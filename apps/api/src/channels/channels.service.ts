import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelStatus, ChannelType, type Channel, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateChannelDto } from './dto/create-channel.dto';
import type { UpdateChannelDto } from './dto/update-channel.dto';
import { MetaGraphService } from './meta-graph.service';

const MAX_CREDENTIALS_BYTES = 8 * 1024;

/** Forma pública do canal — credenciais NUNCA saem da API (CONTRACTS §6/§9). */
export interface ChannelDto {
  id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  config: Record<string, unknown>;
  externalId: string | null;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelTestResultDto {
  success: boolean;
  status: ChannelStatus;
  message: string;
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly metaGraph: MetaGraphService,
  ) {}

  /** GET /channels */
  async list(): Promise<ChannelDto[]> {
    const channels = await this.prisma.tenant.channel.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return channels.map((channel) => this.toDto(channel));
  }

  /** POST /channels — credenciais cifradas com AES-256-GCM antes de persistir. */
  async create(dto: CreateChannelDto): Promise<ChannelDto> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const config = await this.resolveConfig(orgId, dto.type, dto.config);
    const channel = await this.prisma.tenant.channel.create({
      data: {
        // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
        orgId,
        type: dto.type,
        name: dto.name,
        config: config as Prisma.InputJsonValue,
        encryptedCredentials: this.encryptCredentials(dto.credentials),
        externalId: dto.externalId ?? null,
      },
    });
    await this.audit.log({
      action: 'channel.create',
      entity: 'Channel',
      entityId: channel.id,
      meta: { type: dto.type, name: dto.name }, // nunca logar credenciais
    });
    return this.toDto(channel);
  }

  /** PATCH /channels/:id — credentials informadas SUBSTITUEM as anteriores. */
  async update(id: string, dto: UpdateChannelDto): Promise<ChannelDto> {
    const existing = await this.findOrThrow(id);

    const data: Prisma.ChannelUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.config !== undefined) {
      data.config = (await this.resolveConfig(
        existing.orgId,
        existing.type,
        dto.config,
      )) as Prisma.InputJsonValue;
    }
    if (dto.externalId !== undefined) data.externalId = dto.externalId;
    if (dto.credentials !== undefined) {
      data.encryptedCredentials = this.encryptCredentials(dto.credentials);
    }

    const channel = await this.prisma.tenant.channel.update({ where: { id }, data });
    await this.audit.log({
      action: 'channel.update',
      entity: 'Channel',
      entityId: id,
      meta: {
        fields: Object.keys(data).map((key) =>
          key === 'encryptedCredentials' ? 'credentials' : key,
        ),
      },
    });
    return this.toDto(channel);
  }

  /**
   * POST /channels/:id/test — valida as credenciais contra a Graph API
   * (WHATSAPP/INSTAGRAM) e atualiza Channel.status (ACTIVE/ERROR) com o resultado.
   * WEBCHAT não tem credenciais externas: sempre ok.
   */
  async test(id: string): Promise<ChannelTestResultDto> {
    const channel = await this.findOrThrow(id);

    if (channel.type === ChannelType.WEBCHAT) {
      return { success: true, status: channel.status, message: 'Webchat não requer credenciais' };
    }

    const credentials = this.metaGraph.decryptCredentials(channel);
    if (!credentials) {
      return this.applyTestResult(id, false, 'Canal sem credenciais configuradas');
    }

    try {
      await this.metaGraph.testChannel({
        ...credentials,
        // phoneNumberId pode vir das credenciais ou do externalId do canal
        phoneNumberId:
          typeof credentials.phoneNumberId === 'string' && credentials.phoneNumberId
            ? credentials.phoneNumberId
            : (channel.externalId ?? ''),
      });
      return this.applyTestResult(id, true, 'Credenciais válidas');
    } catch (error) {
      return this.applyTestResult(id, false, (error as Error).message);
    }
  }

  private async applyTestResult(
    id: string,
    success: boolean,
    message: string,
  ): Promise<ChannelTestResultDto> {
    const status = success ? ChannelStatus.ACTIVE : ChannelStatus.ERROR;
    await this.prisma.tenant.channel.update({ where: { id }, data: { status } });
    await this.audit.log({
      action: 'channel.test',
      entity: 'Channel',
      entityId: id,
      meta: { success, message },
    });
    return { success, status, message };
  }

  /**
   * Config server-autoritativa: para canais WEBCHAT, `config.orgSlug` é SEMPRE
   * o slug real da organização autenticada (o widget resolve a org por esse
   * slug — um valor livre digitado geraria um snippet quebrado sem feedback).
   * Valor divergente informado pelo cliente → 400 explícito.
   */
  private async resolveConfig(
    orgId: string,
    type: ChannelType,
    config: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const base = config ?? {};
    if (type !== ChannelType.WEBCHAT) {
      return base;
    }
    // Organization não é modelo tenant-escopado — leitura via prismaSystem com id explícito.
    const org = await this.prisma.prismaSystem.organization.findUnique({
      where: { id: orgId },
      select: { slug: true },
    });
    if (!org) {
      throw new NotFoundException('Organização não encontrada');
    }
    const provided = base.orgSlug;
    if (typeof provided === 'string' && provided.length > 0 && provided !== org.slug) {
      throw new BadRequestException(
        `config.orgSlug não corresponde ao slug da organização ("${org.slug}")`,
      );
    }
    return { ...base, orgSlug: org.slug };
  }

  private encryptCredentials(credentials: Record<string, unknown> | undefined): string {
    if (!credentials || Object.keys(credentials).length === 0) {
      return '';
    }
    const serialized = JSON.stringify(credentials);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CREDENTIALS_BYTES) {
      throw new BadRequestException('credentials excede o tamanho máximo permitido (8KB)');
    }
    return this.crypto.encrypt(serialized);
  }

  private async findOrThrow(id: string): Promise<Channel> {
    const channel = await this.prisma.tenant.channel.findUnique({ where: { id } });
    if (!channel) {
      throw new NotFoundException('Canal não encontrado');
    }
    return channel;
  }

  private toDto(channel: Channel): ChannelDto {
    return {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      status: channel.status,
      config:
        typeof channel.config === 'object' && channel.config !== null && !Array.isArray(channel.config)
          ? (channel.config as Record<string, unknown>)
          : {},
      externalId: channel.externalId,
      hasCredentials: channel.encryptedCredentials.length > 0,
      createdAt: channel.createdAt.toISOString(),
      updatedAt: channel.updatedAt.toISOString(),
    };
  }
}
