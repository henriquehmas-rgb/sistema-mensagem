# Continuidade de CRM e follow-up

## Regra de identidade central

O CRM usa `Contact` como identidade central e `ContactIdentity` para as
identidades de canal. Um número do WhatsApp, um ID do Instagram e um visitante
Webchat podem pertencer ao mesmo contato, desde que o vínculo seja seguro:

- telefone único normalizado pode reaproveitar o contato automaticamente;
- identidade de canal já conhecida reaproveita o mesmo contato;
- vínculo Instagram ↔ WhatsApp sem telefone não é inferido por nome ou texto;
  exige mesclagem confirmada por ADMIN;
- duas memórias persistentes nunca são unidas automaticamente.

## Conversa e canal

Cada conversa mantém seu canal de entrega. Por isso, uma nova mensagem de
Instagram não pode ser anexada à conversa WhatsApp já aberta: a resposta
precisaria sair pelo canal errado. As duas conversas ficam, porém, associadas
ao mesmo `Contact`, visíveis juntas no CRM, com memória persistente central e
auditoria comum.

No mesmo canal, uma conversa não resolvida é retomada. Se já houver humano
atribuído, a IA não responde; o atendimento continua com a mesma responsável,
sem redistribuição automática. Nova mensagem somente reabre estados
`SNOOZED`/`PENDING`; conversa já resolvida inicia uma nova ocorrência no mesmo
histórico do contato.

## Follow-up

- A cadência possui quatro etapas e é sempre `REVIEW`: nenhuma etapa envia
  mensagem sem aprovação humana por canal/template.
- O responsável pelo follow-up pode ser uma única pessoa para Suporte,
  Financeiro e Vendas. Ele é separado do atendente da conversa: assumir o
  atendimento não pausa a cadência, nem transfere automaticamente a conversa.
- Só existe após consentimento explícito.
- Resposta do cliente pausa a sequência; opt-out a cancela.
- Resposta em qualquer canal vinculado pausa/cancela também sequências pendentes
  de outras conversas do mesmo contato. Assim não há duplicidade de cobrança ou
  lembrete quando o cliente troca de canal.

## Cenário de homologação sem canal real

1. Criar contato de teste e uma identidade WhatsApp sintética.
2. Abrir conversa, atribuir a humano, definir um responsável de follow-up e registrar consentimento.
3. Criar identidade Instagram sintética no mesmo contato via mesclagem
   administrativa confirmada.
4. Receber mensagem no Instagram e confirmar: histórico central preservado,
   IA não assume a conversa humana e follow-up WhatsApp é pausado pela resposta do cliente.
5. Repetir com opt-out e confirmar cancelamento da sequência.

Nenhuma dessas etapas requer WhatsApp/Instagram conectados, envio externo,
escrita no IXC ou dado real de cliente.
