# Contrato de estado operacional da conversa

## Objetivo

Cada conversa ativa possui um snapshot operacional curto, persistido em
`ConversationOperationalState`. Ele estabiliza o próximo passo do atendimento
quando a janela textual da IA é reduzida, quando o cliente muda a forma de
descrever o problema ou quando uma resposta precisa ser retomada.

Esse snapshot não substitui o histórico, a memória do contato, o IXC, o Olho
de Deus nem o RAG. Cada camada mantém sua própria responsabilidade.

## Fonte de verdade e limites

| Informação | Camada responsável | O que pode ficar no estado curto |
| --- | --- | --- |
| Texto e cronologia completa | Mensagens do CRM | Nunca duplicar o histórico bruto. |
| Preferências duradouras do cliente | Memória do contato | Somente resumo governado, fora deste snapshot. |
| Cliente, contrato, fatura, OS e chamado | IXC | Apenas a necessidade/resultado normalizado da consulta. |
| Incidente coletivo e rede | Olho de Deus | Apenas evidência normalizada, nunca resposta bruta. |
| Procedimento e linguagem aprovada | RAG/skills | Nunca fato inventado pelo estado. |
| Próxima pergunta/etapa | Estado operacional | Enum sem PII, auditável por conversa. |

O estado curto não armazena CPF, telefone, endereço, cidade, bairro, fatura,
conteúdo de mensagens ou respostas cruas de integrações.

## Estado por setor

### Suporte

Mantém sintoma atual, LEDs observados, abrangência em aparelhos, reinício,
indisponibilidade de teste por cabo, confirmação de identidade e `nextStep`.

`nextStep` é a pergunta pendente formal. A ordem obrigatória é:

1. explicar/diagnosticar de forma segura sem consulta individual;
2. pedir somente a evidência técnica ainda necessária;
3. pedir identidade apenas quando a consulta individual for realmente exigida;
4. consultar fontes aprovadas ou aplicar orientação segura;
5. encaminhar apenas quando faltar evidência real ou houver regra de segurança.

### Financeiro

Mantém a categoria da demanda e o estado de identidade. Política geral pode
ser respondida sem identificação; segunda via, pagamento próprio e efeitos de
cancelamento exigem a identidade somente antes da consulta individual.

### Vendas

Mantém perfil, uso predominante, presença mínima de região/endereço e resultado
normalizado da cobertura. Localização textual não é copiada para o snapshot.
A etapa factual somente pode seguir com fonte oficial; resultado inconclusivo
não autoriza promessa de cobertura ou plano.

## Transições entre setores

- Uma intenção explícita pode trocar a rota.
- Continuação genérica preserva a rota operacional anterior quando há evidência.
- Um estado de Suporte, Financeiro ou Vendas nunca é carregado para outro setor.
- `unrouted` é desambiguação curta, não uma quarta fila nem um setor humano.
- Handoff preserva o histórico no CRM e registra motivo, setor, confiança e
  classificação; não reinicia o estado do atendimento.

## Invariantes de segurança

1. Identidade válida é reavaliada a cada turno que requer consulta individual.
2. Falha de IXC, Olho de Deus, provedor de IA ou validação é incidente técnico,
   não GAP de aprendizagem.
3. Ausência de fonte factual impede promessa, escrita no IXC ou criação real de
   chamado/OS.
4. Uma mesma etapa não deve ser repetida após ter sido registrada como concluída.
5. Toda mudança de estado é auditada com rota e `nextStep`, sem PII.

## Critério de regressão

Antes de publicar alteração de IA, RAG, skill ou integração, validar:

- contexto mantido após sair da janela textual;
- mudança de LOS vermelho para apagado sem retornar ao alarme anterior;
- identidade adiada em diagnóstico técnico e exigida em consulta individual;
- separação entre suporte, financeiro e vendas;
- ausência de repetição da pergunta pendente;
- ausência de vazamento de fatos ou dados entre setores.
