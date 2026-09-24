export type SourceState = 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';
export type OnuState = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
export type NetworkEventState = 'NONE' | 'SUSPECTED' | 'CONFIRMED' | 'RECOVERED';

export interface NetworkObservation {
  customerReference: string;
  networkEventId?: string | null;
  olt: string | null;
  pon: string | null;
  cto: string | null;
  route: string | null;
  onuState: OnuState;
  opticalSignalDbm: number | null;
  affectedOnus: number | null;
  totalOnus: number | null;
  ixcAlert: boolean | null;
  eventState: NetworkEventState;
  oltSourceState: SourceState;
  ixcSourceState: SourceState;
  observedAt: string;
}

export type NetworkDiagnosis =
  | 'NORMAL'
  | 'INDIVIDUAL_FAILURE'
  | 'COLLECTIVE_OUTAGE_SUSPECTED'
  | 'COLLECTIVE_OUTAGE_CONFIRMED'
  | 'IXC_FALSE_POSITIVE_SUSPECTED'
  | 'RECOVERED'
  | 'INCONCLUSIVE';

export interface CorrelatedNetworkContext {
  networkEventId: string | null;
  diagnosis: NetworkDiagnosis;
  confidence: number;
  customerReference: string;
  topology: { olt: string | null; pon: string | null; cto: string | null; route: string | null };
  technical: {
    onuState: OnuState;
    opticalSignalDbm: number | null;
    affectedOnus: number | null;
    totalOnus: number | null;
  };
  eventState: NetworkEventState;
  evidence: Array<'OLT' | 'IXC' | 'OLHO_DE_DEUS'>;
  observedAt: string;
  safeForAutomaticReply: boolean;
  reason: string;
}

export const OLHO_DE_DEUS_CONNECTOR = Symbol('OLHO_DE_DEUS_CONNECTOR');

export interface OlhoDeDeusConnector {
  isConfigured(): boolean;
  getCustomerNetworkContext(customerReference: string): Promise<NetworkObservation>;
}

export type DirectIxcEvidenceState =
  | 'success'
  | 'empty'
  | 'unavailable'
  | 'customer_not_found'
  | 'customer_ambiguous';

export interface OmniNetworkResolution {
  status: 'RESOLVED' | 'INCONCLUSIVE' | 'NOT_CONFIGURED';
  /** NOT_CONFIGURED não bloqueia o fluxo atual até a API real ser habilitada. */
  blocksSensitiveAutomation: boolean;
  authorities: {
    decisionOwner: 'OMNI';
    triggerOwner: 'OMNI';
    administrative: 'IXC_DIRECT';
    network: 'OLHO_DE_DEUS_OLT';
    operationalExecutor: 'IXC_DIRECT';
    systemOfRecord: 'IXC';
    olhoDeDeusAccess: 'READ_ONLY';
    aiDirectWriteAllowed: false;
  };
  context: CorrelatedNetworkContext | null;
  reason: string;
}
