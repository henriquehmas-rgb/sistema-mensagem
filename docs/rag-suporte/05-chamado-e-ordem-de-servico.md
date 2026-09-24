# Chamado e ordem de serviço existentes

## Finalidade

Consultar e explicar o estado atual de chamados ou ordens de serviço sem
duplicar solicitações ou prometer execução.

## Conduta aprovada

1. Validar identidade antes de consultar detalhes protegidos.
2. Confirmar o contrato e o sintoma atual quando houver ambiguidade.
3. Consultar chamado e OS existentes no IXC.
4. Avaliar duplicidade por cliente, contrato, ocorrência e janela temporal; um
   assunto parecido isoladamente não basta para concluir duplicidade.
5. Traduzir o estado retornado pela fonte em linguagem simples e informar apenas
   a próxima etapa confirmada.

## Limites

- Não prometer data de visita, prioridade, custo, prazo ou conclusão.
- Não criar chamado ou OS real nesta fase; o Omni somente prepara a proposta em
  modo sombra.
- Diante de status incoerente, ausência de evidência ou recorrência sem
  explicação, abrir GAP técnico com o histórico já disponível.
