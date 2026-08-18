import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChannelType,
  TemplateCategory,
  TemplateStatus,
  type Channel,
  type MessageTemplate,
  type Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { MetaGraphService, type RawMetaTemplate } from '../channels/meta-graph.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';

/** Forma pública de um MessageTemplate (CONTRACTS §12). */
export interface MessageTemplateResponseDto {
  id: string;
  orgId: string;
  channelId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: Prisma.JsonValue;
  bodyParamsCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
}

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(Object.values(TemplateCategory));
const KNOWN_STATUSES: ReadonlySet<string> = new Set(Object.values(TemplateStatus));

/**
 * Conta os placeholders `{{n}}` ÚNICOS no componente BODY (CONTRACTS §12) —
 * ex.: "Olá {{1}}, seu pedido {{2}} chega em {{2}} dias" → 2 (params 1 e 2).
 */
export function countBodyParams(components: unknown): number {
  const list = Array.isArray(components) ? components : [];
  const body = list.find(
    (component): component is { text?: unknown } =>
      typeof component === 'object' &&
      component !== null &&
      (component as { type?: unknown }).type === 'BODY',
  );
  const text = typeof body?.text === 'string' ? body.text : '';
  const unique = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    if (match[1]) unique.add(match[1]);
  }
  return unique.size;
}

/**
 * Templates de mensagem do WhatsApp (CONTRACTS §12): sincroniza com a Graph
 * API e serve a listagem tenant-scoped. Só canais WHATSAPP têm templates.
 */
@Injectable()
export class TemplatesService {
  // Lock em memória por canal — evita que dois `sync()` concorrentes (duplo
  // clique, dois requests) corram em paralelo e um deles marque DISABLED um
  // template que o outro acabou de trazer como ativo (race na janela entre
  // upsert e updateMany). Suficiente para uma única instância da api; a UI já
  // desabilita o botão durante isPending (baixo risco na prática).
  private readonly syncing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly metaGraph: MetaGraphService,
  ) {}

  /** GET /channels/:id/templates?status= */
  async list(channelId: string, status?: TemplateStatus): Promise<MessageTemplateResponseDto[]> {
    await this.findChannelOrThrow(channelId);
    const templates = await this.prisma.tenant.messageTemplate.findMany({
      where: { channelId, ...(status ? { status } : {}) },
      orderBy: { name: 'asc' },
    });
    return templates.map((template) => this.toDto(template));
  }

  /**
   * POST /channels/:id/templates/sync (ADMIN|SUPERVISOR) — busca a lista atual
   * na Graph API, faz upsert por (channelId, name, language) e marca DISABLED
   * os templates que sumiram da resposta (nunca deleta). Rejeita com 409 se já
   * houver uma sincronização em andamento para o mesmo canal (lock em memória).
   */
  async sync(channelId: string): Promise<MessageTemplateResponseDto[]> {
    if (this.syncing.has(channelId)) {
      throw new ConflictException('Já existe uma sincronização de templates em andamento para este canal');
    }
    this.syncing.add(channelId);
    try {
      return await this.doSync(channelId);
    } finally {
      this.syncing.delete(channelId);
    }
  }

  private async doSync(channelId: string): Promise<MessageTemplateResponseDto[]> {
    const channel = await this.findChannelOrThrow(channelId);
    if (channel.type !== ChannelType.WHATSAPP) {
      throw new BadRequestException(
        'Sincronização de templates é exclusiva de canais WhatsApp',
      );
    }

    const credentials = this.metaGraph.decryptCredentials(channel);
    const wabaId =
      credentials && typeof credentials.wabaId === 'string' ? credentials.wabaId : '';
    if (!credentials || !wabaId) {
      throw new BadRequestException(
        'Canal sem credenciais/WABA ID configurados para sincronizar templates',
      );
    }

    let raw: RawMetaTemplate[];
    try {
      raw = await this.metaGraph.syncTemplates(credentials, wabaId);
    } catch (error) {
      throw new ServiceUnavailableException(
        `Falha ao sincronizar templates com a Meta: ${(error as Error).message}`,
      );
    }

    const orgId = this.tenancy.getOrgIdOrThrow();
    const now = new Date();
    const seen = new Set<string>();

    for (const item of raw) {
      if (typeof item.name !== 'string' || item.name.length === 0) continue;
      if (typeof item.language !== 'string' || item.language.length === 0) continue;

      seen.add(this.templateKey(item.name, item.language));
      const components = Array.isArray(item.components) ? item.components : [];
      const category = KNOWN_CATEGORIES.has(item.category)
        ? (item.category as TemplateCategory)
        : TemplateCategory.UTILITY;
      const status = KNOWN_STATUSES.has(item.status)
        ? (item.status as TemplateStatus)
        : TemplateStatus.PENDING;
      const bodyParamsCount = countBodyParams(components);
      const metaTemplateId = typeof item.id === 'string' ? item.id : null;

      await this.prisma.tenant.messageTemplate.upsert({
        where: {
          channelId_name_language: { channelId, name: item.name, language: item.language },
        },
        create: {
          // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
          orgId,
          channelId,
          name: item.name,
          language: item.language,
          category,
          status,
          components: components as Prisma.InputJsonValue,
          bodyParamsCount,
          metaTemplateId,
          lastSyncedAt: now,
        },
        update: {
          category,
          status,
          components: components as Prisma.InputJsonValue,
          bodyParamsCount,
          metaTemplateId,
          lastSyncedAt: now,
        },
      });
    }

    const existing = await this.prisma.tenant.messageTemplate.findMany({
      where: { channelId },
      select: { id: true, name: true, language: true, status: true },
    });
    const disappearedIds = existing
      .filter(
        (template) =>
          !seen.has(this.templateKey(template.name, template.language)) &&
          template.status !== TemplateStatus.DISABLED,
      )
      .map((template) => template.id);
    if (disappearedIds.length > 0) {
      await this.prisma.tenant.messageTemplate.updateMany({
        where: { id: { in: disappearedIds } },
        data: { status: TemplateStatus.DISABLED },
      });
    }

    await this.audit.log({
      action: 'channel.templates.sync',
      entity: 'Channel',
      entityId: channelId,
      meta: { synced: seen.size, disabled: disappearedIds.length },
    });

    return this.list(channelId);
  }

  private templateKey(name: string, language: string): string {
    return `${name}::${language}`;
  }

  private async findChannelOrThrow(channelId: string): Promise<Channel> {
    const channel = await this.prisma.tenant.channel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new NotFoundException('Canal não encontrado');
    }
    return channel;
  }

  private toDto(template: MessageTemplate): MessageTemplateResponseDto {
    return {
      id: template.id,
      orgId: template.orgId,
      channelId: template.channelId,
      name: template.name,
      language: template.language,
      category: template.category,
      status: template.status,
      components: template.components,
      bodyParamsCount: template.bodyParamsCount,
      lastSyncedAt: template.lastSyncedAt ? template.lastSyncedAt.toISOString() : null,
      createdAt: template.createdAt.toISOString(),
    };
  }
}
