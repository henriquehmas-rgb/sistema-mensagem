# Relatório inicial de teste conversacional — 03/09/2026

**Ambiente:** VPS, provedores reais, política `SHADOW`  
**Persistência:** nenhuma conversa ou cliente foi criado; somente métricas normais de consumo de IA  
**Escrita IXC:** desabilitada

## Resultado final

| Cenário sintético | Resultado |
|---|---|
| “to sem net, consegue olhar pra mim?” | Classificado como Suporte e solicitou 3 últimos dígitos do CPF + mês de nascimento antes da consulta |
| Fonte operacional indisponível | Gerou GAP de Suporte, sem inventar causa ou resposta |
| Queda após oscilação de energia com orientação aprovada | Orientou desligamento por 30 segundos, religamento e confirmação do resultado; não sugeriu reset |
| Pedido de desconto especial | Gerou `commercial_approval_required` e roteou para Vendas |
| “não, obrigado” após resolução | Encerrou naturalmente em nome do Grupo SEEG |

## Correções encontradas e aplicadas

1. A abreviação “sem net” inicialmente caía em Atendimento Geral; passou a ser reconhecida como Suporte.
2. “Não, obrigado” após oferta de ajuda inicialmente reabria a triagem; passou a encerrar a conversa.
3. Desconto era bloqueado, mas caía na fila Geral; passou a gerar GAP na fila de Vendas.

## Controles confirmados

- identidade antes de consulta protegida;
- GAP seguro quando a fonte não responde;
- orientação somente a partir de evidência/procedimento aprovado;
- bloqueio de condição comercial sem autorização;
- encerramento natural e variável;
- nenhuma escrita externa;
- homologação automatizada posterior: 10/10.

## Próxima ampliação recomendada

Executar uma matriz maior com erros ortográficos, mensagens fragmentadas, troca de assunto, cliente frustrado, múltiplos contratos, tentativa de engenharia social, recorrência e respostas do responsável ao GAP. A avaliação humana deve pontuar naturalidade, clareza e adequação; aprovação automática não substitui esse aceite.
