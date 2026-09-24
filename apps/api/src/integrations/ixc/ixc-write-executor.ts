import { ForbiddenException, Injectable } from '@nestjs/common';
import { OMNI_OPERATIONAL_POLICY } from '../../operational-policy/omni-operational-policy';

export type IxcWriteOutcome =
  | { state: 'COMPLETED'; ixcId: string; protocol: string | null; created: true }
  | { state: 'DUPLICATE_FOUND'; ixcId: string; protocol: string | null; created: false }
  | { state: 'UNCERTAIN'; ixcId: null; protocol: null; created: null };

export interface IxcWriteCommand {
  action: 'request_ticket' | 'request_service_order';
  mappingKey: string;
  occurrenceId: string;
  idempotencyKey: string;
  payload: Record<string, string>;
}

export interface IxcWriteTransport {
  execute(command: IxcWriteCommand): Promise<unknown>;
}

/** Único portão permitido para futuras inclusões no IXC. */
@Injectable()
export class IxcWriteExecutor {
  assertExecutionEnabled(): void {
    if (
      OMNI_OPERATIONAL_POLICY.effectiveMode === 'SHADOW' ||
      !OMNI_OPERATIONAL_POLICY.externalWriteEnabled
    ) {
      throw new ForbiddenException('IXC_EXTERNAL_WRITE_DISABLED');
    }
  }

  async execute(command: IxcWriteCommand, transport?: IxcWriteTransport): Promise<IxcWriteOutcome> {
    this.assertExecutionEnabled();
    if (!transport) throw new ForbiddenException('IXC_WRITE_TRANSPORT_NOT_CONFIGURED');
    await transport.execute(command);
    // Sem resposta homologada, nunca afirmar sucesso nem repetir automaticamente.
    return { state: 'UNCERTAIN', ixcId: null, protocol: null, created: null };
  }
}

export function normalizeIxcWriteOutcome(value: unknown): IxcWriteOutcome {
  if (!value || typeof value !== 'object') {
    return { state: 'UNCERTAIN', ixcId: null, protocol: null, created: null };
  }
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : null;
  const protocol = typeof row.protocol === 'string'
    ? row.protocol
    : typeof row.protocolo === 'string' ? row.protocolo : null;
  if (!id) return { state: 'UNCERTAIN', ixcId: null, protocol: null, created: null };
  return { state: 'COMPLETED', ixcId: id, protocol, created: true };
}
