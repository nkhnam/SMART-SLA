import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.guard';

export const ROLES = ['ADMIN', 'OPERATIONS', 'LEGAL', 'PM'];

// Admin nền tảng (team SMART_SLA): danh sách email trong biến môi trường PLATFORM_ADMIN_EMAILS, cách nhau bởi dấu phẩy
const isPlatformAdmin = (email: string) =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chức vụ: không bắt buộc, tối đa 100 ký tự
const cleanJobTitle = (raw: unknown): string | null => {
  const t = String(raw ?? '').trim();
  if (t.length > 100) throw new BadRequestException('Chức vụ tối đa 100 ký tự');
  return t || null;
};

// Khóa tạm tài khoản: sai mật khẩu MAX_FAILED lần liên tiếp -> khóa LOCK_MINUTES phút
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private checkCredentials(email: string, password: string) {
    if (!EMAIL_RE.test(email)) throw new BadRequestException('Email không hợp lệ');
    if (!password || password.length < 8) throw new BadRequestException('Mật khẩu tối thiểu 8 ký tự');
  }

  // Đăng ký doanh nghiệp mới + tài khoản Admin đầu tiên
  // accountType: BUYER (bên mua dịch vụ) | SUPPLIER (nhà cung cấp)
  async register(dto: any) {
    const email = String(dto?.email ?? '').trim().toLowerCase();
    const password = String(dto?.password ?? '');
    const fullName = String(dto?.fullName ?? '').trim();
    const orgName = String(dto?.orgName ?? '').trim();
    const orgType = dto?.accountType === 'SUPPLIER' ? 'SUPPLIER' : 'BUYER';
    const jobTitle = cleanJobTitle(dto?.jobTitle);

    this.checkCredentials(email, password);
    if (!fullName || !orgName) throw new BadRequestException('Cần nhập họ tên và tên doanh nghiệp');
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email đã được đăng ký');
    }
    if (await this.prisma.organization.findUnique({ where: { email } })) {
      throw new ConflictException('Email đã được dùng cho một doanh nghiệp khác');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: orgName, email, orgType } });

      // Nhà cung cấp: gắn tài khoản với hồ sơ Provider (Marketplace)
      if (orgType === 'SUPPLIER') {
        const existing = await tx.provider.findUnique({ where: { name: orgName } });
        if (existing?.organizationId) throw new ConflictException('Nhà cung cấp này đã có tài khoản');
        if (existing) {
          await tx.provider.update({ where: { id: existing.id }, data: { organizationId: org.id } });
        } else {
          await tx.provider.create({
            data: { name: orgName, serviceType: String(dto?.serviceType ?? '').trim().slice(0, 100) || 'IT Services', organizationId: org.id },
          });
        }
      }

      return tx.user.create({
        data: { email, passwordHash, fullName, jobTitle, role: 'ADMIN', organizationId: org.id },
        include: { organization: true },
      });
    });

    return this.issue(user);
  }

  async login(dto: any) {
    const email = String(dto?.email ?? '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, include: { organization: true } });

    // Tài khoản đang bị khóa tạm vì sai mật khẩu nhiều lần
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`Đăng nhập sai quá nhiều lần, vui lòng thử lại sau ${minutes} phút`);
    }

    const passwordOk = !!user && (await bcrypt.compare(String(dto?.password ?? ''), user.passwordHash));

    if (!passwordOk) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data:
            failed >= MAX_FAILED
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
              : { failedLoginCount: failed },
        });
      }
      // Cùng 1 thông báo cho cả 2 trường hợp -> không lộ email nào đã tồn tại
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    if (!user.isActive) throw new UnauthorizedException('Tài khoản đã bị vô hiệu hoá');

    // Đăng nhập đúng -> xoá bộ đếm sai
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }
    return this.issue(user);
  }

  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      include: { organization: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Tài khoản không còn hiệu lực');
    return this.publicUser(user);
  }

  // Tự sửa hồ sơ: họ tên, chức vụ; đổi mật khẩu (phải nhập đúng mật khẩu hiện tại)
  async updateProfile(auth: AuthUser, dto: any) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Tài khoản không còn hiệu lực');

    const data: { fullName?: string; jobTitle?: string | null; passwordHash?: string } = {};
    if (dto?.fullName !== undefined) {
      const fullName = String(dto.fullName).trim();
      if (!fullName) throw new BadRequestException('Họ tên không được để trống');
      if (fullName.length > 100) throw new BadRequestException('Họ tên tối đa 100 ký tự');
      data.fullName = fullName;
    }
    if (dto?.jobTitle !== undefined) data.jobTitle = cleanJobTitle(dto.jobTitle);
    if (dto?.newPassword) {
      const newPassword = String(dto.newPassword);
      if (newPassword.length < 8) throw new BadRequestException('Mật khẩu mới tối thiểu 8 ký tự');
      const ok = await bcrypt.compare(String(dto?.currentPassword ?? ''), user.passwordHash);
      if (!ok) throw new BadRequestException('Mật khẩu hiện tại không đúng');
      data.passwordHash = await bcrypt.hash(newPassword, 10);
    }
    if (!Object.keys(data).length) throw new BadRequestException('Không có thông tin nào để cập nhật');

    const updated = await this.prisma.user.update({ where: { id: user.id }, data, include: { organization: true } });
    return this.publicUser(updated);
  }

  // Admin thêm thành viên vào doanh nghiệp của mình (Legal, Operations, PM...)
  async createMember(admin: AuthUser, dto: any) {
    const email = String(dto?.email ?? '').trim().toLowerCase();
    const password = String(dto?.password ?? '');
    const fullName = String(dto?.fullName ?? '').trim();
    const role = String(dto?.role ?? 'OPERATIONS').toUpperCase();
    const jobTitle = cleanJobTitle(dto?.jobTitle);

    this.checkCredentials(email, password);
    if (!fullName) throw new BadRequestException('Cần nhập họ tên');
    if (!ROLES.includes(role)) throw new BadRequestException(`Vai trò phải là: ${ROLES.join(', ')}`);
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email đã được đăng ký');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        fullName,
        jobTitle,
        role,
        passwordHash: await bcrypt.hash(password, 10),
        organizationId: admin.orgId,
      },
      include: { organization: true },
    });
    return this.publicUser(user);
  }

  async listMembers(auth: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: auth.orgId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.publicUser(u));
  }

  private issue(user: any) {
    const accessToken = this.jwt.sign({
      sub: user.id,
      orgId: user.organizationId,
      role: user.role,
      pa: isPlatformAdmin(user.email),
    });
    return { accessToken, user: this.publicUser(user) };
  }

  // Không bao giờ trả passwordHash ra ngoài
  private publicUser(u: any) {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      jobTitle: u.jobTitle ?? null,
      role: u.role,
      isActive: u.isActive,
      platformAdmin: isPlatformAdmin(u.email),
      organization: { id: u.organization.id, name: u.organization.name, orgType: u.organization.orgType },
    };
  }
}
