import { BadRequestException, CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { isUUID } from "class-validator";
import { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";

@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) throw new NotFoundException();

    const organizationId = request.headers["x-organization-id"];
    if (typeof organizationId !== "string") {
      throw new BadRequestException("Select an organization context.");
    }
    if (!isUUID(organizationId)) throw new NotFoundException("Organization not found.");

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: auth.user.id, organizationId } },
      include: { organization: { select: { id: true, name: true, organizationType: true } } }
    });
    if (!membership) throw new NotFoundException("Organization not found.");

    auth.organization = {
      id: membership.organization.id,
      name: membership.organization.name,
      organizationType: membership.organization.organizationType,
      role: membership.role
    };
    return true;
  }
}
