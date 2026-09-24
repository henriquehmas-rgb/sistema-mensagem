import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import type { IxcReadAction } from './ixc-query-planner';
import type { IxcEvidenceFact, IxcOperationalEvidence } from './ixc.types';

const TTL_SECONDS: Record<IxcReadAction, number> = {
  connections: 30,
  fiber_access: 60,
  service_orders: 120,
  tickets: 120,
  invoices: 180,
  contracts: 300,
};

interface CachedEvidence {
  observedAt: string;
  customerRef?: string;
  facts: IxcEvidenceFact[];
}

@Injectable()
export class IxcEvidenceCache {
  constructor(private readonly redis: RedisService) {}

  async read(orgId: string, conversationId: string, actions: IxcReadAction[]): Promise<{
    evidence: IxcOperationalEvidence | null;
    missing: IxcReadAction[];
  }> {
    const facts: IxcEvidenceFact[] = [];
    const observed: string[] = [];
    const missing: IxcReadAction[] = [];
    const customerRefs = new Set<string>();
    for (const action of actions) {
      let raw: string | null;
      try {
        raw = await this.redis.client.get(this.key(orgId, conversationId, action));
      } catch {
        missing.push(action);
        continue;
      }
      if (!raw) {
        missing.push(action);
        continue;
      }
      try {
        const cached = JSON.parse(raw) as CachedEvidence;
        facts.push(...cached.facts);
        observed.push(cached.observedAt);
        if (cached.customerRef) customerRefs.add(cached.customerRef);
      } catch {
        missing.push(action);
      }
    }
    return {
      evidence: observed.length > 0 ? {
        source: 'IXC', status: facts.length > 0 ? 'success' : 'empty',
        observedAt: observed.sort()[0]!, facts,
        ...(customerRefs.size === 1 ? { customerRef: [...customerRefs][0] } : {}),
      } : null,
      missing,
    };
  }

  async write(
    orgId: string,
    conversationId: string,
    actions: IxcReadAction[],
    evidence: IxcOperationalEvidence,
  ): Promise<void> {
    if (evidence.status !== 'success' && evidence.status !== 'empty') return;
    for (const action of actions) {
      const value: CachedEvidence = {
        observedAt: evidence.observedAt,
        customerRef: evidence.customerRef,
        facts: evidence.facts.filter((fact) => fact.resource === action),
      };
      try {
        await this.redis.client.set(
          this.key(orgId, conversationId, action), JSON.stringify(value), 'EX', TTL_SECONDS[action],
        );
      } catch {
        // Cache é uma otimização; falha nunca invalida a evidência recém-consultada.
      }
    }
  }

  /** Um novo titular não pode herdar fatos consultados para o CPF anterior. */
  async clear(orgId: string, conversationId: string): Promise<void> {
    await this.redis.client.del(
      ...Object.keys(TTL_SECONDS).map((action) => this.key(orgId, conversationId, action as IxcReadAction)),
    );
  }

  private key(orgId: string, conversationId: string, action: IxcReadAction): string {
    return `ixc:evidence:${orgId}:${conversationId}:${action}`;
  }
}
