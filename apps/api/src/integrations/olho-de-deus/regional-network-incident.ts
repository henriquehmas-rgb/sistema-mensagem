import { createHash } from 'node:crypto';
import type { OmniNetworkResolution } from './olho-de-deus.types';

export interface ConfirmedRegionalNetworkIncident {
  /** Identificador seguro e determinístico, sem dados do cliente. */
  code: string;
  keySource: 'NETWORK_EVENT' | 'TOPOLOGY';
}

/**
 * Converte uma confirmação coletiva em uma chave de incidente operacional.
 *
 * A chave não usa cliente, contrato, endereço ou texto de conversa. Quando a
 * fonte não fornece o id do evento, a topologia serve somente para evitar que
 * uma mesma falha regional abra vários incidentes no Omni.
 */
export function confirmedRegionalNetworkIncident(
  resolution: OmniNetworkResolution | null,
): ConfirmedRegionalNetworkIncident | null {
  const context = resolution?.context;
  if (context?.diagnosis !== 'COLLECTIVE_OUTAGE_CONFIRMED') return null;

  const eventId = context.networkEventId?.trim();
  const topology = [context.topology.olt, context.topology.pon, context.topology.cto, context.topology.route]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('|');
  const source = eventId ? 'NETWORK_EVENT' : topology ? 'TOPOLOGY' : null;
  const material = eventId ?? topology;
  if (!source || !material) return null;

  const digest = createHash('sha256').update(`${source}:${material}`).digest('hex').slice(0, 20);
  return { code: `regional_outage_confirmed:${digest}`, keySource: source };
}
