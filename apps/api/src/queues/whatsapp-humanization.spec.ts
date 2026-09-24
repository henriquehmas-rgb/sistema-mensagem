import { describe, expect, it } from 'vitest';
import { bubbleGapMs, typingDelayMs, whatsappReplyParts } from './whatsapp-humanization';

describe('humanização compartilhada das respostas', () => {
  it('separa saudação e pedido, sem perder a ordem', () => {
    expect(whatsappReplyParts('Bom dia! Tudo bem?\n\nMe conte o que aconteceu.'))
      .toEqual(['Bom dia! Tudo bem?', 'Me conte o que aconteceu.']);
  });

  it('remove formatação de documento e emojis quando o cliente não usou', () => {
    expect(whatsappReplyParts('**Entendi.**\n\n1. Vou conferir sua conexão. 😊\n2. Já volto.'))
      .toEqual(['Entendi.', 'Vou conferir sua conexão. Já volto.']);
    expect(whatsappReplyParts('Veja [a página](https://exemplo.com/info) e `confirme` o dado.'))
      .toEqual(['Veja a página: https://exemplo.com/info e confirme o dado.']);
  });

  it('admite no máximo um emoji quando o cliente usou', () => {
    expect(whatsappReplyParts('Olá 😊😊. Vou verificar 👍', true)).toEqual(['Olá 😊. Vou verificar']);
  });

  it('mantém cada bolha até 300 caracteres sem descartar conteúdo', () => {
    const reply = 'Uma explicação importante. '.repeat(30);
    const parts = whatsappReplyParts(reply);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 300)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(reply.trim());
  });

  it.each([
    'Não consegui verificar a conexão neste momento. Seu pedido segue registrado para o suporte conferir a situação da região. Pode aguardar um instante?',
    'Preciso confirmar os planos disponíveis para esse endereço. Assim que a consulta terminar, mostro as opções compatíveis e explico os detalhes de cada uma.',
    'Ainda não consegui confirmar essa cobrança. Seu pedido está registrado e o Financeiro vai conferir os dados antes de informar qualquer valor.',
  ])('apresenta respostas de suporte, vendas e financeiro em bolhas curtas', (reply) => {
    const parts = whatsappReplyParts(reply);
    expect(parts.length).toBeGreaterThanOrEqual(1);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.every((part) => part.length <= 160)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(reply);
  });

  it('agrupa quatro ideias curtas em até três bolhas sem alterar a mensagem', () => {
    const parts = whatsappReplyParts('Entendi.\n\nVou conferir.\n\nJá volto.\n\nPode aguardar?');
    expect(parts.length).toBe(3);
    expect(parts.join('\n\n')).toContain('Entendi.');
    expect(parts.join('\n\n')).toContain('Pode aguardar?');
  });

  it('limita digitação simulada e intervalo entre bolhas', () => {
    expect(typingDelayMs('Oi', 'a')).toBe(1_500);
    expect(typingDelayMs('x'.repeat(500), 'b')).toBe(8_000);
    expect(bubbleGapMs('c')).toBeGreaterThanOrEqual(800);
    expect(bubbleGapMs('c')).toBeLessThanOrEqual(2_000);
  });
});
