# Documentação vigente do SEEG Omni

Esta pasta contém somente fontes compatíveis com a arquitetura atual. Pareceres de escolha de provedor, auditorias intermediárias, planos superados e relatórios de etapas anteriores foram removidos para não influenciarem agentes, RAG ou decisões operacionais.

## Ordem de autoridade

1. `ARCHITECTURE.md` — arquitetura e fluxo operacional vigentes.
2. `CONTRACTS.md` — contratos técnicos, segurança e comportamento do sistema.
3. `CONTRATO-INTEGRACAO-IXC-OMNI.md` — contrato interno do IXC, campos locais e homologação de chamado/OS.
4. `AI_ONLY_IMPLEMENTATION_STATUS.md` — estado real do que já existe em código.
5. `PLANO-IMPLEMENTACAO-MANUAL.md` — sequência, dependências e critérios de aprovação da fase manual.
6. `PENDENCIAS-MANUAIS-OMNI.md` — checklist detalhado dos itens que exigem pessoa responsável, credencial, homologação ou mudança de produção.
7. `OPA-KNOWLEDGE-CANDIDATES.md` — candidatos históricos, sempre pendentes de revisão; nunca são fonte operacional automática.
8. `support-skill-drafts.json` — rascunhos inativos que não podem ser executados sem validação e ativação formal.

Para transferir o projeto a outra IA ou equipe, use `HANDOFF-CONTEXTO-COMPLETO-OMNI.md` como resumo autocontido, confirmando alterações técnicas nas fontes de autoridade acima.

O acompanhamento da execução humana deve ser atualizado em `REGISTRO-EXECUCAO-MANUAL.md`; esse registro documenta estado e evidências, mas não substitui aprovações formais.

A cobertura planejada de protocolos por setor fica em `MATRIZ-PROTOCOLOS-SETORES.md`. A matriz organiza o trabalho, mas nenhum item nela é uma skill ativa sem passar pelo ciclo formal de revisão.

## Decisões que não podem ser reinterpretadas

- Sonnet é o modelo conversacional principal.
- Luna é auxiliar seletivo e não participa de toda interação.
- Regras determinísticas, segurança, IXC, RAG e skills são avaliados antes dos modelos.
- Os setores oficiais são Suporte, Financeiro e Vendas.
- Retenção é especialidade de Vendas, não um quarto setor.
- Atendimento Geral é somente fallback técnico.
- OPA não participa do runtime; serve apenas como histórico offline, anonimizado e revisado.
- A IA conduz o atendimento. GAP solicita orientação interna e não transfere automaticamente o cliente.
- Nenhum aprendizado é publicado automaticamente no RAG.
- IXC permanece somente leitura e chamados/OS permanecem em shadow até homologação formal.
- Propostas, descontos, preços excepcionais e condições comerciais exigem validação humana autorizada.

Se houver conflito entre arquivos, prevalece a ordem de autoridade acima e a execução deve falhar de forma segura até revisão responsável.
