import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth.types.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";

export const AuthContext = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) throw new UnauthorizedException("Authentication required.");
  return request.auth;
});

export const OrganizationAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth?.organization) throw new UnauthorizedException("Select an organization context.");
  return request.auth as OrganizationAuthContext;
});
