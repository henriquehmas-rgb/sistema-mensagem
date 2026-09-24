# Plano de maturidade operacional — Omni

**Registrado em:** 14/09/2026  
**Objetivo:** levar Suporte, Financeiro e Vendas a uso controlado forte, com o menor número possível de falsos GAPs e sem liberar escrita externa antes da homologação.

## Estado de partida

- Infraestrutura, API, IA, banco, Redis e Webchat saudáveis.
- Skills ativas: Suporte 5, Financeiro 5 e Vendas 4.
- RAG: 23 fontes prontas e 76 chunks recuperáveis.
- Memória persistente disponível para 75 contatos.
- Consultas IXC de Financeiro, Vendas e transição entre ambos homologadas em conversas sintéticas encerradas.
- GAPs pendentes para revisão: 14 (1 geral, 6 Financeiro, 7 Vendas).
- Follow-up operacional ainda não configurado: há somente uma skill de consentimento em Vendas; não existem sequências, automações ativas, templates aprovados ou canais externos ativos.
- Escrita no IXC permanece bloqueada.

## Ordem aprovada de evolução

1. **Curar os 14 GAPs pendentes.** Classificar cada um como conhecimento real, incidente técnico, baixa confiança ou exceção operacional. Apenas conhecimento real pode virar candidato de RAG.
2. **Ampliar o RAG factual.** Criar conteúdo curto, aprovado, versionado e com validade para Financeiro e Vendas. OPA serve apenas para linguagem e cenários de teste; IXC, Olho de Deus e responsáveis são fontes factuais.
3. **Consolidar o contrato conversacional.** Regressão para identidade, ordem das mensagens, contexto, idempotência, mudança de setor e indisponibilidade de integração.
4. **Construir follow-up operacional.** Plano e tentativas por conversa, consentimento, canal, horário, responsável, template aprovado, opt-out, condição de parada e auditoria.
5. **Homologar por setor.** Casos simples, ambíguos, indisponibilidade, retomada, transição de setor e handoff humano.
6. **Conectar canais reais gradualmente.** Primeiro piloto restrito; WhatsApp e Instagram somente após CRM, templates e follow-up aprovados.

## Regra de qualidade

O alvo não é eliminar GAPs legítimos. É impedir que falhas de integração, identidade ou provedor virem GAP de aprendizagem e reduzir falsos encaminhamentos. Ações financeiras, comerciais sensíveis e qualquer escrita externa continuam sob revisão humana.

## Execução registrada — 14/09/2026

- Inventário inicial: 14 GAPs pendentes, todos com a classificação histórica de baixa confiança automática.
- Regressões sintéticas aprovadas para planos, cobertura, fatura e pagamento. As consultas individuais de fatura e pagamento completaram leitura IXC; os cenários comerciais permaneceram em Vendas.
- Corrigida e publicada a triagem da pergunta de cobertura em linguagem natural: “Vocês atendem no meu endereço?” agora segue para Vendas.
- Encerrados com auditoria 13 falsos GAPs históricos revalidados: 6 de planos, 1 de cobertura, 5 de fatura e 1 de pagamento.
- O último GAP de Financeiro, oriundo de conversa real, foi analisado por metadados de auditoria. Ele havia sido aberto antes da identidade, mas a mesma conversa validou a identidade e concluiu a leitura IXC com sucesso. Foi encerrado como falso GAP histórico, com justificativa e auditoria.
- Fila final de GAPs pendentes: **0**.

## Expansão e isolamento do RAG setorial — 14/09/2026

- Inventário confirmado: 23 fontes prontas e 76 trechos recuperáveis. Financeiro possui cinco artigos factuais aprovados; Vendas possui cinco, além de um catálogo factual do IXC. Os protocolos de cada setor continuam indexados separadamente.
- A avaliação inicial mostrou uma falha concreta de recuperação: os 18 trechos do catálogo comercial podiam preencher a janela de candidatos e ocultar o artigo específico de cobertura.
- A busca agora limita os candidatos, antes do reranqueamento, a `global + setor em rota`. Também ampliou a janela de candidatos para preservar diversidade quando uma fonte é fragmentada. A filtragem posterior foi mantida como defesa em profundidade.
- Regressões locais aprovadas: 53 testes de recuperação, triagem, matriz de skills e conversa setorial.
- Avaliação no runtime após publicação: 10 de 10 cenários recuperaram o artigo esperado (100%). Nenhum dado dinâmico de preço, cobertura individual, cobrança ou condição comercial foi convertido em conteúdo estático; esses dados continuam dependentes de IXC e das regras de identidade.

## Contrato conversacional: ordenação visual — 14/09/2026

- Identificada uma condição de corrida visual no Webchat: o histórico REST era ordenado, mas mensagens vindas de socket e do polling podiam ser apenas acrescentadas ao fim. Em reconexões, isso poderia inverter a apresentação de uma fala já existente.
- O widget agora normaliza toda inserção e reconciliação por `createdAt` e `id`, exatamente na mesma ordem canônica das APIs. A persistência e o dedupe por mensagem permanecem inalterados.
- Publicação isolada do Web concluída com backup. O build de produção do Next compilou e validou tipos com sucesso; a rota pública do widget respondeu HTTP 200 após a recriação.

## Homologação sintética multissetorial — 14/09/2026

- Executada em processo descartável, separado da IA em atendimento, para não herdar conexões ou estado do runtime.
- Resultado: 29 regressões aprovadas. A matriz cobre identidade antes de consulta individual, continuidade após validação, consulta pública sem coleta excessiva, mudança explícita entre Suporte, Financeiro e Vendas, prioridade da intenção mais recente, recusa de condição comercial especial e pedido livre de atendimento humano.
- A idempotência de entrada e de resposta continua aplicada no pipeline de API por mensagem gatilho e por coalescência da última mensagem; não foi criado atendimento, contato, GAP nem escrita no IXC durante esta homologação.

## Follow-up operacional — integração da base existente, em validação

- A VPS já continha uma implementação de sequência consentida que não estava sincronizada neste checkout. Ela foi recuperada e será usada como base, sem substituí-la por uma estrutura paralela.
- A sequência é uma por conversa e preserva o mesmo contato/canal do CRM. Atua nos três setores, nunca redistribui a conversa, tem quatro marcos (1, 3, 7 e 14 dias) e só é criada após autorização inequívoca do cliente.
- A etapa vencida apenas entra em `READY_FOR_REVIEW`; não há mensagem automática, template, chamada de provedor nem mudança no canal externo. Resposta do cliente pausa a sequência, opt-out cancela e uma conversa assumida por humano não segue automaticamente.
- O avanço só ocorre após o sistema confirmar que uma mensagem humana da própria conversa foi enviada. Assim, o CRM deixa de depender de “contato realizado” manual.
- A validação técnica desta integração continua pendente. Templates aprovados, canais reais e um piloto de entrega permanecem bloqueados para a etapa 6.
