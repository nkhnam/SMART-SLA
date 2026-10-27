import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AgreementPartyRole, AgreementStatus, InvitationStatus, MembershipRole } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrganizationAuthContext } from "./agreement.types.js";
import { resolveAgreementPartyRoles } from "./agreement-party.js";

const invitationTtlMs = 7 * 24 * 60 * 60 * 1000;

function requireApprovalRole(context: OrganizationAuthContext): void {
  if (context.organization.role === MembershipRole.MEMBER) {
    throw new ForbiddenException("Only organization OWNER or ADMIN members can approve participation.");
  }
}

function assertPartyRole(role: AgreementPartyRole): AgreementPartyRole {
  return role;
}

@Injectable()
export class AgreementParticipationService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvitation(context: OrganizationAuthContext, agreementId: string, organizationId: string) {
    requireApprovalRole(context);
    if (organizationId === context.organization.id) throw new BadRequestException("An organization cannot invite itself.");

    const [agreement, counterparty] = await Promise.all([
      this.prisma.agreement.findFirst({
        where: { id: agreementId, ownerOrganizationId: context.organization.id },
        select: { id: true, version: true, status: true }
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, organizationType: true }
      })
    ]);
    if (!agreement || !counterparty) throw new NotFoundException("Agreement or counterparty organization not found.");
    if (agreement.status !== AgreementStatus.DRAFT) throw new ConflictException("Only a draft agreement can invite a counterparty.");
    resolveAgreementPartyRoles(context.organization.organizationType, counterparty.organizationType);

    const expiresAt = new Date(Date.now() + invitationTtlMs);
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.agreement.updateMany({
        where: {
          id: agreement.id,
          ownerOrganizationId: context.organization.id,
          status: AgreementStatus.DRAFT,
          version: agreement.version
        },
        data: { status: AgreementStatus.AWAITING_COUNTERPARTY }
      });
      if (changed.count !== 1) throw new ConflictException("This agreement changed. Reload it before inviting a counterparty.");

      const invitation = await transaction.agreementInvitation.create({
        data: {
          agreementId: agreement.id,
          agreementVersion: agreement.version,
          inviterOrganizationId: context.organization.id,
          invitedOrganizationId: counterparty.id,
          invitedByUserId: context.user.id,
          status: InvitationStatus.PENDING,
          expiresAt
        },
        select: {
          id: true,
          agreementId: true,
          agreementVersion: true,
          invitedOrganizationId: true,
          status: true,
          expiresAt: true,
          createdAt: true
        }
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement_invitation",
          resourceId: invitation.id,
          action: "agreement.counterparty.invited",
          metadata: { agreementId, version: agreement.version, invitedOrganizationId: counterparty.id }
        }
      });
      return { ...invitation, invitedOrganization: counterparty };
    });
  }

  async listInvitations(context: OrganizationAuthContext) {
    const invitations = await this.prisma.agreementInvitation.findMany({
      where: {
        invitedOrganizationId: context.organization.id,
        status: InvitationStatus.PENDING
      },
      include: {
        agreement: { select: { id: true, reference: true, version: true, status: true } },
        inviterOrganization: { select: { id: true, name: true, organizationType: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    return invitations.map(({ agreement, inviterOrganization, ...invitation }) => ({
      ...invitation,
      agreement: {
        id: agreement.id,
        reference: agreement.reference,
        version: invitation.agreementVersion,
        status: agreement.status,
        currentVersion: agreement.version
      },
      inviterOrganization
    }));
  }

  async acceptInvitation(context: OrganizationAuthContext, agreementId: string, invitationId: string) {
    requireApprovalRole(context);
    return this.decideInvitation(context, agreementId, invitationId, InvitationStatus.ACCEPTED);
  }

  async rejectInvitation(context: OrganizationAuthContext, agreementId: string, invitationId: string) {
    requireApprovalRole(context);
    return this.decideInvitation(context, agreementId, invitationId, InvitationStatus.REJECTED);
  }

  private async decideInvitation(
    context: OrganizationAuthContext,
    agreementId: string,
    invitationId: string,
    decision: typeof InvitationStatus.ACCEPTED | typeof InvitationStatus.REJECTED
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const invitation = await transaction.agreementInvitation.findFirst({
        where: {
          id: invitationId,
          agreementId,
          invitedOrganizationId: context.organization.id
        },
        include: {
          agreement: {
            select: {
              id: true,
              ownerOrganizationId: true,
              version: true,
              status: true,
              ownerOrganization: { select: { organizationType: true } }
            }
          },
          invitedOrganization: { select: { organizationType: true } }
        }
      });
      if (!invitation) throw new NotFoundException("Invitation not found.");
      if (invitation.status !== InvitationStatus.PENDING) throw new ConflictException("This invitation is no longer pending.");
      if (invitation.expiresAt.getTime() <= Date.now()) throw new ConflictException("This invitation has expired.");
      if (invitation.agreementVersion !== invitation.agreement.version || invitation.agreement.status !== AgreementStatus.AWAITING_COUNTERPARTY) {
        throw new ConflictException("This invitation no longer matches the current agreement version.");
      }
      const roles = resolveAgreementPartyRoles(
        invitation.agreement.ownerOrganization.organizationType,
        invitation.invitedOrganization.organizationType
      );

      const changed = await transaction.agreementInvitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          agreementVersion: invitation.agreement.version,
          expiresAt: { gt: new Date() }
        },
        data: {
          status: decision,
          decidedByUserId: context.user.id,
          ...(decision === InvitationStatus.ACCEPTED ? { acceptedAt: new Date() } : {})
        }
      });
      if (changed.count !== 1) throw new ConflictException("This invitation was already decided or has expired.");

      if (decision === InvitationStatus.ACCEPTED) {
        await transaction.agreementParticipant.createMany({
          data: [
            {
              agreementId: invitation.agreementId,
              agreementVersion: invitation.agreementVersion,
              organizationId: invitation.inviterOrganizationId,
              role: assertPartyRole(roles.owner)
            },
            {
              agreementId: invitation.agreementId,
              agreementVersion: invitation.agreementVersion,
              organizationId: invitation.invitedOrganizationId,
              role: assertPartyRole(roles.counterparty)
            }
          ]
        });
      }

      const nextStatus = decision === InvitationStatus.ACCEPTED
        ? AgreementStatus.AWAITING_SIGNATURES
        : AgreementStatus.REJECTED;
      const agreementChanged = await transaction.agreement.updateMany({
        where: {
          id: invitation.agreementId,
          version: invitation.agreementVersion,
          status: AgreementStatus.AWAITING_COUNTERPARTY
        },
        data: { status: nextStatus }
      });
      if (agreementChanged.count !== 1) throw new ConflictException("The agreement changed while this invitation was being decided.");
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement_invitation",
          resourceId: invitation.id,
          action: decision === InvitationStatus.ACCEPTED ? "agreement.counterparty.accepted" : "agreement.counterparty.rejected",
          metadata: { agreementId, version: invitation.agreementVersion }
        }
      });
      return { id: invitation.id, agreementId, version: invitation.agreementVersion, status: decision };
    });
  }
}
