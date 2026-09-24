export const OMNI_OPERATIONAL_POLICY = {
  id: 'seeg-omni-operational-policy',
  version: '1.2.0',
  status: 'CONTROLLED_PILOT',
  effectiveMode: 'SHADOW',
  externalWriteEnabled: false,
  // Canais externos têm uma trava independente da escrita IXC: possuir uma
  // credencial cadastrada não pode, por si só, habilitar envio real.
  externalChannelDeliveryEnabled: true,
  externalChannelDeliveryAllowedExternalIds: ['896286296892823'] as readonly string[],
  conversationInactivity: {
    // O canal legado encerrava o atendimento após 30 minutos, mas o Omni ainda
    // não tinha um ciclo próprio. Escopo mínimo: somente o número-piloto e
    // somente conversas conduzidas pela IA, sem atendente atribuído.
    enabled: true,
    inactivityMinutes: 30,
    allowedChannelExternalIds: ['896286296892823'] as readonly string[],
  },
  firstRealTestMode: 'REVIEW_REQUIRED',
  scope: {
    pilotDepartmentRoutingKey: 'technical_support',
    allowedActions: ['request_ticket', 'request_service_order'],
    serviceOrderRequiredDiagnosis: 'INDIVIDUAL_FAILURE',
  },
  ownership: {
    decisionOwner: 'OMNI',
    triggerOwner: 'OMNI',
    administrativeSource: 'IXC_DIRECT',
    networkEvidenceSource: 'OLHO_DE_DEUS_OLT',
    operationalExecutor: 'IXC_DIRECT',
    systemOfRecord: 'IXC',
    olhoDeDeusAccess: 'READ_ONLY',
    aiDirectWriteAllowed: false,
  },
  safety: {
    identityVerificationRequired: true,
    minimumConfidenceFloor: 0.85,
    humanReviewRequired: true,
    blockOnInconclusiveNetworkEvidence: true,
    blockIndividualActionDuringCollectiveOutage: true,
  },
  networkEvidence: {
    // Mantemos a correlação cliente/telemetria mais restrita que a janela da API.
    maxCorrelationObservationAgeMs: 2 * 60 * 1_000,
    futureClockToleranceMs: 30 * 1_000,
    olhoOltStaleAfterSeconds: 600,
    ruptureWindowMinutes: 15,
    ruptureWindowUnitConfirmationPending: true,
    minimumCollectiveAffectedOnus: 3,
    minimumCollectiveAffectedRatio: 0.2,
  },
  duplicatePrevention: {
    strategy: 'OCCURRENCE_AWARE',
    similarityFields: ['customer', 'contract_or_source_ticket', 'subject', 'open_status'],
    confirmedIdentityFields: ['omni_idempotency_key', 'same_source_ticket'],
    explicitOccurrenceIdentityRequiredBeforeRealExecution: true,
    similarRecordOutcome: 'REVIEW_REQUIRED',
    conservativeWhenSubjectOrLinkIsMissing: true,
    openRecordsDoNotExpireByAge: true,
    idempotencyAlgorithm: 'SHA256',
  },
  retry: {
    invalidCredentialStatusCodes: [401],
    retryableStatusCodes: [429, 503],
    timeoutOutcome: 'UNCERTAIN',
    lookupBeforeRetry: true,
  },
  pendingIntegrations: [
    'IXC_CUSTOMER_CONTRACT_TO_OLT_PON_MAPPING',
    'IXC_TICKET_CREATE_CONTRACT',
    'IXC_SERVICE_ORDER_CREATE_CONTRACT',
    'SECURE_OLHO_DE_DEUS_TRANSPORT',
    'CONFIRM_OLHO_RUPTURE_WINDOW_UNIT',
  ],
} as const;

export type OmniOperationalPolicy = typeof OMNI_OPERATIONAL_POLICY;
