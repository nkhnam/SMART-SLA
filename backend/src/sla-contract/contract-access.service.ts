import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';

export type Party = 'BUYER' | 'SUPPLIER';

// Xác định doanh nghiệp đang đăng nhập là bên nào trong hợp đồng
@Injectable()
export class ContractAccessService {
  constructor(private prisma: PrismaService) {}

  async getParty(contractId: string, orgId: string): Promise<Party | null> {
    const c = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { provider: true },
    });
    if (!c) throw new NotFoundException('Không tìm thấy hợp đồng');
    if (c.clientId === orgId) return 'BUYER';
    if (c.provider?.organizationId === orgId) return 'SUPPLIER';
    return null;
  }

  // Chỉ bên mua hoặc nhà cung cấp của hợp đồng mới được thao tác
  async assertParty(contractId: string, orgId: string): Promise<Party> {
    const party = await this.getParty(contractId, orgId);
    if (!party) throw new ForbiddenException('Bạn không phải là một bên trong hợp đồng này');
    return party;
  }

  // Điều kiện lọc hợp đồng theo người xem:
  //   admin nền tảng -> tất cả | đã đăng nhập -> chỉ hợp đồng mình là 1 bên | chưa đăng nhập (chế độ cũ) -> tất cả
  scopeWhere(user: AuthUser | null) {
    if (!user || user.platformAdmin) return {};
    return { OR: [{ clientId: user.orgId }, { provider: { organizationId: user.orgId } }] };
  }

  // Xem chi tiết 1 hợp đồng: phải là 1 bên (hoặc admin nền tảng)
  async assertCanView(contractId: string, user: AuthUser | null) {
    if (!user || user.platformAdmin) return;
    await this.assertParty(contractId, user.orgId);
  }
}
