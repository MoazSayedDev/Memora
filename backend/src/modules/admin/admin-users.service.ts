import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ADMIN_EMAIL = 'memora@memora.com';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(requestingUserId: string) {
    const requester = await this.prisma.user.findUnique({
      where: { id: requestingUserId },
      select: { email: true },
    });
    if (requester?.email.toLowerCase() !== ADMIN_EMAIL) {
      throw new ForbiddenException(
        'Access to the admin dashboard is forbidden',
      );
    }

    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        isEmailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
