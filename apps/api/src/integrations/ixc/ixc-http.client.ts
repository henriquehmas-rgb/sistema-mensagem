import { BadGatewayException, Injectable, RequestTimeoutException } from '@nestjs/common';
import { request } from 'node:https';
import type { IxcCredentials, IxcEndpoint, IxcListResponse } from './ixc.types';

const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 200;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;

interface CircuitState {
  failures: number;
  openUntil: number;
}

@Injectable()
export class IxcHttpClient {
  private readonly circuits = new Map<string, CircuitState>();

  async list(
    baseUrl: string,
    credentials: IxcCredentials,
    endpoint: IxcEndpoint,
    payload: Record<string, string>,
  ): Promise<IxcListResponse> {
    const circuitKey = new URL(baseUrl).host.toLowerCase();
    const state = this.circuits.get(circuitKey);
    if (state && state.openUntil > Date.now()) {
      throw new BadGatewayException('IXC temporariamente indisponível após falhas consecutivas');
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.requestOnce(baseUrl, credentials, endpoint, payload);
        this.circuits.delete(circuitKey);
        return response;
      } catch (error) {
        if (!this.isTransient(error) || attempt === MAX_ATTEMPTS) {
          if (this.isTransient(error)) this.recordFailure(circuitKey);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    throw new BadGatewayException('Não foi possível consultar o IXC');
  }

  /**
   * Leitura da configuração do serviço oficial de Auto Viabilidade.
   *
   * Essa rota antiga permanece somente para inspeção administrativa do motor
   * legado. O atendimento usa o endpoint técnico documentado separadamente.
   */
  async readAutoViabilityConfig(
    baseUrl: string,
    credentials: IxcCredentials,
  ): Promise<Record<string, unknown>> {
    const circuitKey = new URL(baseUrl).host.toLowerCase();
    const state = this.circuits.get(circuitKey);
    if (state && state.openUntil > Date.now()) {
      throw new BadGatewayException('IXC temporariamente indisponível após falhas consecutivas');
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.postTechnicalViabilityOnce(
          baseUrl, credentials, { action: 'get-config' }, '/viability/requestAction',
        );
        this.circuits.delete(circuitKey);
        return response;
      } catch (error) {
        if (!this.isTransient(error) || attempt === MAX_ATTEMPTS) {
          if (this.isTransient(error)) this.recordFailure(circuitKey);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    throw new BadGatewayException('Não foi possível consultar o IXC');
  }

  /**
   * Consulta técnica nativa do InMap. Apesar de ser um POST, ela é uma
   * decisão por endereço/coordenadas, não a criação de uma prospecção.
   * Como não existe escrita externa, uma falha transitória pode ser repetida
   * uma única vez. Erros definitivos continuam sem repetição e o circuit
   * breaker impede insistência quando o provedor está realmente instável.
   */
  async checkAutoViability(
    baseUrl: string,
    credentials: IxcCredentials,
    payload: Record<string, string | number>,
  ): Promise<Record<string, unknown>> {
    const circuitKey = new URL(baseUrl).host.toLowerCase();
    const state = this.circuits.get(circuitKey);
    if (state && state.openUntil > Date.now()) {
      throw new BadGatewayException('IXC temporariamente indisponível após falhas consecutivas');
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.postTechnicalViabilityOnce(baseUrl, credentials, payload);
        this.circuits.delete(circuitKey);
        return response;
      } catch (error) {
        if (!this.isTransient(error) || attempt === MAX_ATTEMPTS) {
          if (this.isTransient(error)) this.recordFailure(circuitKey);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    throw new BadGatewayException('Não foi possível consultar a viabilidade no IXC');
  }

  private requestOnce(
    baseUrl: string,
    credentials: IxcCredentials,
    endpoint: IxcEndpoint,
    payload: Record<string, string>,
  ): Promise<IxcListResponse> {
    const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${endpoint}`);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': String(body.length),
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64')}`,
            ixcsoft: 'listar',
          },
          timeout: TIMEOUT_MS,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) {
              req.destroy(new Error('IXC_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const status = response.statusCode ?? 502;
            if (status < 200 || status >= 300) {
              const error = new BadGatewayException(
                status === 429 || status >= 500
                  ? 'IXC temporariamente indisponível'
                  : 'IXC recusou a consulta',
              );
              // O código HTTP é preservado só como metadado interno para que
              // consumidores administrativos possam distinguir permissão,
              // rota e instabilidade sem registrar a resposta bruta do IXC.
              Object.assign(error, {
                ixcTransient: status === 408 || status === 429 || status >= 500,
                ixcHttpStatus: status,
              });
              reject(error);
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as IxcListResponse);
            } catch {
              // O IXC ocasionalmente encerra uma resposta 200 incompleta. Trate
              // isso como transitório para aproveitar a repetição única e
              // limitada já aplicada pelo cliente, sem mascarar falha persistente.
              const invalid = new BadGatewayException('IXC retornou uma resposta inválida');
              Object.assign(invalid, { ixcTransient: true, ixcFailureKind: 'INVALID_RESPONSE' });
              reject(invalid);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('IXC_TIMEOUT')));
      req.on('error', (error) => {
        if (error.message === 'IXC_TIMEOUT') {
          const timeout = new RequestTimeoutException('IXC não respondeu dentro do tempo limite');
          Object.assign(timeout, { ixcTransient: true });
          reject(timeout);
        } else if (error.message === 'IXC_RESPONSE_TOO_LARGE') {
          reject(new BadGatewayException('Resposta do IXC excedeu o limite permitido'));
        } else {
          const unavailable = new BadGatewayException('Não foi possível consultar o IXC');
          Object.assign(unavailable, { ixcTransient: true });
          reject(unavailable);
        }
      });
      req.end(body);
    });
  }

  private postTechnicalViabilityOnce(
    baseUrl: string,
    credentials: IxcCredentials,
    payload: Record<string, string | number>,
    path = '/webservice/v1/viabilidade_tecnica',
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, new URL(baseUrl).origin);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');

    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': String(body.length),
            Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64')}`,
          },
          timeout: TIMEOUT_MS,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) {
              req.destroy(new Error('IXC_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const status = response.statusCode ?? 502;
            if (status < 200 || status >= 300) {
              const error = new BadGatewayException(
                status === 429 || status >= 500
                  ? 'IXC temporariamente indisponível'
                  : 'IXC recusou a consulta',
              );
              Object.assign(error, {
                ixcTransient: status === 408 || status === 429 || status >= 500,
                ixcHttpStatus: status,
              });
              reject(error);
              return;
            }
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              const parsed: unknown = JSON.parse(raw);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
              resolve(parsed as Record<string, unknown>);
            } catch {
              // Nunca conservamos a resposta: ela pode conter o cadastro do
              // lead. O diagnóstico abaixo diferencia retorno vazio, HTML e
              // outro conteúdo não-JSON, o suficiente para homologar o
              // transporte sem vazar dados.
              const raw = Buffer.concat(chunks).toString('utf8').trimStart();
              const responseKind = raw.length === 0
                ? 'EMPTY'
                : /^<!doctype html|^<html[\s>]/i.test(raw)
                  ? 'HTML'
                  : 'NON_JSON';
              const invalid = new BadGatewayException('IXC retornou uma resposta inválida');
              Object.assign(invalid, {
                ixcTransient: true,
                ixcFailureKind: 'INVALID_RESPONSE',
                ixcResponseKind: responseKind,
              });
              reject(invalid);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('IXC_TIMEOUT')));
      req.on('error', (error) => {
        if (error.message === 'IXC_TIMEOUT') {
          const timeout = new RequestTimeoutException('IXC não respondeu dentro do tempo limite');
          Object.assign(timeout, { ixcTransient: true });
          reject(timeout);
        } else if (error.message === 'IXC_RESPONSE_TOO_LARGE') {
          reject(new BadGatewayException('Resposta do IXC excedeu o limite permitido'));
        } else {
          const unavailable = new BadGatewayException('Não foi possível consultar o IXC');
          Object.assign(unavailable, { ixcTransient: true });
          reject(unavailable);
        }
      });
      req.end(body);
    });
  }

  private isTransient(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'ixcTransient' in error && error.ixcTransient === true);
  }

  private recordFailure(circuitKey: string): void {
    const previous = this.circuits.get(circuitKey);
    const failures = (previous?.failures ?? 0) + 1;
    this.circuits.set(circuitKey, {
      failures,
      openUntil: failures >= FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0,
    });
  }
}
