import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SourceType } from '@prisma/client';
import type { Env } from '../config/env.validation';

/** Contratos do serviço de IA (FastAPI) — CONTRACTS §7. Campos em snake_case. */

export interface AiReplyRequest {
  org_id: string;
  conversation_id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  };
}

export interface AiReplyResponse {
  reply: string | null;
  handoff: boolean;
  handoff_reason?: string;
  confidence: number;
  sources: unknown[];
}

export interface AiIngestRequest {
  org_id: string;
  source_id: string;
  type: SourceType;
  content_url?: string;
  content_text?: string;
  meta: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Cliente HTTP do serviço interno de IA (auth via X-Service-Token).
 * Erros HTTP/rede viram exceção — o processor deixa o BullMQ fazer retry.
 */
@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('AI_SERVICE_URL', { infer: true }).replace(/\/+$/, '');
    this.serviceToken = config.get('AI_SERVICE_TOKEN', { infer: true });
  }

  async reply(request: AiReplyRequest): Promise<AiReplyResponse> {
    return this.post<AiReplyResponse>('/reply', request);
  }

  async ingest(request: AiIngestRequest): Promise<void> {
    await this.post<unknown>('/ingest', request);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': this.serviceToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`IA ${path} respondeu ${response.status}`);
      throw new Error(`Serviço de IA ${path} falhou: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}
