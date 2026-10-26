import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanService } from '../billing/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlaBuilderService } from './sla-builder.service';
import { AuthUser } from '../auth/auth.guard';

// DỊCH VỤ TRÊN MARKETPLACE
// Nhà cung cấp soạn (DRAFT) -> gửi duyệt (PENDING) -> admin duyệt (APPROVED, hiện trên Marketplace)
//                                                  -> hoặc từ chối (REJECTED, kèm lý do)
// Sửa dịch vụ đã duyệt -> quay về PENDING (tạm ẩn) để nội dung trên Marketplace luôn đã được kiểm tra.
const MAX_TEXT = 3000;

@Injectable()
export class ListingService {
  constructor(
    private prisma: PrismaService,
    private builder: SlaBuilderService,
    private plans: PlanService,
  ) {}

  private async myProvider(user: AuthUser) {
    const provider = await this.prisma.provider.findUnique({ where: { organizationId: user.orgId } });
    if (!provider) throw new ForbiddenException('Chỉ tài khoản nhà cung cấp mới quản lý dịch vụ trên Marketplace');
    return provider;
  }

  // Kiểm tra + chuẩn hoá nội dung dịch vụ (dùng chung bộ kiểm tra KPI của SLA Builder)
  private normalize(body: any) {
    const title = String(body?.title ?? '').trim();
    if (!title || title.length > 150) throw new BadRequestException('Tên dịch vụ từ 1 đến 150 ký tự');
    const category = String(body?.category ?? '').trim().slice(0, 80) || 'Dịch vụ số';
    const description = String(body?.description ?? '').trim();
    if (description.length > MAX_TEXT) throw new BadRequestException(`Mô tả tối đa ${MAX_TEXT} ký tự`);
    const website = String(body?.website ?? '').trim();
    if (website && !/^https?:\/\/\S+$/i.test(website)) throw new BadRequestException('Website phải bắt đầu bằng http:// hoặc https://');
    const priceNote = String(body?.priceNote ?? '').trim().slice(0, 150);

    const built = this.builder.buildKpis({ kpis: body?.kpis, challengeWindowHours: body?.challengeWindowHours });
    return {
      title,
      category,
      description,
      website: website || null,
      priceNote: priceNote || null,
      challengeWindowHours: built.challengeWindowHours,
      kpis: built.kpis as any,
      additionalConditions: this.builder.normalizeConditions(body?.additionalConditions),
    };
  }

  // Nhà cung cấp
  async mine(user: AuthUser) {
    const provider = await this.myProvider(user);
    return this.prisma.serviceListing.findMany({ where: { providerId: provider.id }, orderBy: { updatedAt: 'desc' } });
  }

  async create(user: AuthUser, body: any) {
    await this.plans.requireActive(user.orgId);
    const provider = await this.myProvider(user);
    const data = this.normalize(body);
    const submit = body?.submit === true;
    return this.prisma.serviceListing.create({
      data: {
        ...data,
        providerId: provider.id,
        createdById: user.userId,
        status: submit ? 'PENDING' : 'DRAFT',
        submittedAt: submit ? new Date() : null,
      },
    });
  }

  async update(user: AuthUser, id: string, body: any) {
    await this.plans.requireActive(user.orgId);
    const provider = await this.myProvider(user);
    const listing = await this.prisma.serviceListing.findUnique({ where: { id } });
    if (!listing || listing.providerId !== provider.id) throw new NotFoundException('Không tìm thấy dịch vụ');
    const data = this.normalize(body);
    const submit = body?.submit === true;
    return this.prisma.serviceListing.update({
      where: { id },
      data: {
        ...data,
        // Sửa xong: gửi duyệt lại (hoặc về nháp). Bản đã duyệt cũng bị ẩn cho tới khi được duyệt lại.
        status: submit ? 'PENDING' : 'DRAFT',
        submittedAt: submit ? new Date() : listing.submittedAt,
        rejectReason: null,
        reviewedAt: null,
        reviewedById: null,
      },
    });
  }

  async submit(user: AuthUser, id: string) {
    await this.plans.requireActive(user.orgId);
    const provider = await this.myProvider(user);
    const listing = await this.prisma.serviceListing.findUnique({ where: { id } });
    if (!listing || listing.providerId !== provider.id) throw new NotFoundException('Không tìm thấy dịch vụ');
    if (!['DRAFT', 'REJECTED'].includes(listing.status)) throw new BadRequestException('Dịch vụ đang chờ duyệt hoặc đã được duyệt');
    return this.prisma.serviceListing.update({
      where: { id },
      data: { status: 'PENDING', submittedAt: new Date(), rejectReason: null },
    });
  }

  // Marketplace (người dùng đã đăng nhập)
  // Dịch vụ đã duyệt. Nhà cung cấp gói Enterprise được ưu tiên lên đầu (featured).
  async publicList() {
    const rows = await this.prisma.serviceListing.findMany({
      where: { status: 'APPROVED' },
      orderBy: { reviewedAt: 'desc' },
      include: { provider: { select: { id: true, name: true, serviceType: true, organizationId: true } } },
    });
    const withFlag = await Promise.all(
      rows.map(async (r) => {
        let featured = false;
        if (r.provider.organizationId) {
          try {
            const s = await this.plans.getState(r.provider.organizationId);
            featured = s.active && s.limits.featured;
          } catch {
            /* bỏ qua */
          }
        }
        return { ...r, featured };
      }),
    );
    return withFlag.sort((a, b) => Number(b.featured) - Number(a.featured));
  }

  // Dịch vụ đã duyệt: ai cũng xem được. Chưa duyệt: chỉ chủ dịch vụ hoặc admin nền tảng.
  async getOne(id: string, user: AuthUser) {
    const listing = await this.prisma.serviceListing.findUnique({
      where: { id },
      include: { provider: { select: { id: true, name: true, serviceType: true, organizationId: true } } },
    });
    if (!listing) throw new NotFoundException('Không tìm thấy dịch vụ');
    const isOwner = listing.provider.organizationId === user.orgId;
    if (listing.status !== 'APPROVED' && !isOwner && !user.platformAdmin) throw new NotFoundException('Không tìm thấy dịch vụ');
    return listing;
  }

  // Admin nền tảng
  adminList(status?: string) {
    return this.prisma.serviceListing.findMany({
      where: status && status !== 'ALL' ? { status } : { status: { not: 'DRAFT' } },
      orderBy: [{ submittedAt: 'desc' }],
      include: { provider: { select: { id: true, name: true } } },
    });
  }

  async review(admin: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', reason?: string) {
    const listing = await this.prisma.serviceListing.findUnique({ where: { id }, include: { provider: true } });
    if (!listing) throw new NotFoundException('Không tìm thấy dịch vụ');
    if (listing.status !== 'PENDING') throw new BadRequestException('Chỉ xử lý được dịch vụ đang chờ duyệt');
    const why = String(reason ?? '').trim();
    if (decision === 'REJECT' && !why) throw new BadRequestException('Cần ghi lý do từ chối');

    const updated = await this.prisma.serviceListing.update({
      where: { id },
      data: {
        status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        rejectReason: decision === 'REJECT' ? why.slice(0, 1000) : null,
        reviewedAt: new Date(),
        reviewedById: admin.userId,
      },
    });

    // Báo cho nhà cung cấp (chuông thông báo)
    if (listing.provider.organizationId) {
      await this.prisma.notification.create({
        data: {
          organizationId: listing.provider.organizationId,
          type: decision === 'APPROVE' ? 'LISTING_APPROVED' : 'LISTING_REJECTED',
          title: decision === 'APPROVE' ? `Dịch vụ "${listing.title}" đã được duyệt` : `Dịch vụ "${listing.title}" bị từ chối`,
          message:
            decision === 'APPROVE'
              ? 'Dịch vụ đã hiển thị trên Marketplace. Khách hàng có thể chọn "Sử dụng dịch vụ" để tạo hợp đồng với bạn.'
              : `Lý do: ${why}. Bạn có thể chỉnh sửa và gửi duyệt lại trong Marketplace → Quản lý dịch vụ.`,
        },
      });
    }
    return updated;
  }
}
