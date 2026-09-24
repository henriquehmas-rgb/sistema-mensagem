import { describe, expect, it } from 'vitest';
import { handoffMessage } from './handoff-message';

describe('handoffMessage', () => {
  it('encaminha falha de confirmação do titular ao setor correto', () => {
    const billing = handoffMessage('confirmacao_titular_financeiro_indisponivel', 'conv1');
    expect(billing).toContain('Financeiro');
    expect(billing).not.toContain('queda na região');
    const support = handoffMessage('confirmacao_titular_indisponivel', 'conv1');
    expect(support).toContain('suporte');
    expect(support).not.toContain('cobrança');
  });
  it('descreve a revisão em vários aparelhos sem alegar LOS vermelha', () => {
    const text = handoffMessage('avaliacao_tecnica_multiplos_dispositivos', 'conv1');
    expect(text).toMatch(/vários aparelhos/i);
    expect(text).not.toContain('LOS');
    expect(text).toContain('Ainda não há ordem de serviço aberta');
  });
  it('não promete OS nem descarta falha de rede ao encaminhar LOS persistente', () => {
    const text = handoffMessage('avaliacao_tecnica_residencial', 'conv1');
    expect(text).toMatch(/não encontrei ocorrência coletiva confirmada/i);
    expect(text).toMatch(/avaliar (uma )?visita/i);
    expect(text).toMatch(/ainda não há ordem de serviço aberta/i);
    expect(text).not.toContain('IXC');
  });

  it('não avança ao diagnóstico local sem concluir a verificação regional', () => {
    const text = handoffMessage('verificacao_regional_indisponivel', 'conv1');
    expect(text).toContain('não consegui verificar');
    expect(text).not.toContain('LOS');
    expect(text).not.toContain('IXC');
  });

  it('respeita pedido humano sem linguagem técnica ou abertura robótica', () => {
    const text = handoffMessage('pedido_de_atendimento_humano', 'conv1');
    expect(text).toMatch(/atendimento humano/);
    expect(text).toMatch(/conversa|histórico/);
    expect(text).not.toMatch(/^(certo|claro|entendi)/i);
  });

  it('não expõe nomes internos de falha ao cliente', () => {
    const text = handoffMessage('falha_no_provedor_llm', 'conv2');
    expect(text).not.toMatch(/llm|provedor|erro interno|ixc/i);
    expect(text).toMatch(/informação|instabilidade|instável/);
    expect(text).not.toMatch(/responsável|retorno/);
  });

  it('não usa termos mecânicos nem hierarquia desnecessária', () => {
    const outputs = Array.from({ length: 20 }, (_, i) => handoffMessage('contexto_insuficiente', `conv${i}`));
    for (const text of outputs) {
      expect(text).not.toMatch(/transferir|escalar|ticket|protocolo interno|meu superior/i);
      expect(text).toMatch(/revisão|registrad|informação segura/);
    }
  });

  it('é variável entre conversas, mas estável na mesma conversa', () => {
    const first = handoffMessage('contexto_insuficiente', 'convA');
    expect(handoffMessage('contexto_insuficiente', 'convA')).toBe(first);
    const outputs = new Set(Array.from({ length: 20 }, (_, i) => handoffMessage('contexto_insuficiente', `conv${i}`)));
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('mantém os avisos automáticos curtos nos três setores sem omitir a pendência', () => {
    const reasons = [
      'verificacao_regional_nao_executada', 'verificacao_regional_indisponivel',
      'servico_atual_nao_confirmado', 'confirmacao_titular_indisponivel',
      'confirmacao_titular_financeiro_indisponivel', 'ocorrencia_regional_confirmada_pendente_registro',
      'cadastro_sem_conexao_ativa', 'avaliacao_tecnica_residencial',
      'avaliacao_tecnica_dispositivo', 'avaliacao_tecnica_dispositivo_regiao_inconclusiva',
      'avaliacao_tecnica_multiplos_dispositivos', 'avaliacao_tecnica_multiplos_dispositivos_regiao_inconclusiva',
      'avaliacao_tecnica_sinal_restabelecido', 'avaliacao_tecnica_sinal_restabelecido_regiao_inconclusiva',
      'avaliacao_tecnica_regiao_inconclusiva', 'pedido_de_atendimento_humano',
      'commercial_approval_required', 'falha_no_provedor_llm', 'contexto_insuficiente',
    ];
    for (const reason of reasons) {
      const message = handoffMessage(reason, 'conv1');
      expect(message.length, reason).toBeLessThanOrEqual(160);
      expect(message).not.toMatch(/\*\*|^\d+[.)]\s/u);
    }
  });
});
