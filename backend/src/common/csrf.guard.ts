import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { AppEnvironment } from "../config/env.schema.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (safeMethods.has(request.method)) return true;

    const origin = request.headers.origin;
    const allowedOrigins = this.config.getOrThrow("CORS_ORIGINS", { infer: true });
    if (typeof origin !== "string" || !allowedOrigins.includes(origin) || request.headers["x-sla-csrf"] !== "1") {
      throw new ForbiddenException("This request could not be verified.");
    }

    return true;
  }
}
