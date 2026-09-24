# Critérios de liberação operacional

O painel `GET /dashboard/metrics` calcula uma recomendação em leitura para
Suporte (`technical_support`), Financeiro (`billing`) e Vendas (`sales`). A
recomendação não habilita escrita no IXC, não envia campanhas e não altera o
encaminhamento de uma conversa.

## Janela e amostra

Os indicadores usam os últimos 30 dias e exigem pelo menos 30 conversas por
setor. Antes dessa amostra, o setor permanece em `SHADOW_ONLY`: há dados para
avaliar, mas não há base estatística para concluir que está pronto.

O parecer também declara a origem da evidência. `WEBCHAT_SHADOW` prova a
integridade estrutural e a qualidade do fluxo em testes/homologação, mas não é
apresentado como validação de operação externa. `EXTERNAL_PILOT` só aparece
quando a janela contém ao menos uma conversa recebida de WhatsApp ou Instagram.
Essa distinção não altera a nota do setor nem habilita entrega: evita que a
amostra de Webchat seja confundida com produção real.

## Estados possíveis

| Estado | Condição | Conduta |
| --- | --- | --- |
| `CONTROLLED_USE` | Amostra suficiente, triagem até 5% (por conversa única com conflito **ou** baixa confiança), confirmações repetidas até 10%, sem GAP factual pendente e sem proposta sombra pendente | Uso assistido, com escrita operacional ainda bloqueada e acompanhamento diário. |
| `SHADOW_ONLY` | Amostra insuficiente ou pendência factual/operacional em sombra | Continuar homologação e curadoria; não declarar uso controlado. |
| `HOLD` | Com amostra suficiente, triagem acima de 5% ou confirmações repetidas acima de 10% | Corrigir regressão, rodar matriz multissetor e só então retomar a homologação. |

Para essa régua, “atenção de triagem” significa conflito explícito ou baixa
confiança acompanhada de rota/intenção alternativa. Uma classificação cautelosa
que ainda aponta apenas para o mesmo setor fica visível como alerta de auditoria,
mas não é contada como erro de roteamento nem como GAP de conhecimento.

## O que não bloqueia indevidamente

Incidente de IXC, identidade, rede, credencial ou provedor de IA aparece como
alerta técnico. Ele não abre candidato de aprendizagem, não é contado como GAP
factual e não muda o setor para `HOLD` por si só. O painel também trata baixa
rastreabilidade como alerta de auditoria: saudações e despedidas podem ser
corretas sem fonte, por isso a leitura factual continua sendo amostral.

## Evidência e decisão humana

O responsável libera ou mantém um setor em sombra com base no painel, na matriz
de regressão e na amostra das conversas. A recomendação é explicável pelos
campos `blockers`, `advisories` e `nextAction`; não existe autoativação de
escrita, nem publicação automática de conteúdo factual.
