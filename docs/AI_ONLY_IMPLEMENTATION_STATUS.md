# Estado da implementação possível somente com IA

> Acompanhamento das atividades que exigem execução humana: [PENDENCIAS-MANUAIS-OMNI.md](./PENDENCIAS-MANUAIS-OMNI.md).

## Implementado em código

- triagem persistente com intenção principal/secundária, rota alternativa, evidências e conflito;
- roteamento determinístico com fallback e possibilidade de classificação pelo modelo;
- diretrizes globais versionadas e aprováveis;
- protocolos/skills operacionais versionados e com bloqueio de ativação incompleta;
- hierarquia de fontes, validade, autoridade e GAP diante de conflito quantitativo relevante;
- evidência operacional do IXC acima do RAG; memória apenas como personalização;
- arquitetura de provedor neutra, com Sonnet principal, Luna auxiliar seletivo, revisor e fallback configuráveis;
- orquestração econômica: regras/RAG/IXC antes dos modelos, Luna somente em conversa complexa e falha auxiliar sem bloquear o Sonnet;
- prompt reorganizado para cache do prefixo institucional e sem limite artificial de três frases;
- segurança de identidade, bloqueios comerciais, fila de aprovação e GAP visível;
- GAP isolado por setor: ADMIN/SUPERVISOR têm visão global e AGENT responde somente pelo próprio departamento;
- setores oficiais consolidados em Suporte, Financeiro e Vendas; Retenção é especialidade de Vendas e Atendimento Geral é fallback técnico;
- pipeline offline de anonimização do histórico do OPA, sem publicação automática no RAG;
- quatro rascunhos iniciais de suporte, deliberadamente sem fontes e impossíveis de ativar sem revisão.

## Ainda exige trabalho humano ou acesso externo

- criar e rotacionar chaves exclusivas de produção, limites de gasto e alertas;
- validar conteúdo, responsáveis, fontes e critérios de cada skill antes de ativá-la;
- exportar legalmente o histórico do OPA, definir retenção e revisar amostras;
- mapear endpoints e permissões reais de escrita do IXC/Olho de Deus;
- homologar em canal controlado, avaliar conversas reais e aprovar publicação;
- definir SLAs e responsáveis pelos GAPs por setor;
- ativar a release já preparada na VPS e executar migrações com janela e plano de retorno.

Nenhum item pendente deve ser simulado por IA: envolve autoridade, credencial, dado real, aceite de negócio ou mudança de produção.
