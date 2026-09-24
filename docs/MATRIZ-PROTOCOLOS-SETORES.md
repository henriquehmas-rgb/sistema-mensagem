# Matriz inicial de protocolos — SEEG Omni

**Estado:** estrutura de governança; procedimentos ainda dependem de validação dos responsáveis  
**Setores oficiais:** Suporte, Financeiro e Vendas  
**Regra:** nenhum protocolo desta matriz está automaticamente autorizado ou ativo.

## Princípios comuns

Todo protocolo deve registrar:

- setor e responsável;
- objetivo e escopo;
- gatilhos e variações de escrita;
- dados obrigatórios;
- necessidade de validação de identidade;
- fontes oficiais permitidas;
- consultas operacionais autorizadas;
- sequência determinística de diagnóstico/atendimento;
- ações permitidas e proibidas;
- condição de conclusão;
- condição de GAP;
- condição de revisão humana;
- validade e periodicidade de revisão;
- exemplos aprovados e testes negativos;
- versão, estado e histórico de aprovação.

Ciclo obrigatório:

```text
DRAFT → IN_REVIEW → APPROVED → ACTIVE
```

## Suporte — prioridade do primeiro piloto

| Protocolo | Estado | Observação |
|---|---|---|
| Falta de conexão | DRAFT existente | Revisar fonte, identidade, diagnóstico e duplicidade de chamado/OS |
| Lentidão/instabilidade | DRAFT existente | Revisar medições, contexto, ocorrências coletivas e limites de promessa |
| Reinício seguro | DRAFT existente | Validar equipamentos, riscos e situações em que não orientar reinício |
| Acompanhamento de chamado | DRAFT existente | Exige identidade e fonte operacional atual |
| Rompimento/indisponibilidade coletiva | A CRIAR | Integrar evidência do IXC/Olho de Deus sem inventar prazo |
| Visita técnica | A CRIAR | Verificar diagnóstico concluído, duplicidade e critérios de OS |
| Alteração de Wi-Fi | A CRIAR | Definir orientação permitida e ações remotas bloqueadas |
| Bloqueio/desbloqueio técnico | A CRIAR | Cruzar identidade, contrato e situação autorizada |

**Ativação:** somente após nomeação do responsável de Suporte, fontes oficiais e homologação fechada.

## Financeiro

| Protocolo | Estado | Observação |
|---|---|---|
| Segunda via de fatura | A CRIAR | Exige identidade e seleção inequívoca do título |
| Pagamento não reconhecido | A CRIAR | Consultar fonte atual; divergência gera GAP |
| Negociação financeira | A CRIAR | Condições não publicadas exigem aprovação humana |
| Nota fiscal | A CRIAR | Exige procedimento e fonte oficial |
| Vencimento e atualização de título | A CRIAR | Não prometer alteração sem ação autorizada |
| Situação contratual relacionada a cobrança | A CRIAR | Exige identidade e limites de exposição definidos |

**Ativação:** bloqueada até nomeação do responsável Financeiro, revisão de privacidade e estabilidade do piloto de Suporte.

## Vendas

| Protocolo | Estado | Observação |
|---|---|---|
| Consulta de cobertura | A CRIAR | Usar somente fonte atual e endereço permitido |
| Planos e campanhas publicadas | A CRIAR | Informar apenas condições oficialmente vigentes |
| Upgrade/downgrade | A CRIAR | Confirmar contrato e elegibilidade; execução permanece bloqueada |
| Nova contratação | A CRIAR | Definir dados mínimos, consentimento e próximo passo permitido |
| Retenção/cancelamento | A CRIAR | Especialidade de Vendas; identidade e regras formais obrigatórias |
| Proposta personalizada | A CRIAR | Sempre exige revisão humana autorizada |
| Desconto ou condição especial | A CRIAR | Sempre gera GAP comercial específico |

**Ativação:** bloqueada até nomeação do responsável de Vendas, regras comerciais oficiais e aceite das fases anteriores.

## Ordem de elaboração

1. Finalizar os quatro rascunhos existentes de Suporte.
2. Criar e homologar os protocolos adicionais de Suporte necessários ao piloto.
3. Estruturar Financeiro sem ativação.
4. Estruturar Vendas sem ativação, com proteção comercial reforçada.
5. Ativar cada protocolo individualmente após responsável, fonte, testes e aprovação.

## Informações humanas necessárias

Para transformar uma linha em protocolo executável, solicitar ao responsável do setor:

1. Qual resultado correto encerra o atendimento?
2. Quais informações são obrigatórias antes de responder ou agir?
3. Qual fonte é oficial e quem a mantém?
4. O que a IA pode consultar, informar e propor?
5. O que a IA nunca pode fazer?
6. Em quais situações deve abrir GAP?
7. Quais erros operacionais já acontecem hoje e precisam ser prevenidos?
8. Qual é a validade do procedimento?

Sem essas respostas, o protocolo permanece `DRAFT` e não deve entrar no prompt como protocolo ativo.
