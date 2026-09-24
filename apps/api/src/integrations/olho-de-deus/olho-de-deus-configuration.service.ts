import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { OlhoDeDeusIntegration } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import { ConfigureOlhoDeDeusDto } from './dto/configure-olho-de-deus.dto';
import { ReadCircuitBreaker } from './read-circuit-breaker';

const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 8_000;
const AGGREGATE_CACHE_TTL_MS = 15_000;

export interface OlhoDeDeusIntegrationDto {
  baseUrl: string;
  allowedHosts: string[];
  allowInsecureHttp: boolean;
  isEnabled: boolean;
  hasCredentials: boolean;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
  access: 'READ_ONLY';
  affectsRuntimeDecisions: false;
}

export interface OlhoDeDeusAggregateSummary {
  generatedAt: string;
  cacheTtlSeconds: number;
  readOnly: true;
  /** Sem esta associação, telemetria coletiva não é atribuída a um cliente. */
  customerCorrelation: 'PENDING_IXC_TOPOLOGY_MAPPING';
  olts: { total: number; ok: number; stale: number; error: number; unknown: number };
  ruptures: { active: number };
}

interface OlhoCredentials {
  apiKey: string;
}

/**
 * Configuração por organização, equivalente ao IXC, mas deliberadamente
 * limitada ao teste e à leitura agregada dos endpoints técnicos. Não troca o
 * conector de decisão do Omni enquanto não houver vínculo IXC -> OLT/PON.
 */
@Injectable()
export class OlhoDeDeusConfigurationService {
  private readonly aggregateCache = new Map<
    string,
    { expiresAt: number; value: OlhoDeDeusAggregateSummary }
  >();
  private readonly aggregateCircuit = new ReadCircuitBreaker();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async getConfiguration(): Promise<OlhoDeDeusIntegrationDto | null> {
    const integration = await this.prisma.tenant.olhoDeDeusIntegration.findUnique({
      where: { orgId: this.tenancy.getOrgIdOrThrow() },
    });
    return integration ? this.toDto(integration) : null;
  }

  /** Estado administrativo, sem expor rede, chave ou dados de OLT/PON. */
  async readiness(): Promise<{
    status: 'NOT_CONFIGURED' | 'DISABLED' | 'READY_FOR_READ_ONLY';
    readOnly: true;
    affectsRuntimeDecisions: false;
  }> {
    const integration = await this.prisma.tenant.olhoDeDeusIntegration.findUnique({
      where: { orgId: this.tenancy.getOrgIdOrThrow() },
    });
    if (!integration) {
      return { status: 'NOT_CONFIGURED', readOnly: true, affectsRuntimeDecisions: false };
    }
    if (!integration.isEnabled || integration.lastTestSucceeded !== true) {
      return { status: 'DISABLED', readOnly: true, affectsRuntimeDecisions: false };
    }
    return { status: 'READY_FOR_READ_ONLY', readOnly: true, affectsRuntimeDecisions: false };
  }

  /** Consulta real e limitada a métricas agregadas, sem dados de cliente ou topologia. */
  async aggregateSummary(): Promise<OlhoDeDeusAggregateSummary> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const cached = this.aggregateCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!this.aggregateCircuit.allows(orgId)) {
      throw new ServiceUnavailableException('Olho de Deus temporariamente indisponível após falhas consecutivas');
    }

    try {
      const integration = await this.requireIntegration(true);
      const [olts, ruptures] = await Promise.all([
        this.fetchCollection(integration, 'olts'),
        this.fetchCollection(integration, 'rompimentos'),
      ]);
      const counters = { ok: 0, stale: 0, error: 0, unknown: 0 };
      for (const item of olts.items) {
        const status = typeof item.status === 'string' ? item.status.toLowerCase() : '';
        if (status === 'ok') counters.ok += 1;
        else if (status === 'stale') counters.stale += 1;
        else if (status === 'erro' || status === 'error') counters.error += 1;
        else counters.unknown += 1;
      }
      const value: OlhoDeDeusAggregateSummary = {
        generatedAt: new Date().toISOString(),
        cacheTtlSeconds: AGGREGATE_CACHE_TTL_MS / 1_000,
        readOnly: true,
        customerCorrelation: 'PENDING_IXC_TOPOLOGY_MAPPING',
        olts: { total: olts.total, ...counters },
        ruptures: { active: ruptures.total },
      };
      this.aggregateCache.set(orgId, { value, expiresAt: Date.now() + AGGREGATE_CACHE_TTL_MS });
      this.aggregateCircuit.recordSuccess(orgId);
      await this.audit.log({
        action: 'integration.olho-de-deus.aggregate.read',
        entity: 'OlhoDeDeusIntegration',
        entityId: integration.id,
        meta: { olts: value.olts.total, activeRuptures: value.ruptures.active },
      });
      return value;
    } catch (error) {
      this.aggregateCircuit.recordFailure(orgId);
      throw error;
    }
  }

  async configure(dto: ConfigureOlhoDeDeusDto): Promise<OlhoDeDeusIntegrationDto> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const allowedHosts = this.parseAllowedHosts(dto.allowedHosts);
    const baseUrl = this.validateBaseUrl(dto.baseUrl, allowedHosts, dto.allowInsecureHttp);
    const existing = await this.prisma.tenant.olhoDeDeusIntegration.findUnique({ where: { orgId } });
    if (!existing && !dto.apiKey) {
      throw new BadRequestException('A chave da API é obrigatória na primeira configuração');
    }

    const previous = existing ? this.decryptCredentials(existing) : null;
    const apiKey = dto.apiKey ?? previous!.apiKey;
    const normalizedHosts = allowedHosts.join(',');
    const configurationChanged =
      !existing ||
      existing.baseUrl !== baseUrl ||
      existing.allowedHosts !== normalizedHosts ||
      existing.allowInsecureHttp !== dto.allowInsecureHttp ||
      dto.apiKey !== undefined;

    if (dto.isEnabled && (configurationChanged || existing?.lastTestSucceeded !== true)) {
      throw new BadRequestException(
        'Salve a configuração desativada e conclua um teste bem-sucedido antes de habilitar',
      );
    }

    const encryptedCredentials = this.crypto.encrypt(JSON.stringify({ apiKey }));
    const integration = await this.prisma.tenant.olhoDeDeusIntegration.upsert({
      where: { orgId },
      create: {
        orgId,
        baseUrl,
        allowedHosts: normalizedHosts,
        encryptedCredentials,
        allowInsecureHttp: dto.allowInsecureHttp,
        isEnabled: dto.isEnabled,
      },
      update: {
        baseUrl,
        allowedHosts: normalizedHosts,
        encryptedCredentials,
        allowInsecureHttp: dto.allowInsecureHttp,
        isEnabled: dto.isEnabled,
        ...(configurationChanged ? { lastTestedAt: null, lastTestSucceeded: null } : {}),
      },
    });
    this.aggregateCache.delete(orgId);
    this.aggregateCircuit.clear(orgId);

    await this.audit.log({
      action: 'integration.olho-de-deus.configure',
      entity: 'OlhoDeDeusIntegration',
      entityId: integration.id,
      meta: {
        host: new URL(baseUrl).hostname,
        enabled: dto.isEnabled,
        insecureHttp: dto.allowInsecureHttp,
        credentialRotated: Boolean(dto.apiKey),
      },
    });
    return this.toDto(integration);
  }

  async test(): Promise<{ success: true }> {
    const integration = await this.requireIntegration(false);
    let success = false;
    try {
      await Promise.all([
        this.fetchCollection(integration, 'olts'),
        this.fetchCollection(integration, 'rompimentos'),
      ]);
      success = true;
      return { success: true };
    } finally {
      await this.prisma.tenant.olhoDeDeusIntegration.update({
        where: { id: integration.id },
        data: { lastTestedAt: new Date(), lastTestSucceeded: success },
      });
      this.aggregateCache.delete(this.tenancy.getOrgIdOrThrow());
      if (success) this.aggregateCircuit.clear(this.tenancy.getOrgIdOrThrow());
      await this.audit.log({
        action: 'integration.olho-de-deus.test',
        entity: 'OlhoDeDeusIntegration',
        entityId: integration.id,
        meta: { success },
      });
    }
  }

  private async fetchCollection(
    integration: OlhoDeDeusIntegration,
    resource: 'olts' | 'rompimentos',
  ): Promise<{ total: number; items: Array<Record<string, unknown>> }> {
    const credentials = this.decryptCredentials(integration);
    const url = `${integration.baseUrl.replace(/\/+$/, '')}/${resource}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-Key': credentials.apiKey },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(`Olho de Deus respondeu ${response.status}`);
      }
      const contentLength = Number(response.headers.get('content-length') ?? '0');
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new ServiceUnavailableException('Resposta do Olho de Deus excede o limite permitido');
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new ServiceUnavailableException('Resposta do Olho de Deus excede o limite permitido');
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ServiceUnavailableException('Olho de Deus retornou uma resposta inválida');
      }
      if (!this.isExpectedCollection(body, resource)) {
        throw new ServiceUnavailableException('Olho de Deus retornou um formato não reconhecido');
      }
      const collection = body as Record<string, unknown>;
      return {
        total: collection.total as number,
        items: (collection[resource] as unknown[]).flatMap((item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? [item as Record<string, unknown>]
            : [],
        ),
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Não foi possível consultar o Olho de Deus');
    } finally {
      clearTimeout(timer);
    }
  }

  private isExpectedCollection(value: unknown, resource: 'olts' | 'rompimentos'): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const body = value as Record<string, unknown>;
    return body.ok === true && typeof body.total === 'number' && Array.isArray(body[resource]);
  }

  private async requireIntegration(mustBeEnabled: boolean): Promise<OlhoDeDeusIntegration> {
    const integration = await this.prisma.tenant.olhoDeDeusIntegration.findUnique({
      where: { orgId: this.tenancy.getOrgIdOrThrow() },
    });
    if (!integration) throw new NotFoundException('Integração Olho de Deus não configurada');
    const hosts = this.parseAllowedHosts(integration.allowedHosts);
    this.validateBaseUrl(integration.baseUrl, hosts, integration.allowInsecureHttp);
    if (mustBeEnabled && !integration.isEnabled) {
      throw new BadRequestException('Integração Olho de Deus desativada');
    }
    return integration;
  }

  private validateBaseUrl(baseUrl: string, allowedHosts: string[], allowInsecureHttp: boolean): string {
    let url: URL;
    try {
      url = new URL(baseUrl.trim());
    } catch {
      throw new BadRequestException('URL do Olho de Deus inválida');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('A URL deve usar HTTPS ou HTTP temporariamente autorizado');
    }
    if (url.protocol === 'http:' && !allowInsecureHttp) {
      throw new BadRequestException('HTTP exige a liberação temporária explícita');
    }
    if (url.username || url.password || !allowedHosts.includes(url.hostname.toLowerCase())) {
      throw new BadRequestException('A URL deve usar um host previamente autorizado, sem credenciais embutidas');
    }
    return url.toString().replace(/\/+$/, '');
  }

  private parseAllowedHosts(value: string): string[] {
    const hosts = [...new Set(value.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))];
    if (hosts.length === 0 || hosts.length > 20 || hosts.some((host) => !/^[a-z0-9.-]+$/i.test(host))) {
      throw new BadRequestException('Informe de um a vinte hostnames válidos, separados por vírgula');
    }
    return hosts.sort();
  }

  private decryptCredentials(integration: OlhoDeDeusIntegration): OlhoCredentials {
    try {
      const value = JSON.parse(this.crypto.decrypt(integration.encryptedCredentials)) as Partial<OlhoCredentials>;
      if (!value.apiKey) throw new Error('missing api key');
      return { apiKey: value.apiKey };
    } catch {
      throw new ServiceUnavailableException('Credenciais do Olho de Deus indisponíveis');
    }
  }

  private toDto(integration: OlhoDeDeusIntegration): OlhoDeDeusIntegrationDto {
    return {
      baseUrl: integration.baseUrl,
      allowedHosts: this.parseAllowedHosts(integration.allowedHosts),
      allowInsecureHttp: integration.allowInsecureHttp,
      isEnabled: integration.isEnabled,
      hasCredentials: integration.encryptedCredentials.length > 0,
      lastTestedAt: integration.lastTestedAt?.toISOString() ?? null,
      lastTestSucceeded: integration.lastTestSucceeded,
      access: 'READ_ONLY',
      affectsRuntimeDecisions: false,
    };
  }
}
