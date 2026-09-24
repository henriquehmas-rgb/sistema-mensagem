import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { deriveOperationalCaseState } from './support-case-state.policy';
import type {
  BillingNextStep,
  BillingRequestKind,
  CaseStateMessage,
  CurrentSymptom,
  LightState,
  OperationalCaseState,
  SalesCoverageCheckStatus,
  SalesCustomerProfile,
  SalesNextStep,
  SalesPrimaryUsage,
  SupportCaseState,
  SupportNextStep,
} from './support-case-state.types';

const lightStates: readonly LightState[] = ['UNKNOWN', 'RED', 'OFF', 'BLINKING', 'ON'];
const symptoms: readonly CurrentSymptom[] = ['UNKNOWN', 'OUTAGE', 'SLOWNESS', 'INSTABILITY'];
const nextSteps: readonly SupportNextStep[] = [
  'ASK_LOS_DURATION',
  'ASK_INTERNET_LIGHT',
  'ASK_LIGHT_STATE',
  'PROVIDE_STABILIZATION_GUIDANCE',
  'REQUEST_ACCOUNT_IDENTITY',
  'CONTINUE_SAFE_DIAGNOSIS',
];
const salesProfiles: readonly SalesCustomerProfile[] = ['UNKNOWN', 'RESIDENTIAL', 'BUSINESS'];
const salesUsages: readonly SalesPrimaryUsage[] = ['UNKNOWN', 'STREAMING', 'GAMES', 'REMOTE_WORK', 'OTHER'];
const salesCoverageStatuses: readonly SalesCoverageCheckStatus[] = [
  'NOT_CHECKED', 'CONFIRMED', 'NOT_AVAILABLE', 'INCONCLUSIVE', 'REVIEW_REQUIRED',
];
const salesNextSteps: readonly SalesNextStep[] = [
  'ASK_CUSTOMER_PROFILE', 'ASK_PRIMARY_USAGE', 'ASK_CITY_NEIGHBORHOOD', 'ASK_ADDRESS',
  'REQUEST_COVERAGE_EVIDENCE', 'CONTINUE_SAFE_QUALIFICATION',
];
const billingRequestKinds: readonly BillingRequestKind[] = [
  'UNKNOWN', 'INVOICE_COPY', 'PAYMENT_STATUS', 'CANCELLATION_EFFECTS', 'GENERAL_POLICY',
];
const billingNextSteps: readonly BillingNextStep[] = [
  'REQUEST_ACCOUNT_IDENTITY', 'PROVIDE_APPROVED_GENERAL_GUIDANCE', 'CONTINUE_SAFE_FINANCIAL_GUIDANCE',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

@Injectable()
export class SupportCaseStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async refresh(input: {
    orgId: string;
    conversationId: string;
    messages: CaseStateMessage[];
    route: string | null;
    identityVerified: boolean;
    identityRequiredNow: boolean;
  }): Promise<OperationalCaseState> {
    const existing = await this.prisma.prismaSystem.conversationOperationalState.findFirst({
      where: { orgId: input.orgId, conversationId: input.conversationId },
      select: { id: true, version: true, state: true },
    });
    const previousState = this.readOperationalState(existing?.state ?? null);
    const state = deriveOperationalCaseState({ ...input, previousState });
    const changed = JSON.stringify(existing?.state ?? null) !== JSON.stringify(state);
    await this.prisma.prismaSystem.conversationOperationalState.upsert({
      where: { conversationId: input.conversationId },
      create: {
        orgId: input.orgId,
        conversationId: input.conversationId,
        state: state as unknown as Prisma.InputJsonValue,
      },
      update: changed
        ? { state: state as unknown as Prisma.InputJsonValue, version: { increment: 1 } }
        : {},
    });
    if (changed) {
      await this.audit.logSystem(input.orgId, {
        action: 'conversation.case-state.refresh',
        entity: 'ConversationOperationalState',
        entityId: input.conversationId,
        meta: {
          route: state.route,
          nextStep: state.nextStep,
          stateCarriedForward: previousState?.route === state.route,
        },
      });
    }
    return state;
  }

  /**
   * A consulta oficial é feita fora do modelo. Persistimos somente seu estado
   * normalizado para que uma retomada de conversa não repita a pergunta nem
   * trate indisponibilidade de integração como lacuna de conhecimento.
   */
  async recordSalesCoverageOutcome(input: {
    orgId: string;
    conversationId: string;
    status: Exclude<SalesCoverageCheckStatus, 'NOT_CHECKED'>;
  }): Promise<void> {
    const existing = await this.prisma.prismaSystem.conversationOperationalState.findFirst({
      where: { orgId: input.orgId, conversationId: input.conversationId },
      select: { id: true, version: true, state: true },
    });
    const state = this.readOperationalState(existing?.state ?? null);
    if (!state || state.route !== 'sales' || state.coverageCheckStatus === input.status) return;
    const next = { ...state, coverageCheckStatus: input.status };
    await this.prisma.prismaSystem.conversationOperationalState.upsert({
      where: { conversationId: input.conversationId },
      create: {
        orgId: input.orgId,
        conversationId: input.conversationId,
        state: next as unknown as Prisma.InputJsonValue,
      },
      update: { state: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    await this.audit.logSystem(input.orgId, {
      action: 'conversation.sales-coverage-outcome.record',
      entity: 'ConversationOperationalState',
      entityId: input.conversationId,
      meta: { status: input.status },
    });
  }

  /**
   * Aceita somente um snapshot técnico íntegro. Estados antigos sem a nova
   * flag continuam compatíveis e assumem que a orientação ainda não ocorreu.
   */
  private readOperationalState(value: Prisma.JsonValue | null): OperationalCaseState | null {
    if (!isRecord(value) || value.schemaVersion !== 1 || value.route !== 'technical_support') {
      return this.readSalesOrBillingState(value);
    }
    const identity = value.identity;
    if (
      !isOneOf(value.currentSymptom, symptoms)
      || !isOneOf(value.losLight, lightStates)
      || !isOneOf(value.internetLight, lightStates)
      || !isOneOf(value.nextStep, nextSteps)
      || !isRecord(identity)
      || typeof identity.verified !== 'boolean'
      || typeof identity.requiredNow !== 'boolean'
      || typeof value.affectedMultipleDevices !== 'boolean'
      || typeof value.equipmentRestarted !== 'boolean'
      || typeof value.wiredTestUnavailable !== 'boolean'
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      route: 'technical_support',
      currentSymptom: value.currentSymptom,
      affectedMultipleDevices: value.affectedMultipleDevices,
      equipmentRestarted: value.equipmentRestarted,
      wiredTestUnavailable: value.wiredTestUnavailable,
      losLight: value.losLight,
      internetLight: value.internetLight,
      stabilizationGuidanceDelivered: value.stabilizationGuidanceDelivered === true,
      identity: { verified: identity.verified, requiredNow: identity.requiredNow },
      nextStep: value.nextStep,
    };
  }

  private readSalesOrBillingState(value: Prisma.JsonValue | null): OperationalCaseState | null {
    if (!isRecord(value) || value.schemaVersion !== 1) return null;
    if (
      value.route === 'sales'
      && isOneOf(value.customerProfile, salesProfiles)
      && isOneOf(value.primaryUsage, salesUsages)
      && isOneOf(value.nextStep, salesNextSteps)
      && typeof value.cityNeighborhoodProvided === 'boolean'
      && typeof value.addressProvided === 'boolean'
    ) {
      return {
        schemaVersion: 1,
        route: 'sales',
        customerProfile: value.customerProfile,
        primaryUsage: value.primaryUsage,
        cityNeighborhoodProvided: value.cityNeighborhoodProvided,
        addressProvided: value.addressProvided,
        // Estados anteriores a esse marco permanecem válidos e seguem para a
        // confirmação factual uma única vez.
        coverageEvidenceRequested: value.coverageEvidenceRequested === true,
        coverageCheckStatus: isOneOf(value.coverageCheckStatus, salesCoverageStatuses)
          ? value.coverageCheckStatus
          : 'NOT_CHECKED',
        nextStep: value.nextStep,
      };
    }
    const identity = value.identity;
    if (
      value.route === 'billing'
      && isOneOf(value.requestKind, billingRequestKinds)
      && isOneOf(value.nextStep, billingNextSteps)
      && isRecord(identity)
      && typeof identity.verified === 'boolean'
      && typeof identity.requiredNow === 'boolean'
    ) {
      return {
        schemaVersion: 1,
        route: 'billing',
        requestKind: value.requestKind,
        identity: { verified: identity.verified, requiredNow: identity.requiredNow },
        nextStep: value.nextStep,
      };
    }
    if (value.route === 'other' && value.nextStep === 'CONTINUE_SAFE_CONVERSATION') {
      return { schemaVersion: 1, route: 'other', nextStep: 'CONTINUE_SAFE_CONVERSATION' };
    }
    return null;
  }
}
