# Pendências de alinhamento técnico

## Perguntas para o líder tech

1. A IA poderá consultar automaticamente dados do IXC durante a conversa?
2. Quais dados financeiros ela poderá mencionar ao cliente?
3. ~~Será necessário validar a identidade antes de mostrar faturas, contratos ou chamados?~~ **Definido:** sim.
4. ~~Quais situações devem obrigatoriamente ir para atendimento humano?~~ **Diretriz definida:** casos de alta complexidade ou que a IA não consiga resolver; falta detalhar os gatilhos objetivos.
5. A IA poderá abrir solicitações futuramente ou permanecerá apenas consultiva?
6. Qual é a tolerância aceitável para indisponibilidade e lentidão do IXC?
7. Por quanto tempo dados do IXC podem permanecer em cache?
8. Quais informações podem aparecer nos logs e nas auditorias?
9. A primeira operação deve ser assistida, com resposta sugerida ao atendente, ou automática?
10. A ativação automática será gradual por setor, tipo de solicitação ou grupo de clientes?

## Itens agendados para uma etapa posterior

- Homologação visual da integração IXC.
- Homologação controlada pelo painel administrativo.

## Decisões temporárias enquanto aguardamos alinhamento

- IXC estritamente em modo de leitura.
- Nenhum token exposto será persistido.
- Sem cache de dados pessoais ou financeiros até a política de retenção ser aprovada.
- A automação da IA não realizará alterações no IXC.

## Decisões confirmadas

### Validação de identidade

- A identidade do cliente deve ser validada antes de exibir faturas, contratos ou chamados.
- O reconhecimento do número de telefone ajuda a localizar o cadastro, mas não será considerado autenticação suficiente isoladamente.
- Antes da homologação, nenhum dado protegido será usado em resposta automática.

### Encaminhamento para atendimento humano

- Encaminhar quando a IA classificar o caso como de alta complexidade.
- Encaminhar quando a IA não encontrar uma resposta confiável ou não conseguir concluir o atendimento.
- Usar uma regra híbrida: avaliação de complexidade/confiança pela IA mais gatilhos determinísticos para situações críticas.
- Preservar contexto, resumo, consultas já realizadas e motivo do encaminhamento para evitar que o cliente repita tudo.
