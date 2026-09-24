# Relatório de homologação automatizada — SEEG Omni

**Data:** 27/08/2026  
**Ambiente:** produção — `chat.srv1450678.hstgr.cloud`  
**Política:** nenhuma escrita executada no IXC.

## Resultado executivo

- Homologação segura da VPS: **10/10 verificações aprovadas**.
- API NestJS: **31 arquivos e 256 testes aprovados**.
- Serviço de IA: **127 testes aprovados**.
- Typecheck da API e da interface: **aprovado**.
- Containers API, Web, IA, PostgreSQL e Redis: **saudáveis**.
- Migrations: **13 aplicadas; banco atualizado**.
- Logs recentes: **nenhum erro crítico**.

## Verificações executadas em produção

| Verificação | Resultado |
|---|---|
| Health público | Aprovado |
| PostgreSQL | Disponível |
| Redis | Disponível |
| Interface pública | Responde e direciona para login |
| Rota de GAP sem autenticação | Protegida (`401`) |
| Simulador operacional sem autenticação | Protegido (`401`) |
| Adaptador do Olho de Deus sem autenticação | Protegido (`401`) |
| Tabela `knowledge_gaps` | Presente |
| Suíte isolada dentro do container de IA | Aprovada |
| Erros críticos nos serviços | Nenhum encontrado |

## IXC e segurança operacional

- Integração IXC: habilitada e com último teste aprovado.
- O módulo IXC implementado permanece somente leitura.
- Não foram encontradas chamadas HTTP `POST`, `PUT`, `PATCH` ou `DELETE` no cliente IXC.
- O simulador de ticket/OS declara `externalWritePerformed: false`.
- Consultas protegidas continuam exigindo identidade válida.
- Circuit breaker, cache, limitação temporária e auditoria possuem cobertura automatizada.

## GAP interno

Cobertura automatizada aprovada para:

- deduplicação de uma dúvida pendente por conversa;
- bloqueio de resposta duplicada;
- registro da orientação do responsável;
- reinserção da orientação no contexto;
- retorno da conversa para a fila da IA;
- retirada imediata da pendência respondida no cache da interface;
- controle de acesso para administrador/supervisor.

No momento desta coleta não havia GAP pendente na produção, portanto o painel flutuante autenticado ainda precisa de uma conferência visual controlada.

## Humanização e resiliência

Os testes automatizados cobrem:

- variações de escrita e erros comuns;
- triagem entre Suporte, Financeiro e Vendas;
- níveis direto, investigativo, acolhedor, cauteloso e passo a passo;
- ausência de abertura genérica com “Certo”;
- cancelamentos e reclamações sem transferência automática;
- CPF tratado como dado sensível sem transferência automática;
- GAP por falta real de contexto ou baixa confiança;
- falhas do provedor, timeout, retry e respostas vazias;
- memória longa sem retenção de CPF, cartão ou senha;
- proteção contra instruções maliciosas no RAG e na memória.

## Descoberta crítica

O ambiente de produção está configurado com:

```text
AI_PROVIDER=mock
```

Esse provedor é determinístico e foi criado para desenvolvimento/testes. Ele recupera trechos do RAG e abre GAP quando não encontra conteúdo, mas não possui a capacidade linguística de um modelo real para produzir a humanização desejada.

Consequências:

- a arquitetura da IA está funcional;
- as regras de segurança e autonomia estão funcionais;
- o atendimento ainda não deve ser avaliado como experiência humana final;
- testes subjetivos de naturalidade devem aguardar a ativação de um provedor real.

## Estado da base de conhecimento

- Fontes com estado `READY`: **1**.
- O material extraído do OPA continua como candidato pendente de revisão, sem publicação automática.
- A base atual é suficiente para testar a infraestrutura, mas não para cobrir todo o atendimento real da SEEG.

## Próximas etapas manuais, em ordem

1. Escolher o provedor real: OpenAI, Anthropic ou Google.
2. Fornecer/configurar uma chave exclusiva para o Omni e definir limite de uso.
3. Homologar visualmente o painel flutuante de GAP com uma conversa controlada.
4. Aprovar o conteúdo inicial extraído do OPA para entrada no RAG.
5. Selecionar cliente e contrato autorizados para teste de suporte com IXC.
6. Avaliar manualmente naturalidade, tom da SEEG e adequação das respostas.

## Reexecução

O roteiro reexecutável está em:

```text
infra/homologation-automated.sh
```

Ele não cria chamados, não abre OS e não altera registros do IXC.
