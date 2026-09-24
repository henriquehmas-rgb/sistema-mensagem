import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IxcIntegration, Prisma } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { identityVerificationIsValid } from '../../common/identity-verification';
import type { Env } from '../../config/env.validation';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SupportCaseStateService } from '../../support-case-state/support-case-state.service';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { IntegrationGovernanceService } from '../integration-governance/integration-governance.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import type { ConfigureIxcDto } from './dto/configure-ixc.dto';
import type { AttemptIdentityVerificationDto } from './dto/attempt-identity-verification.dto';
import type { IxcAutoViabilityCheckDto } from './dto/ixc-auto-viability-check.dto';
import type { SearchIxcCustomerQuery } from './dto/search-ixc-customer.query';
import type { IxcReadAction } from './ixc-query-planner';
import { IxcHttpClient } from './ixc-http.client';
import { IdentityAttemptLimiter, type IdentityAttemptState } from './identity-attempt-limiter';
import { IxcEvidenceCache } from './ixc-evidence-cache';
import type {
  IxcConnectionDto,
  IxcFiberAccessDto,
  IxcAutoViabilityRuntimeConfigDto,
  IxcBoxCohortEvidence,
  IxcStructuralIncidentEvidence,
  IxcContractDto,
  IxcCredentials,
  IxcCustomerDto,
  IxcEndpoint,
  IxcInvoiceDto,
  IxcInmapProjectDto,
  IxcCoverageRegionTypeDto,
  IxcNegotiationPlanDto,
  IxcFtthBoxDto,
  IxcReadInventory,
  IxcListResponse,
  IxcOperationalEvidence,
  IxcPlanDto,
  IxcServiceOrderDto,
  IxcSpeedProfileDto,
  IxcSubjectRuleDto,
  IxcTicketDto,
} from './ixc.types';

export interface IxcIntegrationDto {
  baseUrl: string;
  isEnabled: boolean;
  hasCredentials: boolean;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
}

export type IdentityVerificationResult =
  | { status: 'verified'; validUntil: string }
  | ({ status: 'not_verified' | 'locked' } & IdentityAttemptState)
  | { status: 'unavailable' };

export type IdentityChallengeResult = IdentityVerificationResult | { status: 'format_invalid' };

export type IdentityLocationLookupResult =
  | { status: 'candidate_ready'; candidateCount: number }
  | { status: 'no_candidate' | 'unavailable' | 'not_requested' };

// Vínculo técnico gravado exclusivamente após uma validação IXC bem-sucedida.
// Não substitui a validação atual: apenas limita um fallback a um cadastro que
// o próprio Omni já comprovou pertencer ao contato em algum momento.
const TRUSTED_IXC_CUSTOMER_ID_FIELD = '_omniTrustedIxcCustomerId';
const AUTO_VIABILITY_JOURNAL_FIELD = '_omniInmapAutoViabilityV1';
const AUTO_VIABILITY_LOCK_SECONDS = 60;
const MAX_AUTO_VIABILITY_ATTEMPTS_PER_CONTACT = 20;
// A localização compartilhada serve apenas como alternativa de descoberta.
// Guardamos somente IDs temporários no Redis;
// coordenadas nunca entram em auditoria nem em campos de contato.
const LOCATION_IDENTITY_CANDIDATE_TTL_SECONDS = 10 * 60;
const LOCATION_IDENTITY_RADIUS_METERS = 180;
const LOCATION_IDENTITY_MAX_CANDIDATES = 5;

type AutoViabilityOutcome = 'CONFIRMED' | 'NOT_AVAILABLE' | 'INCONCLUSIVE';
type AutoViabilityAttemptStatus = 'PENDING' | 'COMPLETED' | 'REVIEW_REQUIRED';

interface AutoViabilityAttempt {
  status: AutoViabilityAttemptStatus;
  outcome?: AutoViabilityOutcome;
  leadId?: string;
  eligiblePlans?: IxcAutoViabilityPlan[];
  startedAt: string;
  completedAt?: string;
}

/**
 * Diagnóstico mínimo para homologar contratos IXC que devolvem JSON válido,
 * porém com campos ainda não mapeados. Nunca inclui valores da resposta,
 * endereço, coordenadas, telefone ou qualquer identificador do cliente.
 */
interface AutoViabilityResponseShape {
  topLevelKeys: string[];
  objectContainers: Array<{ key: string; keys: string[] }>;
}

interface AutoViabilityJournal {
  version: 1;
  attempts: Record<string, AutoViabilityAttempt>;
}

export interface IxcAutoViabilityCheckResult {
  source: 'IXC_INMAP_AUTO_VIABILITY';
  status: AutoViabilityOutcome;
  cached: boolean;
  leadReferenceAvailable: boolean;
  eligiblePlans: IxcAutoViabilityPlan[];
  observedAt: string;
}

export interface IxcAutoViabilityPlan {
  id: string | null;
  name: string;
  value: number | null;
}

@Injectable()
export class IxcService {
  private readonly allowedHosts: Set<string>;
  /** Adaptador puro em modo sombra; não participa da resolução DI do IXC legado. */
  private readonly governance = new IntegrationGovernanceService();
  private static readonly BOX_COHORT_PAGE_SIZE = 100;
  /** Inventário por cidade, limitado para evitar varrer toda a infraestrutura. */
  private static readonly FTTH_BOXES_PER_CITY_LIMIT = 250;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly http: IxcHttpClient,
    private readonly redis: RedisService,
    private readonly caseState: SupportCaseStateService,
    private readonly identityAttempts: IdentityAttemptLimiter,
    private readonly metrics: MetricsService,
    private readonly evidenceCache: IxcEvidenceCache,
  ) {
    this.allowedHosts = new Set(
      config
        .get('IXC_ALLOWED_HOSTS', { infer: true })
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  async attemptIdentityVerification(
    conversationId: string,
    factors: AttemptIdentityVerificationDto,
  ): Promise<IdentityVerificationResult> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    return this.attemptIdentityVerificationForOrg(orgId, conversationId, factors);
  }

  async startIdentityChallenge(orgId: string, conversationId: string, contactId: string): Promise<boolean> {
    return this.identityAttempts.startChallenge(orgId, contactId, conversationId);
  }

  /** Troca de titular em Suporte ou Financeiro: revoga o vínculo anterior antes de pedir outro CPF. */
  async beginAccountHolderRebind(
    orgId: string,
    conversationId: string,
    contactId: string,
    route: 'technical_support' | 'billing',
    reason: 'different_account_holder' | 'current_service_not_confirmed' = 'different_account_holder',
  ): Promise<boolean> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId, contactId },
      select: { id: true },
    });
    if (!conversation) return false;
    const started = await this.identityAttempts.startChallenge(orgId, contactId, conversationId);
    if (!started && !(await this.identityAttempts.challengePending(orgId, contactId, conversationId))) return false;
    await this.identityAttempts.clearVerifiedCustomer(orgId, contactId, conversationId);
    await this.prisma.prismaSystem.conversation.update({
      where: { id: conversationId },
      data: { identityVerifiedAt: null, identityVerifiedBy: null, identityVerificationMethod: null },
    });
    await this.audit.logSystem(orgId, {
      action: 'conversation.identity.rebind-requested', entity: 'Conversation', entityId: conversationId,
      meta: { route, reason },
    });
    return true;
  }

  /**
   * A primeira tentativa de vínculo é sempre pelo telefone do próprio canal.
   * O resultado não expõe cadastro: só prepara candidatos efêmeros para a
   * confirmação posterior pelo CPF completo informado pelo cliente.
   */
  async preparePhoneIdentityFallback(
    orgId: string,
    conversationId: string,
    contactId: string,
  ): Promise<IdentityLocationLookupResult> {
    if (!(await this.identityAttempts.challengePending(orgId, contactId, conversationId))) {
      return { status: 'not_requested' };
    }
    try {
      const conversation = await this.prisma.prismaSystem.conversation.findFirst({
        where: { id: conversationId, orgId, contactId },
        select: {
          contact: {
            select: {
              phone: true,
              identities: { select: { externalId: true } },
            },
          },
        },
      });
      if (!conversation) return { status: 'unavailable' };
      const integration = await this.requireIntegrationForOrg(orgId);
      const phoneReferences = new Set<string>();
      if (conversation.contact.phone?.trim()) phoneReferences.add(conversation.contact.phone.trim());
      for (const identity of conversation.contact.identities ?? []) {
        const digits = identity.externalId.replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 13) phoneReferences.add(identity.externalId);
      }
      const lookupValues = [...new Set(
        [...phoneReferences].flatMap((value) => this.phoneLookupCandidates(value)),
      )];
      if (lookupValues.length === 0) {
        await this.auditIdentityCandidateLookup(orgId, conversationId, 'WHATSAPP_PHONE', 'no_candidate', 0);
        return { status: 'no_candidate' };
      }
      const fields = ['cliente.telefone_celular', 'cliente.fone', 'cliente.telefone_comercial', 'cliente.whatsapp'];
      const responses = await Promise.all(
        fields.flatMap((field) => lookupValues.map((candidate) => (
          this.query(integration, 'cliente', field, candidate, LOCATION_IDENTITY_MAX_CANDIDATES)
        ))),
      );
      const candidateIds = [...new Set(responses.flatMap((response) => (response.registros ?? []).flatMap((value) => {
        const row = this.row(value);
        return row && this.text(row, 'id') ? [this.text(row, 'id')!] : [];
      })))].slice(0, LOCATION_IDENTITY_MAX_CANDIDATES);
      if (candidateIds.length === 0) {
        await this.auditIdentityCandidateLookup(orgId, conversationId, 'WHATSAPP_PHONE', 'no_candidate', 0);
        return { status: 'no_candidate' };
      }
      await this.redis.client.set(
        this.locationIdentityKey(orgId, contactId, conversationId),
        JSON.stringify(candidateIds),
        'EX',
        LOCATION_IDENTITY_CANDIDATE_TTL_SECONDS,
      );
      await this.auditIdentityCandidateLookup(
        orgId, conversationId, 'WHATSAPP_PHONE', 'candidate_ready', candidateIds.length,
      );
      return { status: 'candidate_ready', candidateCount: candidateIds.length };
    } catch {
      await this.auditIdentityCandidateLookup(orgId, conversationId, 'WHATSAPP_PHONE', 'unavailable', 0);
      return { status: 'unavailable' };
    }
  }

  async consumeIdentityChallenge(
    orgId: string,
    conversationId: string,
    contactId: string,
    text: string,
  ): Promise<IdentityChallengeResult | null> {
    if (!(await this.identityAttempts.challengePending(orgId, contactId, conversationId))) return null;
    const cpf = text.replace(/\D/g, '');
    if (cpf.length !== 11) return { status: 'format_invalid' };
    const result = await this.attemptIdentityVerificationForOrg(orgId, conversationId, {
      cpf,
    });
    if (result.status === 'verified' || result.status === 'locked') {
      await this.identityAttempts.finishChallenge(orgId, contactId, conversationId);
    }
    return result;
  }

  /**
   * Prepara uma confirmação de identidade a partir de uma localização que a
   * própria pessoa compartilhou. A busca é estritamente limitada à janela
   * geográfica e não devolve nome, endereço, contrato nem existência de conta.
   */
  async prepareLocationIdentityFallback(
    orgId: string,
    conversationId: string,
    contactId: string,
    latitude: number,
    longitude: number,
  ): Promise<IdentityLocationLookupResult> {
    if (!(await this.identityAttempts.challengePending(orgId, contactId, conversationId))) {
      return { status: 'not_requested' };
    }
    if (!this.validLocationCoordinates(latitude, longitude)) return { status: 'unavailable' };

    try {
      const integration = await this.requireIntegrationForOrg(orgId);
      const latitudeDelta = LOCATION_IDENTITY_RADIUS_METERS / 111_320;
      const longitudeDelta = LOCATION_IDENTITY_RADIUS_METERS
        / (111_320 * Math.max(0.1, Math.cos((latitude * Math.PI) / 180)));
      const response = await this.queryWithGrid(
        integration,
        'cliente',
        'cliente.latitude',
        this.rangeQuery(latitude - latitudeDelta, latitude + latitudeDelta),
        LOCATION_IDENTITY_MAX_CANDIDATES,
        'cliente.id',
        'BE',
        [{
          TB: 'cliente.longitude',
          OP: 'BE',
          P: this.rangeQuery(longitude - longitudeDelta, longitude + longitudeDelta),
        }],
      );
      const candidateIds = [...new Set((response.registros ?? []).flatMap((value) => {
        const row = this.row(value);
        const id = row ? this.text(row, 'id') : null;
        const candidateLatitude = row ? this.number(row, 'latitude') : null;
        const candidateLongitude = row ? this.number(row, 'longitude') : null;
        if (!id || candidateLatitude === null || candidateLongitude === null) return [];
        return this.locationDistanceMeters(latitude, longitude, candidateLatitude, candidateLongitude)
          <= LOCATION_IDENTITY_RADIUS_METERS
          ? [id]
          : [];
      }))].slice(0, LOCATION_IDENTITY_MAX_CANDIDATES);

      if (candidateIds.length === 0) {
        await this.auditIdentityCandidateLookup(orgId, conversationId, 'SHARED_LOCATION', 'no_candidate', 0);
        return { status: 'no_candidate' };
      }
      await this.redis.client.set(
        this.locationIdentityKey(orgId, contactId, conversationId),
        JSON.stringify(candidateIds),
        'EX',
        LOCATION_IDENTITY_CANDIDATE_TTL_SECONDS,
      );
      await this.auditIdentityCandidateLookup(
        orgId, conversationId, 'SHARED_LOCATION', 'candidate_ready', candidateIds.length,
      );
      return { status: 'candidate_ready', candidateCount: candidateIds.length };
    } catch {
      // Falha técnica não é ausência de cadastro e nunca deve produzir uma
      // resposta que revele se há cliente perto do ponto compartilhado.
      await this.auditIdentityCandidateLookup(orgId, conversationId, 'SHARED_LOCATION', 'unavailable', 0);
      return { status: 'unavailable' };
    }
  }

  /** CEP+número é a alternativa quando a pessoa não puder compartilhar localização. */
  async prepareAddressIdentityFallback(
    orgId: string,
    conversationId: string,
    contactId: string,
    postalCode: string,
    number: string,
  ): Promise<IdentityLocationLookupResult> {
    if (!(await this.identityAttempts.challengePending(orgId, contactId, conversationId))) {
      return { status: 'not_requested' };
    }
    const normalizedPostalCode = postalCode.replace(/\D/g, '');
    const normalizedNumber = number.trim().toUpperCase();
    if (!/^\d{8}$/.test(normalizedPostalCode) || !/^\d{1,6}[A-Z]?$/.test(normalizedNumber)) {
      return { status: 'unavailable' };
    }
    try {
      const integration = await this.requireIntegrationForOrg(orgId);
      const postalVariants = [
        normalizedPostalCode,
        `${normalizedPostalCode.slice(0, 5)}-${normalizedPostalCode.slice(5)}`,
      ];
      const responses = await Promise.all(postalVariants.map((postal) => this.queryWithGrid(
        integration,
        'cliente',
        'cliente.cep',
        postal,
        LOCATION_IDENTITY_MAX_CANDIDATES,
        'cliente.id',
        '=',
        [{ TB: 'cliente.numero', OP: '=', P: normalizedNumber }],
      )));
      const candidateIds = [...new Set(responses.flatMap((response) => (response.registros ?? []).flatMap((value) => {
        const row = this.row(value);
        return row && this.text(row, 'id') ? [this.text(row, 'id')!] : [];
      })))].slice(0, LOCATION_IDENTITY_MAX_CANDIDATES);
      if (candidateIds.length === 0) {
        await this.auditIdentityCandidateLookup(orgId, conversationId, 'POSTAL_ADDRESS', 'no_candidate', 0);
        return { status: 'no_candidate' };
      }
      await this.redis.client.set(
        this.locationIdentityKey(orgId, contactId, conversationId),
        JSON.stringify(candidateIds),
        'EX',
        LOCATION_IDENTITY_CANDIDATE_TTL_SECONDS,
      );
      await this.auditIdentityCandidateLookup(
        orgId, conversationId, 'POSTAL_ADDRESS', 'candidate_ready', candidateIds.length,
      );
      return { status: 'candidate_ready', candidateCount: candidateIds.length };
    } catch {
      await this.auditIdentityCandidateLookup(orgId, conversationId, 'POSTAL_ADDRESS', 'unavailable', 0);
      return { status: 'unavailable' };
    }
  }

  private async attemptIdentityVerificationForOrg(
    orgId: string,
    conversationId: string,
    factors: AttemptIdentityVerificationDto,
  ): Promise<IdentityVerificationResult> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: {
        id: true,
        contactId: true,
        contact: {
          select: {
            phone: true,
            customFields: true,
            identities: { select: { externalId: true, channelType: true } },
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');

    const state = await this.identityAttempts.status(orgId, conversation.contactId, conversation.id);
    if (state.locked) {
      this.metrics.recordIdentityVerification('locked');
      return { status: 'locked', ...state };
    }
    const integration = await this.requireIntegrationForOrg(orgId);
    const cpf = factors.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido');
    const formattedCpf = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    // A orientação operacional atual permite localizar diretamente o cadastro
    // pelo CPF completo. Consultamos os dois formatos aceitos pelo IXC, mas só
    // aprovamos uma correspondência exata e única após normalizar os dígitos.
    const responses = await Promise.all([
      this.query(integration, 'cliente', 'cliente.cnpj_cpf', cpf, 5),
      this.query(integration, 'cliente', 'cliente.cnpj_cpf', formattedCpf, 5),
    ]);
    const records = new Map<string, Record<string, unknown>>();
    for (const response of responses) {
      for (const value of response.registros ?? []) {
        const row = this.row(value);
        const id = row ? this.text(row, 'id') : null;
        if (row && id) records.set(id, row);
      }
    }

    const comparable = [...records.values()].flatMap((row) => {
      const candidateCpf = (this.text(row, 'cnpj_cpf') ?? '').replace(/\D/g, '');
      const customerId = this.text(row, 'id');
      return candidateCpf.length === 11 && customerId
        ? [{ customerId, cpf: candidateCpf }]
        : [];
    });
    const matches = comparable.filter((candidate) => this.safeEqual(candidate.cpf, cpf));
    if (matches.length > 1) {
      return this.identityUnavailable(
        orgId, conversation.id, 'ambiguous_identity_match', comparable.length, 2,
      );
    }
    if (matches.length === 0) {
      const failed = await this.identityAttempts.failure(orgId, conversation.contactId, conversation.id);
      await this.audit.logSystem(orgId, {
        action: failed.locked ? 'conversation.identity.lock' : 'conversation.identity.failure',
        entity: 'Conversation',
        entityId: conversation.id,
        meta: { method: 'CPF_FULL_EXACT', locked: failed.locked },
      });
      this.metrics.recordIdentityVerification(failed.locked ? 'locked' : 'failed');
      return { status: failed.locked ? 'locked' : 'not_verified', ...failed };
    }

    const verifiedCustomerId = matches[0]!.customerId;
    // Uma confirmação nova nunca reutiliza leituras ainda em cache do titular anterior.
    await this.evidenceCache.clear(orgId, conversation.id);
    await this.identityAttempts.success(
      orgId,
      conversation.contactId, conversation.id, verifiedCustomerId,
    );
    const verifiedAt = new Date();
    await Promise.all([
      this.prisma.prismaSystem.conversation.update({
        where: { id: conversation.id },
        data: {
          identityVerifiedAt: verifiedAt,
          identityVerifiedBy: null,
          identityVerificationMethod: 'CPF_FULL_EXACT',
        },
      }),
      this.prisma.prismaSystem.contact.update({
        where: { id: conversation.contactId },
        data: {
          customFields: this.withTrustedIxcCustomerId(
            conversation.contact.customFields, verifiedCustomerId,
          ),
        },
      }),
      this.redis.client.del(this.locationIdentityKey(orgId, conversation.contactId, conversation.id)),
    ]);
    await this.audit.logSystem(orgId, {
      action: 'conversation.identity.verify',
      entity: 'Conversation',
      entityId: conversation.id,
      meta: { method: 'CPF_FULL_EXACT' },
    });
    this.metrics.recordIdentityVerification('verified');
    return { status: 'verified', validUntil: new Date(verifiedAt.getTime() + 30 * 60 * 1_000).toISOString() };
  }

  async unlockIdentityVerification(conversationId: string): Promise<{ status: 'unlocked' }> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const conversation = await this.prisma.tenant.conversation.findFirst({
      where: { id: conversationId },
      select: { id: true, contactId: true },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    await this.identityAttempts.unlock(orgId, conversation.contactId, conversation.id);
    await this.audit.log({
      action: 'conversation.identity.unlock', entity: 'Conversation', entityId: conversation.id,
    });
    this.metrics.recordIdentityVerification('unlocked');
    return { status: 'unlocked' };
  }

  private async identityUnavailable(
    orgId: string,
    conversationId: string,
    reason:
      | 'no_ixc_customer_for_contact'
      | 'no_ixc_customer_for_shared_location'
      | 'ixc_customer_identity_incomplete'
      | 'ambiguous_identity_match',
    candidateCount: number,
    lookupVariants: number,
  ): Promise<IdentityVerificationResult> {
    // Rastreia a decisão sem gravar telefone, CPF ou qualquer fator informado.
    // Assim sabemos se o IXC respondeu sem cadastro comparável ou se havia
    // ambiguidade, em vez de confundir ambos com indisponibilidade de rede.
    await this.audit.logSystem(orgId, {
      action: 'conversation.identity.unavailable',
      entity: 'Conversation',
      entityId: conversationId,
      meta: { method: 'CPF_FULL_EXACT', reason, candidateCount, lookupVariants },
    });
    this.metrics.recordIdentityVerification('unavailable');
    return { status: 'unavailable' };
  }

  private phoneLookupCandidates(phone: string): string[] {
    const original = phone.trim();
    const digits = original.replace(/\D/g, '');
    const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
    const values = new Set<string>([original, digits, local]);
    if (local.length === 11) {
      values.add(`(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`);
      values.add(`${local.slice(0, 2)} ${local.slice(2, 7)}-${local.slice(7)}`);
    } else if (local.length === 10) {
      values.add(`(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`);
      values.add(`${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}`);
    }
    return [...values].filter(Boolean);
  }

  async getConfiguration(): Promise<IxcIntegrationDto | null> {
    const integration = await this.prisma.tenant.ixcIntegration.findUnique({
      where: { orgId: this.tenancy.getOrgIdOrThrow() },
    });
    return integration ? this.toDto(integration) : null;
  }

  async configure(dto: ConfigureIxcDto): Promise<IxcIntegrationDto> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const baseUrl = this.validateBaseUrl(dto.baseUrl);
    const existing = await this.prisma.tenant.ixcIntegration.findUnique({ where: { orgId } });
    if (!existing && !dto.token) {
      throw new BadRequestException('token é obrigatório na primeira configuração');
    }
    const previousCredentials = existing ? this.decryptCredentials(existing) : null;
    const token = dto.token ?? previousCredentials!.token;
    const configurationChanged =
      !existing ||
      existing.baseUrl !== baseUrl ||
      previousCredentials?.username !== dto.username.trim() ||
      dto.token !== undefined;
    if (dto.isEnabled && (configurationChanged || existing?.lastTestSucceeded !== true)) {
      throw new BadRequestException(
        'Salve a configuração desativada e conclua um teste bem-sucedido antes de habilitar',
      );
    }
    const encryptedCredentials = this.crypto.encrypt(
      JSON.stringify({ username: dto.username.trim(), token }),
    );
    const integration = await this.prisma.tenant.ixcIntegration.upsert({
      where: { orgId },
      create: { orgId, baseUrl, encryptedCredentials, isEnabled: dto.isEnabled },
      update: {
        baseUrl,
        encryptedCredentials,
        isEnabled: dto.isEnabled,
        ...(configurationChanged ? { lastTestedAt: null, lastTestSucceeded: null } : {}),
      },
    });
    await this.audit.log({
      action: 'integration.ixc.configure',
      entity: 'IxcIntegration',
      entityId: integration.id,
      meta: { host: new URL(baseUrl).hostname, enabled: dto.isEnabled, credentialRotated: Boolean(dto.token) },
    });
    return this.toDto(integration);
  }

  async test(): Promise<{ success: true }> {
    const integration = await this.requireIntegration(false);
    let success = false;
    try {
      await this.query(integration, 'cliente', 'cliente.id', '1', 1);
      success = true;
      return { success: true };
    } finally {
      await this.prisma.tenant.ixcIntegration.update({
        where: { id: integration.id },
        data: { lastTestedAt: new Date(), lastTestSucceeded: success },
      });
      await this.audit.log({
        action: 'integration.ixc.test',
        entity: 'IxcIntegration',
        entityId: integration.id,
        meta: { success },
      });
    }
  }

  async searchCustomers(criteria: SearchIxcCustomerQuery): Promise<IxcCustomerDto[]> {
    const selected = [criteria.id, criteria.cpfCnpj, criteria.phone].filter(
      (value): value is string => Boolean(value),
    );
    if (selected.length !== 1) {
      throw new BadRequestException('Informe exatamente um filtro: id, cpfCnpj ou phone');
    }
    const integration = await this.requireIntegration(true);
    const fields = criteria.id
      ? ['cliente.id']
      : criteria.cpfCnpj
        ? ['cliente.cnpj_cpf']
        : ['cliente.telefone_celular', 'cliente.fone', 'cliente.telefone_comercial', 'cliente.whatsapp'];
    const value = selected[0]!;
    const responses = await Promise.all(
      fields.map((field) => this.query(integration, 'cliente', field, value, 5)),
    );
    const customers = new Map<string, IxcCustomerDto>();
    for (const response of responses) {
      for (const record of response.registros ?? []) {
        const customer = this.mapCustomer(record);
        if (customer) customers.set(customer.id, customer);
      }
    }
    await this.audit.log({
      action: 'integration.ixc.customer.search',
      entity: 'IxcIntegration',
      entityId: integration.id,
      meta: { filter: criteria.id ? 'id' : criteria.cpfCnpj ? 'cpfCnpj' : 'phone', resultCount: customers.size },
    });
    return [...customers.values()];
  }

  async listContracts(customerId: string, conversationId: string): Promise<IxcContractDto[]> {
    await this.requireVerifiedIdentity(conversationId);
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration,
      'cliente_contrato',
      'cliente_contrato.id_cliente',
      customerId,
      20,
      'cliente_contrato.id',
    );
    const result = (response.registros ?? [])
      .map((record) => this.mapContract(record))
      .filter((record): record is IxcContractDto => record !== null);
    await this.auditRead(integration.id, 'contracts', result.length);
    return result;
  }

  async listInvoices(customerId: string, conversationId: string): Promise<IxcInvoiceDto[]> {
    await this.requireVerifiedIdentity(conversationId);
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration,
      'fn_areceber',
      'fn_areceber.id_cliente',
      customerId,
      20,
      'fn_areceber.data_vencimento',
    );
    const result = (response.registros ?? [])
      .map((record) => this.mapInvoice(record))
      .filter((record): record is IxcInvoiceDto => record !== null);
    await this.auditRead(integration.id, 'invoices', result.length);
    return result;
  }

  async listServiceOrders(customerId: string, conversationId: string): Promise<IxcServiceOrderDto[]> {
    await this.requireVerifiedIdentity(conversationId);
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration,
      'su_oss_chamado',
      'su_oss_chamado.id_cliente',
      customerId,
      20,
      'su_oss_chamado.id',
    );
    const result = (response.registros ?? [])
      .map((record) => this.mapServiceOrder(record))
      .filter((record): record is IxcServiceOrderDto => record !== null);
    await this.auditRead(integration.id, 'service-orders', result.length);
    return result;
  }

  async listConnections(customerId: string, conversationId: string): Promise<IxcConnectionDto[]> {
    await this.requireVerifiedIdentity(conversationId);
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration,
      'radusuarios',
      'radusuarios.id_cliente',
      customerId,
      20,
      'radusuarios.id',
    );
    const result = (response.registros ?? [])
      .map((record) => this.mapConnection(record))
      .filter((record): record is IxcConnectionDto => record !== null);
    await this.auditRead(integration.id, 'connections', result.length);
    return result;
  }

  async listTickets(customerId: string, conversationId: string): Promise<IxcTicketDto[]> {
    await this.requireVerifiedIdentity(conversationId);
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration, 'su_ticket', 'su_ticket.id_cliente', customerId, 20, 'su_ticket.id',
    );
    const result = (response.registros ?? [])
      .map((record) => this.mapTicket(record))
      .filter((record): record is IxcTicketDto => record !== null);
    await this.auditRead(integration.id, 'tickets', result.length);
    return result;
  }

  async listSubjectRules(): Promise<IxcSubjectRuleDto[]> {
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration, 'su_oss_assunto', 'su_oss_assunto.ativo', 'S', 200, 'su_oss_assunto.id',
    );
    const result = (response.registros ?? [])
      .map((record) => this.mapSubjectRule(record))
      .filter((record): record is IxcSubjectRuleDto => record !== null);
    await this.auditRead(integration.id, 'subjects', result.length);
    return result;
  }

  async listPlans(): Promise<IxcPlanDto[]> {
    const integration = await this.requireIntegration(true);
    const response = await this.query(integration, 'vd_contratos', 'vd_contratos.Ativo', 'S', 250, 'vd_contratos.id');
    const result = (response.registros ?? [])
      .map((record) => this.mapPlan(record))
      .filter((record): record is IxcPlanDto => record !== null);
    await this.auditRead(integration.id, 'plans', result.length);
    return result;
  }

  async listSpeedProfiles(): Promise<IxcSpeedProfileDto[]> {
    const integration = await this.requireIntegration(true);
    const response = await this.query(integration, 'radgrupos', 'radgrupos.id', '0', 150, 'radgrupos.id', '>');
    const result = (response.registros ?? [])
      .map((record) => this.mapSpeedProfile(record))
      .filter((record): record is IxcSpeedProfileDto => record !== null);
    await this.auditRead(integration.id, 'speed-profiles', result.length);
    return result;
  }

  /**
   * Leitura limitada do inventário InMap por cidade. Esta lista nunca é
   * enviada ao modelo: ela atende somente a evidência técnica de proximidade
   * calculada no backend. A capacidade cadastrada não é tratada como porta
   * disponível nem como confirmação de viabilidade.
   */
  async listFtthBoxesByCity(cityId: string): Promise<IxcFtthBoxDto[]> {
    return (await this.readFtthBoxInventoryByCity(cityId)).items;
  }

  async readFtthBoxInventoryByCity(cityId: string): Promise<IxcReadInventory<IxcFtthBoxDto>> {
    if (!/^\d{1,20}$/.test(cityId)) {
      throw new BadRequestException('Cidade IXC inválida para consultar caixas FTTH');
    }
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration,
      'rad_caixa_ftth',
      'rad_caixa_ftth.id_cidade',
      cityId,
      IxcService.FTTH_BOXES_PER_CITY_LIMIT,
      'rad_caixa_ftth.id',
    );
    const rawRecords = response.registros ?? [];
    const result = rawRecords
      .map((record) => this.mapFtthBox(record))
      .filter((record): record is IxcFtthBoxDto => record !== null);
    await this.auditRead(integration.id, 'inmap-ftth-boxes', result.length);
    return this.toReadInventory(response, rawRecords.length, result, IxcService.FTTH_BOXES_PER_CITY_LIMIT);
  }

  /**
   * Leituras oficiais que medem apenas se o InMap possui configuração mínima
   * para rodar a viabilidade. Não expõem geometria, IDs nem confirmam
   * atendimento individual.
   */
  async listInmapProjects(): Promise<IxcInmapProjectDto[]> {
    return (await this.readInmapProjectsInventory()).items;
  }

  async readInmapProjectsInventory(): Promise<IxcReadInventory<IxcInmapProjectDto>> {
    const integration = await this.requireIntegration(true);
    const response = await this.query(integration, 'df_projeto', 'df_projeto.id', '0', 250, 'df_projeto.id', '>');
    const rawRecords = response.registros ?? [];
    const result = rawRecords
      .map((record) => this.mapInmapProject(record))
      .filter((record): record is IxcInmapProjectDto => record !== null);
    await this.auditRead(integration.id, 'inmap-projects', result.length);
    return this.toReadInventory(response, rawRecords.length, result, 250);
  }

  async listCoverageRegionTypes(): Promise<IxcCoverageRegionTypeDto[]> {
    return (await this.readCoverageRegionTypesInventory()).items;
  }

  async readCoverageRegionTypesInventory(): Promise<IxcReadInventory<IxcCoverageRegionTypeDto>> {
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration, 'df_tipo_elemento_regiao', 'df_tipo_elemento_regiao.id', '0', 250,
      'df_tipo_elemento_regiao.id', '>',
    );
    const rawRecords = response.registros ?? [];
    const result = rawRecords
      .map((record) => this.mapCoverageRegionType(record))
      .filter((record): record is IxcCoverageRegionTypeDto => record !== null);
    await this.auditRead(integration.id, 'inmap-coverage-region-types', result.length);
    return this.toReadInventory(response, rawRecords.length, result, 250);
  }

  async listNegotiationPlans(): Promise<IxcNegotiationPlanDto[]> {
    return (await this.readNegotiationPlansInventory()).items;
  }

  /**
   * Consulta a configuração oficial da Auto Viabilidade V3 sem expor
   * telefones, links, políticas ou outras opções de apresentação do IXC.
   */
  async readAutoViabilityRuntimeConfiguration(): Promise<IxcAutoViabilityRuntimeConfigDto> {
    const integration = await this.requireIntegration(true);
    let raw: Record<string, unknown>;
    try {
      raw = await this.http.readAutoViabilityConfig(integration.baseUrl, this.decryptCredentials(integration));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      const failure = new ServiceUnavailableException(`IXC Auto Viabilidade: ${reason}`);
      Object.assign(failure, { ixcFailureCode: this.ixcFailureCode(error) });
      throw failure;
    }

    const text = (key: string): string | null =>
      typeof raw[key] === 'string' && raw[key] !== '' ? raw[key] : null;
    const hasConfiguredId = (key: string): boolean => {
      const value = text(key);
      return value !== null && value !== '0' && value !== 'N';
    };
    const external = text('utiliza_servidor_externo');
    const scheduleConfigured = ['horario_manha', 'horario_tarde', 'horario_noite']
      .some((key) => hasConfiguredId(key));
    const version = text('versao_viabilidade');
    const result: IxcAutoViabilityRuntimeConfigDto = {
      source: 'IXC_INMAP_AUTO_VIABILITY',
      version,
      usesExternalServer: external === '1' || external === 'S'
        ? true
        : external === '0' || external === 'N'
          ? false
          : null,
      hasBranch: hasConfiguredId('id_filial_viabilidade'),
      hasNegotiationSubject: hasConfiguredId('assunto_negociacao'),
      scheduleConfigured,
      // A configuração por plano/caixa continua sendo conferida pela leitura
      // de inventário InMap. Aqui confirmamos apenas que o motor nativo V3
      // está disponível para uma consulta posterior, com consentimento.
      readyForControlledCheck: version === '3' && hasConfiguredId('id_filial_viabilidade'),
      observedAt: new Date().toISOString(),
    };
    await this.auditRead(integration.id, 'inmap-auto-viability-configuration', 1);
    return result;
  }

  /**
   * Consulta técnica oficial do InMap por endereço (CEP) ou coordenadas.
   * O endpoint não usa campanha/canal e não cria prospecção. Ainda assim,
   * uma tentativa incerta não é repetida automaticamente.
   */
  async checkAutoViability(dto: IxcAutoViabilityCheckDto): Promise<IxcAutoViabilityCheckResult> {
    if (this.config.get('IXC_INMAP_DIRECT_CHECK_ENABLED', { infer: true }) !== true) {
      throw new ServiceUnavailableException(
        'A consulta técnica direta está em homologação até o contrato da instância IXC ser confirmado.',
      );
    }
    const orgId = this.tenancy.getOrgIdOrThrow();
    const conversation = await this.prisma.tenant.conversation.findUnique({
      where: { id: dto.conversationId },
      select: {
        id: true,
        contactId: true,
        contact: { select: { name: true, phone: true, customFields: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    const hasCoordinates = Number.isFinite(dto.latitude) && Number.isFinite(dto.longitude)
      && dto.latitude! >= -90 && dto.latitude! <= 90 && dto.longitude! >= -180 && dto.longitude! <= 180;
    const hasAddress = Boolean(
      dto.postalCode && /^\d{8}$/.test(dto.postalCode)
      && dto.street?.trim() && dto.neighborhood?.trim() && dto.city?.trim()
      && dto.state && /^[A-Z]{2}$/.test(dto.state) && dto.number?.trim(),
    );
    if (!hasCoordinates && !hasAddress) {
      throw new BadRequestException('Informe um endereço completo com CEP ou latitude e longitude válidas');
    }

    const fingerprint = this.crypto.fingerprint(JSON.stringify({
      contactId: conversation.contactId,
      method: hasCoordinates ? 'COORDINATES' : 'ADDRESS',
      latitude: hasCoordinates ? dto.latitude : '',
      longitude: hasCoordinates ? dto.longitude : '',
      postalCode: dto.postalCode ?? '',
      street: this.normalizeFingerprintText(dto.street ?? ''),
      neighborhood: this.normalizeFingerprintText(dto.neighborhood ?? ''),
      city: this.normalizeFingerprintText(dto.city ?? ''),
      state: dto.state ?? '',
      number: this.normalizeFingerprintText(dto.number ?? ''),
      complement: this.normalizeFingerprintText(dto.complement ?? ''),
      reference: this.normalizeFingerprintText(dto.reference ?? ''),
    }));
    const previous = this.autoViabilityJournal(conversation.contact.customFields).attempts[fingerprint];
    if (previous?.status === 'COMPLETED' && previous.outcome) {
      return this.autoViabilityResult(
        previous.outcome, true, previous.leadId !== undefined,
        previous.completedAt ?? previous.startedAt, previous.eligiblePlans ?? [],
      );
    }
    if (previous) {
      throw new BadRequestException('Esta consulta já possui resultado incerto e aguarda revisão; ela não será reenviada ao IXC.');
    }

    const lockKey = `ixc:auto-viability:contact:${orgId}:${conversation.contactId}`;
    let locked = false;
    try {
      try {
        locked = (await this.redis.client.set(lockKey, 'pending', 'EX', AUTO_VIABILITY_LOCK_SECONDS, 'NX')) === 'OK';
      } catch {
        throw new ServiceUnavailableException('A proteção contra duplicidade está temporariamente indisponível');
      }
      if (!locked) {
        throw new BadRequestException('Já existe uma consulta de viabilidade em processamento para este contato');
      }

      // A releitura após obter a trava evita duplicidade se dois operadores
      // clicarem quase ao mesmo tempo em servidores diferentes.
      const current = await this.prisma.tenant.contact.findUnique({
        where: { id: conversation.contactId }, select: { customFields: true },
      });
      if (!current) throw new NotFoundException('Contato não encontrado');
      const currentAttempt = this.autoViabilityJournal(current.customFields).attempts[fingerprint];
      if (currentAttempt?.status === 'COMPLETED' && currentAttempt.outcome) {
        return this.autoViabilityResult(
          currentAttempt.outcome, true, currentAttempt.leadId !== undefined,
          currentAttempt.completedAt ?? currentAttempt.startedAt,
          currentAttempt.eligiblePlans ?? [],
        );
      }
      if (currentAttempt) {
        throw new BadRequestException('Esta consulta já possui resultado incerto e aguarda revisão; ela não será reenviada ao IXC.');
      }

      const startedAt = new Date().toISOString();
      await this.persistAutoViabilityAttempt(conversation.contactId, current.customFields, fingerprint, {
        status: 'PENDING', startedAt,
      });

      const integration = await this.requireIntegration(true);
      let raw: Record<string, unknown>;
      try {
        raw = await this.http.checkAutoViability(integration.baseUrl, this.decryptCredentials(integration), hasCoordinates
          ? { latitude: dto.latitude!, longitude: dto.longitude! }
          : {
              endereco: dto.street!.trim(), numero: dto.number!.trim(), bairro: dto.neighborhood!.trim(),
              cidade: dto.city!.trim(), estado: dto.state!, cep: dto.postalCode!,
            });
      } catch (error) {
        await this.persistAutoViabilityAttempt(conversation.contactId, current.customFields, fingerprint, {
          status: 'REVIEW_REQUIRED', startedAt, completedAt: new Date().toISOString(),
        });
        await this.caseState.recordSalesCoverageOutcome({
          orgId, conversationId: conversation.id, status: 'REVIEW_REQUIRED',
        });
        await this.audit.log({
          action: 'integration.ixc.inmap.auto-viability.review-required',
          entity: 'Conversation', entityId: conversation.id,
          meta: {
            reason: this.ixcFailureCode(error),
            responseKind: this.ixcResponseKind(error),
          },
        });
        throw new ServiceUnavailableException(
          'Não foi possível confirmar a viabilidade agora. A consulta foi bloqueada contra repetição e será revisada.',
        );
      }

      const normalized = this.normalizeAutoViabilityResponse(raw);
      const eligiblePlans = normalized.outcome === 'CONFIRMED'
        ? await this.resolveAutoViabilityPlans(normalized.planReferences)
        : [];
      const completedAt = new Date().toISOString();
      await this.persistAutoViabilityAttempt(conversation.contactId, current.customFields, fingerprint, {
        status: 'COMPLETED', outcome: normalized.outcome, leadId: normalized.leadId,
        eligiblePlans, startedAt, completedAt,
      });
      await this.caseState.recordSalesCoverageOutcome({
        orgId, conversationId: conversation.id, status: normalized.outcome,
      });
      await this.audit.log({
        action: 'integration.ixc.inmap.auto-viability.completed',
        entity: 'Conversation', entityId: conversation.id,
        meta: {
          outcome: normalized.outcome,
          leadReferenceAvailable: normalized.leadId !== undefined,
          eligiblePlanCount: eligiblePlans.length,
          // Endereço, telefone, resposta bruta e fingerprint não entram na auditoria.
        },
      });
      if (normalized.outcome === 'INCONCLUSIVE') {
        await this.audit.log({
          action: 'integration.ixc.inmap.auto-viability.inconclusive-shape',
          entity: 'Conversation',
          entityId: conversation.id,
          meta: {
            // Somente nomes estruturais, para ajustar o adaptador ao contrato
            // real sem reter qualquer conteúdo devolvido pelo IXC.
            responseShape: this.autoViabilityResponseShape(raw),
          },
        });
      }
      return this.autoViabilityResult(
        normalized.outcome, false, normalized.leadId !== undefined, completedAt, eligiblePlans,
      );
    } finally {
      if (locked) {
        try {
          await this.redis.client.del(lockKey);
        } catch {
          // A expiração curta já impede uma trava permanente. Não ocultar o
          // resultado de uma consulta que foi efetivamente concluída.
        }
      }
    }
  }

  async readNegotiationPlansInventory(): Promise<IxcReadInventory<IxcNegotiationPlanDto>> {
    const integration = await this.requireIntegration(true);
    const response = await this.query(
      integration, 'crm_planos_negociacoes', 'crm_planos_negociacoes.id', '0', 250,
      'crm_planos_negociacoes.id', '>',
    );
    const rawRecords = response.registros ?? [];
    const result = rawRecords
      .map((record) => this.mapNegotiationPlan(record))
      .filter((record): record is IxcNegotiationPlanDto => record !== null);
    await this.auditRead(integration.id, 'ixc-negotiation-plans', result.length);
    return this.toReadInventory(response, rawRecords.length, result, 250);
  }

  /** Executor background-safe: plano fechado, leitura apenas e saída estritamente tipada. */
  async collectOperationalEvidence(
    orgId: string,
    conversationId: string,
    actions: IxcReadAction[],
  ): Promise<IxcOperationalEvidence> {
    const observedAt = new Date().toISOString();
    const allowed = new Set<IxcReadAction>([
      'contracts', 'invoices', 'service_orders', 'connections', 'fiber_access', 'tickets',
    ]);
    if (actions.some((action) => !allowed.has(action))) {
      throw new BadRequestException('Plano IXC contém ação não permitida');
    }
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: {
        identityVerifiedAt: true,
        contactId: true,
        contact: { select: { phone: true, customFields: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (!identityVerificationIsValid(conversation.identityVerifiedAt)) {
      throw new BadRequestException('Identidade não validada para consulta operacional');
    }
    const phone = conversation.contact.phone?.trim();
    if (!phone) return this.withMcpOutcome({ source: 'IXC', status: 'customer_not_found', observedAt, facts: [] });

    const integration = await this.prisma.prismaSystem.ixcIntegration.findFirst({
      where: { orgId, isEnabled: true },
    });
    if (!integration) return this.withMcpOutcome({ source: 'IXC', status: 'unavailable', observedAt, facts: [] });
    this.validateBaseUrl(integration.baseUrl);

    const verifiedCustomerId = await this.identityAttempts.verifiedCustomerId(
      orgId,
      conversation.contactId,
      conversationId,
    );
    // Um vínculo confiável só é persistido após a validação protegida de
    // identidade. Ele evita que uma troca de número no cadastro do IXC
    // degrade uma consulta já autorizada para "cliente não localizado".
    // O telefone continua sendo o fallback para contatos ainda sem vínculo.
    let customerId = verifiedCustomerId ?? this.trustedIxcCustomerId(conversation.contact.customFields);
    if (!customerId) {
      const customerResponses = await Promise.all(
        ['cliente.telefone_celular', 'cliente.fone', 'cliente.telefone_comercial', 'cliente.whatsapp']
          .map((field) => this.query(integration, 'cliente', field, phone, 5)),
      );
      const customers = new Map<string, IxcCustomerDto>();
      for (const response of customerResponses) {
        for (const record of response.registros ?? []) {
          const customer = this.mapCustomer(record);
          if (customer) customers.set(customer.id, customer);
        }
      }
      if (customers.size === 0) {
        return this.withMcpOutcome({ source: 'IXC', status: 'customer_not_found', observedAt, facts: [] });
      }
      if (customers.size !== 1) {
        return this.withMcpOutcome({ source: 'IXC', status: 'customer_ambiguous', observedAt, facts: [] });
      }
      customerId = [...customers.keys()][0]!;
    }
    const facts: IxcOperationalEvidence['facts'] = [];
    const completedActions: IxcReadAction[] = [];
    const failedActions: IxcReadAction[] = [];
    let contracts: IxcContractDto[] | null = null;
    const readContracts = async (): Promise<IxcContractDto[]> => {
      if (contracts) return contracts;
      const response = await this.query(
        integration,
        'cliente_contrato',
        'cliente_contrato.id_cliente',
        customerId,
        20,
        'cliente_contrato.id',
      );
      contracts = (response.registros ?? [])
        .map((value) => this.mapContract(value))
        .filter((item): item is IxcContractDto => item !== null);
      return contracts;
    };
    for (const action of actions) {
      try {
        if (action === 'contracts') {
        for (const item of await readContracts()) {
          facts.push({ resource: action, entityRef: item.id, fields: {
            status: item.status, internetStatus: item.internetStatus, planDescription: item.planDescription,
            activatedAt: item.activatedAt, expiresAt: item.expiresAt,
          } });
        }
        } else if (action === 'invoices') {
        const response = await this.query(integration, 'fn_areceber', 'fn_areceber.id_cliente', customerId, 20, 'fn_areceber.data_vencimento');
        for (const value of response.registros ?? []) {
          const item = this.mapInvoice(value);
          if (item) facts.push({ resource: action, entityRef: item.id, fields: {
            status: item.status, dueDate: item.dueDate, amount: item.amount, openAmount: item.openAmount, paidAt: item.paidAt,
          } });
        }
        } else if (action === 'service_orders') {
        const response = await this.query(integration, 'su_oss_chamado', 'su_oss_chamado.id_cliente', customerId, 20, 'su_oss_chamado.id');
        for (const value of response.registros ?? []) {
          const item = this.mapServiceOrder(value);
          if (item) facts.push({ resource: action, entityRef: item.id, fields: {
            status: item.status, type: item.type, priority: item.priority, openedAt: item.openedAt,
            scheduledAt: item.scheduledAt, closedAt: item.closedAt,
          } });
        }
        } else if (action === 'connections') {
        const response = await this.query(integration, 'radusuarios', 'radusuarios.id_cliente', customerId, 20, 'radusuarios.id');
        for (const value of response.registros ?? []) {
          const item = this.mapConnection(value);
          if (item) facts.push({ resource: action, entityRef: item.id, fields: {
            active: item.active, online: item.online, connectionState: item.connectionState,
            lastConnectedAt: item.lastConnectedAt, lastDisconnectedAt: item.lastDisconnectedAt,
          } });
        }
        } else if (action === 'fiber_access') {
        // Documentação IXC: radpop_radio_cliente_fibra possui id_contrato,
        // id_caixa_ftth, id_transmissor, ponid/ponno e campos de sinal. O
        // Omni consulta pelo contrato já identificado, nunca por varredura.
        for (const contract of await readContracts()) {
          const response = await this.query(
            integration,
            'radpop_radio_cliente_fibra',
            'radpop_radio_cliente_fibra.id_contrato',
            contract.id,
            10,
            'radpop_radio_cliente_fibra.id',
          );
          for (const value of response.registros ?? []) {
            const item = this.mapFiberAccess(value);
            if (item && item.contractId === contract.id) facts.push({ resource: action, entityRef: item.id, fields: {
              equipmentLinked: true,
              hasFtthBox: item.hasFtthBox,
              hasTransmitter: item.hasTransmitter,
              hasPon: item.hasPon,
              signalRecordedAt: item.signalRecordedAt,
              hasLastSignal: item.hasLastSignal,
            } });
          }
        }
        } else if (action === 'tickets') {
        const response = await this.query(integration, 'su_ticket', 'su_ticket.id_cliente', customerId, 20, 'su_ticket.id');
        for (const value of response.registros ?? []) {
          const item = this.mapTicket(value);
          if (item) facts.push({ resource: action, entityRef: item.id, fields: {
            status: item.status, protocol: item.protocol, subjectId: item.subjectId,
            sectorId: item.sectorId, priority: item.priority,
            pendingInteraction: item.pendingInteraction, openedAt: item.openedAt,
          } });
        }
        }
        completedActions.push(action);
      } catch {
        // Um recurso opcional instável não invalida fatos já obtidos de outros
        // endpoints. Os nomes das ações são seguros; payloads nunca são logados.
        failedActions.push(action);
      }
    }
    if (completedActions.length === 0) {
      return this.withMcpOutcome({ source: 'IXC', customerRef: customerId, status: 'unavailable', observedAt, facts: [] });
    }
    const evidence = this.withMcpOutcome({
      source: 'IXC', customerRef: customerId,
      status: facts.length > 0 ? 'success' : 'empty', observedAt, facts,
    });
    await this.audit.logSystem(orgId, {
      action: 'integration.ixc.operational-evidence.read', entity: 'Conversation', entityId: conversationId,
      meta: {
        actions, completedActions, failedActions, factCount: facts.length,
        legacyStatus: evidence.status,
        mcpStatus: evidence.mcpOutcome?.status,
        mcpLearningDisposition: evidence.mcpOutcome?.learningDisposition,
      },
    });
    return evidence;
  }

  private withMcpOutcome(evidence: IxcOperationalEvidence): IxcOperationalEvidence {
    const mapping = {
      success: { available: true, found: true, sufficientEvidence: true, safeForAutomaticReply: true },
      // Consulta válida sem fatos não autoriza ação automática nem permite que
      // a IA preencha a lacuna com suposição.
      empty: { available: true, found: true, sufficientEvidence: true, safeForAutomaticReply: false },
      customer_not_found: { available: true, found: false, sufficientEvidence: true, safeForAutomaticReply: false },
      customer_ambiguous: { available: true, found: true, sufficientEvidence: false, safeForAutomaticReply: false },
      unavailable: { available: false, found: true, sufficientEvidence: false, safeForAutomaticReply: false },
    } as const;
    const state = mapping[evidence.status];
    const outcome = this.governance.normalizeReadOutcome({
      integration: 'IXC',
      ...state,
      reason: `ixc_operational_evidence_${evidence.status}`,
    });
    const sourceStatusByEvidenceStatus = {
      success: 'SUCCESS',
      empty: 'EMPTY',
      customer_not_found: 'NOT_FOUND',
      customer_ambiguous: 'AMBIGUOUS',
      unavailable: 'UNAVAILABLE',
    } as const satisfies Record<
      IxcOperationalEvidence['status'],
      'SUCCESS' | 'EMPTY' | 'NOT_FOUND' | 'AMBIGUOUS' | 'UNAVAILABLE'
    >;
    this.metrics.recordMcpIntegrationOutcome(
      'IXC',
      sourceStatusByEvidenceStatus[evidence.status],
      outcome.status,
      outcome.learningDisposition,
    );
    return {
      ...evidence,
      mcpOutcome: outcome,
    };
  }

  /**
   * Forma o agrupamento operacional pela caixa FTTH registrada no IXC.
   *
   * Não é uma inferência de OLT/PON e não revela membros da caixa. A chamada é
   * permitida somente para uma conversa cuja identidade já foi validada; sua
   * saída é agregada para a camada de decisão em modo sombra.
   */
  async collectBoxCohortEvidence(
    orgId: string,
    conversationId: string,
  ): Promise<IxcBoxCohortEvidence> {
    const observedAt = new Date().toISOString();
    const empty = (
      status: IxcBoxCohortEvidence['status'],
      boxCount = 0,
    ): IxcBoxCohortEvidence => ({
      source: 'IXC_FTTH_BOX', status, observedAt, boxCount, sampleComplete: true,
      fiberEquipment: { total: 0, signalTimestamped: 0, lastSignalRecorded: 0 },
    });
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: { identityVerifiedAt: true, contactId: true },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (!identityVerificationIsValid(conversation.identityVerifiedAt)) {
      throw new BadRequestException('Identidade não validada para consultar a caixa FTTH');
    }
    const customerId = await this.identityAttempts.verifiedCustomerId(
      orgId,
      conversation.contactId,
      conversationId,
    );
    if (!customerId) return empty('unavailable');

    const integration = await this.prisma.prismaSystem.ixcIntegration.findFirst({
      where: { orgId, isEnabled: true },
    });
    if (!integration) return empty('unavailable');
    this.validateBaseUrl(integration.baseUrl);

    try {
      const customerContracts = await this.query(
        integration,
        'cliente_contrato',
        'cliente_contrato.id_cliente',
        customerId,
        20,
        'cliente_contrato.id',
      );
      const contractIds = (customerContracts.registros ?? [])
        .map((value) => this.mapContract(value))
        .filter((value): value is IxcContractDto => value !== null)
        .map((value) => value.id);
      if (contractIds.length === 0) return empty('no_box');
      const boxReferences = new Set(
        (await Promise.all(contractIds.map(async (contractId) => {
          const response = await this.query(
            integration,
            'radpop_radio_cliente_fibra',
            'radpop_radio_cliente_fibra.id_contrato',
            contractId,
            10,
            'radpop_radio_cliente_fibra.id',
          );
          return (response.registros ?? [])
            .map((value) => this.row(value))
            .map((row) => row ? this.text(row, 'id_caixa_ftth') : null)
            .filter((value): value is string => Boolean(value));
        }))).flat(),
      );
      if (boxReferences.size === 0) return empty('no_box');
      // Uma conversa pode representar mais de um contrato. Sem uma
      // relação explícita da solicitação com uma delas, não misturamos caixas.
      if (boxReferences.size !== 1) return empty('box_ambiguous', boxReferences.size);

      const boxReference = [...boxReferences][0]!;
      const response = await this.query(
        integration,
        'radpop_radio_cliente_fibra',
        'radpop_radio_cliente_fibra.id_caixa_ftth',
        boxReference,
        IxcService.BOX_COHORT_PAGE_SIZE,
        'radpop_radio_cliente_fibra.id',
      );
      const rows = (response.registros ?? [])
        .map((value) => this.mapFiberAccess(value))
        .filter((value): value is IxcFiberAccessDto => value !== null);
      const declaredTotal = this.asNonNegativeInteger(response.total);
      const total = declaredTotal ?? rows.length;
      const sampleComplete = declaredTotal !== null
        ? declaredTotal <= rows.length
        : rows.length < IxcService.BOX_COHORT_PAGE_SIZE;
      const result: IxcBoxCohortEvidence = {
        source: 'IXC_FTTH_BOX', status: 'available', observedAt, boxCount: 1, sampleComplete,
        fiberEquipment: {
          total,
          signalTimestamped: rows.filter((row) => row.signalRecordedAt !== null).length,
          lastSignalRecorded: rows.filter((row) => row.hasLastSignal).length,
        },
      };
      await this.audit.logSystem(orgId, {
        action: 'integration.ixc.box-cohort.read',
        entity: 'Conversation',
        entityId: conversationId,
        meta: {
          boxCount: result.boxCount,
          sampleComplete: result.sampleComplete,
          total: result.fiberEquipment.total,
          signalTimestamped: result.fiberEquipment.signalTimestamped,
          lastSignalRecorded: result.fiberEquipment.lastSignalRecorded,
        },
      });
      return result;
    } catch {
      // A indisponibilidade da leitura é incidente técnico, não evidência de
      // queda nem lacuna de conhecimento.
      return empty('unavailable');
    }
  }

  /**
   * Consulta a trilha factual documentada pelo IXC para evento estrutural:
   * login (`radusuarios`) -> login afetado -> OS -> estrutura.
   *
   * A tabela de logins afetados é a diferença entre uma coorte técnica e
   * uma afetação efetivamente registrada. Sem ela, inclusive diante de sinal
   * ausente, a resposta continua não confirmada.
   */
  async collectStructuralIncidentEvidence(
    orgId: string,
    conversationId: string,
  ): Promise<IxcStructuralIncidentEvidence> {
    const observedAt = new Date().toISOString();
    const empty = (
      status: IxcStructuralIncidentEvidence['status'],
      matchedLogins = 0,
      matchedMaintenanceRegions = 0,
      activeStructuralOrders = 0,
    ): IxcStructuralIncidentEvidence => ({
      source: 'IXC_STRUCTURAL_OS', status, observedAt,
      matchedLogins, matchedMaintenanceRegions, activeStructuralOrders,
      incidentCode: null,
    });
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      select: { identityVerifiedAt: true, contactId: true },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (!identityVerificationIsValid(conversation.identityVerifiedAt)) {
      throw new BadRequestException('Identidade não validada para consultar evento estrutural');
    }
    const customerId = await this.identityAttempts.verifiedCustomerId(
      orgId,
      conversation.contactId,
      conversationId,
    );
    if (!customerId) return empty('INCONCLUSIVE');
    const integration = await this.prisma.prismaSystem.ixcIntegration.findFirst({
      where: { orgId, isEnabled: true },
    });
    if (!integration) return empty('UNAVAILABLE');
    this.validateBaseUrl(integration.baseUrl);

    try {
      const connectionResponse = await this.query(
        integration,
        'radusuarios',
        'radusuarios.id_cliente',
        customerId,
        20,
        'radusuarios.id',
      );
      const loginIds = (connectionResponse.registros ?? [])
        .map((value) => this.mapConnection(value))
        .filter((value): value is IxcConnectionDto => value !== null)
        .filter((value) => value.customerId === customerId)
        .map((value) => value.id);
      if (loginIds.length === 0) return empty('NOT_CONFIRMED');

      const affected = (await Promise.all(loginIds.map(async (loginId) => {
        const response = await this.query(
          integration,
          'su_oss_chamado_regiao_manutencao_radusuarios',
          'su_oss_chamado_regiao_manutencao_radusuarios.id_radusuarios',
          loginId,
          20,
          'su_oss_chamado_regiao_manutencao_radusuarios.id',
        );
        return (response.registros ?? [])
          .map((value) => this.mapAffectedLogin(value))
          .filter((value): value is { loginId: string; serviceOrderId: string; maintenanceRegionServiceOrderId: string } => value !== null)
          .filter((value) => value.loginId === loginId);
      }))).flat();
      if (affected.length === 0) return empty('NOT_CONFIRMED');

      // No contrato IXC, `id_su_oss_chamado` referencia a OS associada ao
      // registro; já `id_su_oss_chamado_regiao_manutencao` é a OS que pertence
      // à região de manutenção. É esta segunda que precisa ser estrutural e
      // ativa para representar evento coletivo.
      const structuralOrderIds = [...new Set(affected.map((value) => value.maintenanceRegionServiceOrderId))];
      const activeStructuralOrderIds: string[] = [];
      for (const orderId of structuralOrderIds) {
        const response = await this.query(
          integration,
          'su_oss_chamado',
          'su_oss_chamado.id',
          orderId,
          1,
          'su_oss_chamado.id',
        );
        const order = (response.registros ?? [])
          .map((value) => this.mapStructuralServiceOrder(value))
          .find((value) => value?.id === orderId);
        if (order?.type === 'E' && order.status === 'A') activeStructuralOrderIds.push(order.id);
      }
      if (activeStructuralOrderIds.length === 0) {
        return empty(
          'NOT_CONFIRMED',
          new Set(affected.map((value) => value.loginId)).size,
          new Set(affected.map((value) => value.maintenanceRegionServiceOrderId)).size,
        );
      }
      const incidentCode = `ixc_estrutura_${createHash('sha256')
        .update(activeStructuralOrderIds.sort().join(','), 'utf8')
        .digest('hex')
        .slice(0, 24)}`;
      const result: IxcStructuralIncidentEvidence = {
        source: 'IXC_STRUCTURAL_OS',
        status: 'CONFIRMED',
        observedAt,
        matchedLogins: new Set(affected.map((value) => value.loginId)).size,
        matchedMaintenanceRegions: new Set(affected.map((value) => value.maintenanceRegionServiceOrderId)).size,
        activeStructuralOrders: activeStructuralOrderIds.length,
        incidentCode,
      };
      await this.audit.logSystem(orgId, {
        action: 'integration.ixc.structural-incident.read',
        entity: 'Conversation',
        entityId: conversationId,
        meta: {
          status: result.status,
          matchedLogins: result.matchedLogins,
          matchedMaintenanceRegions: result.matchedMaintenanceRegions,
          activeStructuralOrders: result.activeStructuralOrders,
        },
      });
      return result;
    } catch {
      // Falha de leitura não equivale a ausência de evento. O atendimento
      // segue por diagnóstico individual seguro, sem declarar normalidade.
      return empty('UNAVAILABLE');
    }
  }

  private async auditIdentityCandidateLookup(
    orgId: string,
    conversationId: string,
    source: 'WHATSAPP_PHONE' | 'SHARED_LOCATION' | 'POSTAL_ADDRESS',
    status: 'candidate_ready' | 'no_candidate' | 'unavailable',
    candidateCount: number,
  ): Promise<void> {
    try {
      await this.audit.logSystem(orgId, {
        action: 'conversation.identity.location-candidate.evaluate',
        entity: 'Conversation',
        entityId: conversationId,
        // Sem latitude, longitude, CEP, número ou IDs IXC: o log só permite
        // auditar o comportamento do fluxo, não reconstruir a localização.
        meta: { source, status, candidateCount },
      });
    } catch {
      // A auditoria é complementar: sua indisponibilidade não pode impedir a
      // resposta segura nem transformar uma falha de leitura em conclusão.
    }
  }

  private locationIdentityKey(orgId: string, contactId: string, conversationId: string): string {
    return `identity-location-candidates:${orgId}:${contactId}:${conversationId}`;
  }

  private validLocationCoordinates(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90
      && latitude <= 90
      && longitude >= -180
      && longitude <= 180;
  }

  private rangeQuery(minimum: number, maximum: number): string {
    // O operador BE do IXC recebe os limites no mesmo campo, separados por
    // vírgula; a segunda dimensão entra por grid_param.
    return `${minimum.toFixed(7)},${maximum.toFixed(7)}`;
  }

  private locationDistanceMeters(
    sourceLatitude: number,
    sourceLongitude: number,
    targetLatitude: number,
    targetLongitude: number,
  ): number {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const latitudeDelta = radians(targetLatitude - sourceLatitude);
    const longitudeDelta = radians(targetLongitude - sourceLongitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(radians(sourceLatitude)) * Math.cos(radians(targetLatitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private async queryWithGrid(
    integration: IxcIntegration,
    endpoint: IxcEndpoint,
    field: string,
    value: string,
    rp: number,
    sortname: string,
    oper: string,
    grid: Array<{ TB: string; OP: string; P: string }>,
  ): Promise<IxcListResponse> {
    let response: IxcListResponse;
    try {
      response = await this.http.list(integration.baseUrl, this.decryptCredentials(integration), endpoint, {
        qtype: field,
        query: value,
        oper,
        page: '1',
        rp: String(rp),
        sortname,
        sortorder: 'desc',
        grid_param: JSON.stringify(grid),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      const failure = new ServiceUnavailableException(`IXC endpoint ${endpoint}: ${reason}`);
      Object.assign(failure, { ixcFailureCode: this.ixcFailureCode(error) });
      throw failure;
    }
    if (response.type === 'error') {
      const failure = new ServiceUnavailableException('IXC recusou a consulta configurada');
      Object.assign(failure, { ixcFailureCode: 'IXC_REJECTED' });
      throw failure;
    }
    return response;
  }

  private async query(
    integration: IxcIntegration,
    endpoint: IxcEndpoint,
    field: string,
    value: string,
    rp: number,
    sortname = 'cliente.id',
    oper = '=',
  ): Promise<IxcListResponse> {
    let response: IxcListResponse;
    try {
      response = await this.http.list(integration.baseUrl, this.decryptCredentials(integration), endpoint, {
        qtype: field,
        query: value,
        oper,
        page: '1',
        rp: String(rp),
        sortname,
        sortorder: 'desc',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      const failure = new ServiceUnavailableException(`IXC endpoint ${endpoint}: ${reason}`);
      Object.assign(failure, { ixcFailureCode: this.ixcFailureCode(error) });
      throw failure;
    }
    if (response.type === 'error') {
      const failure = new ServiceUnavailableException('IXC recusou a consulta configurada');
      Object.assign(failure, { ixcFailureCode: 'IXC_REJECTED' });
      throw failure;
    }
    return response;
  }

  private async auditRead(
    integrationId: string,
    resource: string,
    resultCount: number,
  ): Promise<void> {
    await this.audit.log({
      action: `integration.ixc.${resource}.list`,
      entity: 'IxcIntegration',
      entityId: integrationId,
      meta: { resultCount },
    });
  }

  private async requireIntegration(mustBeEnabled: boolean): Promise<IxcIntegration> {
    const integration = await this.prisma.tenant.ixcIntegration.findUnique({
      where: { orgId: this.tenancy.getOrgIdOrThrow() },
    });
    if (!integration) throw new NotFoundException('Integração IXC não configurada');
    this.validateBaseUrl(integration.baseUrl);
    if (mustBeEnabled && !integration.isEnabled) {
      throw new ServiceUnavailableException('Integração IXC está desativada');
    }
    return integration;
  }

  private async requireIntegrationForOrg(orgId: string): Promise<IxcIntegration> {
    const integration = await this.prisma.prismaSystem.ixcIntegration.findFirst({ where: { orgId } });
    if (!integration) throw new NotFoundException('Integração IXC não configurada');
    this.validateBaseUrl(integration.baseUrl);
    if (!integration.isEnabled) throw new ServiceUnavailableException('Integração IXC está desativada');
    return integration;
  }

  private async requireVerifiedIdentity(conversationId: string): Promise<void> {
    const conversation = await this.prisma.tenant.conversation.findFirst({
      where: { id: conversationId },
      select: { identityVerifiedAt: true },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (!conversation.identityVerifiedAt) {
      throw new BadRequestException('Valide a identidade do cliente antes de consultar dados protegidos');
    }
    if (!identityVerificationIsValid(conversation.identityVerifiedAt)) {
      throw new BadRequestException('Valide novamente a identidade do cliente antes de consultar dados protegidos');
    }
  }

  private validateBaseUrl(input: string): string {
    let url: URL;
    try {
      url = new URL(input.trim());
    } catch {
      throw new BadRequestException('baseUrl IXC inválida');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new BadRequestException('baseUrl IXC deve ser HTTPS e não pode conter credenciais ou parâmetros');
    }
    if (!this.allowedHosts.has(url.hostname.toLowerCase())) {
      throw new BadRequestException('Host IXC não está autorizado em IXC_ALLOWED_HOSTS');
    }
    const path = url.pathname.replace(/\/+$/, '');
    if (!path.endsWith('/webservice/v1')) {
      throw new BadRequestException('baseUrl IXC deve terminar em /webservice/v1');
    }
    url.pathname = path;
    return url.toString().replace(/\/$/, '');
  }

  private decryptCredentials(integration: IxcIntegration): IxcCredentials {
    try {
      const value = JSON.parse(this.crypto.decrypt(integration.encryptedCredentials)) as Partial<IxcCredentials>;
      if (!value.username || !value.token) throw new Error('invalid');
      return { username: value.username, token: value.token };
    } catch {
      throw new ServiceUnavailableException('Credenciais IXC inválidas ou indisponíveis');
    }
  }

  private trustedIxcCustomerId(customFields: unknown): string | null {
    if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) return null;
    const value = (customFields as Record<string, unknown>)[TRUSTED_IXC_CUSTOMER_ID_FIELD];
    return typeof value === 'string' && /^\d{1,32}$/.test(value) ? value : null;
  }

  private withTrustedIxcCustomerId(customFields: unknown, customerId: string): Prisma.InputJsonValue {
    const current = customFields && typeof customFields === 'object' && !Array.isArray(customFields)
      ? customFields as Record<string, unknown>
      : {};
    return { ...current, [TRUSTED_IXC_CUSTOMER_ID_FIELD]: customerId };
  }

  private autoViabilityJournal(customFields: unknown): AutoViabilityJournal {
    if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) {
      return { version: 1, attempts: {} };
    }
    const candidate = (customFields as Record<string, unknown>)[AUTO_VIABILITY_JOURNAL_FIELD];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { version: 1, attempts: {} };
    }
    const attempts = (candidate as Record<string, unknown>).attempts;
    if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) {
      return { version: 1, attempts: {} };
    }
    const safeAttempts: Record<string, AutoViabilityAttempt> = {};
    for (const [key, value] of Object.entries(attempts as Record<string, unknown>)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const status = row.status;
      const startedAt = row.startedAt;
      if ((status !== 'PENDING' && status !== 'COMPLETED' && status !== 'REVIEW_REQUIRED') || typeof startedAt !== 'string') continue;
      const outcome = row.outcome;
      const leadId = row.leadId;
      const completedAt = row.completedAt;
      const eligiblePlans = this.safeAutoViabilityPlans(row.eligiblePlans);
      safeAttempts[key] = {
        status,
        ...(outcome === 'CONFIRMED' || outcome === 'NOT_AVAILABLE' || outcome === 'INCONCLUSIVE' ? { outcome } : {}),
        ...(typeof leadId === 'string' && /^\d{1,32}$/.test(leadId) ? { leadId } : {}),
        ...(eligiblePlans.length > 0 ? { eligiblePlans } : {}),
        startedAt,
        ...(typeof completedAt === 'string' ? { completedAt } : {}),
      };
    }
    return { version: 1, attempts: safeAttempts };
  }

  private async persistAutoViabilityAttempt(
    contactId: string,
    customFields: unknown,
    fingerprint: string,
    attempt: AutoViabilityAttempt,
  ): Promise<void> {
    const current = customFields && typeof customFields === 'object' && !Array.isArray(customFields)
      ? customFields as Record<string, unknown>
      : {};
    const attempts = {
      ...this.autoViabilityJournal(customFields).attempts,
      [fingerprint]: attempt,
    };
    const retained = Object.entries(attempts)
      .sort(([, left], [, right]) => (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt))
      .slice(0, MAX_AUTO_VIABILITY_ATTEMPTS_PER_CONTACT);
    await this.prisma.tenant.contact.update({
      where: { id: contactId },
      data: {
        customFields: {
          ...current,
          [AUTO_VIABILITY_JOURNAL_FIELD]: { version: 1, attempts: Object.fromEntries(retained) },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private normalizeAutoViabilityPhone(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.replace(/\D/g, '');
    return /^\d{10,13}$/.test(normalized) ? normalized : null;
  }

  private normalizeFingerprintText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  }

  private normalizeAutoViabilityResponse(raw: Record<string, unknown>): {
    outcome: AutoViabilityOutcome;
    leadId?: string;
    planReferences: Array<{ id: string | null; name: string | null; value: number | null }>;
  } {
    // O IXC Provider também encapsula o resultado na chave numérica `0`
    // (ex.: { "0": { status_viabilidade: "S" }, success: true }). Ler
    // somente `data` ou o nível principal convertia uma resposta válida em
    // INCONCLUSIVE. Aceitamos as três formas observadas sem interpretar texto
    // livre retornado pelo provedor.
    const nestedData = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? raw.data as Record<string, unknown>
      : null;
    const indexedData = raw['0'] && typeof raw['0'] === 'object' && !Array.isArray(raw['0'])
      ? raw['0'] as Record<string, unknown>
      : null;
    const data = nestedData ?? indexedData ?? raw;
    const boolean = (value: unknown): boolean | null => {
      if (value === true || value === 1) return true;
      if (value === false || value === 0) return false;
      if (typeof value !== 'string') return null;
      const normalized = value.trim().toLocaleUpperCase('pt-BR');
      return ['S', 'SIM', '1', 'TRUE', 'VIAVEL', 'DISPONIVEL'].includes(normalized)
        ? true
        : ['N', 'NAO', 'NÃO', '0', 'FALSE', 'INVIAVEL', 'INDISPONIVEL'].includes(normalized)
          ? false
          : null;
    };
    const viability = boolean(
      data.status_viabilidade
      ?? data.hasViability
      ?? data.has_viability
      ?? data.viability
      ?? data.viabilidade
      ?? data.viavel
      ?? data.disponivel,
    );
    const candidateLeadId = data.leadId ?? data.lead_id ?? data.idLead ?? data.id_lead;
    const leadId = typeof candidateLeadId === 'number' || typeof candidateLeadId === 'string'
      ? String(candidateLeadId)
      : undefined;
    const planReferences = Array.isArray(data.planos)
      ? data.planos.slice(0, 30).flatMap((candidate) => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
          const row = candidate as Record<string, unknown>;
          const rawId = row.id ?? row.id_plano ?? row.id_contrato;
          const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
          const rawName = row.nome ?? row.name ?? row.plano ?? row.descricao;
          const name = typeof rawName === 'string' ? this.cleanAutoViabilityPlanName(rawName) : null;
          const rawValue = row.valor ?? row.valor_contrato ?? row.preco ?? row.value;
          const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          const value = Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
          return id || name ? [{ id, name, value }] : [];
        })
      : [];
    return {
      outcome: viability === true ? 'CONFIRMED' : viability === false ? 'NOT_AVAILABLE' : 'INCONCLUSIVE',
      ...(leadId && /^\d{1,32}$/.test(leadId) ? { leadId } : {}),
      planReferences,
    };
  }

  private async resolveAutoViabilityPlans(
    references: Array<{ id: string | null; name: string | null; value: number | null }>,
  ): Promise<IxcAutoViabilityPlan[]> {
    if (references.length === 0) return [];
    let catalog: IxcPlanDto[] = [];
    if (references.some((item) => item.id && !item.name)) {
      try {
        catalog = await this.listPlans();
      } catch {
        // A confirmação de cobertura continua válida. Sem catálogo não
        // inventamos nome ou preço para uma referência retornada pelo InMap.
      }
    }
    const catalogById = new Map(catalog.map((plan) => [plan.id, plan]));
    return references.flatMap((reference) => {
      const catalogPlan = reference.id ? catalogById.get(reference.id) : undefined;
      const name = reference.name ?? (catalogPlan ? this.cleanAutoViabilityPlanName(catalogPlan.name) : null);
      if (!name) return [];
      return [{
        id: reference.id,
        name,
        value: reference.value ?? catalogPlan?.value ?? null,
      }];
    });
  }

  private safeAutoViabilityPlans(value: unknown): IxcAutoViabilityPlan[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 30).flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const row = candidate as Record<string, unknown>;
      const name = typeof row.name === 'string' ? this.cleanAutoViabilityPlanName(row.name) : null;
      if (!name) return [];
      const id = typeof row.id === 'string' && /^\d{1,32}$/.test(row.id) ? row.id : null;
      const value = typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0
        ? row.value
        : null;
      return [{ id, name, value }];
    });
  }

  private cleanAutoViabilityPlanName(value: string): string | null {
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return clean.length >= 2 ? clean : null;
  }

  private autoViabilityResult(
    status: AutoViabilityOutcome,
    cached: boolean,
    leadReferenceAvailable: boolean,
    observedAt: string,
    eligiblePlans: IxcAutoViabilityPlan[],
  ): IxcAutoViabilityCheckResult {
    return {
      source: 'IXC_INMAP_AUTO_VIABILITY', status, cached, leadReferenceAvailable, eligiblePlans, observedAt,
    };
  }

  private autoViabilityResponseShape(raw: Record<string, unknown>): AutoViabilityResponseShape {
    const safeKeys = (value: Record<string, unknown>): string[] => Object.keys(value)
      // Nomes de campos do contrato; descarta qualquer chave dinâmica ou
      // não convencional que pudesse carregar conteúdo identificável.
      .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(key))
      .slice(0, 16);
    const objectContainers = safeKeys(raw)
      .map((key) => ({ key, value: raw[key] }))
      .filter((entry): entry is { key: string; value: Record<string, unknown> } => (
        Boolean(entry.value) && typeof entry.value === 'object' && !Array.isArray(entry.value)
      ))
      .slice(0, 4)
      .map(({ key, value }) => ({ key, keys: safeKeys(value).slice(0, 12) }));
    return { topLevelKeys: safeKeys(raw), objectContainers };
  }

  private mapCustomer(value: unknown): IxcCustomerDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const text = (key: string): string | null =>
      typeof row[key] === 'string' && row[key] !== '' ? row[key] : null;
    const id = text('id');
    if (!id) return null;
    return {
      id,
      name: text('razao') ?? text('nome') ?? 'Cliente IXC',
      tradeName: text('fantasia'),
      cpfCnpj: text('cnpj_cpf'),
      active: row.ativo === 'S' ? true : row.ativo === 'N' ? false : null,
      phone: text('fone'),
      mobilePhone: text('telefone_celular'),
      whatsapp: text('whatsapp'),
      email: text('email'),
      cityId: text('cidade'),
    };
  }

  private row(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private text(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    return typeof value === 'string' && value !== '' ? value : null;
  }

  private number(row: Record<string, unknown>, key: string): number | null {
    const value = this.text(row, key);
    if (value === null) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private asNonNegativeInteger(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private ixcFailureCode(error: unknown): 'ACCESS_DENIED' | 'ENDPOINT_UNSUPPORTED' | 'INVALID_QUERY' | 'TEMPORARY_UNAVAILABLE' | 'INVALID_RESPONSE' | 'IXC_REJECTED' | 'UNKNOWN' {
    const failureKind = error && typeof error === 'object' && 'ixcFailureKind' in error
      ? (error as { ixcFailureKind?: unknown }).ixcFailureKind
      : undefined;
    if (failureKind === 'INVALID_RESPONSE') return 'INVALID_RESPONSE';
    const status = error && typeof error === 'object' && 'ixcHttpStatus' in error
      ? (error as { ixcHttpStatus?: unknown }).ixcHttpStatus
      : undefined;
    if (status === 401 || status === 403) return 'ACCESS_DENIED';
    if (status === 404) return 'ENDPOINT_UNSUPPORTED';
    if (status === 400 || status === 405 || status === 422) return 'INVALID_QUERY';
    if (status === 408 || status === 429 || (typeof status === 'number' && status >= 500)) {
      return 'TEMPORARY_UNAVAILABLE';
    }
    return 'UNKNOWN';
  }

  /** Diagnóstico de transporte de baixa cardinalidade; nunca inclui o corpo IXC. */
  private ixcResponseKind(error: unknown): 'EMPTY' | 'HTML' | 'NON_JSON' | 'UNKNOWN' {
    const value = error && typeof error === 'object' && 'ixcResponseKind' in error
      ? (error as { ixcResponseKind?: unknown }).ixcResponseKind
      : undefined;
    return value === 'EMPTY' || value === 'HTML' || value === 'NON_JSON' ? value : 'UNKNOWN';
  }

  private toReadInventory<T>(
    response: IxcListResponse,
    rawRecordCount: number,
    items: T[],
    pageSize: number,
  ): IxcReadInventory<T> {
    const declaredTotal = this.asNonNegativeInteger(response.total);
    const pageComplete = declaredTotal !== null
      ? declaredTotal <= rawRecordCount
      : rawRecordCount < pageSize;
    return {
      items,
      declaredTotal,
      // Um registro malformado também invalida uma conclusão negativa: ele
      // pode ser justamente a caixa/regra que faltaria para a avaliação.
      malformedRecordCount: rawRecordCount - items.length,
      complete: pageComplete && rawRecordCount === items.length,
    };
  }

  private safeEqual(expected: string, supplied: string): boolean {
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(supplied, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private yesNo(row: Record<string, unknown>, key: string): boolean | null {
    const value = this.text(row, key)?.toUpperCase();
    if (value === 'S' || value === 'SIM' || value === '1') return true;
    if (value === 'N' || value === 'NAO' || value === 'NÃO' || value === '0') return false;
    return null;
  }

  private statusIsActive(row: Record<string, unknown>, key: string): boolean | null {
    const value = this.text(row, key)?.toUpperCase();
    if (value === 'A') return true;
    if (value === 'I') return false;
    return this.yesNo(row, key);
  }

  private mapContract(value: unknown): IxcContractDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const customerId = this.text(row, 'id_cliente');
    if (!id || !customerId) return null;
    return {
      id,
      customerId,
      status: this.text(row, 'status'),
      internetStatus: this.text(row, 'status_internet'),
      planDescription: this.text(row, 'descricao_aux_plano_venda'),
      registeredAt: this.text(row, 'data_cadastro_sistema'),
      activatedAt: this.text(row, 'data_ativacao'),
      expiresAt: this.text(row, 'data_expiracao'),
      cancelledAt: this.text(row, 'data_cancelamento'),
    };
  }

  private mapInvoice(value: unknown): IxcInvoiceDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const customerId = this.text(row, 'id_cliente');
    if (!id || !customerId) return null;
    return {
      id,
      customerId,
      contractId: this.text(row, 'id_contrato'),
      status: this.text(row, 'status'),
      dueDate: this.text(row, 'data_vencimento'),
      issuedAt: this.text(row, 'data_emissao'),
      paidAt: this.text(row, 'pagamento_data'),
      amount: this.number(row, 'valor'),
      openAmount: this.number(row, 'valor_aberto'),
      paidAmount: this.number(row, 'valor_recebido'),
    };
  }

  private mapServiceOrder(value: unknown): IxcServiceOrderDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const customerId = this.text(row, 'id_cliente');
    if (!id || !customerId) return null;
    return {
      id,
      customerId,
      ticketId: this.text(row, 'id_ticket'),
      protocol: this.text(row, 'protocolo'),
      status: this.text(row, 'status'),
      type: this.text(row, 'tipo'),
      priority: this.text(row, 'prioridade'),
      sector: this.text(row, 'setor'),
      subjectId: this.text(row, 'id_assunto'),
      openedAt: this.text(row, 'data_abertura'),
      scheduledAt: this.text(row, 'data_agenda'),
      closedAt: this.text(row, 'data_fechamento'),
      slaStatus: this.text(row, 'status_sla'),
    };
  }

  private mapConnection(value: unknown): IxcConnectionDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const customerId = this.text(row, 'id_cliente');
    if (!id || !customerId) return null;
    return {
      id,
      customerId,
      contractId: this.text(row, 'id_contrato'),
      active: this.yesNo(row, 'ativo'),
      online: this.yesNo(row, 'online'),
      connectionState: this.text(row, 'conexao'),
      accessType: this.text(row, 'tipo_acesso'),
      lastConnectedAt: this.text(row, 'ultima_conexao_inicial'),
      lastDisconnectedAt: this.text(row, 'ultima_conexao_final'),
      disconnectReason: this.text(row, 'motivo_desconexao'),
      lastSignal: this.text(row, 'sinal_ultimo_atendimento'),
    };
  }

  private mapFiberAccess(value: unknown): IxcFiberAccessDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const contractId = this.text(row, 'id_contrato');
    if (!id || !contractId) return null;
    return {
      id,
      contractId,
      hasFtthBox: Boolean(this.text(row, 'id_caixa_ftth')),
      hasTransmitter: Boolean(this.text(row, 'id_transmissor')),
      hasPon: Boolean(this.text(row, 'ponid') ?? this.text(row, 'ponno')),
      signalRecordedAt: this.text(row, 'data_sinal'),
      hasLastSignal: Boolean(this.text(row, 'sinal_rx') ?? this.text(row, 'sinal_tx')),
    };
  }

  private mapAffectedLogin(value: unknown): {
    loginId: string;
    serviceOrderId: string;
    maintenanceRegionServiceOrderId: string;
  } | null {
    const row = this.row(value);
    if (!row) return null;
    const loginId = this.text(row, 'id_radusuarios');
    const serviceOrderId = this.text(row, 'id_su_oss_chamado');
    const maintenanceRegionServiceOrderId = this.text(row, 'id_su_oss_chamado_regiao_manutencao');
    return loginId && serviceOrderId && maintenanceRegionServiceOrderId
      ? { loginId, serviceOrderId, maintenanceRegionServiceOrderId }
      : null;
  }

  private mapStructuralServiceOrder(value: unknown): { id: string; type: string | null; status: string | null } | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    if (!id) return null;
    return {
      id,
      type: this.text(row, 'tipo')?.toUpperCase() ?? null,
      status: this.text(row, 'status')?.toUpperCase() ?? null,
    };
  }

  private mapFtthBox(value: unknown): IxcFtthBoxDto | null {
    const row = this.row(value);
    if (!row || !this.text(row, 'id')) return null;
    const latitude = this.number(row, 'latitude');
    const longitude = this.number(row, 'longitude');
    return {
      active: this.yesNo(row, 'status') ?? (this.text(row, 'status')?.toUpperCase() === 'A' ? true : null),
      cityId: this.text(row, 'id_cidade'),
      latitude: latitude !== null && latitude >= -90 && latitude <= 90 ? latitude : null,
      longitude: longitude !== null && longitude >= -180 && longitude <= 180 ? longitude : null,
      reportedCapacity: this.number(row, 'capacidade'),
      updatedAt: this.text(row, 'ultima_atualizacao'),
    };
  }

  private mapInmapProject(value: unknown): IxcInmapProjectDto | null {
    const row = this.row(value);
    if (!row || !this.text(row, 'id')) return null;
    return { active: this.statusIsActive(row, 'status') };
  }

  private mapCoverageRegionType(value: unknown): IxcCoverageRegionTypeDto | null {
    const row = this.row(value);
    if (!row || !this.text(row, 'id')) return null;
    return {
      active: this.statusIsActive(row, 'status'),
      viabilityEnabled: this.yesNo(row, 'verificar_viabilidade'),
      fiberEnabled: this.yesNo(row, 'tec_fibra'),
    };
  }

  private mapNegotiationPlan(value: unknown): IxcNegotiationPlanDto | null {
    const row = this.row(value);
    if (!row || !this.text(row, 'id')) return null;
    return {
      active: this.yesNo(row, 'ativo'),
      hasSourcePlan: Boolean(this.text(row, 'id_plano')),
      hasWorkflow: Boolean(this.text(row, 'id_wfl_processo')),
      hasInstallationSubject: Boolean(this.text(row, 'id_assunto')),
    };
  }

  private mapTicket(value: unknown): IxcTicketDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const customerId = this.text(row, 'id_cliente');
    if (!id || !customerId) return null;
    return {
      id, customerId,
      contractId: this.text(row, 'id_contrato'),
      protocol: this.text(row, 'protocolo'),
      status: this.text(row, 'status') ?? this.text(row, 'su_status'),
      subjectId: this.text(row, 'id_assunto'),
      sectorId: this.text(row, 'id_ticket_setor'),
      priority: this.text(row, 'prioridade'),
      pendingInteraction: this.yesNo(row, 'interacao_pendente'),
      openedAt: this.text(row, 'data_criacao'),
      updatedAt: this.text(row, 'data_ultima_alteracao'),
    };
  }

  private mapSubjectRule(value: unknown): IxcSubjectRuleDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const name = this.text(row, 'assunto');
    if (!id || !name) return null;
    return {
      id, name,
      active: this.yesNo(row, 'ativo'),
      purpose: this.text(row, 'finalidade'),
      defaultPriority: this.text(row, 'prioridade_padrao'),
      contractRequired: this.yesNo(row, 'contrato_obrigatorio'),
      loginRequired: this.yesNo(row, 'login_obrigatorio'),
      diagnosisRequired: this.yesNo(row, 'diagnostico_obrigatorio_finalizacao_os'),
      checklistId: this.text(row, 'id_checklist'),
      photosRequired: this.yesNo(row, 'exige_fotos_finalizacao_os'),
      teamRequired: this.yesNo(row, 'equipe_obrigatoria_finalizacao_os'),
      customerSignatureEnabled: this.yesNo(row, 'habilita_assinatura_cliente'),
    };
  }

  private mapPlan(value: unknown): IxcPlanDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const name = this.text(row, 'nome');
    if (!id || !name) return null;
    return {
      id, name,
      active: this.yesNo(row, 'Ativo'),
      value: this.number(row, 'valor_contrato'),
      loyaltyMonths: this.number(row, 'fidelidade'),
      productId: this.text(row, 'id_produto_contrato_vinc'),
    };
  }

  private mapSpeedProfile(value: unknown): IxcSpeedProfileDto | null {
    const row = this.row(value);
    if (!row) return null;
    const id = this.text(row, 'id');
    const name = this.text(row, 'grupo');
    if (!id || !name) return null;
    return {
      id, name,
      active: this.yesNo(row, 'ativo_normal'),
      download: this.text(row, 'download'),
      upload: this.text(row, 'upload'),
      monthlyAllowance: this.text(row, 'franquia_mensal'),
      connectionType: this.text(row, 'sici_tecnologia'),
    };
  }

  private toDto(integration: IxcIntegration): IxcIntegrationDto {
    return {
      baseUrl: integration.baseUrl,
      isEnabled: integration.isEnabled,
      hasCredentials: integration.encryptedCredentials.length > 0,
      lastTestedAt: integration.lastTestedAt?.toISOString() ?? null,
      lastTestSucceeded: integration.lastTestSucceeded,
    };
  }
}
