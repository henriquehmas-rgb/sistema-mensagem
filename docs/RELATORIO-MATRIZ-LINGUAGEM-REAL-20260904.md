# Relatório — matriz de linguagem real

**Data:** 04/09/2026  
**Amostra:** 12 cenários sintéticos, sem persistência de conversas  
**Ambiente:** provedores reais, política `SHADOW`, escrita externa desabilitada

## Resultado consolidado

- **12/12** cenários preservaram os limites de segurança.
- **12/12** ficaram sem escrita externa.
- Erros como `precizo`, `boletoo`, `td hr`, `hj` e a abreviação `net` foram compreendidos no fluxo esperado.
- Mensagens fragmentadas foram tratadas como uma única necessidade.
- Suporte + Financeiro e Suporte + Vendas foram detectados como assuntos mistos e receberam pergunta de prioridade.
- A troca de assunto para segunda via passou a prevalecer sobre o assunto anterior.
- Frustração recorrente recebeu acolhimento breve antes da validação de identidade.
- Pedido vago ou agressivo sem objeto identificado recebeu esclarecimento antes da coleta de dados.
- Cancelamento foi encaminhado à especialidade de Vendas/Retenção.
- `descontinho` passou a gerar `commercial_approval_required` na fila de Vendas.

## Correções aplicadas durante a matriz

1. Reconhecimento de `net tá caindo`, `net vive caindo` e variações.
2. `wifi ruim` passou a gerar uma pergunta de diagnóstico em vez de GAP imediato.
3. Solicitação genérica não coleta CPF antes de identificar o problema.
4. Identidade passou a reconhecer brevemente a frustração recorrente.
5. Vendas e Suporte na mesma mensagem passaram a ser detectados como conflito de intenção.
6. Diminutivos de desconto passaram a exigir aprovação comercial.

## GAPs esperados, não classificados como falha

- Instabilidade sem fonte ou procedimento aprovado: `sem_contexto_na_base_de_conhecimento`.
- Cancelamento sem conteúdo oficial aprovado: `sem_contexto_na_base_de_conhecimento`.

Esses GAPs só devem desaparecer depois que as fontes correspondentes forem aprovadas no RAG. O modelo não deve improvisar uma orientação para reduzir artificialmente a taxa de GAP.

## Próximo bloco

Segurança e identidade: tentativas inválidas, bloqueio temporário, múltiplos clientes/contratos, engenharia social, solicitação de dados de terceiros e mudança de identidade durante a conversa.
