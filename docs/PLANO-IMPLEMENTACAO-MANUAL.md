# Plano de implementação manual do SEEG Omni

**Estado:** pronto para execução controlada  
**Escopo:** atividades que exigem autoridade humana, credenciais, conteúdo oficial, acesso externo, homologação ou mudança do ambiente real  
**Referência detalhada:** `PENDENCIAS-MANUAIS-OMNI.md`

## Objetivo

Levar a arquitetura já implementada até um piloto real e seguro de Suporte, preservando Sonnet como modelo conversacional principal, Luna como auxiliar seletivo, IXC em leitura, ações externas em modo sombra e humanos apenas como orientação interna para GAPs.

## Regras de execução

- Nenhuma fase avança sem evidência e aceite do seu critério de saída.
- Credenciais temporárias não podem chegar à homologação externa.
- Mudança na VPS exige backup, janela definida e plano de retorno.
- Conteúdo sem fonte, responsável e validade não entra no RAG nem ativa skill.
- Escrita no IXC ou no Olho de Deus permanece bloqueada nesta primeira fase.
- Suporte é o primeiro piloto; Financeiro e Vendas só avançam depois do aceite anterior.
- Incidente de segurança, vazamento, escrita indevida ou resposta comercial não autorizada interrompe o piloto.

## Fase 0 — Designar responsáveis e abrir o registro

**Prioridade:** imediata  
**Responsáveis:** dono do produto e líder técnico

1. Nomear o administrador da VPS.
2. Nomear o gestor das contas Anthropic e OpenAI.
3. Configurar papéis/filas responsáveis por Suporte, Financeiro e Vendas; vincular pessoas autorizadas antes do piloto de cada setor, sem gravar nomes nas skills.
4. Nomear responsáveis por segurança/privacidade, conteúdo/RAG e Meta/WhatsApp.
5. Definir quem concede o aceite de cada fase.
6. Abrir o registro de execução com responsável, data, ambiente, evidência, resultado e risco residual.

**Saída obrigatória:** nenhum item manual permanece sem dono e aprovador identificados.

## Fase 1 — Segurança, credenciais e limites financeiros

**Prioridade:** crítica  
**Responsáveis:** gestor das contas de IA, líder técnico e segurança

1. Criar chaves exclusivas do Omni para Anthropic e OpenAI.
2. Definir orçamento mensal e alertas em 50%, 75%, 90% e 100%.
3. Preparar as variáveis finais sem expor segredos em chat, documentação ou terminal compartilhado.
4. Revogar as chaves temporárias anteriormente compartilhadas.
5. Confirmar nos painéis dos fornecedores que as chaves antigas não funcionam mais.
6. Definir responsável por incidente, indisponibilidade e estouro de orçamento.

**Saída obrigatória:** chaves exclusivas, antigas revogadas, orçamento e alertas ativos.

## Fase 2 — Governança operacional e conteúdo oficial

**Prioridade:** alta  
**Execução:** pode ocorrer em paralelo com a preparação técnica da Fase 3  
**Responsáveis:** dono do produto, liderança operacional e donos de conteúdo

1. Aprovar o playbook global: visão, tom de voz, privacidade, encerramento, proibições e promessas vedadas.
2. Confirmar Suporte, Financeiro e Vendas como setores oficiais.
3. Definir papéis responsáveis, cobertura mínima, SLA e escalonamento dos GAPs por setor.
4. Definir quem aprova conteúdo e quem aprova ação operacional.
5. Revisar as quatro skills iniciais de Suporte, sem ativá-las ainda.
6. Inventariar fontes oficiais do RAG e atribuir origem, autoridade, responsável e validade.
7. Manter o histórico do OPA fora do runtime; preparar exportação e anonimização apenas com autorização.

**Saída obrigatória:** playbook aprovado, matriz de responsabilidades e primeiro conjunto de fontes/skills revisado.

## Fase 3 — Implantação técnica controlada na VPS

**Prioridade:** alta  
**Responsável:** administrador da VPS, acompanhado pelo líder técnico

### Preparação

1. Release canônica, hash, backups e procedimento de retorno concluídos.
2. Confirmar participantes e janela do primeiro teste funcional.

### Ativação

1. Rotacionar as chaves temporárias compartilhadas.
2. Configurar Sonnet como principal, Luna como auxiliar seletivo e OpenAI para embeddings.
3. Manter revisor e fallback conversacional automático desativados.
4. Reiniciar os serviços de maneira coordenada.

### Validação

1. Verificar API, Web, IA, PostgreSQL e Redis.
2. Confirmar que o provedor não está mais em `mock`.
3. Fazer teste interno sem cliente real.
4. Confirmar logs sem segredo e sem falha crítica.
5. Executar retorno imediatamente se migração, healthcheck ou autenticação dos provedores falhar.

**Saída obrigatória:** ambiente saudável, backups registrados, IA real respondendo internamente e nenhuma exposição externa.

## Fase 4 — Preparar conhecimento, skills e integrações em leitura

**Prioridade:** alta  
**Responsáveis:** responsáveis de Suporte, conteúdo/RAG e integrações

1. Publicar somente diretrizes globais aprovadas.
2. Reprocessar fontes aprovadas com embeddings reais.
3. Testar recuperação, conflitos, validade e ausência de resposta quando não houver fonte.
4. Passar skills de Suporte por `IN_REVIEW` e `APPROVED`; ativar apenas as completas.
5. Validar consultas de leitura do IXC com cliente e contrato autorizados.
6. Documentar permissões, campos, timeouts, identidade e deduplicação do IXC.
7. Documentar o contrato do Olho de Deus, sem liberar gatilhos de escrita.
8. Preparar o histórico autorizado do OPA offline; nenhum conteúdo entra no RAG sem revisão.
9. Somente após acesso e auditoria do Olho de Deus, avaliar um gateway MCP interno com ferramentas inicialmente de leitura, contratos fechados e autorização controlada pelo Omni.

**Saída obrigatória:** RAG rastreável, skills de Suporte aprovadas e integrações operando somente em leitura/sombra.

Fine-tuning permanece fora desta implantação. Sua reavaliação só ocorre depois do piloto, com dataset supervisionado, avaliações comparáveis e confirmação de um modelo compatível; ele nunca substituirá RAG, protocolos, memória ou autorização.

## Fase 5 — Homologação fechada

**Prioridade:** crítica antes de qualquer piloto  
**Responsáveis:** segurança, produto, Suporte e usuários-piloto

1. Selecionar contas e clientes explicitamente autorizados.
2. Homologar identidade pelos três últimos dígitos do CPF.
3. Testar cinco falhas, bloqueio temporário e retomada.
4. Testar proteção de faturas, contratos, chamados e memória.
5. Testar manipulação de prompt, mensagens fragmentadas, erros de escrita e múltiplas intenções.
6. Testar GAP: criação, popup, isolamento por setor, resposta responsável e retomada pela IA.
7. Testar indisponibilidade de Luna, Sonnet, RAG, IXC e Redis com comportamento seguro.
8. Testar propostas, descontos e condições especiais, confirmando consulta humana obrigatória.
9. Avaliar naturalidade, fidelidade factual, perguntas uma a uma, resumos e encerramentos.
10. Corrigir por versão e repetir os cenários reprovados.

**Critérios mínimos sugeridos:**

- 100% dos testes críticos de identidade e dados protegidos aprovados.
- Zero escrita externa ou condição comercial não autorizada.
- 100% dos GAPs entregues somente ao setor ou papel autorizado.
- Zero resposta factual inventada nos casos sem fonte.
- Qualidade conversacional aceita formalmente pela liderança de atendimento.

**Saída obrigatória:** relatório assinado de homologação e autorização explícita para piloto restrito.

## Fase 6 — Canal controlado e piloto de Suporte

**Prioridade:** após homologação  
**Responsáveis:** administrador Meta, Suporte, produto e líder técnico

1. Configurar webhook, assinatura, System User, `phone_number_id` e WABA com segredos protegidos.
2. Validar recebimento, entrega, leitura e resposta em canal controlado.
3. Liberar somente clientes autorizados e assuntos de Suporte.
4. Manter IXC em leitura e ações externas em sombra.
5. Acompanhar diariamente qualidade, custo, cache, latência, abandono, GAP e indisponibilidade.
6. Revisar conversas e registrar correções apenas como candidatos supervisionados.
7. Definir reunião diária curta durante a primeira semana do piloto.

**Critério de interrupção imediata:** incidente de segurança, acesso cruzado entre setores, escrita externa, vazamento, resposta comercial indevida ou repetição relevante de alucinação.

**Saída obrigatória:** aceite do piloto de Suporte e decisão documentada de continuar, corrigir ou retornar.

## Fase 7 — Expansão e escrita futura

**Prioridade:** posterior  
**Responsáveis:** dono do produto, líder técnico e responsáveis dos setores

1. Expandir para Financeiro somente após estabilidade do Suporte.
2. Expandir para Vendas por último, com revisão comercial reforçada.
3. Liberar criação de chamado apenas após contrato IXC aprovado e teste de idempotência; o Olho de Deus permanece como evidência somente leitura.
4. Liberar OS apenas para situações simples, fechadas e formalmente autorizadas.
5. Manter descontos, propostas e exceções comerciais sob aprovação humana.
6. Registrar aceite separado para cada setor e capacidade de escrita.

**Saída obrigatória:** cada expansão possui aceite, métricas, plano de retorno e escopo claramente limitado.

## Ordem prática resumida

1. Responsáveis e aprovadores.
2. Rotação das chaves e orçamento.
3. Playbook, setores, GAPs, fontes e skills.
4. Ativação interna da release na VPS.
5. RAG real e IXC somente leitura.
6. Homologação fechada de segurança e naturalidade.
7. Canal controlado e piloto de Suporte.
8. Financeiro, Vendas e escrita somente em fases posteriores.

## Primeiro bloco de trabalho

Para iniciar sem risco de produção, coletar primeiro:

- nome do administrador da VPS;
- contas autorizadas vinculadas aos papéis setoriais no momento de cada piloto;
- gestor das contas Anthropic/OpenAI;
- aprovador do playbook e da homologação;
- orçamento mensal inicial da IA;
- janela desejada para ativação interna;
- contas/clientes que poderão participar da homologação fechada.

Com essas informações, as Fases 0 e 1 podem ser encerradas e a Fase 2 pode começar em paralelo à preparação técnica da Fase 3.
