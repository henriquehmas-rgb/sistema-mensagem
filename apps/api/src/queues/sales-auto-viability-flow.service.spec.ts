import { MessageDirection, MessageType, type Message } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { OperationalCaseState } from '../support-case-state/support-case-state.types';
import { SalesAutoViabilityFlowService } from './sales-auto-viability-flow.service';

const state: OperationalCaseState = {
  schemaVersion: 1,
  route: 'sales',
  customerProfile: 'RESIDENTIAL',
  primaryUsage: 'GAMES',
  cityNeighborhoodProvided: false,
  addressProvided: true,
  coverageEvidenceRequested: false,
  coverageCheckStatus: 'NOT_CHECKED',
  nextStep: 'CONTINUE_SAFE_QUALIFICATION',
};

function message(direction: MessageDirection, text: string): Message {
  // O fixture contém somente os campos lidos por este fluxo.
  return { direction, type: MessageType.TEXT, content: { text } } as unknown as Message;
}

function location(direction: MessageDirection, latitude: number, longitude: number): Message {
  return { direction, type: MessageType.LOCATION, content: { latitude, longitude } } as unknown as Message;
}

function service(messages: Message[], enabled = true) {
  return new SalesAutoViabilityFlowService(
    { prismaSystem: { message: { findMany: async () => [...messages].reverse() } } } as never,
    { get: (key: string) => key === 'IXC_INMAP_DIRECT_CHECK_ENABLED' ? enabled : '' } as never,
    { lookup: async () => ({ street: 'Rua das Flores', neighborhood: 'Centro', city: 'Cáceres', state: 'MT' }) } as never,
  );
}

const base = [
  message(MessageDirection.OUTBOUND, 'Para verificar a disponibilidade, me informe somente o CEP e o número do endereço.'),
];

describe('SalesAutoViabilityFlowService', () => {
  it('does not ask for location before learning the primary usage', async () => {
    const messages = [
      message(MessageDirection.INBOUND, 'Bom dia'),
      message(MessageDirection.OUTBOUND, 'Bom dia! Tudo bem? Como posso te ajudar?'),
      message(MessageDirection.INBOUND, 'Quero um plano de internet'),
    ];
    await expect(service(messages).resolve({
      orgId: 'org', conversationId: 'conversation',
      caseState: { ...state, customerProfile: 'UNKNOWN', primaryUsage: 'UNKNOWN', addressProvided: false, nextStep: 'ASK_PRIMARY_USAGE' },
    })).resolves.toEqual({ kind: 'NONE' });
  });

  it('asks for location after the customer describes their usage', async () => {
    const messages = [
      ...base,
      message(MessageDirection.INBOUND, 'Uso mais para jogos e trabalho remoto'),
    ];
    await expect(service(messages).resolve({
      orgId: 'org', conversationId: 'conversation',
      caseState: { ...state, addressProvided: false, nextStep: 'ASK_ADDRESS' },
    })).resolves.toEqual({
      kind: 'REPLY',
      reply: 'Para verificar a disponibilidade agora, compartilhe sua localização pelo clipe. Se preferir, envie somente o CEP e o número do endereço — por exemplo: 12345-678, 100.',
    });
  });

  it('starts automatically after CEP and number, without requesting location', async () => {
    const messages = [...base, message(MessageDirection.INBOUND, '78200-000, 671')];
    await expect(service(messages).resolve({ orgId: 'org', conversationId: 'conversation', caseState: state })).resolves.toEqual({
      kind: 'EXECUTE',
      input: {
        street: 'Rua das Flores', number: '671', neighborhood: 'Centro', city: 'Cáceres',
        postalCode: '78200000', state: 'MT',
      },
    });
  });

  it('starts from CEP and number even before profile and usage qualification', async () => {
    const messages = [message(MessageDirection.INBOUND, 'Quero internet'), message(MessageDirection.INBOUND, '78200-000, 671')];
    await expect(service(messages).resolve({
      orgId: 'org', conversationId: 'conversation',
      caseState: { ...state, customerProfile: 'UNKNOWN', primaryUsage: 'UNKNOWN', addressProvided: false },
    })).resolves.toMatchObject({
      kind: 'EXECUTE', input: { postalCode: '78200000', number: '671', state: 'MT' },
    });
  });

  it('starts the official sales check from a shared location without a customer lookup', async () => {
    const messages = [...base, location(MessageDirection.INBOUND, -16.063, -57.68)];
    await expect(service(messages).resolve({
      orgId: 'org', conversationId: 'conversation',
      caseState: { ...state, primaryUsage: 'UNKNOWN', addressProvided: false, nextStep: 'ASK_PRIMARY_USAGE' },
    })).resolves.toEqual({
      kind: 'EXECUTE', input: { latitude: -16.063, longitude: -57.68 },
    });
  });

  it('does not intercept the normal sales flow while technical checking is disabled', async () => {
    await expect(service(base, false).resolve({ orgId: 'org', conversationId: 'conversation', caseState: state })).resolves.toEqual({ kind: 'NONE' });
  });

  it('keeps an existing-customer plan change outside new-installation viability', async () => {
    const messages = [message(MessageDirection.INBOUND, 'Já sou cliente e quero trocar de plano')];
    await expect(service(messages).resolve({
      orgId: 'org', conversationId: 'conversation', caseState: state,
    })).resolves.toEqual({ kind: 'NONE' });
  });
});
