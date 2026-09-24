import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { IntegrationGovernanceService, type GovernedReadOutcome } from '../integration-governance/integration-governance.service';
import { IxcService } from './ixc.service';

/**
 * A Auto Viabilidade V3 do InMap utiliza 200 m quando a instância não definiu
 * um raio próprio. Não ampliamos esse alcance por conta própria: um candidato
 * fora do raio oficial não é evidência de cobertura.
 */
const DEFAULT_AUTOVIABILITY_RADIUS_METERS = 200;
const MAX_RETURNED_CANDIDATES = 5;

export type IxcInmapCoverageStatus =
  | 'CANDIDATES_FOUND'
  | 'NO_ACTIVE_BOXES'
  | 'NO_CANDIDATES_NEARBY'
  | 'INVENTORY_LIMIT_REACHED'
  | 'UNAVAILABLE';

/**
 * Evidência de proximidade, deliberadamente insuficiente para confirmar
 * cobertura. A confirmação continua pertencendo ao fluxo de Auto Viabilidade
 * do InMap, que considera as regras comerciais/técnicas da operação.
 */
export interface IxcInmapCoverageEvidence {
  source: 'IXC_INMAP_FTTH_BOX';
  status: IxcInmapCoverageStatus;
  observedAt: string;
  activeBoxesInCity: number;
  /** A primeira página atingiu o limite; ausência de candidato não é conclusão. */
  inventoryComplete: boolean;
  nearbyCandidateCount: number;
  nearestCandidateDistanceMeters: number | null;
  mcpOutcome: GovernedReadOutcome;
}

export interface IxcInmapViabilityConfigurationEvidence {
  source: 'IXC_INMAP_CONFIGURATION';
  status:
    | 'CONFIGURATION_SIGNALS_PRESENT'
    | 'MISSING_REQUIRED_CONFIGURATION'
    | 'PARTIAL_CONFIGURATION'
    | 'PARTIAL_UNAVAILABLE'
    | 'UNAVAILABLE';
  observedAt: string;
  /** Só permite interpretar ausência de configuração quando as três leituras terminaram. */
  configurationInventoryComplete: boolean;
  availableSourceCount: number;
  unavailableSources: Array<{
    source: 'PROJECTS' | 'REGION_TYPES' | 'NEGOTIATION_PLANS';
    reason: 'ACCESS_DENIED' | 'ENDPOINT_UNSUPPORTED' | 'INVALID_QUERY' | 'TEMPORARY_UNAVAILABLE' | 'INVALID_RESPONSE' | 'IXC_REJECTED' | 'UNKNOWN';
  }>;
  activeProjectCount: number;
  viableFiberRegionTypeCount: number;
  activeNegotiationPlanCount: number;
  negotiationPlansWithSourcePlan: number;
  negotiationPlansWithInstallationSubject: number;
  mcpOutcome: GovernedReadOutcome;
}

@Injectable()
export class IxcInmapCoverageService {
  constructor(
    private readonly ixc: IxcService,
    private readonly governance: IntegrationGovernanceService,
    private readonly audit: AuditService,
  ) {}

  async collect(input: {
    cityId: string;
    latitude: number;
    longitude: number;
  }): Promise<IxcInmapCoverageEvidence> {
    if (!/^\d{1,20}$/.test(input.cityId)) {
      throw new BadRequestException('cityId inválido para evidência InMap');
    }
    if (!this.validCoordinates(input.latitude, input.longitude)) {
      throw new BadRequestException('Coordenadas inválidas para evidência InMap');
    }

    const observedAt = new Date().toISOString();
    try {
      const inventory = await this.ixc.readFtthBoxInventoryByCity(input.cityId);
      const boxes = inventory.items;
      const activeBoxes = boxes.filter((box) => box.active === true);
      const inventoryComplete = inventory.complete;
      const distances = activeBoxes
        .flatMap((box) => {
          if (box.latitude === null || box.longitude === null) return [];
          return [this.distanceMeters(input.latitude, input.longitude, box.latitude, box.longitude)];
        })
        .filter((distance) => distance <= DEFAULT_AUTOVIABILITY_RADIUS_METERS)
        .sort((left, right) => left - right)
        .slice(0, MAX_RETURNED_CANDIDATES);

      const status: IxcInmapCoverageStatus = distances.length > 0
        ? 'CANDIDATES_FOUND'
        : !inventoryComplete
          ? 'INVENTORY_LIMIT_REACHED'
          : activeBoxes.length === 0
            ? 'NO_ACTIVE_BOXES'
            : 'NO_CANDIDATES_NEARBY';
      const evidence: IxcInmapCoverageEvidence = {
        source: 'IXC_INMAP_FTTH_BOX',
        status,
        observedAt,
        activeBoxesInCity: activeBoxes.length,
        inventoryComplete,
        nearbyCandidateCount: distances.length,
        nearestCandidateDistanceMeters: distances[0] === undefined ? null : Math.round(distances[0]),
        // Mesmo com caixas próximas a evidência é somente de proximidade. Ela
        // não revela porta, projeto, endereço de caixa ou topologia e não
        // permite à IA prometer cobertura.
        mcpOutcome: this.governance.normalizeReadOutcome({
          integration: 'IXC',
          available: true,
          // Nem ausência de caixa ativa na amostra representa "sem
          // viabilidade": faltam região, porta e regras do Auto Viabilidade.
          // Logo todo retorno saudável desta fonte permanece inconclusivo.
          found: true,
          sufficientEvidence: false,
          safeForAutomaticReply: false,
          reason: `ixc_inmap_ftth_boxes_${status.toLowerCase()}`,
        }),
      };
      await this.audit.log({
        action: 'integration.ixc.inmap.coverage-evidence.read',
        entity: 'IxcIntegration',
        entityId: 'inmap-ftth-boxes',
        // Não registrar cidade nem coordenadas: são informações de instalação.
        meta: {
          status,
          activeBoxesInCity: evidence.activeBoxesInCity,
          inventoryComplete: evidence.inventoryComplete,
          nearbyCandidateCount: evidence.nearbyCandidateCount,
          mcpStatus: evidence.mcpOutcome.status,
          learningDisposition: evidence.mcpOutcome.learningDisposition,
        },
      });
      return evidence;
    } catch (error) {
      const evidence: IxcInmapCoverageEvidence = {
        source: 'IXC_INMAP_FTTH_BOX',
        status: 'UNAVAILABLE',
        observedAt,
        activeBoxesInCity: 0,
        inventoryComplete: false,
        nearbyCandidateCount: 0,
        nearestCandidateDistanceMeters: null,
        mcpOutcome: this.governance.normalizeReadOutcome({
          integration: 'IXC',
          available: false,
          safeForAutomaticReply: false,
          reason: 'ixc_inmap_ftth_boxes_unavailable',
        }),
      };
      await this.audit.log({
        action: 'integration.ixc.inmap.coverage-evidence.unavailable',
        entity: 'IxcIntegration',
        entityId: 'inmap-ftth-boxes',
        meta: {
          error: error instanceof Error ? error.name : 'unknown',
          learningDisposition: evidence.mcpOutcome.learningDisposition,
        },
      });
      return evidence;
    }
  }

  /**
   * Verifica se as tabelas que sustentam a Auto Viabilidade estão disponíveis
   * e minimamente configuradas. É uma auditoria de prontidão: a documentação
   * não expõe por API a geometria da região nem o vínculo região/caixa-plano,
   * logo o resultado nunca confirma cobertura para um endereço.
   */
  async inspectOfficialConfiguration(): Promise<IxcInmapViabilityConfigurationEvidence> {
    const observedAt = new Date().toISOString();
    const reads = await Promise.allSettled([
      this.ixc.readInmapProjectsInventory(),
      this.ixc.readCoverageRegionTypesInventory(),
      this.ixc.readNegotiationPlansInventory(),
    ]);
    const sourceNames = ['PROJECTS', 'REGION_TYPES', 'NEGOTIATION_PLANS'] as const;
    const unavailableSources = reads.flatMap((read, index) => read.status === 'rejected'
      ? [{ source: sourceNames[index]!, reason: this.failureReason(read.reason) }]
      : []);
    const availableSourceCount = reads.filter((read) => read.status === 'fulfilled').length;
    if (availableSourceCount === 0) {
      return this.unavailableConfiguration(observedAt, 'UNAVAILABLE', availableSourceCount, unavailableSources);
    }

    const projects = reads[0].status === 'fulfilled' ? reads[0].value : null;
    const regionTypes = reads[1].status === 'fulfilled' ? reads[1].value : null;
    const negotiationPlans = reads[2].status === 'fulfilled' ? reads[2].value : null;
    const configurationInventoryComplete = availableSourceCount === reads.length
      && [projects, regionTypes, negotiationPlans].every((inventory) => inventory?.complete === true);

    try {
      const projectItems = projects?.items ?? [];
      const regionTypeItems = regionTypes?.items ?? [];
      const negotiationPlanItems = negotiationPlans?.items ?? [];
      const activeProjectCount = projectItems.filter((project) => project.active === true).length;
      const viableFiberRegionTypeCount = regionTypeItems.filter(
        (region) => region.active === true && region.viabilityEnabled === true && region.fiberEnabled === true,
      ).length;
      const activePlans = negotiationPlanItems.filter((plan) => plan.active === true);
      const negotiationPlansWithSourcePlan = activePlans.filter((plan) => plan.hasSourcePlan).length;
      const negotiationPlansWithInstallationSubject = activePlans.filter((plan) => plan.hasInstallationSubject).length;
      const status = availableSourceCount !== reads.length
        ? 'PARTIAL_UNAVAILABLE' as const
        : !configurationInventoryComplete
          ? 'PARTIAL_CONFIGURATION' as const
          : activeProjectCount > 0 && negotiationPlansWithSourcePlan > 0
            ? 'CONFIGURATION_SIGNALS_PRESENT' as const
            : 'MISSING_REQUIRED_CONFIGURATION' as const;
      const evidence: IxcInmapViabilityConfigurationEvidence = {
        source: 'IXC_INMAP_CONFIGURATION',
        status,
        observedAt,
        configurationInventoryComplete,
        availableSourceCount,
        unavailableSources,
        activeProjectCount,
        viableFiberRegionTypeCount,
        activeNegotiationPlanCount: activePlans.length,
        negotiationPlansWithSourcePlan,
        negotiationPlansWithInstallationSubject,
        mcpOutcome: this.governance.normalizeReadOutcome({
          integration: 'IXC', available: status !== 'PARTIAL_UNAVAILABLE', found: true, sufficientEvidence: false,
          safeForAutomaticReply: false,
          reason: `ixc_inmap_official_configuration_${status.toLowerCase()}`,
        }),
      };
      await this.audit.log({
        action: 'integration.ixc.inmap.configuration.read',
        entity: 'IxcIntegration', entityId: 'inmap-configuration',
        meta: {
          status: evidence.status,
          activeProjectCount,
          viableFiberRegionTypeCount,
          activeNegotiationPlanCount: evidence.activeNegotiationPlanCount,
          negotiationPlansWithSourcePlan,
          negotiationPlansWithInstallationSubject,
          unavailableSources,
          learningDisposition: evidence.mcpOutcome.learningDisposition,
        },
      });
      return evidence;
    } catch (error) {
      return this.unavailableConfiguration(observedAt, 'UNAVAILABLE', availableSourceCount, unavailableSources, error);
    }
  }

  private async unavailableConfiguration(
    observedAt: string,
    status: 'UNAVAILABLE' | 'PARTIAL_UNAVAILABLE',
    availableSourceCount: number,
    unavailableSources: IxcInmapViabilityConfigurationEvidence['unavailableSources'],
    error?: unknown,
  ): Promise<IxcInmapViabilityConfigurationEvidence> {
    const evidence: IxcInmapViabilityConfigurationEvidence = {
      source: 'IXC_INMAP_CONFIGURATION', status, observedAt,
      configurationInventoryComplete: false, availableSourceCount, unavailableSources,
      activeProjectCount: 0, viableFiberRegionTypeCount: 0, activeNegotiationPlanCount: 0,
      negotiationPlansWithSourcePlan: 0, negotiationPlansWithInstallationSubject: 0,
      mcpOutcome: this.governance.normalizeReadOutcome({
        integration: 'IXC', available: false, safeForAutomaticReply: false,
        reason: 'ixc_inmap_official_configuration_unavailable',
      }),
    };
    await this.audit.log({
      action: 'integration.ixc.inmap.configuration.unavailable',
      entity: 'IxcIntegration', entityId: 'inmap-configuration',
        meta: { status, availableSourceCount, unavailableSources, error: error instanceof Error ? error.name : 'unknown', learningDisposition: evidence.mcpOutcome.learningDisposition },
    });
    return evidence;
  }

  private failureReason(error: unknown): IxcInmapViabilityConfigurationEvidence['unavailableSources'][number]['reason'] {
    const reason = error && typeof error === 'object' && 'ixcFailureCode' in error
      ? (error as { ixcFailureCode?: unknown }).ixcFailureCode
      : undefined;
    return reason === 'ACCESS_DENIED' || reason === 'ENDPOINT_UNSUPPORTED' || reason === 'INVALID_QUERY'
      || reason === 'TEMPORARY_UNAVAILABLE' || reason === 'INVALID_RESPONSE' || reason === 'IXC_REJECTED'
      ? reason
      : 'UNKNOWN';
  }

  private validCoordinates(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90
      && latitude <= 90
      && longitude >= -180
      && longitude <= 180;
  }

  private distanceMeters(
    sourceLatitude: number,
    sourceLongitude: number,
    targetLatitude: number,
    targetLongitude: number,
  ): number {
    const toRadians = (value: number) => value * Math.PI / 180;
    const latitudeDelta = toRadians(targetLatitude - sourceLatitude);
    const longitudeDelta = toRadians(targetLongitude - sourceLongitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(toRadians(sourceLatitude))
      * Math.cos(toRadians(targetLatitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
