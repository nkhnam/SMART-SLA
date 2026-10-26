import type { MembershipRole } from "../generated/prisma/client.js";

export type OrganizationAuthContext = {
  user: { id: string; email: string; displayName: string };
  sessionId: string;
  sessionExpiresAt: Date;
  organization: { id: string; name: string; role: MembershipRole };
};
