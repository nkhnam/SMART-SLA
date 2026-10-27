import type { MembershipRole, OrganizationType } from "../generated/prisma/client.js";
import type { Request } from "express";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AuthenticatedRequest = Request & {
  auth?: {
    user: AuthenticatedUser;
    sessionId: string;
    sessionExpiresAt: Date;
    organization?: {
      id: string;
      name: string;
      organizationType: OrganizationType;
      role: MembershipRole;
    };
  };
};
