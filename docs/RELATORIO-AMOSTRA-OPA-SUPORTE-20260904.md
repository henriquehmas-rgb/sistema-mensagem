# Relatório da amostra recente do OPA — Suporte

Data da análise: 04/09/2026  
Status: **ANÁLISE CONCLUÍDA / PUBLICAÇÃO NO RAG BLOQUEADA**

## Escopo

Foi consultado, em modo somente leitura, o histórico de atendimentos finalizados
do OPA. A seleção ficou restrita a conversas recentes dentro da janela autorizada
de 30 dias e classificadas com a etiqueta de Suporte. Para a primeira análise,
foram examinadas 30 conversas abertas em 03/09/2026, totalizando 580 mensagens.

Essa é uma amostra inicial para ajustar critérios de qualidade. Ela não representa
todo o volume mensal e não autoriza generalização estatística da operação.

## Proteção dos dados

- a análise ocorreu em memória;
- nomes, contatos, endereços, URLs, credenciais e identificadores não foram
  incorporados à documentação;
- nenhuma conversa bruta foi adicionada ao repositório;
- nenhum conteúdo foi enviado ao RAG, à memória de longo prazo ou ao runtime;
- os resultados registrados são somente agregados e padrões abstratos;
- eventual exportação completa continuará dependendo do pipeline offline, de
  retenção definida e de revisão humana de privacidade.

## Distribuição temática observada

As categorias se sobrepõem porque uma conversa pode envolver mais de um tema.

| Tema | Ocorrências |
|---|---:|
| visita técnica ou possível OS | 15 |
| LOS ou rompimento | 9 |
| acesso, credenciais ou aplicativo | 8 |
| ausência de conexão | 7 |
| Wi-Fi ou roteador | 6 |
| lentidão | 1 |
| sem correspondência nas categorias anteriores | 3 |

## Aprendizados aproveitáveis

1. O diagnóstico deve começar pela abrangência da falha: um dispositivo ou todos.
2. O estado das luzes da ONU/roteador, principalmente LOS, é uma pergunta útil e
   de baixo atrito quando o cliente está no local.
3. Se o cliente não estiver no local, insistir no mesmo teste piora a experiência;
   o fluxo deve buscar evidência operacional ou oferecer o próximo passo possível.
4. A IA pode reconhecer urgência e impacto, mas não deve transformar isso em prazo
   ou prioridade operacional sem fonte válida.
5. Antes de sugerir OS, é necessário consultar ocorrência coletiva, chamado e OS
   existentes para evitar duplicidade.
6. O resumo antes do GAP ou da execução ajuda o responsável a continuar sem fazer
   o cliente repetir informações.

## Problemas encontrados no repertório legado

- repetição das mesmas perguntas mesmo depois de resposta parcial do cliente;
- coleta maior de dados pessoais do que o necessário;
- anúncio antecipado de visita, prazo ou abertura de OS;
- transferência explícita para “humano”, incompatível com a comunicação natural
  definida para o Omni;
- respostas humanas curtas ou gramaticalmente frágeis;
- encerramento sem confirmação clara de resolução;
- mensagens automáticas e pesquisas misturadas ao conteúdo útil;
- presença de dados sensíveis em conversas, reforçando que cópia direta é proibida.

## Decisão de governança

O histórico do OPA é útil para descobrir intenções, variações de escrita e falhas
do atendimento atual. Ele não deve ser tratado como fonte oficial de procedimento.
Os padrões úteis permanecem como candidatos para conferência com o protocolo de
Suporte, IXC, Olho de Deus e responsáveis do Grupo SEEG.

Nenhum candidato desta análise está aprovado para publicação. Os padrões foram
convertidos em 24 cenários sintéticos de replay, sem dados de clientes e com a
publicação no RAG explicitamente desabilitada. O replay revelou cinco variações
que ainda caíam em Atendimento Geral; a triagem determinística passou a reconhecer
LOS, consulta de OS/chamado existente, ausência do técnico, credenciais inválidas
em aplicativo e falha de telefonia como Suporte.

A ampliação acrescentou abreviações, erros de escrita, recorrência, indisponibilidade
por dispositivo, lentidão, telefonia, aplicativo, Wi-Fi e urgência. Ela também
detectou e corrigiu um falso conflito em “velocidade abaixo do plano”: esse contexto
agora permanece em Suporte e não é desviado para Vendas apenas pela palavra
“plano”.

A suíte completa do serviço de IA foi executada após a alteração: 181 testes
foram aprovados. Apenas conteúdo confirmado, versionado e com responsável poderá
entrar no RAG.
