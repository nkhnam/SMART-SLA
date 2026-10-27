import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AgreementStatus, MembershipRole } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { BlockchainNetworkService } from "./blockchain-network.service.js";
import { recoverWalletLinkSigner, walletLinkChallengeTypedData } from "./wallet-link.js";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { serializeTypedData } from "./agreement-hash.service.js";

const challengeTtlMs = 5 * 60 * 1000;

function requireSignerAdmin(context: OrganizationAuthContext): void {
  if (context.organization.role === MembershipRole.MEMBER) {
    throw new ForbiddenException("Only organization OWNER or ADMIN members can authorize a signer wallet.");
  }
}

@Injectable()
export class AuthorizedSignersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchain: BlockchainNetworkService
  ) {}

  async list(context: OrganizationAuthContext) {
    return this.prisma.authorizedSigner.findMany({
      where: { organizationId: context.organization.id, revokedAt: null },
      select: {
        id: true,
        address: true,
        verifiedAt: true,
        user: { select: { id: true, displayName: true } }
      },
      orderBy: { verifiedAt: "desc" }
    });
  }

  async createChallenge(context: OrganizationAuthContext, rawAddress: string) {
    requireSignerAdmin(context);
    const address = getAddress(rawAddress);
    const { chainId, registryAddress } = await this.blockchain.getSigningContext();
    const expiresAt = new Date(Date.now() + challengeTtlMs);
    const nonce = randomBytes(32).toString("hex");
    const challenge = await this.prisma.signerChallenge.create({
      data: {
        organizationId: context.organization.id,
        userId: context.user.id,
        address,
        nonce,
        expiresAt
      },
      select: { id: true }
    });
    const typedData = walletLinkChallengeTypedData({
      organizationId: context.organization.id,
      userId: context.user.id,
      nonce,
      deadline: Math.floor(expiresAt.getTime() / 1000)
    }, chainId, registryAddress);
    return { challengeId: challenge.id, address, expiresAt, typedData: serializeTypedData(typedData) };
  }

  async verifyChallenge(context: OrganizationAuthContext, challengeId: string, signature: `0x${string}`) {
    requireSignerAdmin(context);
    const challenge = await this.prisma.signerChallenge.findFirst({
      where: {
        id: challengeId,
        organizationId: context.organization.id,
        userId: context.user.id,
        consumedAt: null,
        expiresAt: { gt: new Date() }
      }
    });
    if (!challenge) throw new NotFoundException("Signer challenge not found or expired.");

    const { chainId, registryAddress } = await this.blockchain.getSigningContext();
    const typedData = walletLinkChallengeTypedData({
      organizationId: challenge.organizationId,
      userId: challenge.userId,
      nonce: challenge.nonce,
      deadline: Math.floor(challenge.expiresAt.getTime() / 1000)
    }, chainId, registryAddress);
    const recoveredAddress = await recoverWalletLinkSigner(typedData, signature);
    if (recoveredAddress.toLowerCase() !== challenge.address.toLowerCase()) {
      throw new ForbiddenException("The signature does not prove control of the requested wallet.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.signerChallenge.updateMany({
        where: {
          id: challenge.id,
          organizationId: context.organization.id,
          userId: context.user.id,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (consumed.count !== 1) throw new ConflictException("This signer challenge was already used or expired.");

      const existing = await transaction.authorizedSigner.findUnique({
        where: {
          organizationId_address: {
            organizationId: context.organization.id,
            address: challenge.address
          }
        }
      });
      if (existing && existing.userId !== context.user.id) {
        throw new ConflictException("This wallet is already authorized to another member of the organization.");
      }
      const signer = existing
        ? await transaction.authorizedSigner.update({
            where: { id: existing.id },
            data: { verifiedAt: new Date(), revokedAt: null },
            select: { id: true, address: true, verifiedAt: true }
          })
        : await transaction.authorizedSigner.create({
            data: {
              organizationId: context.organization.id,
              userId: context.user.id,
              address: challenge.address
            },
            select: { id: true, address: true, verifiedAt: true }
          });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "authorized_signer",
          resourceId: signer.id,
          action: "organization.signer.wallet_linked",
          metadata: { address: signer.address }
        }
      });
      return signer;
    });
  }

  async revoke(context: OrganizationAuthContext, signerId: string) {
    requireSignerAdmin(context);
    return this.prisma.$transaction(async (transaction) => {
      const signer = await transaction.authorizedSigner.findFirst({
        where: { id: signerId, organizationId: context.organization.id, revokedAt: null },
        select: { id: true, address: true }
      });
      if (!signer) throw new NotFoundException("Authorized signer not found.");
      const inUse = await transaction.signingSnapshot.findFirst({
        where: {
          agreement: {
            ownerOrganizationId: context.organization.id,
            status: { in: [AgreementStatus.AWAITING_SIGNATURES, AgreementStatus.ANCHOR_PENDING] }
          },
          OR: [{ buyerSigner: signer.address }, { supplierSigner: signer.address }],
          invalidatedAt: null
        },
        select: { id: true }
      });
      if (inUse) throw new ConflictException("This wallet is bound to an active signing snapshot and cannot be revoked yet.");
      await transaction.authorizedSigner.update({ where: { id: signer.id }, data: { revokedAt: new Date() } });
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "authorized_signer",
          resourceId: signer.id,
          action: "organization.signer.wallet_revoked",
          metadata: { address: signer.address }
        }
      });
      return { id: signer.id, revoked: true };
    });
  }
}
