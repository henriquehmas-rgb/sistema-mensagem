/**
 * Contrato interno preliminar para escrita IXC.
 *
 * Estas funções apenas montam payloads tipados. Elas não fazem requisições e
 * não liberam escrita externa. Os nomes finais devem ser confirmados pela
 * homologação da instância SEEG antes de conectar um executor HTTP.
 */

export interface IxcCommonWriteMapping {
  priority: string;
  branchId: string;
  origin: 'I';
}

export interface IxcTicketWriteMapping extends IxcCommonWriteMapping {
  ticketSectorId: string;
  ticketSubjectId: string;
  initialTicketStatus: string;
}

export interface IxcServiceOrderWriteMapping extends IxcCommonWriteMapping {
  serviceOrderSectorId: string;
  serviceOrderSubjectId: string;
  initialServiceOrderStatus: string;
  serviceOrderType: string;
}

export type IxcWriteMapping = IxcTicketWriteMapping & IxcServiceOrderWriteMapping;

export interface OmniTicketCommand {
  customerId: string;
  contractId: string;
  title: string;
  summary: string;
}

export interface OmniServiceOrderCommand {
  customerId: string;
  ticketId: string;
  summary: string;
  loginId?: string;
}

export interface IxcTicketInsertPayload {
  id_cliente: string;
  id_contrato: string;
  id_assunto: string;
  id_ticket_setor: string;
  id_filial: string;
  titulo: string;
  menssagem: string;
  prioridade: string;
  status: string;
  origem_cadastro: 'I';
}

export interface IxcServiceOrderInsertPayload {
  id_cliente: string;
  id_ticket: string;
  id_assunto: string;
  setor: string;
  id_filial: string;
  id_login?: string;
  mensagem: string;
  prioridade: string;
  status: string;
  tipo: string;
  origem_cadastro: 'I';
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`IXC_WRITE_FIELD_REQUIRED:${field}`);
  return normalized;
}

export function buildIxcTicketInsert(
  command: OmniTicketCommand,
  mapping: IxcTicketWriteMapping,
): IxcTicketInsertPayload {
  return {
    id_cliente: required(command.customerId, 'customerId'),
    id_contrato: required(command.contractId, 'contractId'),
    id_assunto: required(mapping.ticketSubjectId, 'ticketSubjectId'),
    id_ticket_setor: required(mapping.ticketSectorId, 'ticketSectorId'),
    id_filial: required(mapping.branchId, 'branchId'),
    titulo: required(command.title, 'title'),
    menssagem: required(command.summary, 'summary'),
    prioridade: required(mapping.priority, 'priority'),
    status: required(mapping.initialTicketStatus, 'initialTicketStatus'),
    origem_cadastro: mapping.origin,
  };
}

export function buildIxcServiceOrderInsert(
  command: OmniServiceOrderCommand,
  mapping: IxcServiceOrderWriteMapping,
): IxcServiceOrderInsertPayload {
  return {
    id_cliente: required(command.customerId, 'customerId'),
    id_ticket: required(command.ticketId, 'ticketId'),
    id_assunto: required(mapping.serviceOrderSubjectId, 'serviceOrderSubjectId'),
    setor: required(mapping.serviceOrderSectorId, 'serviceOrderSectorId'),
    id_filial: required(mapping.branchId, 'branchId'),
    ...(command.loginId ? { id_login: command.loginId.trim() } : {}),
    mensagem: required(command.summary, 'summary'),
    prioridade: required(mapping.priority, 'priority'),
    status: required(mapping.initialServiceOrderStatus, 'initialServiceOrderStatus'),
    tipo: required(mapping.serviceOrderType, 'serviceOrderType'),
    origem_cadastro: mapping.origin,
  };
}
