import { describe, expect, it } from 'vitest';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('registra decisões e transições com rotas de cardinalidade fechada', async () => {
    const metrics = new MetricsService();

    metrics.recordAiDecision('billing', 'reply');
    metrics.recordAiDecision('rota-informada-pelo-cliente', 'clarification');
    metrics.recordAiRouteTransition('billing', 'sales');
    metrics.recordAiRouteTransition('sales', 'sales');

    const content = await metrics.metricsText();
    expect(content).toContain('ai_decisions_total{route_key="billing",outcome="reply"} 1');
    expect(content).toContain('ai_decisions_total{route_key="general",outcome="clarification"} 1');
    expect(content).toContain('ai_route_transitions_total{from_route="billing",to_route="sales"} 1');
    expect(content).not.toContain('ai_route_transitions_total{from_route="sales",to_route="sales"}');
  });

  it('registra a comparação MCP sem identificadores de cliente', async () => {
    const metrics = new MetricsService();
    metrics.recordMcpIntegrationOutcome('IXC', 'UNAVAILABLE', 'UNAVAILABLE', 'NO_LEARNING_TECHNICAL_INCIDENT');

    const content = await metrics.metricsText();
    expect(content).toContain('mcp_integration_outcomes_total{integration="IXC",source_status="UNAVAILABLE",mcp_status="UNAVAILABLE",learning_disposition="NO_LEARNING_TECHNICAL_INCIDENT"} 1');
  });
});
