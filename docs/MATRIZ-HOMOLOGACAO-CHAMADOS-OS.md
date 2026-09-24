# Matriz de homologação — chamados e ordens de serviço

## Regra de execução

- Omni/IA identifica, reúne contexto e propõe a ação.
- Regras determinísticas autorizam ou bloqueiam.
- Olho de Deus fornecerá somente evidência técnica de rede.
- O adaptador direto do IXC executará o fluxo homologado e devolverá o protocolo.
- Até a homologação, o modo permanece `SHADOW`, sem escrita externa.

## Pré-requisitos do primeiro disparo

- [ ] API de consulta e comando documentada.
- [ ] Confirmar se a credencial atual será usada apenas na homologação e rotacionada depois.
- [x] Cliente `2508` e contrato `2738` autorizados para teste.
- [x] Cliente/contrato validados para cenário de duplicidade; existe OS marcada como aberta.
- [ ] Obter outro cliente/contrato sem chamado ou OS aberta para cenário de criação limpa.
- [x] Segundo par `13054`/`13396` validado, mas também possui chamado/OS em estados abertos.
- [ ] Consulta de chamado e OS existentes validada.
- [ ] Idempotência aceita pelo IXC ou verificável por consulta direta antes de repetir.
- [ ] Protocolo IXC presente na resposta ou em consulta posterior.
- [ ] Modo `REVIEW_REQUIRED` habilitado.
- [ ] Responsável acompanhando o teste.
- [ ] Bloqueio geral de emergência disponível.

## Cenários obrigatórios

| Cenário | Resultado esperado | Protocolo esperado | Escrita no SHADOW | Aprovado |
|---|---|---:|---:|---:|
| Falha individual confirmada e sem registro aberto | `READY_TO_TRIGGER` | Não | Não | [ ] |
| OS equivalente aberta | `DUPLICATE_FOUND` | Protocolo existente | Não | [ ] |
| Mesmo assunto, mas ocorrência não identificada | `REVIEW_REQUIRED` | A confirmar | Não | [ ] |
| Mesmo assunto após ocorrência anterior resolvida | `READY_TO_TRIGGER` | Não | Não | [ ] |
| Chamado técnico semelhante, sem identidade da ocorrência | `REVIEW_REQUIRED` | A confirmar | Não | [ ] |
| OS ligada ao mesmo chamado de origem | `DUPLICATE_FOUND` | Protocolo existente | Não | [ ] |
| Rompimento coletivo | `BLOCKED` | Não | Não | [ ] |
| Cliente ou contrato ambíguo | `BLOCKED` | Não | Não | [ ] |
| Identidade não validada | `BLOCKED` antes da consulta | Não | Não | [ ] |
| Confiança abaixo do mínimo da skill | `BLOCKED` antes da consulta | Não | Não | [ ] |
| `mappingKey` desconhecida ou incompatível | `BLOCKED` antes da consulta | Não | Não | [ ] |
| Financeiro ou vendas tentando criar OS | `BLOCKED` | Não | Não | [ ] |
| IXC indisponível | `BLOCKED` | Não | Não | [ ] |
| Olho de Deus indisponível | `BLOCKED` | Não | Não | [ ] |
| Timeout depois do disparo | `UNCERTAIN` e consulta por idempotência | A confirmar | Uma única tentativa | [ ] |

## Registro de cada execução

- Data e responsável:
- Cliente/contrato de homologação:
- Cenário:
- Resposta esperada:
- Resposta obtida:
- Evidências utilizadas:
- Estado final:
- Protocolo IXC:
- Duplicidade evitada:
- Mensagem exibida ao cliente:
- Tempo total:
- Observações e decisão de aprovação:

## Critério de avanço

O modo `REVIEW_REQUIRED` só poderá ser ativado quando todos os cenários em `SHADOW`
forem aprovados. Automação sem revisão exige uma segunda homologação e autorização
expressa do responsável técnico.

Mesmo após uma aprovação interna, o `IxcWriteExecutor` bloqueia fisicamente o transporte enquanto
`effectiveMode=SHADOW` ou `externalWriteEnabled=false`. O transporte de inclusão real ainda não está
conectado; resposta sem identificador homologado é sempre tratada como `UNCERTAIN`.
