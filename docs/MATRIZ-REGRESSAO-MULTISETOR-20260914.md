# Matriz de regressão multissetorial

**Objetivo:** impedir que uma alteração em Suporte, Financeiro, Vendas, RAG,
identidade ou integrações reintroduza falhas já corrigidas.

## Portão obrigatório de release

| Caso | Garantia que não pode regredir |
|---|---|
| LOS vermelha → LOS apagada → lentidão | A conversa preserva o estado mais recente; não retorna para perda óptica nem repete a pergunta anterior. |
| Diagnóstico técnico inicial | Identidade fica adiada até a primeira consulta individual. |
| Regra financeira geral | Não consulta IXC nem solicita CPF/mês. |
| Fatura, pagamento ou segunda via próprios | Identidade I2 é exigida antes de consulta individual. |
| Financeiro → Vendas | Pergunta nova sobre planos não herda faturas, contrato nem desafio de identidade. |
| Falha de IXC, validação ou provedor | Vira incidente técnico, jamais candidato de aprendizagem. |
| Ausência real de conhecimento aprovado | É o único caso que pode gerar candidato de RAG. |
| Evento coletivo ou evidência inconclusiva | Bloqueia proposta individual de chamado/OS. |
| Duplicidade, contrato ambíguo ou baixa confiança | Mantém modo sombra e revisão; nunca executa escrita. |
| Mensagens via REST, socket e polling | A interface ordena por `createdAt` e `id`, sem inverter cliente e assistente. |

## Execução

- Suíte consolidada: `apps/api/src/regression/multisector-regression.spec.ts`.
- Smoke portátil do núcleo: `node tools/core-regression-smoke.cjs`. Ele não
  substitui a suíte Vitest; cobre as regras determinísticas quando o sandbox
  local não permite inicializá-la.
- Executar antes de qualquer publicação junto às demais suítes de API e Web.
- O resultado precisa ser anexado ao registro da release; qualquer falha bloqueia a publicação até correção ou rollback.
