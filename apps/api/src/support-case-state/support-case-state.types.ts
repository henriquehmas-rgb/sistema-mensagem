export type LightState = 'UNKNOWN' | 'RED' | 'OFF' | 'BLINKING' | 'ON';
export type CurrentSymptom = 'UNKNOWN' | 'OUTAGE' | 'SLOWNESS' | 'INSTABILITY';
export type SupportNextStep =
  | 'ASK_LOS_DURATION'
  | 'ASK_INTERNET_LIGHT'
  | 'ASK_LIGHT_STATE'
  | 'PROVIDE_STABILIZATION_GUIDANCE'
  | 'REQUEST_ACCOUNT_IDENTITY'
  | 'CONTINUE_SAFE_DIAGNOSIS';

/**
 * Snapshot deliberadamente mínimo e sem PII. Ele é memória operacional de
 * curta duração do caso; o histórico textual e as fontes IXC/ODG mantêm suas
 * responsabilidades próprias.
 */
export interface SupportCaseState {
  schemaVersion: 1;
  route: 'technical_support' | 'other';
  currentSymptom: CurrentSymptom;
  affectedMultipleDevices: boolean;
  equipmentRestarted: boolean;
  wiredTestUnavailable: boolean;
  losLight: LightState;
  internetLight: LightState;
  /**
   * Evita repetir uma orientação de estabilização que já foi dada no mesmo
   * atendimento, mesmo quando as mensagens antigas saem da janela da IA.
   */
  stabilizationGuidanceDelivered: boolean;
  identity: { verified: boolean; requiredNow: boolean };
  nextStep: SupportNextStep;
}

/** Estado mínimo da qualificação comercial. Não contém cidade, bairro ou endereço. */
export type SalesCustomerProfile = 'UNKNOWN' | 'RESIDENTIAL' | 'BUSINESS';
export type SalesPrimaryUsage = 'UNKNOWN' | 'STREAMING' | 'GAMES' | 'REMOTE_WORK' | 'OTHER';
/** Resultado factual resumido, sem endereço ou resposta bruta do IXC. */
export type SalesCoverageCheckStatus =
  | 'NOT_CHECKED'
  | 'CONFIRMED'
  | 'NOT_AVAILABLE'
  | 'INCONCLUSIVE'
  | 'REVIEW_REQUIRED';
export type SalesNextStep =
  | 'ASK_CUSTOMER_PROFILE'
  | 'ASK_PRIMARY_USAGE'
  | 'ASK_CITY_NEIGHBORHOOD'
  | 'ASK_ADDRESS'
  | 'REQUEST_COVERAGE_EVIDENCE'
  | 'CONTINUE_SAFE_QUALIFICATION';

export interface SalesCaseState {
  schemaVersion: 1;
  route: 'sales';
  customerProfile: SalesCustomerProfile;
  primaryUsage: SalesPrimaryUsage;
  cityNeighborhoodProvided: boolean;
  addressProvided: boolean;
  /**
   * Marca somente que a limitação factual já foi explicada. A cidade, o bairro
   * e o endereço nunca entram neste snapshot operacional.
   */
  coverageEvidenceRequested: boolean;
  /** Persiste a decisão factual sem carregar PII para a memória do caso. */
  coverageCheckStatus: SalesCoverageCheckStatus;
  nextStep: SalesNextStep;
}

/** Estado mínimo de Financeiro. A identidade continua sendo controlada fora dele. */
export type BillingRequestKind =
  | 'UNKNOWN'
  | 'INVOICE_COPY'
  | 'PAYMENT_STATUS'
  | 'CANCELLATION_EFFECTS'
  | 'GENERAL_POLICY';
export type BillingNextStep =
  | 'REQUEST_ACCOUNT_IDENTITY'
  | 'PROVIDE_APPROVED_GENERAL_GUIDANCE'
  | 'CONTINUE_SAFE_FINANCIAL_GUIDANCE';

export interface BillingCaseState {
  schemaVersion: 1;
  route: 'billing';
  requestKind: BillingRequestKind;
  identity: { verified: boolean; requiredNow: boolean };
  nextStep: BillingNextStep;
}

export interface OtherCaseState {
  schemaVersion: 1;
  route: 'other';
  nextStep: 'CONTINUE_SAFE_CONVERSATION';
}

export type OperationalCaseState = SupportCaseState | SalesCaseState | BillingCaseState | OtherCaseState;

export interface CaseStateMessage {
  role: 'user' | 'assistant';
  content: string;
}
