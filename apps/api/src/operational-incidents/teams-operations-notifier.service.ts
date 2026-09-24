import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OperationalIncident } from '@prisma/client';
import type { Env } from '../config/env.validation';

/**
 * Adaptador de alerta externo deliberadamente simples. O URL vem de um
 * Workflow do Teams, fica somente no ambiente seguro e recebe uma mensagem
 * sem conversa, cliente, credencial, endereço ou retorno de integração.
 */
@Injectable()
export class TeamsOperationsNotifier {
  private readonly logger = new Logger(TeamsOperationsNotifier.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  isEnabled(): boolean {
    return this.config.get('OPERATIONS_TEAMS_ALERTS_ENABLED', { infer: true })
      && Boolean(this.config.get('OPERATIONS_TEAMS_WEBHOOK_URL', { infer: true }));
  }

  async notify(incident: OperationalIncident): Promise<boolean> {
    const url = this.config.get('OPERATIONS_TEAMS_WEBHOOK_URL', { infer: true });
    if (!this.isEnabled() || !url) return false;

    const text = [
      `[${incident.severity}] SEEG Omni — incidente operacional`,
      `Fonte: ${incident.source}`,
      `Código: ${incident.code}`,
      `Ocorrências agrupadas: ${incident.occurrenceCount}`,
      `Primeira ocorrência: ${incident.firstSeenAt.toISOString()}`,
      `Última ocorrência: ${incident.lastSeenAt.toISOString()}`,
      'Verifique o painel de incidentes do Omni. Este alerta não contém dados de clientes.',
    ].join('\n');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        this.logger.warn(`Teams recusou alerta operacional com HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Falha ao notificar Teams: ${(error as Error).message}`);
      return false;
    }
  }
}
