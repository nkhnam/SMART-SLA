import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { parse as parseCookie } from "cookie";
import type { Request } from "express";
import { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";

export const SESSION_COOKIE_NAME = "sladex_session";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseCookie((request as Request).headers.cookie ?? "")[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException("Authentication required.");

    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });
    if (!session) throw new UnauthorizedException("Authentication required.");

    request.auth = {
      user: session.user,
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt
    };
    return true;
  }
}
