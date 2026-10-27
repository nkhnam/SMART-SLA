import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MembershipRole } from "../generated/prisma/client.js";
import { createHash, randomBytes } from "node:crypto";
import { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";
import type { AppEnvironment } from "../config/env.schema.js";
import { PrismaService } from "../database/prisma.service.js";
import type { AuthenticatedUser } from "./auth.types.js";
import type { LoginDto, RegisterDto } from "./auth.dto.js";

type SessionGrant = {
  user: AuthenticatedUser;
  token: string;
  expiresAt: Date;
};

function normalizeEmail(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>
  ) {}

  async register(input: RegisterDto): Promise<SessionGrant & { organization: { id: string; name: string; organizationType: string } }> {
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const token = newSessionToken();
    const expiresAt = this.expirationDate();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email,
            passwordHash,
            displayName: input.displayName.normalize("NFC").trim()
          },
          select: { id: true, email: true, displayName: true }
        });
        const organization = await transaction.organization.create({
          data: {
            name: input.organizationName.normalize("NFC").trim(),
            organizationType: input.organizationType
          },
          select: { id: true, name: true, organizationType: true }
        });
        await transaction.membership.create({
          data: { userId: user.id, organizationId: organization.id, role: MembershipRole.OWNER }
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: user.id,
            organizationId: organization.id,
            resourceType: "organization",
            resourceId: organization.id,
            action: "organization.registered",
            metadata: { organizationType: input.organizationType }
          }
        });
        await transaction.session.create({
          data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt }
        });
        return { user, organization };
      });
      return { ...result, token, expiresAt };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("An account with this email already exists.");
      }
      throw error;
    }
  }

  async login(input: LoginDto): Promise<SessionGrant> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });
    const passwordHash = user?.passwordHash ?? await this.dummyPasswordHash;
    const passwordMatches = await verifyPassword(passwordHash, input.password);
    if (!user || !passwordMatches) {
      throw new UnauthorizedException("Email or password is incorrect.");
    }

    const token = newSessionToken();
    const expiresAt = this.expirationDate();
    await this.prisma.session.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt }
    });

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      token,
      expiresAt
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  private expirationDate(): Date {
    const hours = this.config.getOrThrow("SESSION_TTL_HOURS", { infer: true });
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}
