import type { GovernedReadOutcome } from '../integration-governance/integration-governance.service';

export interface IxcCredentials {
  username: string;
  token: string;
}

export interface IxcCustomerDto {
  id: string;
  name: string;
  tradeName: string | null;
  cpfCnpj: string | null;
  active: boolean | null;
  phone: string | null;
  mobilePhone: string | null;
  whatsapp: string | null;
  email: string | null;
  cityId: string | null;
}

export type IxcEndpoint =
  | 'cliente'
  | 'cliente_contrato'
  | 'fn_areceber'
  | 'su_oss_chamado'
  /** Vínculo explícito entre login afetado, OS e região de manutenção. */
  | 'su_oss_chamado_regiao_manutencao_radusuarios'
  | 'radusuarios'
  /** ONU/cliente FTTH vinculada ao contrato; leitura técnica sem credenciais. */
  | 'radpop_radio_cliente_fibra'
  | 'su_ticket'
  | 'su_oss_assunto'
  | 'vd_contratos'
  | 'radgrupos'
  /** Inventário InMap de caixas FTTH. Leitura técnica; não confirma cobertura. */
  | 'rad_caixa_ftth'
  /** Recursos oficiais InMap/CRM usados apenas para auditar configuração. */
  | 'df_projeto'
  | 'df_tipo_elemento_regiao'
  | 'crm_planos_negociacoes';

export interface IxcContractDto {
  id: string;
  customerId: string;
  status: string | null;
  internetStatus: string | null;
  planDescription: string | null;
  registeredAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
}

export interface IxcInvoiceDto {
  id: string;
  customerId: string;
  contractId: string | null;
  status: string | null;
  dueDate: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  amount: number | null;
  openAmount: number | null;
  paidAmount: number | null;
}

export interface IxcServiceOrderDto {
  id: string;
  customerId: string;
  ticketId: string | null;
  protocol: string | null;
  status: string | null;
  type: string | null;
  priority: string | null;
  sector: string | null;
  subjectId: string | null;
  openedAt: string | null;
  scheduledAt: string | null;
  closedAt: string | null;
  slaStatus: string | null;
}

export interface IxcTicketDto {
  id: string;
  customerId: string;
  contractId: string | null;
  protocol: string | null;
  status: string | null;
  subjectId: string | null;
  sectorId: string | null;
  priority: string | null;
  pendingInteraction: boolean | null;
  openedAt: string | null;
  updatedAt: string | null;
}

export interface IxcSubjectRuleDto {
  id: string;
  name: string;
  active: boolean | null;
  purpose: string | null;
  defaultPriority: string | null;
  contractRequired: boolean | null;
  loginRequired: boolean | null;
  diagnosisRequired: boolean | null;
  checklistId: string | null;
  photosRequired: boolean | null;
  teamRequired: boolean | null;
  customerSignatureEnabled: boolean | null;
}

export interface IxcPlanDto {
  id: string;
  name: string;
  active: boolean | null;
  value: number | null;
  loyaltyMonths: number | null;
  productId: string | null;
}

export interface IxcSpeedProfileDto {
  id: string;
  name: string;
  active: boolean | null;
  download: string | null;
  upload: string | null;
  monthlyAllowance: string | null;
  connectionType: string | null;
}

/**
 * Recorte seguro de uma caixa FTTH do InMap.
 *
 * Não inclui identificador, endereço nem vínculo de transmissor: esses dados
 * servem apenas para o cálculo no backend e não devem chegar ao canal nem ao
 * modelo. `reportedCapacity` é a capacidade cadastrada da caixa, não porta
 * livre e, portanto, não pode ser usada para afirmar viabilidade.
 */
export interface IxcFtthBoxDto {
  active: boolean | null;
  cityId: string | null;
  latitude: number | null;
  longitude: number | null;
  reportedCapacity: number | null;
  updatedAt: string | null;
}

/**
 * Resultado paginado reduzido para auditorias técnicas. `complete` só é
 * verdadeiro quando o IXC declarou (ou a página demonstra) que não há mais
 * registros e todos os registros recebidos puderam ser interpretados.
 */
export interface IxcReadInventory<T> {
  items: T[];
  complete: boolean;
  declaredTotal: number | null;
  malformedRecordCount: number;
}

/** Recortes sem identificadores, descrições ou coordenadas para auditoria de viabilidade. */
export interface IxcInmapProjectDto {
  active: boolean | null;
}

export interface IxcCoverageRegionTypeDto {
  active: boolean | null;
  viabilityEnabled: boolean | null;
  fiberEnabled: boolean | null;
}

export interface IxcNegotiationPlanDto {
  active: boolean | null;
  hasSourcePlan: boolean;
  hasWorkflow: boolean;
  hasInstallationSubject: boolean;
}

/** Whitelist deliberada: nunca expõe senha, IP, MAC, SSID ou credenciais do roteador. */
export interface IxcConnectionDto {
  id: string;
  customerId: string;
  contractId: string | null;
  active: boolean | null;
  online: boolean | null;
  connectionState: string | null;
  accessType: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  disconnectReason: string | null;
  lastSignal: string | null;
}

/**
 * Vínculo factual entre contrato e equipamento FTTH, lido do IXC/InMap.
 * Identificadores de CTO, OLT/PON, IP, MAC e credenciais não cruzam a
 * fronteira da integração: são somente sinalizadores seguros para o Omni.
 */
export interface IxcFiberAccessDto {
  id: string;
  contractId: string;
  hasFtthBox: boolean;
  hasTransmitter: boolean;
  hasPon: boolean;
  signalRecordedAt: string | null;
  hasLastSignal: boolean;
}

/**
 * Evidência agregada da caixa FTTH no IXC.
 *
 * O identificador da caixa, os logins e os demais clientes permanecem dentro
 * da integração: esta estrutura é segura para auditoria e composição de regra,
 * mas não é enviada ao modelo nem ao canal do cliente.
 */
export interface IxcBoxCohortEvidence {
  source: 'IXC_FTTH_BOX';
  status: 'available' | 'no_box' | 'box_ambiguous' | 'unavailable';
  observedAt: string;
  /** Quantas caixas FTTH foram encontradas para os contratos do cliente atual. */
  boxCount: number;
  /** A amostra pode ser incompleta quando a caixa ultrapassa o limite seguro de leitura. */
  sampleComplete: boolean;
  /**
   * Inventário agregado de ONU, vindo de radpop_radio_cliente_fibra.
   * Um valor de sinal registrado não é tratado como disponibilidade atual,
   * queda, porta livre ou confirmação de evento coletivo.
   */
  fiberEquipment: {
    total: number;
    signalTimestamped: number;
    lastSignalRecorded: number;
  };
}

/**
 * Evidência direta de evento coletivo registrada no IXC.
 *
 * A confirmação exige um login do cliente explicitamente marcado como
 * afetado e uma OS de estrutura (`tipo=E`) ainda ativa. Não deduzimos o
 * evento por sinal, caixa, OLT, proximidade ou volume de clientes.
 * `incidentCode` é uma chave opaca somente para deduplicação interna;
 * nunca atravessa para o modelo ou para o cliente.
 */
export interface IxcStructuralIncidentEvidence {
  source: 'IXC_STRUCTURAL_OS';
  status: 'CONFIRMED' | 'NOT_CONFIRMED' | 'INCONCLUSIVE' | 'UNAVAILABLE';
  observedAt: string;
  matchedLogins: number;
  matchedMaintenanceRegions: number;
  activeStructuralOrders: number;
  incidentCode: string | null;
}

export interface IxcListResponse {
  registros?: unknown[];
  total?: number | string;
  type?: string;
  message?: string;
}

/**
 * Recorte não sensível da configuração oficial da Auto Viabilidade V3.
 * A rota nativa também retorna telefone, links e itens visuais; o Omni não
 * replica esses valores porque eles não são necessários para decidir se a
 * fonte factual está pronta para uma consulta controlada.
 */
export interface IxcAutoViabilityRuntimeConfigDto {
  source: 'IXC_INMAP_AUTO_VIABILITY';
  version: string | null;
  usesExternalServer: boolean | null;
  hasBranch: boolean;
  hasNegotiationSubject: boolean;
  scheduleConfigured: boolean;
  readyForControlledCheck: boolean;
  observedAt: string;
}

export interface IxcEvidenceFact {
  resource: 'contracts' | 'invoices' | 'service_orders' | 'connections' | 'fiber_access' | 'tickets';
  entityRef: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface IxcOperationalEvidence {
  source: 'IXC';
  /** Referência interna do cliente IXC identificado de forma inequívoca. Nunca vai ao prompt. */
  customerRef?: string;
  status: 'success' | 'empty' | 'customer_not_found' | 'customer_ambiguous' | 'unavailable';
  /** Contrato MCP em modo sombra; não substitui o status legado nesta fase. */
  mcpOutcome?: GovernedReadOutcome;
  observedAt: string;
  facts: IxcEvidenceFact[];
}
