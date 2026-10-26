import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

export type AuthUser = { userId: string; orgId: string; role: string; platformAdmin?: boolean };

// @Roles('ADMIN') -> chỉ vai trò này mới được gọi API
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// @CurrentUser() -> lấy người dùng đang đăng nhập trong controller
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

// Đọc token "Authorization: Bearer <JWT>", không hợp lệ -> trả về null
export function readUser(jwt: JwtService, authHeader?: string): AuthUser | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const p: any = jwt.verify(authHeader.slice(7));
    return { userId: p.sub, orgId: p.orgId, role: p.role, platformAdmin: p.pa === true };
  } catch {
    return null;
  }
}

// Chế độ bắt buộc đăng nhập: đặt REQUIRE_AUTH=true trên Render khi giao diện mới đã có trang đăng nhập.
// Khi chưa bật: người chưa đăng nhập vẫn xem được (giao diện cũ không hỏng) nhưng dữ liệu nhạy cảm bị ẩn.
export function viewerOrThrow(jwt: JwtService, authHeader?: string): AuthUser | null {
  const user = readUser(jwt, authHeader);
  if (!user && process.env.REQUIRE_AUTH === 'true') {
    throw new UnauthorizedException('Cần đăng nhập');
  }
  return user;
}

// Chỉ admin nền tảng (team SLA_DEX) mới được gọi
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = readUser(this.jwt, req.headers.authorization);
    if (!user) throw new UnauthorizedException('Cần đăng nhập');
    if (!user.platformAdmin) throw new ForbiddenException('Chỉ admin nền tảng SLA-DEX mới được thực hiện');
    req.user = user;
    return true;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = readUser(this.jwt, req.headers.authorization);
    if (!user) throw new UnauthorizedException('Cần đăng nhập (token thiếu, sai hoặc đã hết hạn)');
    req.user = user;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException(`Chỉ vai trò ${roles.join(', ')} mới được thực hiện`);
    }
    return true;
  }
}
