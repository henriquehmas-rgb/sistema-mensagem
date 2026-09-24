# MCP de governança e camadas de reforço

## Papel no Omni

O MCP não substitui o motor conversacional, o RAG ou as skills. Ele é a camada
de contrato entre o Omni e uma fonte externa: declara o que pode ser
consultado, quando a identidade é necessária, se existe escrita habilitada e
como o retorno deve ser interpretado.

O contrato comum usa `CONFIRMED`, `NOT_FOUND`, `UNAVAILABLE` e `AMBIGUOUS`.
Os dois últimos nunca podem virar GAP de aprendizagem: `UNAVAILABLE` é
incidente técnico; `AMBIGUOUS` requer mais evidência ou revisão. Escritas
externas continuam desligadas.

Para observabilidade, IXC e Olho de Deus registram o mesmo evento
`mcp_integration_outcomes_total`. Seus rótulos são fechados: integração,
estado da fonte (`SUCCESS`, `EMPTY`, `NOT_FOUND`, `AMBIGUOUS` ou
`UNAVAILABLE`), estado MCP e disposição de aprendizagem. Nenhum rótulo pode
conter cliente, conversa, telefone, texto livre, OLT, PON ou credencial.

| Integração | Papel | Situação |
|---|---|---|
| IXC | fonte cadastral e sistema de registro | perfil governado; identidade para dados protegidos |
| Olho de Deus | evidência de rede | MCP somente leitura, HTTPS validado, correlação individual em sombra |

## Cinco camadas de reforço

1. **Higiene RAG:** aposentar a fonte `mock:v1` após confirmar que não é usada
   em regressão.
2. **RAG factual de Suporte:** artigos aprovados para LOS, lentidão, Wi-Fi,
   teste sem cabo, telefonia e chamado/OS. OPA só produz linguagem, nunca fatos.
3. **Follow-up fechado:** validar consentimento, recusa, pausa por nova
   mensagem, revisão humana e encerramento no Webchat.
4. **Topologia IXC–Olho de Deus:** manter três eventos, dois dias e confirmação
   humana antes de aplicar evento coletivo a cliente individual.
5. **Aprendizagem controlada:** autopublicação somente com 90%, regressão,
   versionamento e rollback; PII, preço e ação operacional exigem revisão.

## Sequência segura

1. Consultas retornam o contrato comum.
2. Skills usam apenas `CONFIRMED`; `UNAVAILABLE` cria incidente e `AMBIGUOUS`
   pede evidência adicional ou revisão.
3. RAG recebe somente fontes aprovadas do setor em rota e material global.
4. Follow-up só inicia após consentimento e segue em revisão humana.
5. Escritas no IXC e canais ficam fora do MCP até possuírem autorização,
   idempotência, auditoria e rollback próprios.
