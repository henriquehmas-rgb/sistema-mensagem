# Handoff completo — SEEG Omni

**Finalidade:** transferir para outra IA o contexto consolidado do projeto, as decisões vigentes, o estado técnico real e a próxima sequência de trabalho.  
**Atualizado em:** 31/08/2026  
**Escopo:** contexto de produto, arquitetura, IA, segurança, integrações, deploy, validações e pendências.  
**Importante:** este documento não contém senhas, tokens, chaves privadas ou segredos de produção.

---

## 1. Orientação para a IA que continuará o projeto

Você está continuando o desenvolvimento do **SEEG Omni**, uma plataforma omnichannel de atendimento e CRM conversacional. Antes de alterar qualquer coisa:

1. Leia este documento integralmente.
2. Confirme detalhes técnicos nos documentos canônicos citados na seção 18.
3. Diferencie sempre:
   - o que já está implementado em código;
   - o que está apenas preparado em uma release;
   - o que está ativo na VPS pública;
   - o que ainda depende de decisão ou execução humana.
4. Não reabra decisões fechadas sem solicitação explícita do responsável pelo projeto.
5. Não trate pareceres históricos, conversas antigas ou conteúdo do OPA como regras atuais.
6. Não execute escrita no IXC, Olho de Deus, Meta ou produção sem autorização específica e homologação correspondente.
7. Nunca peça, registre, repita ou exponha chaves já compartilhadas. Elas são temporárias e precisam ser rotacionadas.
8. Em caso de conflito documental, siga a ordem de autoridade da seção 18 e falhe de forma segura.

## 2. Visão do produto

O SEEG Omni substituirá o OPA como canal central de atendimento da SEEG Fibras. O objetivo não é apenas automatizar respostas: é construir um atendimento conduzido principalmente por IA, natural, contextual, seguro e capaz de operar por setores.

O cliente deve perceber uma conversa fluida e humana, sem frases engessadas ou repetitivas. O sistema não deve anunciar espontaneamente que é uma assistente virtual, mas também não pode afirmar falsamente que é uma pessoa específica.

O foco é que a IA resolva a maior parte dos atendimentos. O humano não assume automaticamente a conversa quando surge uma dúvida: ele orienta internamente a IA por meio de um GAP, e a própria IA retoma o atendimento ao cliente.

Os setores oficiais são:

- **Suporte**;
- **Financeiro**;
- **Vendas**.

Retenção e cancelamento são especialidades de **Vendas**, não um quarto setor. “Atendimento Geral” existe somente como fallback técnico quando não é possível determinar uma rota segura.

## 3. Decisões vigentes que não devem ser reinterpretadas

- Sonnet é o modelo conversacional principal.
- Luna é auxiliar seletivo e não participa de toda interação.
- OpenAI também fornece os embeddings do RAG.
- Regras determinísticas, segurança, IXC, RAG e skills são avaliados antes dos modelos.
- O modelo não escolhe livremente endpoints ou parâmetros de integrações externas.
- A IA é a principal responsável pelo atendimento.
- GAP é uma consulta interna, não uma transferência automática do cliente.
- A conversa permanece com `aiEnabled=true` durante o GAP.
- Humanos só assumem diretamente por contingência e ação explícita.
- OPA será substituído e não participa do runtime futuro.
- OPA serve somente como histórico offline para análise, avaliação e aprendizagem supervisionada.
- Nenhum conteúdo é publicado automaticamente no RAG.
- IXC permanece somente leitura nesta fase.
- Chamados e OS permanecem em simulação/modo sombra até homologação formal.
- Descontos, propostas personalizadas, preços especiais e alterações de condição comercial exigem validação humana autorizada.
- Suporte será o primeiro setor homologado.
- Financeiro e Vendas entram somente após estabilidade e aceite do piloto anterior.
- Fallback automático entre modelos está inicialmente desativado para evitar troca silenciosa de voz e comportamento.
- Revisor de IA separado também permanece desativado no primeiro ciclo; ações sensíveis são protegidas por regras determinísticas e revisão humana.
- MCP será avaliado somente depois do acesso e da auditoria detalhada do Olho de Deus; o Omni continuará sendo o gate de segurança e autorização.
- Fine-tuning está fora do escopo atual e só poderá ser reavaliado após piloto, dataset supervisionado, métricas e modelo compatível.

## 4. Arquitetura conceitual de decisão

Fluxo resumido:

```text
Mensagem recebida
  → validações de segurança e identidade
  → normalização e regras determinísticas
  → roteamento por Suporte, Financeiro ou Vendas
  → consulta de contexto recente e memória autorizada
  → consulta operacional do IXC, quando permitida
  → seleção de skill ativa e fonte RAG autorizada
  → Luna apenas se a conversa realmente precisar de organização auxiliar
  → Sonnet produz a resposta final
  → guardrails verificam segurança, fatos, ações e condições comerciais
  → resposta ao cliente OU GAP interno
```

Princípio central: o modelo principal deve redigir e interpretar, mas não substituir regras de segurança, autorização, roteamento, identidade, fonte factual ou execução operacional.

### Quando Luna entra

Luna é chamado seletivamente em conversas com sinais como:

- histórico longo;
- múltiplos assuntos;
- mensagem extensa;
- baixa confiança de triagem;
- necessidade de compactar estado e organizar contexto.

Sua saída é não autoritativa. Luna não escolhe a skill, não autoriza ação, não substitui fonte oficial e não responde diretamente ao cliente. Se Luna falhar, Sonnet continua com o contexto disponível.

### Quando Sonnet entra

Sonnet é o gerador conversacional principal. Recebe o contexto já organizado e produz a resposta final respeitando:

- diretrizes globais da marca;
- fatos recuperados;
- skill escolhida;
- limites de privacidade;
- resultado de identidade;
- regras comerciais;
- necessidade de GAP;
- tom natural e adequado à situação.

## 5. Humanização da conversa

O comportamento esperado não é um catálogo de frases fixas. A resposta deve depender da pergunta real e das fontes encontradas, usando variações naturais sem mudar os fatos.

Diretrizes já discutidas:

- evitar abertura automática com “Certo”, pois pode soar robótica;
- não limitar toda resposta a três frases;
- fazer perguntas uma por vez quando isso facilitar o atendimento;
- compreender erros de escrita, abreviações e mensagens fragmentadas;
- preservar contexto entre mensagens;
- adaptar clareza à pessoa sem criar estereótipos por idade;
- reconhecer frustração e ajustar o tom;
- não inventar prazos, preços, diagnósticos ou soluções;
- usar variações naturais de abertura, espera e encerramento;
- em GAP, informar naturalmente que a informação será confirmada com o responsável/superior;
- após orientação interna, a IA deve voltar ao cliente sem fazê-lo repetir tudo;
- ao encerrar definitivamente, usar agradecimento natural com variações, preservando a ideia de que o Grupo SEEG continua disponível.

Persuasão pode ser usada especialmente em Vendas e retenção, mas nunca para contornar política comercial, conceder desconto ou manipular o cliente.

## 6. GAP e participação humana

Um GAP é criado quando existe lacuna real, por exemplo:

- baixa confiança relevante;
- ausência de resposta na conversa recente;
- ausência de informação válida no RAG;
- ausência de repertório aprovado ou memória útil;
- conflito entre fontes;
- situação comercial sensível;
- ação que exige aprovação;
- complexidade que ultrapassa o protocolo autorizado.

Comportamento esperado:

1. O sistema cria um GAP interno deduplicado para o setor correto.
2. O cliente recebe uma mensagem natural de espera/confirmação.
3. A IA continua habilitada.
4. O responsável do setor ou pessoa autorizada visualiza o GAP em popup/fila.
5. ADMIN e SUPERVISOR possuem visão global.
6. AGENT visualiza e responde somente GAPs de seu departamento ativo.
7. A orientação humana entra no contexto.
8. A própria IA formula e envia a resposta ao cliente.

Uma orientação humana não vira automaticamente regra geral. Ela pode gerar candidato de aprendizagem, sempre sujeito à revisão responsável.

## 7. Aprendizagem, memória e RAG

Existem camadas distintas:

- **histórico recente:** mensagens da conversa atual;
- **memória individual:** resumo autorizado do contato entre conversas;
- **RAG:** conhecimento geral e oficial da organização;
- **skills:** protocolos operacionais versionados;
- **evidência operacional:** dados atuais consultados no IXC;
- **diretrizes globais:** identidade e regras da marca.

Hierarquia factual: evidência operacional atual e fonte oficial válida ficam acima de memória e exemplos históricos.

### Memória individual

- Deve guardar apenas fatos objetivos e úteis.
- Não deve guardar senha, token, cartão, CVV, CPF completo, RG ou documento sensível.
- Não deve transformar conteúdo do cliente em instrução operacional.
- Falha ao resumir nunca deve apagar a memória anterior.
- A memória serve para personalização, não para substituir dados atuais do IXC.

### RAG

- Usa embeddings OpenAI, planejados com `text-embedding-3-small`, dimensão 1536.
- Cada fonte precisa ter origem, responsável, autoridade, validade e revisão.
- Conteúdo duplicado, contraditório ou desatualizado deve ser removido.
- Preços, prazos e políticas precisam de confirmação humana antes da publicação.
- Nenhum candidato entra automaticamente.
- Recorrência e qualidade servem somente para priorizar a fila de revisão.

### Histórico do OPA

- É material histórico, não fonte factual de produção.
- Deve ser exportado com autorização.
- O processamento é offline.
- Deve haver anonimização, retenção e descarte definidos.
- Conversas abandonadas devem ser separadas das concluídas.
- Respostas incorretas, desatualizadas ou sensíveis devem ser excluídas.
- Exemplos positivos podem ajudar naturalidade e avaliação.
- Publicação exige revisão explícita.

## 8. Skills e protocolos

`OperationalSkill` representa um protocolo por setor. Ela possui versões, gatilhos, dados obrigatórios, fontes permitidas, passos, ações permitidas/proibidas, requisitos de identidade, confiança mínima, condições de conclusão e condições de GAP.

Ciclo obrigatório:

```text
DRAFT → IN_REVIEW → APPROVED → ACTIVE
```

Regras:

- nova versão sempre nasce como rascunho;
- somente uma versão da chave deve ficar ativa;
- ativação exige responsável, fonte autorizada e etapas preenchidas;
- conteúdo do OPA não pode ativar ou alterar uma skill;
- RAG não concede permissão operacional;
- somente uma skill é selecionada por atendimento;
- `allowedSources` pode restringir exatamente as fontes aceitas;
- `minimumConfidence` só pode tornar o sistema mais rigoroso;
- ações comerciais sensíveis exigem condição explícita de revisão humana.

Existem quatro rascunhos iniciais de Suporte:

- falta de conexão;
- lentidão;
- reinício seguro;
- acompanhamento de chamado.

Eles foram deixados propositalmente sem fontes e não podem ser ativados antes da revisão humana.

## 9. Identidade e segurança

O telefone ajuda a localizar o cadastro, mas não é autenticação suficiente sozinho.

Diretriz definida:

- validar identidade antes de expor faturas, contratos, chamados ou dados protegidos;
- usar os três últimos dígitos do CPF como um dos desafios previstos;
- após cinco falhas consecutivas, aplicar bloqueio temporário, não bloqueio definitivo;
- permitir retomada segura após o tempo configurado;
- não guardar CPF completo ou credenciais em memória/log;
- não expor tokens, senhas ou dados de cartão ao modelo;
- testar manipulação de prompt e conteúdo malicioso;
- nunca liberar condição comercial sensível apenas pela confiança do modelo.

Controles técnicos já previstos/implementados incluem multitenancy, RBAC, criptografia AES-256-GCM de credenciais, Argon2id para senhas, validação de DTO, throttling, proteção SSRF do IXC, limite de resposta externa e auditoria sem CPF/telefone.

## 10. Integração IXC

Base conhecida:

- o IXC possui API em `/webservice/v1`;
- consultas foram validadas anteriormente a partir da VPS;
- o token fornecido historicamente pode ter privilégios amplos, pois era o mesmo utilizado pelo OPA;
- o projeto deve tratar esse token como privilegiado e substituí-lo por credencial própria e mínima;
- acessar o ERP visual não substitui o mapeamento da API;
- a API pode consultar clientes, contratos e dados operacionais necessários ao atendimento;
- a integração real ainda precisa de contrato formal para escrita.

Regra atual:

- **somente leitura**;
- host precisa estar explicitamente permitido em `IXC_ALLOWED_HOSTS`;
- credencial fica somente no backend;
- HTTPS e caminho `/webservice/v1` são exigidos;
- não enviar CPF/telefone ao prompt ou audit log;
- nenhuma escrita deve ser inferida como autorizada pelo fato de um token tecnicamente permiti-la.

Ainda precisa ser confirmado manualmente:

- permissões reais do token definitivo;
- endpoints de criação de chamado e OS;
- campos e códigos obrigatórios;
- assuntos, setores, prioridades e status;
- chave de idempotência/deduplicação;
- comportamento em timeout e resposta ambígua;
- consultas que exigem identidade validada;
- clientes/contratos autorizados para homologação.

## 11. OPA

OPA é o sistema atual/legado que o Omni pretende substituir.

Decisão definitiva:

- OPA não será dependência do Omni em produção;
- Omni não consultará OPA para responder, classificar ou executar ações;
- OPA será usado somente para exportação histórica autorizada;
- seus dados podem apoiar avaliação de qualidade, padrões de atendimento e aprendizagem supervisionada;
- qualquer conhecimento extraído permanece pendente até aprovação.

## 12. Olho de Deus

Informações obtidas:

- o Olho de Deus já existe;
- consulta diretamente OLTs;
- organiza eventos por OLT, porta PON e rota;
- usa IXC para relacionar CTOs/clientes e estimar quantidade de clientes afetados;
- já envia alertas de rompimento para canal no Discord;
- a base local pode ficar defasada e indicar menos clientes que a consulta atual do IXC;
- não foi confirmado que ele já cubra todas as vias de criação de chamado/OS imaginadas inicialmente.

Direção arquitetural:

- Omni deve ser um gatilho seguro para capacidades existentes, não reconstruir o Olho de Deus;
- a IA não deve montar chamadas livres;
- deve existir catálogo fechado de intenções e ações;
- o Olho de Deus deve devolver estado, protocolo, sucesso/erro e somente contexto permitido;
- idempotência, interrupção e prevenção de duplicidade precisam estar documentadas;
- escrita permanece bloqueada até o contrato técnico ser concluído e homologado.

## 13. Ações operacionais e comerciais

As ações passam por gate independente do modelo.

Mesmo quando uma resposta sugere abrir chamado ou OS, o sistema exige:

- skill ativa e válida;
- setor compatível;
- ação permitida e não proibida;
- identidade validada quando necessária;
- confiança mínima;
- cliente inequívoco;
- exatamente um contrato ativo quando aplicável;
- ausência de chamado/OS duplicado;
- aprovação humana quando exigida.

Estado atual:

- simulação de ações está implementada;
- avaliação em modo sombra está implementada;
- fila interna de propostas e aprovações está implementada;
- aprovação interna **não executa** escrita externa;
- não existe executor liberado para IXC ou Olho de Deus.

Para decisões comerciais:

- preço/campanha já publicados podem ser informados;
- desconto, proposta personalizada, mudança de preço ou condição especial geram GAP `commercial_approval_required`;
- somente orientação vinculada ao GAP correto libera a resposta revisada;
- aprovação nunca deve ser inferida de outro GAP ou conversa.

## 14. Arquitetura técnica do monorepo

Diretório principal desta cópia:

```text
C:\Users\mathe\Documents\Codex\2026-08-20\codex-threads-01a01f09-abed-7b62-bdd0\work\sistema-mensagem-vps
```

Componentes:

| Caminho | Tecnologia | Responsabilidade |
|---|---|---|
| `apps/api` | NestJS/TypeScript | autenticação, tenancy, conversas, mensagens, integrações, filas, GAP, skills e aprovações |
| `apps/web` | Next.js/React | inbox, painel, protocolos, aprovações, CRM e configurações |
| `services/ai` | FastAPI/Python | RAG, embeddings, provedores, prompts, guardrails, memória e triagem auxiliar |
| `packages/shared` | TypeScript | tipos e contratos compartilhados do frontend |
| `infra` | Docker/Traefik | composição e infraestrutura |
| `docs` | Markdown/JSON | fontes canônicas e rascunhos governados |

Infraestrutura prevista:

- Web Next.js;
- API NestJS;
- serviço de IA FastAPI;
- PostgreSQL com pgvector;
- Redis/BullMQ;
- Socket.io com Redis adapter;
- Docker e Traefik na VPS;
- Meta WhatsApp/Instagram e Webchat como canais.

Fluxo de entrada do WhatsApp:

1. webhook Meta valida assinatura;
2. resposta HTTP imediata e job de ingestão;
3. deduplicação pelo identificador da mensagem;
4. contato, conversa e mensagem são persistidos;
5. debounce agrupa mensagens fragmentadas;
6. pipeline de IA gera resposta;
7. mensagem outbound vai à Graph API;
8. estados de entrega/leitura retornam por webhook;
9. eventos são refletidos em tempo real no painel.

## 15. Provedores e configuração esperada

Arquitetura escolhida:

- **Anthropic/Sonnet:** resposta conversacional principal;
- **OpenAI/Luna:** organização auxiliar seletiva;
- **OpenAI embeddings:** vetorização do RAG.

Configuração planejada, sem incluir segredos:

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

Observação crítica: nomes comerciais/model IDs precisam ser confirmados nos painéis e APIs no momento da configuração. Não alterar o código ou o `.env` supondo que um nome informal seja obrigatoriamente o identificador aceito pelo fornecedor.

As chaves temporárias já foram testadas e aceitas pelos provedores, mas foram compartilhadas durante o desenvolvimento. Devem ser revogadas e substituídas antes de homologação externa ou produção. Não reutilizar valores encontrados em conversa, imagem, terminal ou histórico.

## 16. Estado de implementação em código

Implementado:

- triagem persistente com intenção principal/secundária, alternativa, evidência e conflito;
- roteamento determinístico com fallback seguro e classificador opcional;
- três setores oficiais e migração de retenção para Vendas;
- diretrizes globais versionadas;
- skills versionadas e bloqueio de ativação incompleta;
- hierarquia e validade de fontes;
- GAP diante de baixa confiança, ausência ou conflito;
- IXC acima do RAG como evidência operacional;
- memória apenas como personalização;
- provedor neutro com principal, auxiliar, revisor e fallback configuráveis;
- Luna seletivo e fail-open;
- prompt reorganizado para cache;
- Sonnet sem limite artificial de três frases;
- identidade, bloqueios comerciais, aprovações e GAP visível;
- isolamento de GAP por setor;
- pipeline offline do OPA;
- aprendizagem sempre revisada;
- recorrência usada para priorizar revisão;
- três skills iniciais de Suporte em `DRAFT`;
- simulação e modo sombra de ações;
- proteção comercial determinística;
- interface administrativa de protocolos e aprovações.

## 17. Estado do ambiente, release e validações

Estado atualizado em 03/09/2026:

- release de prontidão SHADOW ativada no ambiente público;
- Sonnet principal, Luna auxiliar e embeddings OpenAI estão tecnicamente ativos;
- as 22 migrações presentes estão aplicadas;
- API, Web, IA, PostgreSQL e Redis estão saudáveis;
- homologação automatizada repetida com 10/10 verificações aprovadas;
- escrita IXC permanece fisicamente bloqueada antes do transporte;
- migração 17 consolida departamentos oficiais e desativa retenção legada;
- nenhuma alteração de produção deve ser presumida apenas porque o código local está pronto.

Validações já concluídas antes do handoff:

- 162 testes do serviço de IA aprovados;
- 269 testes da API aprovados;
- typecheck da API aprovado;
- typecheck do Web aprovado;
- build de produção do Next.js aprovado;
- Prisma generate aprovado;
- release anterior validada em diretório isolado da VPS, sem ativar produção;
- varredura confirmou ausência de chaves reais no código-fonte;
- documentação superada foi removida da base ativa.

Release local mais atual, contendo documentação canônica e plano manual:

```text
omni-release-20260829-canonical-docs-with-manual-plan.tar.gz
SHA-256: 121039c0e1837f3d9ef87ee3c65e1f4337bafcd085453bcf70f90a5f1e095548
```

Essa release foi gerada localmente e não deve ser considerada enviada ou ativa até confirmação externa.

## 18. Documentos canônicos e ordem de autoridade

1. `docs/ARCHITECTURE.md` — arquitetura e fluxo vigentes.
2. `docs/CONTRACTS.md` — contratos técnicos, segurança e comportamento.
3. `docs/AI_ONLY_IMPLEMENTATION_STATUS.md` — o que existe em código.
4. `docs/PLANO-IMPLEMENTACAO-MANUAL.md` — sequência e critérios da fase manual.
5. `docs/PENDENCIAS-MANUAIS-OMNI.md` — checklist manual detalhado.
6. `docs/OPA-KNOWLEDGE-CANDIDATES.md` — candidatos históricos não aprovados.
7. `docs/support-skill-drafts.json` — rascunhos inativos.

Este documento é um resumo de handoff. Quando for modificar contratos ou código, confirme primeiro nas fontes acima.

## 19. Fase manual aprovada

Ordem definida:

### Fase 0 — Responsáveis

- administrador da VPS;
- gestor Anthropic/OpenAI;
- contas autorizadas vinculadas às filas de Suporte, Financeiro e Vendas no momento do piloto de cada setor;
- responsáveis por segurança, conteúdo e Meta;
- aprovadores de cada fase.

### Fase 1 — Segurança e orçamento

- criar chaves exclusivas;
- definir orçamento;
- configurar alertas de 50%, 75%, 90% e 100%;
- revogar as chaves temporárias;
- definir responsáveis por incidente e custo.

### Fase 2 — Governança

- aprovar playbook;
- definir SLAs e escalonamento de GAP;
- revisar fontes e skills;
- definir aprovadores de conteúdo e ação.

### Fase 3 — Ativação controlada na VPS

- release, hash, backups, migrações e healthchecks concluídos;
- configurar os provedores reais após rotação das chaves;
- manter rollback disponível.

### Fase 4 — Conhecimento e leitura

- publicar somente diretrizes aprovadas;
- gerar embeddings reais das fontes aprovadas;
- testar RAG;
- aprovar skills de Suporte;
- validar IXC somente leitura;
- documentar Olho de Deus sem liberar escrita.

### Fase 5 — Homologação fechada

- identidade e bloqueio temporário;
- proteção de dados;
- prompt injection;
- GAP completo;
- indisponibilidade de modelos/RAG/IXC/Redis;
- naturalidade e fidelidade factual;
- condições comerciais sensíveis.

### Fase 6 — Piloto de Suporte

- canal Meta controlado;
- somente clientes autorizados;
- IXC leitura e ações sombra;
- acompanhamento diário de qualidade, custo e GAP;
- interrupção imediata em incidente grave.

### Fase 7 — Expansão posterior

- Financeiro depois de Suporte;
- Vendas por último;
- chamados/OS somente após contrato e idempotência;
- aceite formal por setor e capacidade.

## 20. Informações que precisam ser obtidas do responsável

Para continuar de forma segura, coletar:

- nome do administrador com acesso `sudo` à VPS;
- janela autorizada de implantação;
- orçamento mensal inicial de IA;
- gestor das contas Anthropic e OpenAI;
- confirmação/ID real dos modelos disponíveis;
- papéis/filas de Suporte, Financeiro e Vendas, com ao menos uma conta ativa no piloto e contingência ADMIN/SUPERVISOR;
- aprovador do playbook;
- aprovador da homologação;
- dono do conteúdo/RAG;
- responsável pela privacidade;
- administrador Meta/WhatsApp;
- contas/clientes autorizados para teste;
- SLA de GAP por complexidade;
- política de retenção do histórico do OPA;
- fontes oficiais iniciais de Suporte;
- endpoints e permissões definitivas do IXC;
- contrato técnico do Olho de Deus.

## 21. Riscos que a próxima IA deve preservar visíveis

- chaves temporárias comprometidas por compartilhamento e pendentes de rotação;
- ambiente público atualizado, porém ainda sem IA real e sem homologação funcional;
- modelo IDs podem precisar de confirmação;
- token histórico do IXC pode possuir privilégios excessivos;
- escrita do IXC/Olho de Deus ainda não está contratada/homologada;
- OPA contém respostas humanas potencialmente erradas ou desatualizadas;
- aprendizagem automática irrestrita causaria contaminação do RAG;
- roteamento exclusivamente por modelo aumenta custo e risco de indisponibilidade;
- tratamento de Vendas exige barreiras comerciais adicionais;
- memória não pode acumular PII ou instruções maliciosas;
- aprovação interna de ação não significa execução externa;
- documentação antiga fora da pasta canônica não deve ser usada como fonte.

## 22. Critérios de homologação sugeridos

- 100% dos cenários críticos de identidade e dados protegidos aprovados;
- zero escrita externa não autorizada;
- zero condição comercial concedida sem aprovação;
- 100% dos GAPs visíveis somente a papéis/setores autorizados;
- zero resposta factual inventada quando não existe fonte;
- comportamento seguro quando Sonnet, Luna, RAG, IXC ou Redis falharem;
- aceite formal da liderança sobre naturalidade;
- custos e tokens observáveis por atendimento e setor;
- rollback testado e documentado;
- expansão somente após aceite do setor anterior.

## 23. Próxima ação lógica

Não começar por novas funcionalidades. A sequência correta é:

1. concluir Fase 0 com nomes e responsabilidades;
2. rotacionar credenciais e definir orçamento;
3. aprovar playbook, fontes e SLAs;
4. preparar e autorizar a ativação interna da release;
5. homologar com contas controladas;
6. iniciar piloto restrito de Suporte.

Qualquer pedido para pular diretamente à produção deve ser tratado como expansão de risco e exigir autorização explícita, backup, critérios de retorno e evidência de homologação.

## 24. Resumo executivo curto

O SEEG Omni está aproximadamente **90–95% pronto na preparação técnica automatizável**, mas ainda não é um serviço homologado. A release SHADOW está publicada e saudável, com Sonnet principal, Luna auxiliar, embeddings OpenAI, orquestração segura, RAG governado, skills versionadas, GAP por setor, segurança de identidade, proteção comercial e portão físico contra escrita IXC. A fase seguinte é humana e operacional: rotacionar as chaves após os testes, ativar alertas do orçamento de R$ 2.500, definir responsáveis, aprovar conteúdo e mapeamentos, homologar segurança/naturalidade e iniciar piloto restrito de Suporte. OPA não fará parte do runtime; ações reais no IXC só serão liberadas gradualmente após homologação formal.
