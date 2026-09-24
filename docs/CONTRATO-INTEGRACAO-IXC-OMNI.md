# Contrato interno de integração IXC — SEEG Omni

**Versão:** 0.10.0  
**Estado:** pronto para preenchimento e homologação; escrita ainda desabilitada  
**Proprietário:** Grupo SEEG  
**Responsável técnico:** líder técnico do Omni

## 1. Objetivo

Este documento converte a documentação pública do IXC e o comportamento já implementado no
Omni em um contrato único. Ele não substitui a documentação do fornecedor: fixa como o Omni
usará o IXC e impede que campos, permissões ou comportamentos sejam inferidos pela IA em tempo
de execução.

Fontes de referência:

- Documentação IXC Provedor: <https://wikiapiprovedor.ixcsoft.com.br/>
- Coleção técnica fornecida ao projeto: <https://documenter.getpostman.com/view/40255984/2sAYBbe9Ma#intro>
- API OPA: <https://api.opasuite.com.br/> — referência histórica; não participa do runtime.
- Código vigente do adaptador: `apps/api/src/integrations/ixc/`.
- Política operacional: `apps/api/src/operational-policy/omni-operational-policy.ts`.

## 2. Legenda de maturidade

| Estado | Significado |
|---|---|
| `CONFIRMADO` | Está implementado e já foi usado em leitura ou possui contrato interno fechado. |
| `DOCUMENTADO` | Está descrito pelo fornecedor, mas ainda precisa de teste na instância SEEG. |
| `PENDENTE_SEEG` | Depende de código/ID/configuração operacional da SEEG. |
| `PENDENTE_HOMOLOGACAO` | Só pode ser fechado com teste controlado e evidência registrada. |

## 3. Autoridade e responsabilidades

| Responsabilidade | Sistema |
|---|---|
| Decidir a ação | Omni, por regras determinísticas |
| Redigir a conversa | IA, limitada por protocolo e skill |
| Autorizar no primeiro piloto | Pessoa revisora no Omni |
| Executar consulta e criação administrativa | IXC direto |
| Manter o registro oficial e protocolo | IXC |
| Fornecer evidência técnica de rede | Olho de Deus/OLT, somente leitura |
| Fornecer histórico para aprendizagem | OPA, somente pipeline offline |

A IA nunca escolhe livremente endpoint, operação, setor, assunto, prioridade ou payload. O contrato
público recebe uma `mappingKey` conhecida; os códigos IXC são resolvidos internamente pelo Omni.

## 4. Transporte e autenticação

| Item | Contrato Omni | Estado |
|---|---|---|
| Base URL | `https://ixc.seegfibras.com.br/webservice/v1` | `CONFIRMADO` |
| Host permitido | `ixc.seegfibras.com.br` em `IXC_ALLOWED_HOSTS` | `CONFIRMADO` |
| Autenticação | HTTP Basic com usuário e token armazenados cifrados | `CONFIRMADO` |
| Consulta | `GET`, JSON e cabeçalho `ixcsoft: listar` | `CONFIRMADO` |
| Inclusão | Convenção IXC de inclusão, a validar no teste da SEEG | `DOCUMENTADO` |
| Timeout de leitura | 8 segundos | `CONFIRMADO` |
| Limite de resposta | 1 MiB | `CONFIRMADO` |
| Tentativas de leitura | Até 2 em falha transitória | `CONFIRMADO` |
| Escrita automática | Proibida enquanto o modo for `SHADOW` | `CONFIRMADO` |
| Portão único de escrita | `IxcWriteExecutor`, bloqueado antes de alcançar qualquer transporte | `CONFIRMADO` |
| Permissão de criação do token atual | Confirmada pelo responsável; falta comprovação em homologação | `PENDENTE_HOMOLOGACAO` |
| Integração habilitada | Sim; último teste registrado como bem-sucedido | `CONFIRMADO` |

Tokens nunca devem aparecer em documentação, logs, payload de auditoria ou mensagens para modelos.
A credencial de produção deverá ter privilégio mínimo e ser diferente da chave exposta durante testes.

## 5. Recursos de leitura

| Finalidade | Recurso IXC | Chave principal de consulta | Situação no Omni |
|---|---|---|---|
| Cliente | `cliente` | ID, CPF/CNPJ ou telefones cadastrados | Implementado |
| Contratos | `cliente_contrato` | `id_cliente` | Implementado |
| Faturas | `fn_areceber` | `id_cliente` | Implementado e protegido |
| Chamados | `su_ticket` | `id_cliente` | Implementado |
| Ordens de serviço | `su_oss_chamado` | `id_cliente` | Implementado |
| Conexões | `radusuarios` | `id_cliente` | Implementado |
| Assuntos/regras de OS | `su_oss_assunto` | ativos | Implementado |
| Planos comerciais | `vd_contratos` | ativos | Implementado |
| Perfis de velocidade | `radgrupos` | ID | Implementado |

Consultas protegidas exigem identidade validada. Dados retornados ao restante do Omni são reduzidos
por whitelist; credenciais de rede, senha, IP, MAC, SSID, boleto, Pix e linha digitável não são
repassados por este adaptador.

### 5.1 Viabilidade comercial por endereço

**Fonte oficial:** [InMap Sales / Auto Viabilidade do IXC](https://wiki-erp.ixcsoft.com.br/documentacao/menu-sistema/inmap/sales/configuracoes/configuracao-da-auto-viabilidade.html).  
**Estado:** `SOMBRA_IMPLEMENTADA` para evidência de caixas + `FORMULARIO_OFICIAL_PENDENTE_HOMOLOGACAO` para a confirmação individual.

O Omni não inferirá cobertura apenas a partir de bairro, cidade, clientes próximos ou de um
registro de outro lead. A evidência de caixas fica em sombra, sem chegar ao cliente ou ao modelo;
a disponibilidade só poderá ser apresentada depois da consulta oficial para o endereço novo. A
instância SEEG possui o motor InMap Auto Viabilidade V3. A documentação oficial descreve a
confirmação individual pelo formulário público do InMap, que registra o pré-cadastro/prospecção
no IXC; por isso, ela não é tratada como uma leitura inofensiva.

A coleção técnica documenta `GET /webservice/v1/rad_caixa_ftth`, com status, capacidade,
endereço e coordenadas das caixas de atendimento. Esse recurso é uma evidência de infraestrutura
útil, mas não substitui a Auto Viabilidade: a coleção não documenta cálculo de distância até o
endereço, ocupação de portas, regras de região ou planos elegíveis. O adaptador em sombra lê no
máximo 250 caixas da cidade, calcula somente proximidade no backend com o raio padrão oficial
de 200 m (sem ampliar esse limite por inferência) e descarta identificadores,
endereços, topologia e capacidade antes da saída. Se a página atingir esse limite, o resultado é
inconclusivo por definição. Ele fica fora da resposta automática até existir uma correlação IXC
homologada que produza os critérios completos.

O recurso `contato` do CRM pode conter campos como status e data de viabilidade de leads já
cadastrados, mas não é aceito como calculadora de cobertura do Omni. Consultá-lo por endereço
poderia reutilizar uma decisão antiga ou acessar dados de outro interessado.

#### Auditoria da configuração oficial

Além das caixas, o manual oficial da API lista `df_projeto`,
`df_tipo_elemento_regiao` e `crm_planos_negociacoes`. O Omni os consulta somente em leitura
administrativa para verificar se há projetos ativos, tipos de região com
`verificar_viabilidade`/fibra e planos de negociação ligados a um plano comercial. Essa leitura
produz `CONFIGURATION_SIGNALS_PRESENT`, `MISSING_REQUIRED_CONFIGURATION`,
`PARTIAL_CONFIGURATION`, `PARTIAL_UNAVAILABLE` ou `UNAVAILABLE` e permanece fora
do modelo e do canal. Os recursos expostos não incluem a geometria da região nem o vínculo
efetivo região/caixa ↔ plano; por isso a auditoria não equivale a uma decisão individual de
cobertura.

Quando uma dessas leituras não responder, a saída administrativa informa apenas a fonte
afetada e uma causa técnica normalizada (`ACCESS_DENIED`, `ENDPOINT_UNSUPPORTED`,
`INVALID_QUERY`, `TEMPORARY_UNAVAILABLE`, `INVALID_RESPONSE`, `IXC_REJECTED` ou `UNKNOWN`). A resposta bruta, credenciais e
topologia não são registradas nem retornadas.

O adaptador segue este contrato fechado:

```json
{
  "input": "endereco informado no turno atual",
  "output": "CONFIRMED | NOT_AVAILABLE | INCONCLUSIVE | UNAVAILABLE",
  "source": "IXC_INMAP_AUTO_VIABILITY",
  "plans": "somente identificadores aprovados e compatíveis"
}
```

- A URL e a operação serão uma chave fixa no código, nunca uma escolha do modelo;
- `get-config` é leitura administrativa. Um teste controlado do endpoint interno de transporte
  retornou conteúdo não-JSON e foi classificado como `REVIEW_REQUIRED`; como esse POST não está
  documentado como contrato público do fornecedor, ele permanece desativado por padrão
  (`IXC_INMAP_DIRECT_CHECK_ENABLED=false`), sem novas tentativas automáticas;
- a confirmação individual deverá seguir o formulário oficial do InMap, com campanha/canal
  aprovados, e retornar ao CRM somente por uma integração IXC documentada e homologada;
- antes do POST, o Omni grava uma chave HMAC não reversível no contato. O mesmo contato/endereço
  recebe o resultado já salvo, sem novo POST; timeout, recusa ou resposta ambígua viram
  `REVIEW_REQUIRED`, sem repetição automática;
- endereço, CEP, coordenadas e qualquer resposta bruta ficam fora de RAG, memória operacional,
  logs e auditoria; a auditoria recebe apenas resultado normalizado, versão do mapeamento e
  identificador técnico da consulta;
- `UNAVAILABLE` representa incidente técnico, e `INCONCLUSIVE` representa evidência insuficiente:
  nenhum dos dois vira GAP de aprendizagem;
- a IA só apresenta disponibilidade e planos depois de `CONFIRMED`; nos demais estados ela
  continua a qualificação sem prometer cobertura;
- a criação implícita de lead nunca é liberada ao modelo, ao webchat nem ao RAG. A etapa inicial
  é administrativa e auditada; a futura skill de Vendas deverá reaproveitar exatamente este
  contrato, exigindo o consentimento no turno atual.

Para fechar a homologação, falta configurar a ponte do formulário oficial para o CRM e conferir
os nomes concretos de campanha/canal e o evento/registro IXC que devolve a decisão. A configuração do InMap
Sales deve conter regiões ou caixas vinculadas a planos; sem isso, a própria [Auto
Viabilidade](https://wiki-erp.ixcsoft.com.br/documentacao/menu-sistema/inmap/sales/configuracoes/configuracao-da-auto-viabilidade.html)
não consegue calcular cobertura.

## 6. Contrato de criação de chamado

**Recurso candidato documentado:** `su_ticket`.  
**Estado:** `DOCUMENTADO` + `PENDENTE_HOMOLOGACAO`.

O adaptador interno receberá somente:

```json
{
  "conversationId": "referencia-interna",
  "customerId": "id-cliente-ixc",
  "contractId": "id-contrato-ixc",
  "mappingKey": "support.connectivity.ticket",
  "summary": "resumo-tecnico-sem-segredos",
  "idempotencyKey": "sha256-gerado-pelo-omni"
}
```

Campos IXC definitivos e seus nomes externos serão fechados a partir do exemplo oficial da
documentação e de uma criação controlada. O Omni não aceitará campos adicionais livres da IA.

## 7. Contrato de criação de ordem de serviço

**Recurso candidato documentado:** `su_oss_chamado`.  
**Estado:** `DOCUMENTADO` + `PENDENTE_HOMOLOGACAO`.

O adaptador interno receberá somente:

```json
{
  "conversationId": "referencia-interna",
  "customerId": "id-cliente-ixc",
  "contractId": "id-contrato-ixc",
  "mappingKey": "support.fiber_los.service_order",
  "diagnosis": "falha-individual-confirmada",
  "summary": "resumo-tecnico-sem-segredos",
  "idempotencyKey": "sha256-gerado-pelo-omni"
}
```

Uma OS somente poderá avançar quando todas as condições forem verdadeiras:

1. setor de Suporte;
2. identidade e contrato válidos e inequívocos;
3. skill ativa e autorizada;
4. confiança efetiva igual ou superior ao maior valor entre a skill e `0,85`;
5. diagnóstico de rede `INDIVIDUAL_FAILURE`;
6. ausência de rompimento coletivo e de evidência inconclusiva;
7. ausência de chamado ou OS equivalente aberta;
8. aprovação humana enquanto o modo for `REVIEW_REQUIRED`.

## 8. Valores locais que a SEEG deve preencher

| Parâmetro | Valor | Fonte de confirmação |
|---|---|---|
| ID do setor Suporte | `A_PREENCHER` | Catálogo/configuração IXC |
| Assunto para falta de conexão | `A_PREENCHER` | `su_oss_assunto` + protocolo SEEG |
| Assunto para visita técnica | `A_PREENCHER` | `su_oss_assunto` + protocolo SEEG |
| Prioridade padrão | `A_PREENCHER` | Regra do assunto/gestão de Suporte |
| Status inicial de chamado | `T` (candidato; aprovação pendente) | Estado observado em chamados em andamento |
| Status inicial de OS | `A` (candidato; aprovação pendente) | Estado observado em OS aberta |
| Tipo de OS | `C` (candidato; aprovação pendente) | 100/100 registros em cada amostra de OS |
| Equipe inicial, se obrigatória | `A_PREENCHER` | Regra do assunto/configuração IXC |
| Filial | `1` (candidata; aprovação pendente) | 100/100 registros em cada amostra dos assuntos `60`, `25` e `28` |
| Processo, se obrigatório | `A_PREENCHER` | Configuração IXC |
| Cliente de homologação | `2508` | Autorizado e encontrado em leitura em 02/09/2026 |
| Contrato de homologação | `2738` | Ativo e vinculado ao cliente `2508`, confirmado em leitura em 02/09/2026 |
| Segundo cliente candidato | `13054` | Encontrado em leitura em 02/09/2026 |
| Segundo contrato candidato | `13396` | Ativo e vinculado ao cliente `13054`, confirmado em leitura em 02/09/2026 |

Esses valores podem ser obtidos por consultas de catálogo ou configuração da própria instância.
Não precisam ser inventados nem incorporados ao prompt da IA.

### 8.1 Assuntos técnicos encontrados — ainda não selecionados

A consulta em leitura encontrou 152 assuntos ativos. Os candidatos abaixo são os mais diretamente
relacionados ao piloto de Suporte, mas **não constituem aprovação automática**:

| ID | Assunto IXC | Finalidade | Prioridade padrão | Observação |
|---:|---|---|---|---|
| `60` | Registro - Suporte Técnico | `AT` | `N` | Exige contrato e login segundo o catálogo. |
| `153` | Cliente sem conexão - identificado pela URA | `AT` | `N` | Nome vinculado à URA; adequação ao Omni precisa ser decidida. |
| `25` | Manutenção - Fibra (LOS) | `AM` | `C` | Candidato para perda de sinal; não exige contrato no catálogo. |
| `28` | Manutenção - Correção de Sinal | `AM` | `N` | Candidato para manutenção técnica. |
| `103` | Suporte - S.O.S | `AM` | `N` | Exige diagnóstico na finalização da OS. |
| `15` | Atendimento Suporte Técnico | `AM` | `N` | Assunto técnico genérico. |

O assunto `173` contém referência explícita ao OPA e não deve ser adotado como padrão do Omni sem
renomeação ou decisão responsável. Rompimentos coletivos não devem gerar OS individual.

### 8.2 Setores encontrados

A consulta confirmou `su_ticket_setor` e retornou 12 registros. Os candidatos ativos pertinentes são:

| ID | Setor | Uso preliminar, ainda não aprovado |
|---:|---|---|
| `7` | Atendimento | Entrada/registro inicial de chamado; aparece no histórico autorizado. |
| `3` | Técnico | Execução técnica/OS. |
| `13` | NOC | Análise de rede; não é destino automático de atendimento individual. |
| `6` | Comercial | Mapeamento futuro de Vendas, fora do piloto de Suporte. |

O setor Financeiro retornou inativo no catálogo consultado. Isso não altera o setor interno Financeiro
do Omni; apenas impede mapear automaticamente uma ação IXC para esse código sem revisão.

### 8.2.1 Mapeamentos preliminares versionados

Foram cadastrados em código, todos com estado `DRAFT`:

- `support.connectivity.ticket`: setor Atendimento `7`, assunto Registro - Suporte Técnico `60`;
- `support.fiber_los.service_order`: setor Técnico `3`, assunto Manutenção - Fibra (LOS) `25`;
- `support.signal_correction.service_order`: setor Técnico `3`, assunto Manutenção - Correção de Sinal `28`.

O resolvedor rejeita rascunhos, versões ativas duplicadas e configurações incompletas. Ele valida
separadamente os campos exigidos por chamado e por OS, evitando exigir dados de outra ação. Os
candidatos `T` (chamado), `A` (OS), filial `1` e tipo `C` foram incorporados somente aos rascunhos;
a aprovação e a criação controlada continuam obrigatórias antes de habilitar escrita.

### 8.2.2 Evidência estatística dos parâmetros operacionais

Em 02/09/2026, uma consulta agregada e somente leitura avaliou os 100 registros mais recentes de
cada assunto candidato. Nenhum cliente, protocolo, título ou mensagem foi copiado:

| Amostra | Filial | Setor predominante | Tipo | Observação |
|---|---:|---:|---:|---|
| Chamado, assunto `60` | `1` em 100/100 | `7` em 93/100 | `C` em 100/100 | Prioridade histórica `M`; catálogo do assunto define `N`. |
| OS, assunto `25` | `1` em 100/100 | `3` em 93/100 | `C` em 100/100 | 98/100 estavam finalizadas; não prova o estado inicial. |
| OS, assunto `28` | `1` em 100/100 | `3` em 99/100 | `C` em 100/100 | 98/100 estavam finalizadas; não prova o estado inicial. |

Para prioridade, prevalece provisoriamente a regra atual de cada assunto (`N`, `C`, `N`), não a
frequência histórica. `origem_cadastro=P` apareceu em 100% das amostras, mas representa o fluxo
histórico do portal; o Omni mantém `I` como origem de integração até a homologação confirmar o
código aceito. Os estados `T` e `A` foram registrados como candidatos por aparecerem em registros
ainda em andamento/abertos, mas isso não prova sozinho que sejam aceitos na inclusão.

### 8.3 Estrutura real observada de chamado e OS

- `su_ticket` retornou `id_cliente`, `id_contrato`, `id_assunto`, `id_ticket_setor`, `id_filial`,
  `id_login`, `id_wfl_processo`, `prioridade`, `status`, `tipo`, `titulo`, `menssagem` e `protocolo`,
  entre outros campos.
- `su_oss_chamado` retornou `id_cliente`, `id_ticket`, `id_assunto`, `setor`, `id_filial`, `id_login`,
  `prioridade`, `status`, `tipo`, `mensagem` e `protocolo`, entre outros campos.
- A OS observada não apresentou um campo direto `id_contrato`; o vínculo rastreável ocorre por
  `id_ticket`. Por segurança, o contrato preliminar exige criar/localizar o chamado antes da OS.
- O recurso tentado para catálogo de modelos de OS respondeu com erro lógico do IXC. Nenhum modelo
  será inventado; o fluxo usará assunto e parâmetros explicitamente homologados.
- O cliente de teste possui registros históricos e pelo menos uma OS ainda marcada como aberta.
  Portanto, ele é adequado para validar `DUPLICATE_FOUND`, mas não para um cenário limpo de criação.
- O segundo par `13054`/`13396` também não está limpo pela regra conservadora: a leitura encontrou
  um chamado em estado `OSAG` e quatro OS em estado `A`. Nenhum conteúdo ou protocolo foi coletado.

## 9. Duplicidade e idempotência

- Antes da criação, consultar chamados e OS abertos do cliente.
- Usar cliente, contrato, assunto e estado aberto apenas para localizar registros semelhantes.
- Mesmo assunto não confirma duplicidade: o problema pode ter ocorrido novamente.
- A mesma chave idempotente ou, para OS, o mesmo `id_ticket` confirma a mesma ocorrência.
- Registro semelhante sem identidade da ocorrência produz `REVIEW_REQUIRED`, não `DUPLICATE_FOUND`.
- Registros comprovadamente de outro contrato ou assunto não bloqueiam a ação.
- Campo essencial ausente mantém revisão conservadora; a IA nunca decide a identidade da ocorrência.
- Registro marcado como aberto não deixa de ser duplicidade apenas por ser antigo.
- A chave SHA-256 considera conversa, cliente, contrato, ação, intenção, assunto e diagnóstico.
- Nunca repetir uma criação após timeout sem consultar o IXC.
- Se a criação não puder ser confirmada nem descartada, registrar `UNCERTAIN` e solicitar revisão.
- O protocolo existente deve ser reutilizado quando a duplicidade for confirmada.

No primeiro piloto, `request_service_order` é uma ação composta: localizar ou criar o chamado
autorizado e, somente depois, criar a OS vinculada pelo `id_ticket`. Se qualquer etapa ficar incerta,
a sequência para e não executa a etapa seguinte.

Essa separação é obrigatória:

- **idempotência técnica:** evita que a mesma execução do Omni seja enviada duas vezes;
- **similaridade operacional:** encontra registros possivelmente relacionados para revisão;
- **duplicidade confirmada:** exige identidade da ocorrência, não apenas o mesmo assunto.

### 9.1 Identidade persistente da ocorrência

- O orquestrador cria um `occurrenceId` novo quando identifica uma nova manifestação do problema.
- Repetições técnicas da mesma execução preservam esse ID e geram a mesma chave idempotente.
- Uma recorrência real recebe outro `occurrenceId`, mesmo mantendo cliente, contrato e assunto.
- Quando disponível, `networkEventId` relaciona a ocorrência ao `EventID` do Olho de Deus.
- Chamado e OS da mesma ocorrência compartilham a chave de ocorrência e a OS registra o
  `sourceTicketId`.
- Em `SHADOW`, a ausência de identificador usa um fallback baseado na conversa para compatibilidade.
- Antes de escrita real, `occurrenceId` ou `networkEventId` será obrigatório; o fallback não autoriza execução.
- A identidade e sua origem ficam persistidas em `requestPayload` junto da proposta operacional.

## 10. Retorno normalizado ao Omni

O adaptador de escrita deverá devolver uma destas formas, independentemente da resposta bruta do IXC:

```json
{
  "state": "COMPLETED",
  "ixcId": "identificador",
  "protocol": "protocolo",
  "created": true
}
```

```json
{
  "state": "DUPLICATE_FOUND",
  "ixcId": "identificador-existente",
  "protocol": "protocolo-existente",
  "created": false
}
```

```json
{
  "state": "UNCERTAIN",
  "ixcId": null,
  "protocol": null,
  "created": null
}
```

A resposta bruta poderá ser usada internamente para diagnóstico redigido, mas não será persistida
integralmente quando contiver dados pessoais ou campos fora da whitelist.

O transporte real de inclusão permanece deliberadamente desconectado. O executor rejeita toda
tentativa enquanto a política estiver em `SHADOW` ou `externalWriteEnabled=false`; assim, aprovar
uma proposta no painel não é suficiente para provocar uma chamada externa.

## 11. Falhas e comportamento seguro

| Situação | Comportamento |
|---|---|
| `401`/credencial recusada | Bloquear integração; não repetir; alertar responsável. |
| `400`/validação | Bloquear proposta e registrar campos rejeitados sem dados pessoais. |
| `404`/recurso ou vínculo ausente | Bloquear; revisar mapeamento e versão do endpoint. |
| `429`/limite | Repetição controlada apenas em leitura; criação permanece pendente. |
| `5xx`/indisponibilidade | Não prometer criação; aplicar retentativa controlada conforme a operação. |
| Timeout antes de resposta de criação | Estado `UNCERTAIN`; consultar antes de qualquer repetição. |
| Resposta sem ID/protocolo | Consultar por cliente/contrato e chave correlacionável; caso contrário, `UNCERTAIN`. |

## 12. Sequência de homologação

1. Preencher os IDs operacionais restantes da seção 8 por consulta em leitura.
2. ~~Confirmar em leitura que o cliente `2508` está vinculado ao contrato `2738`, sem expor seus dados.~~ Concluído em 02/09/2026.
3. Comparar o payload documentado com os campos exigidos pela instância SEEG.
4. Executar todos os cenários da `MATRIZ-HOMOLOGACAO-CHAMADOS-OS.md` em `SHADOW`.
5. Ativar `REVIEW_REQUIRED` somente para o teste acompanhado.
6. Criar um chamado e conferir ID, protocolo, setor, assunto, contrato e auditoria.
7. Criar uma OS elegível e conferir os mesmos vínculos.
8. Testar duplicidade e timeout sem provocar uma segunda criação.
9. Registrar evidências sem dados pessoais e decidir aprovação ou retorno a `SHADOW`.

## 13. Critério de contrato fechado

Este contrato muda de `0.1.0` para `1.0.0` somente quando:

- todos os valores `A_PREENCHER` estiverem aprovados;
- nomes e tipos dos campos externos de inclusão estiverem registrados;
- permissões mínimas do token estiverem comprovadas;
- respostas de sucesso, validação, duplicidade e timeout estiverem normalizadas;
- a matriz de homologação estiver assinada pelo responsável;
- nenhuma chave real ou dado pessoal estiver presente neste arquivo.
