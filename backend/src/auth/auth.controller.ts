import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { AppEnvironment } from "../config/env.schema.js";
import { AuthContext } from "./auth-context.decorator.js";
import { AuthService } from "./auth.service.js";
import { LoginDto, RegisterDto } from "./auth.dto.js";
import { SESSION_COOKIE_NAME, SessionGuard } from "./session.guard.js";
import type { AuthenticatedRequest } from "./auth.types.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppEnvironment, true>
  ) {}

  @Post("register")
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: "Register a user and create an organization" })
  async register(@Body() input: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.register(input);
    this.setSessionCookie(response, result.token, result.expiresAt);
    return { user: result.user, organization: result.organization, expiresAt: result.expiresAt };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({ summary: "Create a server-side session" })
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(input);
    this.setSessionCookie(response, result.token, result.expiresAt);
    return { user: result.user, expiresAt: result.expiresAt };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Revoke the current session" })
  async logout(
    @AuthContext() context: NonNullable<AuthenticatedRequest["auth"]>,
    @Res({ passthrough: true }) response: Response
  ) {
    await this.auth.logout(context.sessionId);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
    return { success: true };
  }

  @Get("me")
  @UseGuards(SessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Get the current authenticated user" })
  me(@AuthContext() context: NonNullable<AuthenticatedRequest["auth"]>) {
    return { user: context.user, expiresAt: context.sessionExpiresAt };
  }

  private setSessionCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      ...this.cookieOptions(),
      expires: expiresAt
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow("NODE_ENV", { infer: true }) === "production",
      sameSite: "strict" as const,
      path: "/api/v1"
    };
  }
}
