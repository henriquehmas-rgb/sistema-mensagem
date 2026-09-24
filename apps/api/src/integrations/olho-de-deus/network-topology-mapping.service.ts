import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  NetworkTopologyMappingKind,
  type NetworkTopologyCalibrationEvidence,
  type NetworkTopologyMapping,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import {
  ConfirmNetworkTopologyMappingDto,
  CreateNetworkTopologyMappingDto,
} from './dto/create-network-topology-mapping.dto';
import { RecordNetworkTopologyCalibrationDto } from './dto/record-network-topology-calibration.dto';

type Topology = { olt: string; board: string | null; pon: string | null };

export type NetworkTopologyResolution =
  | { state: 'UNMAPPED' }
  | { state: 'AMBIGUOUS'; matches: number }
  | { state: 'CONFIRMED'; topology: Topology };

/**
 * Registro de correlação sob controle do Omni. Não consulta nem deduz por
 * proximidade geográfica: uma região só é uma cobertura coletiva após ser
 * confirmada; uma ligação individual exige referência IXC técnica ou cliente.
 */
@Injectable()
export class NetworkTopologyMappingService {
  private static readonly CALIBRATION_MIN_INDEPENDENT_EVENTS = 3;
  private static readonly CALIBRATION_MIN_DISTINCT_DAYS = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async readiness() {
    const [shadow, confirmed] = await Promise.all([
      this.prisma.tenant.networkTopologyMapping.count({ where: { status: 'SHADOW' } }),
      this.prisma.tenant.networkTopologyMapping.count({ where: { status: 'CONFIRMED' } }),
    ]);
    return {
      mode: 'SHADOW' as const,
      supportsRegionalTriage: true,
      allowsIndividualDecision: false,
      shadow,
      confirmed,
      nextRequirement: confirmed > 0 ? 'IXC_REFERENCE_AT_RUNTIME' : 'CONFIRMED_TECHNICAL_MAPPING',
    };
  }

  /** Inventário administrativo sem revelar referência, endereço ou topologia. */
  async list() {
    const entries = await this.prisma.tenant.networkTopologyMapping.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { calibrationEvidence: { select: { observedAt: true } } },
    });
    return entries.map((entry) => this.toAdminDto(entry));
  }

  async createShadow(dto: CreateNetworkTopologyMappingDto) {
    const record = await this.upsertShadow(dto);
    await this.audit.log({
      action: 'olho-de-deus.topology-mapping.shadow.create',
      entity: 'NetworkTopologyMapping',
      entityId: record.id,
      meta: { referenceKind: record.referenceKind, status: record.status },
    });
    return this.toAdminDto(record);
  }

  /**
   * Registra uma ocorrência técnica confirmada para calibrar uma caixa FTTH.
   * O registro continua em SHADOW: a elegibilidade nunca muda o status nem
   * influencia a triagem até que um administrador confirme explicitamente.
   */
  async recordCalibration(dto: RecordNetworkTopologyCalibrationDto) {
    if (dto.referenceKind !== NetworkTopologyMappingKind.IXC_FTTH_BOX) {
      throw new BadRequestException('A calibração controlada aceita somente caixas FTTH do IXC');
    }
    const observedAt = new Date(dto.observedAt);
    if (Number.isNaN(observedAt.getTime())) {
      throw new BadRequestException('Data da ocorrência inválida');
    }
    const record = await this.upsertShadow(dto);
    const eventFingerprint = this.crypto.fingerprint(this.normalize(dto.externalEventId));
    const evidenceFingerprint = this.crypto.fingerprint(this.normalize(dto.evidenceReference));
    const existing = await this.prisma.tenant.networkTopologyCalibrationEvidence.findUnique({
      where: { mappingId_eventFingerprint: { mappingId: record.id, eventFingerprint } },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.tenant.networkTopologyCalibrationEvidence.create({
        data: {
          orgId: this.tenancy.getOrgIdOrThrow(),
          mappingId: record.id,
          eventFingerprint,
          evidenceFingerprint,
          observedAt,
        },
      });
    }
    const calibrationEvidence = await this.getCalibrationEvidence(record.id);
    const calibration = this.calibrationSummary(calibrationEvidence);
    await this.audit.log({
      action: 'olho-de-deus.topology-mapping.calibration.record',
      entity: 'NetworkTopologyMapping',
      entityId: record.id,
      meta: {
        referenceKind: record.referenceKind,
        alreadyRecorded: Boolean(existing),
        independentEvents: calibration.independentEvents,
        distinctDays: calibration.distinctDays,
        eligibleForHumanConfirmation: calibration.eligibleForHumanConfirmation,
      },
    });
    return {
      ...this.toAdminDto({ ...record, calibrationEvidence }),
      calibration,
    };
  }

  async confirm(id: string, dto: ConfirmNetworkTopologyMappingDto) {
    const record = await this.getById(id);
    if (record.referenceKind === NetworkTopologyMappingKind.IXC_FTTH_BOX) {
      const calibration = this.calibrationSummary(await this.getCalibrationEvidence(record.id));
      if (!calibration.eligibleForHumanConfirmation) {
        throw new BadRequestException(
          `A calibração exige ${calibration.requiredIndependentEvents} ocorrências independentes em ${calibration.requiredDistinctDays} dias distintos antes da confirmação humana`,
        );
      }
    }
    const updated = await this.prisma.tenant.networkTopologyMapping.update({
      where: { id: record.id },
      data: {
        status: 'CONFIRMED',
        evidenceReference: dto.evidenceReference.trim(),
        confirmedAt: new Date(),
        retiredAt: null,
      },
    });
    await this.audit.log({
      action: 'olho-de-deus.topology-mapping.confirm',
      entity: 'NetworkTopologyMapping',
      entityId: updated.id,
      meta: { referenceKind: updated.referenceKind },
    });
    return this.toAdminDto(updated);
  }

  async retire(id: string) {
    const record = await this.getById(id);
    const updated = await this.prisma.tenant.networkTopologyMapping.update({
      where: { id: record.id },
      data: { status: 'RETIRED', retiredAt: new Date() },
    });
    await this.audit.log({
      action: 'olho-de-deus.topology-mapping.retire',
      entity: 'NetworkTopologyMapping',
      entityId: updated.id,
      meta: { referenceKind: updated.referenceKind },
    });
    return this.toAdminDto(updated);
  }

  /** Uso interno futuro após a consulta factual do IXC; não retorna referência. */
  async resolve(
    referenceKind: NetworkTopologyMappingKind,
    reference: string,
  ): Promise<NetworkTopologyResolution> {
    const matches = await this.prisma.tenant.networkTopologyMapping.findMany({
      where: {
        referenceKind,
        referenceFingerprint: this.crypto.fingerprint(this.normalize(reference)),
        status: 'CONFIRMED',
      },
      select: { topologyFingerprint: true, encryptedTopology: true },
    });
    const distinct = new Map(matches.map((match) => [match.topologyFingerprint, match.encryptedTopology]));
    if (distinct.size === 0) return { state: 'UNMAPPED' };
    if (distinct.size > 1) return { state: 'AMBIGUOUS', matches: distinct.size };
    const encrypted = [...distinct.values()][0];
    return { state: 'CONFIRMED', topology: this.decryptTopology(encrypted) };
  }

  private async getById(id: string): Promise<NetworkTopologyMapping> {
    const record = await this.prisma.tenant.networkTopologyMapping.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Mapeamento técnico não encontrado');
    return record;
  }

  private async upsertShadow(dto: CreateNetworkTopologyMappingDto): Promise<NetworkTopologyMapping> {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const reference = this.normalize(dto.reference);
    const topology = this.normalizeTopology(dto);
    return this.prisma.tenant.networkTopologyMapping.upsert({
      where: {
        orgId_referenceKind_referenceFingerprint_topologyFingerprint: {
          orgId,
          referenceKind: dto.referenceKind,
          referenceFingerprint: this.crypto.fingerprint(reference),
          topologyFingerprint: this.crypto.fingerprint(JSON.stringify(topology)),
        },
      },
      create: {
        orgId,
        referenceKind: dto.referenceKind,
        referenceFingerprint: this.crypto.fingerprint(reference),
        encryptedReference: this.crypto.encrypt(reference),
        topologyFingerprint: this.crypto.fingerprint(JSON.stringify(topology)),
        encryptedTopology: this.crypto.encrypt(JSON.stringify(topology)),
      },
      update: { status: 'SHADOW', evidenceReference: null, confirmedAt: null, retiredAt: null },
    });
  }

  private async getCalibrationEvidence(mappingId: string): Promise<Pick<NetworkTopologyCalibrationEvidence, 'observedAt'>[]> {
    return this.prisma.tenant.networkTopologyCalibrationEvidence.findMany({
      where: { mappingId },
      select: { observedAt: true },
    });
  }

  private calibrationSummary(evidence: Pick<NetworkTopologyCalibrationEvidence, 'observedAt'>[]) {
    const distinctDays = new Set(evidence.map((item) => item.observedAt.toISOString().slice(0, 10))).size;
    const independentEvents = evidence.length;
    return {
      independentEvents,
      distinctDays,
      requiredIndependentEvents: NetworkTopologyMappingService.CALIBRATION_MIN_INDEPENDENT_EVENTS,
      requiredDistinctDays: NetworkTopologyMappingService.CALIBRATION_MIN_DISTINCT_DAYS,
      eligibleForHumanConfirmation:
        independentEvents >= NetworkTopologyMappingService.CALIBRATION_MIN_INDEPENDENT_EVENTS &&
        distinctDays >= NetworkTopologyMappingService.CALIBRATION_MIN_DISTINCT_DAYS,
    };
  }

  private normalize(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  }

  private normalizeTopology(dto: CreateNetworkTopologyMappingDto): Topology {
    return {
      olt: this.normalize(dto.olt),
      board: dto.board?.trim() ? this.normalize(dto.board) : null,
      pon: dto.pon?.trim() ? this.normalize(dto.pon) : null,
    };
  }

  private decryptTopology(value: string): Topology {
    return JSON.parse(this.crypto.decrypt(value)) as Topology;
  }

  private toAdminDto(
    record: NetworkTopologyMapping & { calibrationEvidence?: Pick<NetworkTopologyCalibrationEvidence, 'observedAt'>[] },
  ) {
    const calibration = record.calibrationEvidence ? this.calibrationSummary(record.calibrationEvidence) : undefined;
    return {
      id: record.id,
      referenceKind: record.referenceKind,
      status: record.status,
      evidenceReference: record.evidenceReference,
      confirmedAt: record.confirmedAt?.toISOString() ?? null,
      retiredAt: record.retiredAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      ...(calibration ? { calibration } : {}),
    };
  }
}
