# Pendências manuais do SEEG Omni

Este documento é a referência permanente para tudo que depende de credencial, autoridade humana, conteúdo oficial, acesso externo ou homologação. Os itens devem ser concluídos individualmente e registrados com responsável, data e evidência.

## Estado atual

- Preparação técnica automatizável estimada: **90–95% concluída**. Isso não equivale a serviço homologado.
- Release `omni-release-20260903-budget-alerts.tar.gz` publicada em 03/09/2026, SHA-256 `A615DFB4CFD0E61080F8943BAA9E69B92BAF5F0C01E3010AB7975492873BF357`.
- Ambiente público atualizado e validado com 10/10 verificações automatizadas; política operacional permanece `SHADOW`, escrita externa desabilitada e mapeamentos IXC em `DRAFT`.
- Provedores reais ativos na VPS: Anthropic/Sonnet principal, OpenAI/Luna auxiliar e OpenAI para embeddings.
- As 23 migrações presentes estão aplicadas; a mais recente é `000000000021_add_ai_budget_monitoring`.
- O executor físico de escrita IXC está bloqueado antes do transporte. Prova ao vivo: `transportCalls=0` e `externalWritePerformed=false` em `SHADOW`.
- Três skills de Suporte existem em `DRAFT`: abertura de chamado de conectividade, OS de fibra/LOS e OS de correção de sinal.
- O painel de aprovação exibe mapeamento, versão, ocorrência e estratégia de duplicidade para revisão humana.
- O pipeline offline do OPA e os testes de naturalidade/resiliência estão prontos; nenhum histórico foi importado sem autorização.

## Caminho crítico para validar o serviço

Esta é a fila mínima. As seções posteriores preservam o checklist completo e as evidências exigidas.

1. Rotacionar as chaves temporárias expostas e configurar o provedor real de IA com orçamento e alertas.
2. Aprovar o playbook, os protocolos e a skill `support-connectivity-ticket`; manter as skills de OS inativas.
3. Aprovar os mapeamentos IXC e executar a primeira conversa controlada de Suporte, com identidade e ocorrência verificadas.
4. Importar uma amostra autorizada e anonimizada do OPA pelo pipeline offline; revisar antes de publicar qualquer conteúdo no RAG.
5. Homologar identidade, segurança, naturalidade, GAP e painel de aprovação com cenários positivos e negativos.
6. Conectar o canal piloto e operar em `SHADOW`, medindo qualidade, custo, latência, GAP e abandono.
7. Somente após aceite humano, liberar uma ação IXC em `REVIEW_REQUIRED`; nunca ativar escrita externa em lote.

## Ordem de execução

### 1. Implantação técnica da release

- [x] Release implantada com acesso administrativo autorizado.

- [x] Backup do código criado antes da release de 02/09/2026.
- [x] Backup do PostgreSQL criado antes da release de 02/09/2026.
- [x] Migrações confirmadas como atualizadas pela homologação automatizada.
- [x] Contêineres API, Web, IA, PostgreSQL e Redis confirmados saudáveis.
- [x] Backups registrados em `/home/sm-colab/releases/pre-shadow-readiness-20260903T014247Z-source.tar.gz` e `/home/sm-colab/releases/pre-shadow-readiness-20260903T014247Z-postgres.sql.gz`.

**Responsável esperado:** administrador da VPS.  
**Concluído quando:** healthcheck público estiver `ok`, contêineres saudáveis e logs sem falha crítica.

### 2. Escolher e configurar o provedor de IA

- [x] Definir Anthropic como fornecedor conversacional principal e OpenAI como fornecedor auxiliar/embeddings.
- [x] Definir `claude-sonnet-5` como modelo principal e `gpt-5.6-luna` como auxiliar.
- [x] Manter revisor separado desativado nesta primeira ativação; segurança permanece determinística e humana nas ações sensíveis.
- [x] Manter fallback conversacional automático desativado inicialmente; indisponibilidade gera tratamento seguro, sem trocar a voz do atendimento silenciosamente.
- [ ] Criar chave exclusiva para o Omni.
- [x] Orçamento mensal inicial definido em **R$ 2.500,00**.
- [x] Definir faixas de atenção: 50% (R$ 1.250), 75% (R$ 1.875), 90% (R$ 2.250) e 100% (R$ 2.500).
- [x] Definir Matheus de Arruda Silva, líder técnico, como destinatário inicial dos alertas.
- [x] Definir que R$ 2.500 é teto de atenção e investigação, sem interrupção automática do atendimento.
- [x] Definir o painel administrativo do Omni como canal inicial dos alertas.
- [x] Implementar e homologar o alerta persistente de orçamento no painel administrativo.
- [x] Persistir consumo mensal de Sonnet, Luna e embeddings, sobrevivendo a reinícios.
- [x] Garantir idempotência: cada faixa gera no máximo um alerta por organização e mês.
- [x] Confirmar por teste que reconhecer o alerta funciona e que atingir o teto nunca bloqueia atendimento.
- [ ] Conferir mensalmente a estimativa do Omni com as faturas dos provedores; divergências exigem revisão das tarifas e do câmbio configurados.
- [ ] **Melhoria futura:** configurar serviço externo de e-mail e enviar os alertas também por e-mail como canal redundante.
- [x] Inserir as chaves temporárias da OpenAI e da Anthropic exclusivamente no `.env` protegido da VPS; concluído em 2026-08-29, com autenticação aceita pelos dois provedores e backups remotos antes de cada alteração.
- [ ] Revogar e substituir obrigatoriamente as duas chaves temporárias antes da homologação externa ou produção, pois foram compartilhadas durante a preparação do ambiente de testes.
- [ ] Confirmar após a rotação que as chaves antigas foram revogadas nos painéis dos provedores e que os serviços foram reiniciados com os novos valores.
- [x] Configuração de provedores preenchida na VPS:

```env
AI_PROVIDER=
AI_PRIMARY_PROVIDER=
AI_REVIEW_PROVIDER=
AI_FALLBACK_PROVIDER=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
```

- [x] Configuração técnica aplicada:

```env
AI_PROVIDER=anthropic
AI_PRIMARY_PROVIDER=anthropic
AI_AUXILIARY_PROVIDER=openai
AI_REVIEW_PROVIDER=
AI_FALLBACK_PROVIDER=
OPENAI_CHAT_MODEL=gpt-5.6-luna
ANTHROPIC_CHAT_MODEL=claude-sonnet-5
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_REASONING_EFFORT=low
OPENAI_MAX_OUTPUT_TOKENS=512
ANTHROPIC_MAX_OUTPUT_TOKENS=1024
ANTHROPIC_PROMPT_CACHE_ENABLED=true
ANTHROPIC_PROMPT_CACHE_TTL=5m
```

- [x] Serviço de IA reiniciado de maneira coordenada.
- [x] Healthcheck confirmou `production_ready=true`, Sonnet principal, Luna auxiliar e embedding OpenAI de 1.536 dimensões.
- [x] Homologação automatizada pós-ativação concluída com 10/10 verificações.

**Responsável esperado:** líder técnico/gestor da conta de IA.  
**Concluído quando:** resposta real funcionar sem `mock`, com custo e limite registrados.

### 3. Definir o playbook global da SEEG

- [ ] Registrar visão, missão e valores aplicáveis ao atendimento.
- [ ] Registrar tom de voz da marca.
- [ ] Definir princípios obrigatórios de atendimento.
- [ ] Definir comportamentos proibidos.
- [ ] Definir regras de privacidade e exposição de dados.
- [ ] Definir regras de encerramento e agradecimento.
- [ ] Definir o que nunca pode ser prometido.
- [ ] Informar responsável, prioridade e validade de cada diretriz.
- [x] Playbook global v2 revisado e ativado no painel em 03/09/2026.

**Responsável esperado:** dono do produto/liderança da SEEG.  
**Concluído quando:** todas as diretrizes essenciais estiverem `ACTIVE` e possuírem responsável.

### 4. Validar os setores e responsáveis

- [ ] Confirmar os setores: Suporte, Financeiro e Vendas.
- [ ] Configurar um papel/fila responsável por cada setor, sem vincular protocolos a nomes fixos.
- [ ] Antes do piloto de um setor, vincular ao menos uma conta ativa ao papel correspondente e definir uma rota de contingência para ausência de resposta.
- [ ] Vincular cada AGENT autorizado ao setor correto; ADMIN/SUPERVISOR mantêm visão global dos GAPs.
- [ ] Definir quem pode aprovar conteúdo.
- [ ] Definir quem pode aprovar ação operacional.
- [ ] Definir SLA de resposta conforme complexidade.
- [ ] Definir escalonamento quando o responsável não responder.

**Responsável esperado:** liderança operacional.  
**Concluído quando:** todo GAP possuir destino, responsável e prazo definidos.

### 5. Revisar e ativar as skills iniciais de suporte

Para as três skills já criadas em `DRAFT` — chamado de conectividade, OS de fibra/LOS e OS de correção de sinal:

- [ ] Nomear um responsável.
- [ ] Vincular fontes oficiais permitidas.
- [ ] Revisar gatilhos e dados obrigatórios.
- [ ] Revisar o procedimento etapa por etapa.
- [ ] Confirmar ações permitidas e proibidas.
- [ ] Confirmar critérios de conclusão.
- [ ] Confirmar quando é obrigatória a revisão humana.
- [ ] Confirmar quando deve gerar GAP.
- [ ] Confirmar exigência de identidade.
- [ ] Informar validade.
- [ ] Passar por `IN_REVIEW`, `APPROVED` e somente então `ACTIVE`.
- [x] Ativada somente `support-connectivity-ticket` em política `SHADOW`; as duas skills de OS permanecem em `DRAFT` até a homologação do contrato de escrita IXC.

**Responsável esperado:** responsável técnico pelo Suporte.  
**Concluído quando:** cada skill ativa possuir fonte, responsável, validade e procedimento aprovado.

### 6. Governar as fontes do RAG

Para cada documento ou fonte:

- [ ] Confirmar origem oficial.
- [ ] Informar responsável editorial.
- [ ] Definir autoridade de 0 a 100.
- [ ] Definir validade ou periodicidade de revisão.
- [ ] Remover conteúdo duplicado ou contraditório.
- [ ] Confirmar que preços, prazos e políticas estão atuais.
- [ ] Reprocessar a fonte com embeddings reais após escolher o provedor.
- [ ] Testar perguntas que a fonte deve responder.

**Responsável esperado:** dono do conteúdo de cada setor.  
**Concluído quando:** fonte estiver atual, rastreável, testada e sem conflito conhecido.

### 7. Preparar o histórico do OPA para aprendizagem

- [ ] Solicitar/exportar o histórico autorizado.
- [ ] Definir período da exportação.
- [ ] Definir política de retenção e descarte.
- [ ] Executar anonimização offline.
- [ ] Separar conversas completas de conversas abandonadas.
- [ ] Avaliar qualidade das respostas humanas.
- [ ] Identificar padrões recorrentes.
- [ ] Selecionar exemplos positivos de naturalidade.
- [ ] Excluir erros, dados sensíveis e respostas desatualizadas.
- [ ] Submeter candidatos à revisão responsável.
- [ ] Publicar no RAG somente conteúdo aprovado.

**Responsável esperado:** produto, atendimento e responsável por privacidade.  
**Concluído quando:** houver conjunto anonimizado, revisado e aprovado; o OPA nunca será dependência de produção.

### 8. Fechar o contrato técnico do IXC

- [x] Confirmação declarada de que o token permite criação; comprovação técnica permanece na homologação.
- [x] Endpoints usados atualmente pelo Omni classificados como somente leitura.
- [ ] Homologar `su_ticket` como recurso selecionado para criação de chamado.
- [ ] Homologar `su_oss_chamado` como recurso selecionado para criação de OS.
- [x] Campos preliminares obrigatórios separados por chamado e OS.
- [x] Candidatos de assunto, setor, prioridade, status, filial e tipo registrados como `DRAFT`.
- [x] Chave de idempotência e identidade de ocorrência definidas.
- [x] Comportamento diante de timeout ou resposta ambígua definido como `UNCERTAIN`.
- [x] Consultas protegidas condicionadas à identidade validada.
- [x] Cliente `2508` e contrato `2738` fornecidos e autorizados para homologação.
- [x] Vínculo cliente `2508` → contrato ativo `2738` confirmado em consulta somente leitura.
- [x] Catálogo de assuntos ativos consultado; candidatos técnicos registrados sem seleção automática.
- [x] Catálogo de setores consultado e estrutura real de chamados/OS inspecionada sem conteúdo pessoal.
- [ ] Aprovar o mapeamento Atendimento (`7`) para chamado e Técnico (`3`) para OS, ou definir alternativa.
- [ ] Aprovar os candidatos `T` (status de chamado), `A` (status de OS), filial `1` e tipo `C`.
- [x] Skill inicial `support-connectivity-ticket` v1 criada no setor Suporte em `DRAFT`, permitindo somente leituras e `request_ticket`.
- [x] `support-connectivity-ticket` v1 revisada e movida para `APPROVED` em 03/09/2026; campos de segurança conferidos e homologação automatizada 10/10. Ainda não está `ACTIVE` e não executa escrita externa.
- [ ] Preparar uma conversa controlada de Suporte com identidade validada, confiança mínima de `0,90` e identificador explícito de ocorrência.
- [ ] Fornecer cliente/contrato sem registro aberto para homologar uma criação limpa.
- [x] Segundo candidato `13054`/`13396` verificado; vínculo ativo, porém com registros abertos.
- [ ] Registrar exemplos de payload e resposta sem dados sensíveis.

**Responsável esperado:** responsável IXC/desenvolvedor antigo/líder técnico.  
**Concluído quando:** contrato de integração estiver documentado e validado em homologação.

### 9. Fechar o contrato técnico do Olho de Deus

- [x] Papel limitado a evidência de rede somente leitura; não cria chamado ou OS para o Omni.
- [x] Endpoints de visualização de rompimentos e OLTs identificados.
- [x] Correlação opcional por `networkEventId` prevista no Omni.
- [ ] Disponibilizar transporte HTTPS ou canal privado confiável para consumo em produção.
- [ ] Mapear de forma homologada OLT, porta PON, rota, CTO, contrato e cliente.
- [ ] Confirmar SLA de atualização, janela de detecção e significado completo dos estados.
- [ ] Definir fallback quando o Olho de Deus estiver indisponível ou com dados `stale`.
- [ ] Definir quais evidências podem ser apresentadas ao cliente e quais permanecem internas.
- [ ] Homologar que rompimento coletivo bloqueia OS individual e encaminha o fluxo adequado.

**Responsável esperado:** equipe responsável pelo Olho de Deus.  
**Concluído quando:** o Omni puder atuar somente como gatilho seguro e receber resultado rastreável.

### 10. Configurar canais e Meta/WhatsApp

- [ ] Confirmar o canal inicial de homologação.
- [ ] Preencher `META_APP_SECRET` correto.
- [ ] Confirmar `META_VERIFY_TOKEN`.
- [ ] Configurar callback do webhook.
- [ ] Informar token permanente do System User.
- [ ] Informar `phone_number_id`.
- [ ] Informar WABA ID.
- [ ] Testar assinatura e recebimento de mensagem.
- [ ] Testar entrega, leitura e resposta.
- [ ] Confirmar que segredos permanecem criptografados.

**Responsável esperado:** administrador da conta Meta.  
**Concluído quando:** mensagem controlada entrar, for processada e receber resposta pelo Omni.

### 11. Homologar identidade e segurança

- [ ] Selecionar clientes autorizados para teste.
- [ ] Testar validação pelos três últimos dígitos do CPF.
- [ ] Testar cinco falhas consecutivas e bloqueio temporário.
- [ ] Testar retomada após o bloqueio.
- [ ] Confirmar proteção de faturas, contratos e chamados.
- [ ] Confirmar que senha, token, cartão e CPF completo não entram na memória.
- [ ] Testar tentativa de manipulação do prompt.
- [ ] Testar propostas, preços especiais e descontos.
- [ ] Confirmar consulta humana obrigatória em ação comercial sensível.

**Responsável esperado:** segurança, produto e atendimento.  
**Concluído quando:** os cenários negativos falharem com segurança e estiverem auditados.

### 12. Homologar experiência e naturalidade

- [ ] Criar roteiro de conversas de Suporte.
- [ ] Criar roteiro de conversas de Financeiro.
- [ ] Criar roteiro de conversas de Vendas.
- [ ] Incluir erros de escrita e mensagens fragmentadas.
- [ ] Incluir clientes frustrados e respostas curtas.
- [ ] Avaliar ausência de tom robótico.
- [ ] Avaliar variação de frases sem alteração de fatos.
- [ ] Avaliar adequação à idade sem estereótipos.
- [ ] Avaliar perguntas feitas uma por vez.
- [ ] Avaliar resumo entregue ao responsável em GAP.
- [ ] Registrar correções como candidatos, nunca como aprendizado irrestrito.

**Responsável esperado:** liderança de atendimento e usuários-piloto.  
**Concluído quando:** amostra controlada alcançar o nível mínimo de qualidade definido pela liderança.

### 13. Configurar observabilidade e custos

- [x] Definir orçamento mensal da IA: **R$ 2.500,00**.
- [x] Definir alerta de 50%, 75%, 90% e 100% do orçamento, destinado ao líder técnico e sem bloqueio automático.
- [x] Registrar tokens por operação, provedor e modelo; detalhamento por setor permanece como evolução posterior.
- [ ] Medir uso do modelo principal, revisor e fallback.
- [ ] Definir limite de histórico enviado ao modelo.
- [ ] Acompanhar cache, RAG e respostas sem contexto.
- [ ] Acompanhar taxa de GAP.
- [ ] Acompanhar abandono e encerramento por inatividade.
- [ ] Configurar coleta segura de métricas.
- [ ] Definir responsável por incidentes e filas paradas.

**Responsável esperado:** líder técnico/gestor financeiro.  
**Concluído quando:** custo, qualidade, disponibilidade e GAPs possuírem indicadores e alertas.

### 14. Implantar gradualmente

- [ ] Iniciar somente com Suporte e clientes autorizados.
- [ ] Manter ações externas em modo leitura/sombra.
- [ ] Liberar criação de chamado apenas após contrato IXC aprovado.
- [ ] Liberar OS apenas para situações simples e autorizadas.
- [ ] Acompanhar diariamente as primeiras conversas.
- [ ] Corrigir fontes e skills por versão.
- [ ] Expandir para Financeiro.
- [ ] Expandir para Vendas por último, com regras comerciais reforçadas.
- [ ] Registrar aceite formal de cada fase.

**Responsável esperado:** dono do produto, líder técnico e responsáveis dos setores.  
**Concluído quando:** cada setor estiver aprovado individualmente antes da expansão.

## Registro de execução

Ao concluir um item, registrar:

```text
Item:
Responsável:
Data:
Ambiente:
Evidência:
Resultado:
Pendência ou risco residual:
```

## Regra de segurança

Nenhuma pendência deste documento deve ser marcada como concluída apenas porque foi implementada em código. Credenciais, conteúdo oficial, autorização, teste com dados reais, homologação e aceite precisam de evidência humana.
