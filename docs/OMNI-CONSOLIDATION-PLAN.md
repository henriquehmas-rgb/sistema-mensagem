# Plano de consolidação — SEEG Omni

## Objetivo

Levar Suporte, Financeiro e Vendas a uso intenso controlado, com contexto
preservado, respostas factuais, encaminhamento somente quando necessário e
operações externas ainda protegidas por gates explícitos.

## Regras permanentes

- IXC e Olho de Deus são fontes factuais; OPA é somente fonte de linguagem e
  cenários anonimizados.
- Nenhuma escrita no IXC, criação real de chamado/OS, envio de WhatsApp ou
  Instagram é habilitada por este plano.
- Cancelamento, retenção, preço, desconto, condições especiais e dados da
  conta continuam sujeitos às regras de identidade e revisão humana.
- Conversas de homologação são identificadas e encerradas ao final.
- Incidente técnico não é GAP de aprendizagem.

## Etapas

1. **Roteamento sem setor operacional Geral** — `general` passa a ser somente
   uma transição curta de desambiguação para Suporte, Financeiro ou Vendas.
   Critério: nenhuma conversa permanece em fila Geral por falta de clareza.
2. **Cancelamento e retenção seguros** — ativar somente triagem, coleta mínima
   e revisão humana; sem cancelamento, oferta ou alteração autônoma.
3. **RAG e avaliação robustos** — ampliar artigos aprovados e matriz de
   regressão para pelo menos 20 cenários por setor, incluindo trocas de assunto
   e falta de evidência.
4. **Governança de GAPs e incidentes** — corrigir histórico e painel para
   separar lacuna factual, baixa confiança/revisão e indisponibilidade técnica.
5. **Estado conversacional por setor** — estender o estado estruturado de
   Suporte para qualificação de Vendas e contexto público/protegido de
   Financeiro.
6. **Memória e follow-up homologados** — medir cobertura/idade/falhas da
   memória e validar consentimento, opt-out, cadência e encerramento no Webchat.
7. **Correlação IXC–Olho de Deus** — calibrar mapeamentos e evidências antes
   de qualquer decisão individual baseada em evento coletivo.
8. **Canais reais graduais** — configurar um canal por vez, credenciais,
   template aprovado, teste fechado, monitoramento e rollback.

## Sequência de execução

Iniciar pelas etapas 1–4. Depois de homologadas, seguir da 5 à 8 sem reduzir
os gates de segurança acima.

## Andamento

| Etapa | Situação | Evidência de fechamento |
|---|---|---|
| 1. Roteamento sem Geral | Concluída | `unrouted` não atribui fila; departamento Geral desativado; regressão aprovada. |
| 2. Cancelamento e retenção | Concluída | Duas skills ativas somente para triagem e revisão humana; ações sensíveis continuam proibidas. |
| 3. RAG e avaliação | Concluída | Matriz factual ampliada para 30 cenários, todos aprovados na organização. |
| 4. GAPs e incidentes | Concluída | Painel separa incidente e revisão; 15 registros históricos reclassificados com auditoria. |
| 5. Estado conversacional por setor | Em validação | Suporte, Vendas e Financeiro preservam somente marcos estruturados e sem PII. |
| 6–8 | Aguardando próxima rodada | Mantêm todas as travas de operação externa. |
