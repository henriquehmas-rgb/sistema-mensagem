import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { UserStatusService } from '../auth/user-status.service';
import { toUserDto, type PaginatedDto, type UserDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { PaginationQuery } from '../common/dto/pagination.query';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly userStatus: UserStatusService,
  ) {}

  async list(query: PaginationQuery): Promise<PaginatedDto<UserDto>> {
    const [data, total] = await Promise.all([
      this.prisma.tenant.user.findMany({
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.user.count(),
    ]);
    return {
      data: data.map(toUserDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** GET /users/agents — usuários ativos para atribuição (todos os papéis). */
  async agents(): Promise<UserDto[]> {
    const users = await this.prisma.tenant.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return users.map(toUserDto);
  }

  async get(id: string): Promise<UserDto> {
    return toUserDto(await this.findOrThrow(id));
  }

  async create(dto: CreateUserDto): Promise<UserDto> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      const user = await this.prisma.tenant.user.create({
        data: {
          // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
          orgId: this.tenancy.getOrgIdOrThrow(),
          name: dto.name,
          email: dto.email.toLowerCase(),
          passwordHash,
          role: dto.role ?? 'AGENT',
          avatarUrl: dto.avatarUrl ?? null,
        },
      });
      await this.audit.log({ action: 'user.create', entity: 'User', entityId: user.id });
      return toUserDto(user);
    } catch (error) {
      throw this.mapUniqueViolation(error, 'Email já cadastrado nesta organização');
    }
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<UserDto> {
    await this.findOrThrow(id);
    if (id === actor.userId && dto.isActive === false) {
      throw new ForbiddenException('Não é possível desativar o próprio usuário');
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password !== undefined) {
      data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    }

    try {
      const user = await this.prisma.tenant.user.update({ where: { id }, data });
      if (dto.isActive !== undefined) {
        this.userStatus.invalidate(id);
      }
      await this.audit.log({
        action: 'user.update',
        entity: 'User',
        entityId: id,
        meta: { fields: Object.keys(data).filter((key) => key !== 'passwordHash') },
      });
      return toUserDto(user);
    } catch (error) {
      throw this.mapUniqueViolation(error, 'Email já cadastrado nesta organização');
    }
  }

  /**
   * DELETE /users/:id — desativação (soft delete): preserva histórico de
   * mensagens/audit e revoga sessões. Hard delete destruiria a autoria.
   */
  async remove(id: string, actor: AuthUser): Promise<{ success: true }> {
    if (id === actor.userId) {
      throw new ForbiddenException('Não é possível remover o próprio usuário');
    }
    await this.findOrThrow(id);
    await this.prisma.tenant.user.update({ where: { id }, data: { isActive: false } });
    this.userStatus.invalidate(id);
    await this.prisma.prismaSystem.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({ action: 'user.deactivate', entity: 'User', entityId: id });
    return { success: true };
  }

  private async findOrThrow(id: string): Promise<User> {
    const user = await this.prisma.tenant.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }
    return user;
  }

  private mapUniqueViolation(error: unknown, message: string): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(message);
    }
    return error as Error;
  }
}
