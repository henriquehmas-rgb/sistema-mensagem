/**
 * Circuit breaker local para integrações apenas de leitura. Evita que uma
 * fonte já comprovadamente indisponível atrase todos os atendimentos enquanto
 * o estado expira; não substitui evidência por cache vencido.
 */
interface CircuitState {
  failures: number;
  openUntil: number;
}

export class ReadCircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(
    private readonly failureThreshold = 3,
    private readonly openMs = 30_000,
  ) {}

  allows(key: string, now = Date.now()): boolean {
    const state = this.states.get(key);
    if (!state) return true;
    if (state.openUntil > now) return false;
    if (state.openUntil > 0) this.states.delete(key);
    return true;
  }

  recordSuccess(key: string): void {
    this.states.delete(key);
  }

  recordFailure(key: string, now = Date.now()): void {
    const previous = this.states.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    this.states.set(key, {
      failures,
      openUntil: failures >= this.failureThreshold ? now + this.openMs : 0,
    });
  }

  clear(key: string): void {
    this.states.delete(key);
  }
}
