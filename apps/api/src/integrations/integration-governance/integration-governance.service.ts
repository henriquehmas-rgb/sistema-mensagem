import { Injectable } from '@nestjs/common';

/** Contrato comum para integrações factuais; nunca decide a conversa. */
export type GovernedIntegration = 'IXC' | 'OLHO_DE_DEUS';
export type IntegrationOutcomeStatus = 'CONFIRMED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'AMBIGUOUS';

export interface IntegrationProfile {
  integration: GovernedIntegration;
  systemOfRecord: 'IXC' | null;
  role: 'CUSTOMER_FACT_SOURCE' | 'NETWORK_EVIDENCE_SOURCE';
  readOnly: boolean;
  externalWriteEnabled: false;
  requiresIdentityForProtectedData: boolean;
  humanApprovalRequiredForWrites: true;
}

export interface GovernedReadOutcome {
  integration: GovernedIntegration;
  status: IntegrationOutcomeStatus;
  learningDisposition: 'NO_LEARNING_TECHNICAL_INCIDENT' | 'NO_LEARNING_AMBIGUOUS_EVIDENCE' | 'ELIGIBLE_FOR_REVIEW';
  retryable: boolean;
  safeForAutomaticReply: boolean;
  reason: string;
}

export interface NormalizeReadOutcomeInput {
  integration: GovernedIntegration;
  available: boolean;
  found?: boolean;
  sufficientEvidence?: boolean;
  safeForAutomaticReply?: boolean;
  reason: string;
}

const PROFILES: Record<GovernedIntegration, IntegrationProfile> = {
  IXC: {
    integration: 'IXC', systemOfRecord: 'IXC', role: 'CUSTOMER_FACT_SOURCE',
    readOnly: false, externalWriteEnabled: false, requiresIdentityForProtectedData: true,
    humanApprovalRequiredForWrites: true,
  },
  OLHO_DE_DEUS: {
    integration: 'OLHO_DE_DEUS', systemOfRecord: 'IXC', role: 'NETWORK_EVIDENCE_SOURCE',
    readOnly: true, externalWriteEnabled: false, requiresIdentityForProtectedData: false,
    humanApprovalRequiredForWrites: true,
  },
};

@Injectable()
export class IntegrationGovernanceService {
  profile(integration: GovernedIntegration): IntegrationProfile {
    return { ...PROFILES[integration] };
  }

  /** Retornos técnicos não podem ser classificados como lacuna de conhecimento. */
  normalizeReadOutcome(input: NormalizeReadOutcomeInput): GovernedReadOutcome {
    if (!input.available) return {
      integration: input.integration, status: 'UNAVAILABLE', retryable: true,
      safeForAutomaticReply: false, learningDisposition: 'NO_LEARNING_TECHNICAL_INCIDENT', reason: input.reason,
    };
    if (input.found === false) return {
      integration: input.integration, status: 'NOT_FOUND', retryable: false,
      safeForAutomaticReply: false, learningDisposition: 'ELIGIBLE_FOR_REVIEW', reason: input.reason,
    };
    if (input.sufficientEvidence === false) return {
      integration: input.integration, status: 'AMBIGUOUS', retryable: false,
      safeForAutomaticReply: false, learningDisposition: 'NO_LEARNING_AMBIGUOUS_EVIDENCE', reason: input.reason,
    };
    return {
      integration: input.integration, status: 'CONFIRMED', retryable: false,
      safeForAutomaticReply: Boolean(input.safeForAutomaticReply), learningDisposition: 'ELIGIBLE_FOR_REVIEW', reason: input.reason,
    };
  }
}
