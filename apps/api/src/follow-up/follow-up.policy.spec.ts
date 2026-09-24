import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_DELAYS_MS,
  isFollowUpConsentAccepted,
  isFollowUpConsentPrompt,
  isFollowUpOptOut,
} from './follow-up.policy';

describe('follow-up policy', () => {
  it('mantém quatro etapas progressivas', () => {
    expect(FOLLOW_UP_DELAYS_MS).toEqual([86_400_000, 259_200_000, 604_800_000, 1_209_600_000]);
  });

  it('exige autorização explícita para uma retomada com atualização', () => {
    expect(isFollowUpConsentPrompt('Você autoriza que a equipe retome esta conversa por aqui quando houver uma atualização?')).toBe(true);
    expect(isFollowUpConsentPrompt('Posso retornar por aqui quando houver uma atualização?')).toBe(true);
    expect(isFollowUpConsentPrompt('Posso ajudar em algo?')).toBe(false);
  });

  it('não confunde opt-out com consentimento', () => {
    expect(isFollowUpConsentAccepted('Sim')).toBe(true);
    expect(isFollowUpOptOut('Não quero mais receber mensagens')).toBe(true);
    expect(isFollowUpConsentAccepted('Não quero mais receber mensagens')).toBe(false);
    expect(isFollowUpOptOut('Por favor, pare de enviar atualizações.')).toBe(true);
  });

  it('não toma uma resposta com dúvida como consentimento', () => {
    expect(isFollowUpConsentAccepted('Talvez, como funcionaria?')).toBe(false);
    expect(isFollowUpConsentAccepted('Pode me explicar melhor?')).toBe(false);
  });
});
