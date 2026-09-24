import type { IxcOperationalEvidence } from '../integrations/ixc/ixc.types';

/** Cadastro verificado não comprova serviço atual: a consulta regional exige contrato e login ativos. */
export function hasCurrentIxcService(evidence: IxcOperationalEvidence | null): boolean {
  if (evidence?.status !== 'success') return false;
  const activeContract = evidence.facts.some((fact) => fact.resource === 'contracts'
    && ['A', 'ATIVO', 'ACTIVE'].includes(String(fact.fields.status ?? '').toUpperCase()));
  const activeLogin = evidence.facts.some((fact) => fact.resource === 'connections'
    && fact.fields.active === true);
  return activeContract && activeLogin;
}

/** Só pede outro titular quando o cadastro foi encontrado, mas o serviço atual não foi confirmado. */
export function needsCurrentServiceHolder(
  route: string | null,
  identityVerified: boolean,
  actions: readonly string[],
  evidence: IxcOperationalEvidence | null,
): boolean {
  return route === 'technical_support'
    && identityVerified
    && actions.includes('connections')
    && Boolean(evidence?.customerRef)
    && (evidence?.status === 'success' || evidence?.status === 'empty')
    && !hasCurrentIxcService(evidence);
}
