import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';

const MAX_BODY_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface OltsResponse {
  ok: true;
  total: number;
  olts: unknown[];
}

interface RupturesResponse {
  ok: true;
  total: number;
  rompimentos: unknown[];
}

/**
 * Cliente de pré-validação da API de visualização do Olho de Deus.
 *
 * Não recebe comandos de criação, não expõe os dados retornados e não participa
 * da decisão de atendimento enquanto não existir correlação IXC -> OLT/PON.
 */
@Injectable()
export class OlhoDeDeusReadClientService {
  private readonly allowedHosts: Set<string>;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.allowedHosts = new Set(
      config.get('OLHO_DE_DEUS_ALLOWED_HOSTS', { infer: true })
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  isConfigured(): boolean {
    return Boolean(this.config.get('OLHO_DE_DEUS_BASE_URL', { infer: true }).trim()
      && this.config.get('OLHO_DE_DEUS_API_KEY', { infer: true })?.trim());
  }

  async readiness() {
    if (!this.isConfigured()) {
      return {
        status: 'NOT_CONFIGURED' as const,
        readOnly: true,
        affectsRuntimeDecisions: false,
        reason: 'olho_de_deus_aguardando_configuracao_segura',
      };
    }

    try {
      const [olts, ruptures] = await Promise.all([
        this.read<OltsResponse>('olts', 'olts'),
        this.read<RupturesResponse>('rompimentos', 'rompimentos'),
      ]);
      return {
        status: 'AVAILABLE' as const,
        readOnly: true,
        affectsRuntimeDecisions: false,
        olts: olts.total,
        activeRuptures: ruptures.total,
      };
    } catch (error) {
      return {
        status: 'UNAVAILABLE' as const,
        readOnly: true,
        affectsRuntimeDecisions: false,
        reason: error instanceof Error ? error.message : 'olho_de_deus_unavailable',
      };
    }
  }

  private async read<T extends { ok: true; total: number }>(path: string, collection: string): Promise<T> {
    const url = this.urlFor(path);
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': this.config.get('OLHO_DE_DEUS_API_KEY', { infer: true })! },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`olho_de_deus_http_${response.status}`);
    const declaredSize = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
      throw new Error('olho_de_deus_response_too_large');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('olho_de_deus_response_too_large');
    const payload: unknown = JSON.parse(text);
    if (!this.isExpectedPayload(payload, collection)) throw new Error('olho_de_deus_invalid_payload');
    return payload as T;
  }

  private urlFor(path: string): string {
    const rawBase = this.config.get('OLHO_DE_DEUS_BASE_URL', { infer: true }).trim();
    let base: URL;
    try {
      base = new URL(rawBase);
    } catch {
      throw new Error('olho_de_deus_invalid_base_url');
    }
    if (!['https:', 'http:'].includes(base.protocol)) throw new Error('olho_de_deus_invalid_protocol');
    if (base.protocol === 'http:' && !this.config.get('OLHO_DE_DEUS_ALLOW_HTTP', { infer: true })) {
      throw new Error('olho_de_deus_http_not_explicitly_allowed');
    }
    if (!this.allowedHosts.has(base.hostname.toLowerCase())) throw new Error('olho_de_deus_host_not_allowed');
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/${path}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private isExpectedPayload(payload: unknown, collection: string): payload is Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const value = payload as Record<string, unknown>;
    return value.ok === true && typeof value.total === 'number' && Array.isArray(value[collection]);
  }
}
