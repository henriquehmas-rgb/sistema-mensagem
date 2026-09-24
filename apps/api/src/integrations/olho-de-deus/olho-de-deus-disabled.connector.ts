import { Injectable } from '@nestjs/common';
import type { NetworkObservation, OlhoDeDeusConnector } from './olho-de-deus.types';

/**
 * Fronteira segura usada enquanto o contrato HTTP real não foi recebido.
 * Amanhã somente este adaptador deve ser substituído pelo cliente autenticado.
 */
@Injectable()
export class OlhoDeDeusDisabledConnector implements OlhoDeDeusConnector {
  isConfigured(): boolean {
    return false;
  }

  getCustomerNetworkContext(_customerReference: string): Promise<NetworkObservation> {
    return Promise.reject(new Error('Conector do Olho de Deus ainda não configurado'));
  }
}
