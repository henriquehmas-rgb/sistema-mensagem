# Registro de execução manual — SEEG Omni

**Iniciado em:** 31/08/2026  
**Estado geral:** preparação técnica implantada; decisões e homologação manual em andamento  
**Ambiente público:** release de prontidão SHADOW saudável; IA real tecnicamente ativa  
**Regra:** nenhum campo pode ser considerado aprovado apenas por inferência técnica.

## Fase 0 — Responsáveis e aprovadores

| Função | Titular | Substituto | Autoridade/escopo | Estado |
|---|---|---|---|---|
| Organização responsável/patrocinadora | GRUPO SEEG | — | Autoridade responsável pelo produto, pela operação, pelas prioridades e pelas regras de negócio | DEFINIDO |
| Líder técnico | Matheus de Arruda Silva | A informar | Aprova arquitetura, código, integração, deploy e homologação técnica | DEFINIDO PARCIALMENTE |
| Administrador da VPS | A informar | A informar | Executa backup, deploy, migração e rollback | PENDENTE |
| Gestor Anthropic/OpenAI | Matheus de Arruda Silva | A informar | Acessa as contas, cria/rotaciona chaves e acompanha orçamento/alertas | DEFINIDO PARCIALMENTE |
| Papel/Fila de Suporte | GRUPO SEEG | Contingência ADMIN/SUPERVISOR | Recebe GAPs de Suporte; pessoas autorizadas podem ser vinculadas sem alterar a skill | DEFINIDO, SEM CONTA SETORIAL |
| Papel/Fila Financeiro | GRUPO SEEG | Contingência ADMIN/SUPERVISOR | Recebe GAPs financeiros; pessoas autorizadas podem ser vinculadas sem alterar a skill | DEFINIDO, SEM CONTA SETORIAL |
| Papel/Fila de Vendas | GRUPO SEEG | Contingência ADMIN/SUPERVISOR | Recebe GAPs comerciais; pessoas autorizadas podem ser vinculadas sem alterar a skill | DEFINIDO, SEM CONTA SETORIAL |
| Segurança e privacidade | A informar | A informar | Aprova identidade, dados, retenção e testes negativos | PENDENTE |
| Responsável por conteúdo/RAG | A informar | A informar | Governa fontes, validade e publicação | PENDENTE |
| Administrador Meta/WhatsApp | A informar | A informar | Configura WABA, System User, webhook e canal de teste | PENDENTE |
| Aprovador do playbook | Matheus de Arruda Silva | — | Aceite das diretrizes globais e tom da marca | DEFINIDO |
| Aprovador da homologação | Matheus de Arruda Silva | — | Autoriza início e expansão do piloto | DEFINIDO |

## Autoridades mínimas a confirmar

- [ ] Quem pode aprovar diretrizes globais.
- [ ] Quem pode aprovar fonte e publicação no RAG.
- [ ] Quem pode aprovar ou ativar uma skill.
- [ ] Quem pode responder GAP por setor.
- [ ] Quem pode aprovar proposta/condição comercial.
- [ ] Quem pode autorizar escrita futura no IXC/Olho de Deus.
- [ ] Quem pode autorizar deploy e rollback.
- [ ] Quem pode interromper imediatamente a homologação ou o piloto.

## Decisões operacionais da Fase 0

| Decisão | Valor | Estado |
|---|---|---|
| Primeiro setor do piloto | Suporte | DEFINIDO |
| Setores oficiais | Suporte, Financeiro e Vendas | DEFINIDO |
| Retenção | Especialidade de Vendas | DEFINIDO |
| Provedor principal | Anthropic/Sonnet | DEFINIDO |
| Auxiliar seletivo | OpenAI/Luna | DEFINIDO |
| Embeddings | OpenAI | DEFINIDO |
| Escrita externa inicial | Bloqueada; leitura/sombra | DEFINIDO |
| MCP | Planejamento após acesso e auditoria do Olho de Deus | DEFINIDO |
| Fine-tuning | Fora do escopo atual; reavaliar somente com dados e métricas do piloto/segundo cérebro | DEFINIDO |
| Janela de ativação interna | A informar | PENDENTE |
| Orçamento mensal inicial | R$ 2.500,00 | DEFINIDO; alertas pendentes |
| Contas/clientes autorizados | A informar | PENDENTE |

## Definição dos papéis ainda não nomeados

### Líder técnico

Não é apenas a pessoa que escreve código. É a autoridade técnica responsável por:

- arquitetura e padrões do projeto;
- revisão e aceite técnico do código;
- integrações IXC, Olho de Deus, Meta e provedores de IA;
- estratégia de deploy, migração e rollback;
- segurança técnica, observabilidade e resposta a incidentes;
- decisão sobre quando uma versão está tecnicamente apta para homologação.

O líder técnico pode também programar e pode acumular a administração da VPS, desde que possua autoridade e acesso para executar essas responsabilidades.

### Responsáveis dos setores

Os responsáveis nominais de Suporte, Financeiro e Vendas ainda não foram oficialmente definidos, mas isso não altera protocolos ou skills. Os papéis/filas pertencem ao GRUPO SEEG e recebem contas autorizadas dinamicamente antes do piloto do respectivo setor. As pessoas vinculadas deverão:

- validar fontes e procedimentos de seu setor;
- revisar e responder GAPs;
- aprovar ou rejeitar candidatos de conhecimento dentro de sua autoridade;
- acompanhar a qualidade do atendimento;
- garantir cobertura por ao menos uma conta ativa e rota de contingência para ausências;
- não aprovar ações fora de sua competência.

Em nenhum dos três setores é necessário fixar titular e substituto em documento ou skill. O bloqueio para cada piloto é existir ao menos uma conta ativa vinculada à fila correspondente, com ADMIN/SUPERVISOR como contingência. Fontes e skills do setor não devem ser ativadas sem essa cobertura operacional.

## Evidências já disponíveis

- Healthcheck público repetido em 03/09/2026: API `ok`, PostgreSQL `up`, Redis `up`; 10/10 verificações aprovadas.
- VPS em `AI_PROVIDER=anthropic`, com Sonnet principal, Luna auxiliar e embeddings OpenAI.
- As 23 migrações presentes estão aplicadas na VPS; a mais recente é `000000000021_add_ai_budget_monitoring`.
- Release `omni-release-20260903-budget-alerts.tar.gz` ativa em modo `SHADOW`, SHA-256 `A615DFB4CFD0E61080F8943BAA9E69B92BAF5F0C01E3010AB7975492873BF357`.
- Portão de escrita IXC comprovado no artefato em execução: bloqueado, zero chamadas ao transporte e zero escrita externa.
- Três skills iniciais de Suporte presentes em `DRAFT`.
- Modelos `gpt-5.6-luna` e `claude-sonnet-5` foram listados pelas APIs das respectivas contas.
- Chaves temporárias estão presentes na VPS e precisam ser substituídas antes da homologação externa.

## Critério de conclusão da Fase 0

A fase termina somente quando:

1. todas as funções críticas possuírem papel e autoridade definidos;
2. cada setor em piloto possuir ao menos uma conta ativa e uma rota de contingência;
3. aprovadores de playbook, homologação, conteúdo e deploy estiverem definidos;
4. janela preliminar, orçamento inicial e grupo de testes tiverem responsáveis definidos;
5. cada pessoa tiver confirmado que aceita o escopo atribuído.

## Registro de alterações

| Data | Item | Responsável | Evidência/observação |
|---|---|---|---|
| 31/08/2026 | Abertura da Fase 0 | Matheus / Codex | Registro criado a partir do plano manual vigente |
| 31/08/2026 | Organização responsável | Matheus | GRUPO SEEG confirmado como autoridade responsável pelo Omni |
| 31/08/2026 | Gestão das contas de IA | Matheus de Arruda Silva | Matheus terá acesso às contas; substituto, orçamento e alertas ainda pendentes |
| 31/08/2026 | Aprovação do playbook e homologação | Matheus de Arruda Silva | Autoridade confirmada pelo próprio responsável |
| 31/08/2026 | Administração da VPS | Matheus | Acesso `sudo` será providenciado; administrador definitivo ainda pendente |
| 31/08/2026 | Responsáveis setoriais | Matheus | Nenhum dos três setores possui responsável oficialmente designado |
| 31/08/2026 | Autoridade do produto | Matheus | GRUPO SEEG será mantido como autoridade responsável, sem representante individual obrigatório |
| 31/08/2026 | Liderança técnica | Matheus de Arruda Silva | Matheus confirmado como líder técnico; substituto ainda pendente |
| 31/08/2026 | Estratégia MCP | Matheus de Arruda Silva | Estrutura MCP será avaliada após acesso e análise detalhada do Olho de Deus |
| 31/08/2026 | Fine-tuning | Matheus de Arruda Silva | Descartado no momento; possibilidade futura condicionada a dataset aprovado, métricas e modelo compatível |
| 03/09/2026 | Provedores reais | Matheus de Arruda Silva | Sonnet principal, Luna auxiliar e embeddings OpenAI validados por chamadas reais; `production_ready=true` |
| 03/09/2026 | Orçamento inicial | Matheus de Arruda Silva | R$ 2.500,00 mensais como teto de atenção; alertas ativos e sem bloqueio automático |
| 03/09/2026 | Política do teto de atenção | Matheus de Arruda Silva | Alertas em 50%, 75%, 90% e 100%; Matheus recebe; atendimento não é bloqueado ao atingir R$ 2.500 |
| 03/09/2026 | Canal de alerta de orçamento | Matheus de Arruda Silva | Painel administrativo definido como canal inicial; serviço externo de e-mail registrado como melhoria futura redundante |
| 03/09/2026 | Monitor mensal de IA | Codex | Sonnet, Luna e embeddings instrumentados; alertas persistentes 50/75/90/100, reconhecimento auditado e atendimento nunca bloqueado; homologação 10/10 |
| 03/09/2026 | Release de orçamento | Codex | `omni-release-20260903-budget-alerts.tar.gz`, SHA-256 `A615DFB4CFD0E61080F8943BAA9E69B92BAF5F0C01E3010AB7975492873BF357`; backups com carimbo `20260903T175622Z` |
| 03/09/2026 | Isolamento dos testes | Codex | Suíte impedida de herdar chaves/provedores reais; homologação pós-correção 10/10 |
| 03/09/2026 | Playbook global v1 | Matheus de Arruda Silva | Aprovado com voz natural, GAP contextual, persuasão ética, privacidade e limites operacionais |
| 03/09/2026 | Método inicial de identidade | Matheus de Arruda Silva | Três últimos dígitos do CPF combinados com mês de nascimento; telefone somente localiza/desambigua cadastro |
| 03/09/2026 | Skill de chamado de Suporte | Matheus de Arruda Silva | `support-connectivity-ticket` aprovada para avançar a `IN_REVIEW`; escrita externa permanece bloqueada |
| 03/09/2026 | Skills de OS de Suporte | Matheus de Arruda Silva | Mantidas em `DRAFT` até homologação específica do IXC |
| 03/09/2026 | Responsabilidade setorial flexível | Matheus de Arruda Silva | Skills vinculadas ao setor/papel, não a nomes; piloto exige uma conta ativa na fila e contingência ADMIN/SUPERVISOR |
| 03/09/2026 | Modelo setorial unificado | Matheus de Arruda Silva | O padrão flexível de papel/fila e contingência ADMIN/SUPERVISOR aplica-se também a Financeiro e Vendas |
| 03/09/2026 | Revisão técnica da skill de chamado | Matheus / Codex | `support-connectivity-ticket` v1 movida para `IN_REVIEW`; setor, identidade, confiança 0,90, fontes e bloqueios validados; OS permanecem `DRAFT`; homologação 10/10 |
| 03/09/2026 | Aprovação final da skill de chamado | Matheus de Arruda Silva | `support-connectivity-ticket` v1 movida para `APPROVED`, sem ativação; política confirmada em `SHADOW`, escrita externa `false` e skills de OS mantidas em `DRAFT` |
| 03/09/2026 | Ativação controlada de Suporte | Matheus / Codex | Playbook global v2 e `support-connectivity-ticket` v1 ativados sob política `SHADOW`; escrita externa desabilitada e revisão humana obrigatória |
| 03/09/2026 | Conta temporária de Suporte | Codex | Conta `AGENT` vinculada à fila, login e acesso aos GAPs validados, mutação administrativa bloqueada; conta desativada após os testes e senha aleatória descartada |
| 03/09/2026 | Homologação pós-ativação | Codex | 10/10 verificações aprovadas; API, banco, Redis, interface, migrações, GAPs, suíte de IA, contêineres e logs saudáveis |
