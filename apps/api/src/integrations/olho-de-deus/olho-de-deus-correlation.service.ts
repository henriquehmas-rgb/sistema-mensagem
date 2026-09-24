import { Injectable } from '@nestjs/common';
import type {
  CorrelatedNetworkContext,
  NetworkDiagnosis,
  NetworkObservation,
} from './olho-de-deus.types';
import { OMNI_OPERATIONAL_POLICY } from '../../operational-policy/omni-operational-policy';

const NETWORK_POLICY = OMNI_OPERATIONAL_POLICY.networkEvidence;

@Injectable()
export class OlhoDeDeusCorrelationService {
  correlate(observation: NetworkObservation, now = new Date()): CorrelatedNetworkContext {
    const evidence: CorrelatedNetworkContext['evidence'] = [];
    if (observation.oltSourceState === 'AVAILABLE') evidence.push('OLT');
    if (observation.ixcSourceState === 'AVAILABLE') evidence.push('IXC');
    if (observation.eventState !== 'NONE') evidence.push('OLHO_DE_DEUS');

    const age = now.getTime() - Date.parse(observation.observedAt);
    if (
      !Number.isFinite(age) ||
      age < -NETWORK_POLICY.futureClockToleranceMs ||
      age > NETWORK_POLICY.maxCorrelationObservationAgeMs ||
      observation.oltSourceState !== 'AVAILABLE'
    ) {
      return this.result(observation, evidence, 'INCONCLUSIVE', 0, false, 'evidencia_olt_indisponivel_ou_vencida');
    }
    // O IXC usado pelo Olho de Deus estabelece a associação cliente -> ONU/rota.
    // Sem essa associação atual não é seguro aplicar a telemetria ao cliente atual.
    if (observation.ixcSourceState !== 'AVAILABLE') {
      return this.result(observation, evidence, 'INCONCLUSIVE', 0, false, 'associacao_ixc_indisponivel_ou_vencida');
    }
    if (observation.eventState === 'RECOVERED') {
      return this.result(observation, evidence, 'RECOVERED', 0.95, true, 'evento_tecnico_recuperado');
    }

    const affected = observation.affectedOnus ?? 0;
    const total = observation.totalOnus ?? 0;
    const ratio = total > 0 ? affected / total : 0;
    const collective =
      affected >= NETWORK_POLICY.minimumCollectiveAffectedOnus &&
      ratio >= NETWORK_POLICY.minimumCollectiveAffectedRatio;

    if (collective && (observation.eventState === 'CONFIRMED' || observation.ixcAlert === true)) {
      return this.result(observation, evidence, 'COLLECTIVE_OUTAGE_CONFIRMED', 0.97, true, 'olt_e_correlacao_confirmam_falha_coletiva');
    }
    if (collective || observation.eventState === 'SUSPECTED') {
      return this.result(observation, evidence, 'COLLECTIVE_OUTAGE_SUSPECTED', 0.78, false, 'olt_indica_falha_coletiva_ainda_nao_confirmada');
    }
    if (observation.ixcAlert === true && observation.onuState === 'ONLINE') {
      return this.result(observation, evidence, 'IXC_FALSE_POSITIVE_SUSPECTED', 0.9, false, 'ixc_alerta_mas_olt_confirma_onu_online');
    }
    if (observation.onuState === 'OFFLINE') {
      return this.result(observation, evidence, 'INDIVIDUAL_FAILURE', 0.88, true, 'somente_conexao_individual_aparece_offline');
    }
    if (observation.onuState === 'ONLINE' && observation.ixcAlert !== true) {
      return this.result(observation, evidence, 'NORMAL', 0.94, true, 'olt_confirma_conexao_online');
    }
    return this.result(observation, evidence, 'INCONCLUSIVE', 0.25, false, 'evidencia_insuficiente_ou_conflitante');
  }

  private result(
    observation: NetworkObservation,
    evidence: CorrelatedNetworkContext['evidence'],
    diagnosis: NetworkDiagnosis,
    confidence: number,
    safeForAutomaticReply: boolean,
    reason: string,
  ): CorrelatedNetworkContext {
    return {
      networkEventId: observation.networkEventId ?? null,
      diagnosis,
      confidence,
      customerReference: observation.customerReference,
      topology: { olt: observation.olt, pon: observation.pon, cto: observation.cto, route: observation.route },
      technical: {
        onuState: observation.onuState,
        opticalSignalDbm: observation.opticalSignalDbm,
        affectedOnus: observation.affectedOnus,
        totalOnus: observation.totalOnus,
      },
      eventState: observation.eventState,
      evidence,
      observedAt: observation.observedAt,
      safeForAutomaticReply,
      reason,
    };
  }
}
