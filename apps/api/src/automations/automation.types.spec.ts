import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { parseAction } from './automation.types';

/**
 * automation.types.ts — parseAction (CONTRACTS §12): única fonte de verdade
 * de validação de `actions[]`, usada tanto pelo CRUD (AutomationsService,
 * rejeita payload inválido com 400) quanto pelo engine (AutomationRunProcessor,
 * nunca confia no que está no banco). Cobre principalmente `send_template`,
 * adicionado nesta wave — antes, QUALQUER automação usando essa action (a
 * única exigida pelo builder de Automações do CONTRACTS §12) era rejeitada
 * com 400 porque o `default: return null` do switch não reconhecia o tipo.
 */
describe('parseAction', () => {
  describe('send_template', () => {
    it('aceita {type, templateId} sem params', () => {
      expect(parseAction({ type: 'send_template', templateId: 'tpl_1' })).toEqual({
        type: 'send_template',
        templateId: 'tpl_1',
      });
    });

    it('aceita {type, templateId, params} com params string[]', () => {
      expect(
        parseAction({ type: 'send_template', templateId: 'tpl_1', params: ['Ana', '12345'] }),
      ).toEqual({
        type: 'send_template',
        templateId: 'tpl_1',
        params: ['Ana', '12345'],
      });
    });

    it('templateId ausente/vazio → null', () => {
      expect(parseAction({ type: 'send_template' })).toBeNull();
      expect(parseAction({ type: 'send_template', templateId: '' })).toBeNull();
      expect(parseAction({ type: 'send_template', templateId: 123 })).toBeNull();
    });

    it('params não-array → null', () => {
      expect(parseAction({ type: 'send_template', templateId: 'tpl_1', params: 'Ana' })).toBeNull();
    });

    it('params com item não-string → null', () => {
      expect(
        parseAction({ type: 'send_template', templateId: 'tpl_1', params: ['Ana', 5] }),
      ).toBeNull();
    });

    it('params vazio [] é aceito (template sem {{n}})', () => {
      expect(parseAction({ type: 'send_template', templateId: 'tpl_1', params: [] })).toEqual({
        type: 'send_template',
        templateId: 'tpl_1',
        params: [],
      });
    });
  });

  describe('demais tipos (regressão)', () => {
    it('assign com userId válido', () => {
      expect(parseAction({ type: 'assign', userId: 'u1' })).toEqual({
        type: 'assign',
        userId: 'u1',
      });
    });

    it('add_tag com tagId válido', () => {
      expect(parseAction({ type: 'add_tag', tagId: 't1' })).toEqual({
        type: 'add_tag',
        tagId: 't1',
      });
    });

    it('disable_ai sem campos extra', () => {
      expect(parseAction({ type: 'disable_ai' })).toEqual({ type: 'disable_ai' });
    });

    it('tipo desconhecido → null', () => {
      expect(parseAction({ type: 'send_text', text: 'oi' })).toBeNull();
      expect(parseAction({ type: 'call_webhook', url: 'https://x.com' })).toBeNull();
      expect(parseAction({ type: 'notify_agents' })).toBeNull();
    });

    it('valor não-objeto → null', () => {
      expect(parseAction(null)).toBeNull();
      expect(parseAction('send_template')).toBeNull();
      expect(parseAction([])).toBeNull();
    });
  });
});
