import { randomBytes } from 'node:crypto';

/** Protocolo legível, não sequencial e difícil de enumerar. */
export function createConversationProtocol(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const entropy = randomBytes(5).toString('hex').toUpperCase();
  return `SEEG-${date}-${entropy}`;
}
