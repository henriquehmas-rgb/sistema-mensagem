import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.validation';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recomendado para GCM
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * AES-256-GCM com APP_ENCRYPTION_KEY (32 bytes hex).
 * IV aleatório por operação. Formato de saída: base64(iv | tag | cipher).
 * Usado para credenciais de canal (CONTRACTS §9) — nunca logar entradas/saídas.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const keyHex: string = config.get('APP_ENCRYPTION_KEY', { infer: true });
    this.key = Buffer.from(keyHex, 'hex');
    if (this.key.length !== KEY_LENGTH) {
      throw new Error('APP_ENCRYPTION_KEY deve decodificar para exatamente 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, 'base64');
    if (raw.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Payload criptografado inválido');
    }
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
