# Candidatos de conhecimento extraídos do OPA

Status: **PENDENTE DE REVISÃO**. Este conteúdo não deve entrar automaticamente no RAG.

## Fontes examinadas

- 13 departamentos;
- 77 etiquetas corporativas;
- 82 motivos de atendimento;
- 17 mensagens rápidas;
- 79 fluxos de comunicação, incluindo a família `Seeg IA`.
- amostra autorizada de 30 atendimentos finalizados de Suporte, abertos em
  03/09/2026, contendo 580 mensagens. A análise foi feita em memória, com
  anonimização, e nenhum texto foi publicado no RAG.

## Evidências da amostra conversacional

| Tema observado | Conversas na amostra | Uso permitido |
|---|---:|---|
| visita técnica ou possível OS | 15 | validar perguntas mínimas, deduplicação e expectativa de prazo |
| LOS ou rompimento | 9 | diferenciar falha individual de evento coletivo confirmado |
| acesso, credenciais ou aplicativo | 8 | estruturar diagnóstico sem expor ou reproduzir credenciais |
| ausência de conexão | 7 | validar sequência curta de diagnóstico |
| Wi-Fi ou roteador | 6 | organizar perguntas por dispositivo e estado das luzes |
| lentidão | 1 | ampliar a amostra antes de propor conteúdo |

As categorias podem se sobrepor. Os números servem para priorização de revisão,
não para medir o volume mensal da operação.

## Padrões úteis pendentes de revisão

- perguntar uma informação por vez quando o cliente demonstra dificuldade;
- confirmar se a falha ocorre em todos os dispositivos;
- perguntar pelo estado das luzes da ONU/roteador, especialmente LOS;
- consultar contrato, ocorrência e OS existente antes de criar novo registro;
- reconhecer urgência sem prometer visita ou normalização sem evidência;
- resumir o diagnóstico antes de encaminhar um GAP ou uma execução autorizada;
- encerrar de maneira natural e deixar explícito como o cliente pode retomar.

## Conteúdo rejeitado como referência direta

- solicitações repetidas sem considerar a resposta já dada;
- promessa de prazo, visita ou resolução sem confirmação operacional;
- coleta de endereço completo quando contrato e identidade já permitem a busca;
- exposição de login, senha, telefone, protocolo ou outro dado pessoal;
- mensagens humanas excessivamente curtas, ambíguas ou com erros que prejudiquem
  a compreensão;
- frases que anunciam transferência para “atendente humano” ou revelam a
  automação;
- cópia literal de mensagens automáticas, avaliações ou encerramentos do OPA.

## Taxonomia inicial

| Intenção | Setor Omni | Evidências mínimas | Ação segura atual |
|---|---|---|---|
| ausência de conexão | Suporte | identidade, contrato, conexão, tickets e OS | diagnosticar e consultar |
| lentidão/instabilidade | Suporte | contrato, perfil, conexão e ocorrência existente | diagnosticar e consultar |
| rompimento | Suporte | evento coletivo confirmado | informar sem inventar prazo |
| alteração de Wi-Fi | Suporte | identidade e contrato | orientar; ação remota ainda não habilitada |
| bloqueio/desbloqueio | Suporte | identidade, contrato e situação financeira | consultar; executar somente após homologação |
| visita técnica | Suporte | diagnóstico concluído, duplicidade verificada | simular ticket/OS |
| segunda via | Financeiro | identidade e título correto | consultar; envio posterior à homologação |
| pagamento não reconhecido | Financeiro | identidade, título e pagamento | consultar e abrir GAP se houver divergência |
| nota fiscal | Financeiro | identidade e contrato | consultar procedimento aprovado |
| cancelamento | Vendas/Retenção | identidade, contrato e motivo | conduzir procedimento; autorização conforme regra |
| plano/cobertura/upgrade | Vendas | localidade e contrato quando existente | informar somente com fonte aprovada |

## Procedimentos candidatos

### Instabilidade individual

- Confirmar contrato e conexão.
- Verificar ticket ou OS existente.
- Fazer diagnóstico curto, uma etapa por vez.
- Não afirmar visita antes da criação confirmada da OS.
- Não prometer prazo sem regra ou evidência atual.

### Rompimento ou falha coletiva

- Confirmar evento coletivo e região afetada.
- Evitar diagnóstico individual desnecessário.
- Informar previsão somente quando a fonte operacional trouxer uma.
- Acompanhar recuperação antes de encerrar.

### Inatividade

- Diferenciar conversa resolvida de conversa abandonada.
- Não declarar resolução quando o cliente parou de responder.
- Preservar resumo e pendência para retomada.

### Cancelamento

- Entender o motivo sem pressionar o cliente.
- Consultar contrato e pendências.
- Seguir a decisão final do cliente e as regras aprovadas.
- Não transferir automaticamente; abrir GAP somente por falta de regra ou autoridade.

## Regras de linguagem

- Não copiar mensagens rápidas literalmente.
- Corrigir gramática e formatação.
- Evitar começar repetidamente com “Certo”, “Claro” ou “Entendi”.
- Gerar a resposta a partir de fatos, procedimento, risco e contexto.
- Usar uma pergunta por vez quando estiver diagnosticando.
- Não anunciar uma ação antes da confirmação do executor.
