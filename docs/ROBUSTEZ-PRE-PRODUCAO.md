# Robustez antes de produção

Objetivo: aumentar tolerância a variações humanas e falhas temporárias sem
afrouxar segurança, fontes factuais ou controles operacionais.

## Princípio de flexibilidade controlada

O Omni deve preservar o contexto já confirmado, aceitar linguagem natural,
abreviações e formatação comum, e pedir apenas o próximo dado indispensável.
Flexibilidade nunca autoriza consulta de conta sem identidade válida, promessa
comercial sem fonte, criação externa ou inferência de impacto individual de rede.

## Ciclos internos

1. Contexto e linguagem: variações de identidade, continuidade, troca explícita
   de setor, mensagens curtas e informações já fornecidas.
2. Resiliência técnica: IA, IXC, Redis e Olho de Deus indisponíveis devem virar
   incidente técnico com resposta segura e recuperação, não GAP de RAG.
3. Ordem e idempotência: mensagens rápidas, retries e webhooks repetidos não
   podem inverter respostas nem duplicar ações, follow-ups ou encaminhamentos.
4. Conhecimento e segurança: RAG aprovado por setor, conflito de fonte,
   resposta sem evidência e tentativa de instrução maliciosa.
5. Operação recuperável: auditoria, logs sem PII, backup, rollback e métricas
   de regressão executáveis sem canal externo.

## Ciclo 2 — resiliência técnica e aprendizagem limpa

- A falha final do provedor de IA preserva o resumo do caso e responde com uma
  contingência que não pede que a pessoa repita o relato.
- Indisponibilidade de IXC ou Olho de Deus passa a prevalecer sobre uma razão
  genérica emitida pelo modelo: é sempre incidente técnico, nunca candidato de
  RAG. Com as fontes disponíveis, um GAP de conhecimento real continua sendo
  elegível para curadoria.
- Redis continua *fail closed* para a validação de identidade: não libera
  consulta protegida se a proteção estiver indisponível, mas a conversa segue
  com orientação pública e segura.

## Ciclo 3 — ordem e idempotência

- O histórico enviado à IA tem desempate estável por ID quando duas mensagens
  possuem o mesmo timestamp. Assim, mensagens rápidas não invertem o contexto
  entre tentativa, worker ou reprocessamento.
- O processor mantém coalescência pelo último inbound e idempotência após uma
  resposta persistida; reentregas de webhook não repetem automações nem uma
  resposta já criada.

## Ciclo 4 — conhecimento e segurança

- O RAG só concorre dentro do setor atual; fontes aprovadas conflitantes sobre
  preço, prazo ou outro fato quantitativo seguem para revisão, sem o modelo
  escolher uma delas silenciosamente.
- Contexto recuperado, memória e evidência operacional agora são instruídos de
  forma explícita como dados, não comandos. Uma tentativa de alterar regras,
  identidade ou ações dentro desses blocos não recebe autoridade.

## Regra de liberação interna

Cada ciclo precisa ter cenário determinístico, teste automatizado, resultado
auditável e regressão integrada ao smoke portátil. Falha nova gera teste antes
de correção; correção que crie rigidez injustificada deve voltar para revisão.
