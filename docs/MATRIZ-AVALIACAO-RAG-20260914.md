# Matriz de avaliação factual do RAG

## Finalidade

Portão técnico de leitura para verificar, após cada ingestão ou antes de uma
publicação, se o RAG recupera conteúdo aprovado, atual e do setor correto.
Ele não mede a qualidade literária da resposta do modelo e não autoriza ações
externas.

## Casos de consolidação

| Setor | Cenário | Critério |
|---|---|---|
| Suporte | 10 cenários: LOS, lentidão, LOS apagada, Wi-Fi, teste sem cabo, instabilidade, chamado/OS, aplicativo, telefonia e recorrência | fonte aprovada de Suporte/global, atual |
| Financeiro | 10 cenários: segunda via, compensação, regra pública, juros, pagamento, estorno, cancelamento, identidade e condição especial | fonte aprovada de Financeiro/global, atual |
| Vendas | 10 cenários: planos, cobertura, perfil, empresa, endereço, proposta, condição especial, retenção, follow-up e promessa de cobertura | fonte aprovada de Vendas/global, atual |

Cada um dos 30 casos exige ao menos um trecho aprovado com score de recuperação igual ou
superior a `0,35` e duas fontes distintas na janela. O valor é deliberadamente
compatível com o piso governado de `0,25` usado para políticas públicas; não
altera o limite superior exigido para ações, dados individuais, preço ou
promessa de cobertura.

## Execução

No contêiner `ai`, com o identificador interno da organização:

```sh
cd /app
python -m src.rag_evaluation --org-id <org-id>
```

O processo é somente leitura. Se qualquer caso falhar, a fonte nova não deve
ser promovida: primeiro revisar metadados de setor, aprovação, validade,
conteúdo e skill autorizada. O resultado deve ser anexado ao registro de
publicação e repetido na Fase 8, junto dos demais testes de release.

O script `infra/homologation-automated.sh` executa essa matriz para todas as
organizações existentes como parte da homologação de release. Ele registra
somente aprovado/falhou; não imprime trechos nem identificadores do RAG.

## Critérios de qualidade para uso controlado

Os indicadores abaixo não liberam escrita externa. Eles definem quando RAG e
decisão estão consistentes o bastante para aumentar o volume de atendimentos
controlados:

| Indicador | Fonte | Limite inicial |
| --- | --- | --- |
| Avaliação factual por cenário | `rag_evaluation` | 30 de 30 aprovados; uma falha bloqueia a promoção da fonte. |
| Rastro de respostas factuais | `aiRepliesWithTrace` / `aiRepliesWithoutTrace` | 100% na matriz; no piloto, revisar toda resposta factual sem rastro. Saudações e despedidas não entram no denominador. |
| GAP real | `KnowledgeGap` e auditoria | Somente `sem_contexto_na_base_de_conhecimento` ou `contexto_insuficiente` podem gerar candidato. |
| Incidente técnico | `ai.handoff.classified` | 0 incidente classificado como GAP; IXC, Olho de Deus, identidade e provedor ficam fora da aprendizagem. |
| Pergunta repetida | `conversationsWithRepeatedClarification` | Até 10% da amostra controlada; acima disso, interromper expansão e revisar estado/skill. |
| Conflito de triagem | `triageConflicts` | Até 5% da amostra controlada; acima disso, revisar roteamento antes de ampliar canais. |

Os limites percentuais só são avaliados após pelo menos 30 conversas de
homologação por setor. Antes disso, servem como alerta qualitativo, não como
estatística de produção.
