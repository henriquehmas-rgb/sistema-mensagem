# Plano de ação — Omni, OPA, IXC e Olho de Deus

**Atualizado em:** 24/08/2026  
**Estado:** aprovado como orientação para investigação e evolução; implementação operacional condicionada ao mapeamento dos ambientes OPA e IXC.

## Diretrizes confirmadas

- Todo atendimento é conduzido inicialmente pela IA.
- Quando não houver segurança suficiente na memória recente, RAG, memória de longo prazo ou fontes operacionais, a IA solicita orientação interna.
- A conversa não é transferida automaticamente: a IA informa ao cliente que está confirmando a informação e retoma após a resposta.
- A dúvida pode ser respondida pelo responsável do setor ou por pessoa autorizada.
- O prazo de resposta varia conforme a complexidade.
- Os setores oficiais são Financeiro, Suporte e Vendas.
- A comunicação deve ser natural, sem destacar que se trata de uma assistente virtual e sem afirmar falsamente que é uma pessoa.
- O primeiro domínio de homologação será Suporte, sem vinculação definitiva a um único canal.
- A IA funciona como gatilho; não cria livremente parâmetros ou requisições para OPA/IXC.
- O Olho de Deus já existe e possui padrão próprio de organização, execução e interrupção. O Omni deve integrar-se a ele, não reconstruí-lo.
- Chamados e ordens de serviço podem ser criados conforme as regras existentes no Olho de Deus.
- OS simples podem ser automatizadas; casos fora do padrão seguem o processo determinado pelo Olho de Deus ou orientação interna.
- Nenhum conteúdo entra no repertório geral sem revisão, salvo futura autorização formal para responsáveis confiáveis.
- Respostas humanas podem gerar candidatos a conhecimento, mas nunca alterar automaticamente regras operacionais, permissões ou endpoints.

## Objetivo imediato

Obter acesso técnico de observação ao OPA e ao IXC e mapear o funcionamento real antes de ampliar a implementação.

## Etapa 1 — Inspeção do OPA

- Identificar conectores e integrações configuradas.
- Mapear canais, departamentos, usuários API, atendimentos, mensagens e automações.
- Verificar como OPA e IXC se relacionam.
- Identificar gatilhos, filtros, campos, estados e respostas.
- Observar como atendimentos são criados, transferidos, atualizados e encerrados.
- Registrar regras existentes sem realizar alterações.

## Etapa 2 — Inspeção do IXC

- Confirmar permissões reais do usuário/token.
- Mapear clientes, contratos, assuntos, setores, chamados, protocolos e ordens de serviço.
- Confirmar campos reais retornados, incluindo `data_nascimento`.
- Identificar endpoints e recursos utilizados pela operação atual.
- Mapear criação, análise, encaminhamento e finalização de atendimentos/OS.
- Confirmar regras de duplicidade, interrupção, retentativa e encerramento.
- Manter a investigação inicial estritamente não destrutiva.

## Etapa 3 — Auditoria do Olho de Deus

- Localizar sua implementação concreta e responsáveis técnicos.
- Documentar entradas, saídas, gatilhos e máquina de estados.
- Identificar quais capacidades estão implementadas e quais existem apenas nas APIs.
- Mapear decisões automáticas e pontos de intervenção humana.
- Identificar como ocorre interrupção, cancelamento, retomada e tratamento de erro.
- Verificar como tipo, setor, prioridade, assunto e responsável são escolhidos.
- Confirmar como o mecanismo evita chamados e OS duplicados.

## Etapa 4 — Contrato entre Omni e Olho de Deus

- Criar catálogo fechado de intenções e ações.
- Impedir que a IA escolha endpoints ou parâmetros externos livremente.
- Padronizar requisições do Omni e respostas do Olho de Deus.
- Manter credenciais exclusivamente no backend.
- Aplicar validação de identidade, autorização, auditoria e idempotência.
- Retornar para a IA somente resultado, protocolo, estado e contexto permitido.

## Etapa 5 — Canal interno de dúvidas

- Criar fila por setor.
- Permitir resposta por responsável ou pessoa autorizada.
- Classificar complexidade e prazo de forma configurável.
- Informar o cliente naturalmente durante a espera.
- Retomar a conversa automaticamente após orientação.
- Criar candidato a conhecimento, sempre sujeito à política de revisão.

## Etapa 6 — Primeiro fluxo de suporte

- Começar pelo cenário de cliente sem conexão.
- Identificar e validar o cliente.
- Consultar contrato, conexão, chamados e OS existentes.
- Disparar o Olho de Deus com intenção estruturada.
- Permitir que o mecanismo existente decida entre orientação, chamado ou OS simples.
- Encaminhar dúvidas fora do padrão ao canal interno.
- Comunicar resultado e protocolo de forma natural.

## Etapa 7 — Homologação progressiva

1. Dados simulados.
2. Cadastro autorizado no IXC.
3. Consultas reais sem escrita.
4. Observação dos fluxos existentes.
5. Simulação de gatilhos de escrita.
6. Criação controlada de chamado.
7. Criação controlada de OS simples.
8. Testes de interrupção e retomada.
9. Piloto restrito de Suporte.
10. Expansão posterior para Financeiro e Vendas.

## Restrições até o fim do mapeamento

- Não alterar configurações do OPA ou IXC.
- Não criar, editar ou excluir registros reais durante a inspeção.
- Não presumir que documentação genérica representa a configuração da SEEG.
- Não duplicar capacidades já existentes no Olho de Deus.
- Não entregar tokens, dados pessoais ou payloads sensíveis à IA ou ao navegador.
- Não liberar escrita automática antes da homologação e da documentação da máquina de estados.

## Entregáveis da investigação

- Diagrama real OPA → IXC → Olho de Deus → Omni.
- Inventário de endpoints e recursos efetivamente utilizados.
- Máquina de estados do Olho de Deus.
- Matriz intenção → regra → ação → resultado.
- Matriz de permissões e responsáveis.
- Lista de lacunas técnicas.
- Plano de integração revisado com estimativa de risco e prioridade.
