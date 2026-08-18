import { Controller, Get, Param, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { MediaService } from './media.service';

/**
 * GET /api/media/:orgId/:file — serve a mídia re-hospedada (CONTRACTS §6).
 * VERSION_NEUTRAL (fora do /v1), público e isento de throttle, como health/
 * webhooks. Segurança MVP: URL não-adivinhável (arquivo = 128 bits aleatórios
 * em hex) + validação estrita/anti path-traversal no MediaService. Conteúdo
 * imutável (nome aleatório por arquivo) → cache agressivo.
 */
@Public()
@SkipThrottle()
@Controller({ path: 'media', version: VERSION_NEUTRAL })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':orgId/:file')
  async serve(
    @Param('orgId') orgId: string,
    @Param('file') file: string,
    @Res() res: Response,
  ): Promise<void> {
    // Lança 400 (segmento inválido/traversal) ou 404 (inexistente).
    const { absolutePath, contentType } = await this.media.resolveMediaFile(orgId, file);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // sendFile (express) — suporta Range (seek de áudio/vídeo) e ETag.
    // Arquivo removido entre o stat e o sendFile: 404 limpo em vez do handler
    // default do Express (que vazaria 500 com detalhe interno).
    res.sendFile(absolutePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).end();
      }
    });
  }
}
