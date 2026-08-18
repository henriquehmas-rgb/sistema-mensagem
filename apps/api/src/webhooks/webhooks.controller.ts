import { InjectQueue } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator';
import type { Env } from '../config/env.validation';
import { QUEUES, type WebhookIngestJob } from '../queues/queues.constants';

/**
 * Webhooks públicos da Meta (CONTRACTS §6) — VERSION_NEUTRAL (/api/webhooks/meta),
 * sem JWT e isentos de rate limit (§9).
 * - GET: verificação do hub.challenge (META_VERIFY_TOKEN).
 * - POST: valida X-Hub-Signature-256 (HMAC SHA-256 do raw body com META_APP_SECRET),
 *   responde 200 IMEDIATAMENTE e só enfileira `webhook-ingest` — todo o
 *   processamento (dedupe por wamid, contato/conversa, eventos) é do processor.
 */
@Public()
@SkipThrottle()
@Controller({ path: 'webhooks/meta', version: VERSION_NEUTRAL })
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly appSecret: string;
  private readonly verifyToken: string;

  constructor(
    config: ConfigService<Env, true>,
    @InjectQueue(QUEUES.WEBHOOK_INGEST)
    private readonly webhookIngestQueue: Queue<WebhookIngestJob>,
  ) {
    this.appSecret = config.get('META_APP_SECRET', { infer: true });
    this.verifyToken = config.get('META_VERIFY_TOKEN', { infer: true });
  }

  /** Handshake de assinatura do webhook (Meta chama uma vez ao configurar). */
  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (mode === 'subscribe' && token === this.verifyToken && challenge) {
      return challenge;
    }
    throw new ForbiddenException('Verificação de webhook inválida');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ received: boolean }> {
    // CONTRACTS §6: 200 sempre (Meta reenvia em não-200). Assinatura inválida
    // NÃO enfileira — payload forjado nunca entra no pipeline.
    if (!this.isSignatureValid(request.rawBody, signature)) {
      this.logger.warn('Webhook Meta com X-Hub-Signature-256 ausente/inválida — descartado');
      return { received: true };
    }

    await this.webhookIngestQueue.add('meta', {
      source: 'meta',
      body,
      headers: signature ? { 'x-hub-signature-256': signature } : {},
      receivedAt: new Date().toISOString(),
    });
    return { received: true };
  }

  private isSignatureValid(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature?.startsWith('sha256=')) {
      return false;
    }
    const expected = createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    const provided = signature.slice('sha256='.length);
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
  }
}
