# Implementação das etapas 1 a 11 — SEEG Omni

**Atualizado em:** 26/08/2026  
**Escopo:** evolução possível com as informações confirmadas no IXC, OPA e Olho de Deus.  
**Princípio de produto:** a IA é responsável pelo atendimento. Uma pessoa participa internamente apenas diante de GAP real de conhecimento ou autoridade; depois da orientação, a IA continua com o cliente.

## Resultado por etapa

| Etapa | Entrega | Estado |
|---|---|---|
| 1 | Fronteiras e contratos de integração auditados | Concluída |
| 2 | Consultas IXC ampliadas para clientes, contratos, conexões, faturas, OS e tickets | Concluída em leitura |
| 3 | Catálogos IXC de assuntos, planos e perfis de velocidade | Concluída em leitura |
| 4 | Triagem em Financeiro, Suporte e Vendas, com variações de escrita e erros comuns | Concluída |
| 5 | Identidade protegida antes de contratos, faturas, chamados e OS | Concluída |
| 6 | Memória curta, memória longa, RAG e evidências operacionais combinadas no atendimento | Concluída |
| 7 | Comunicação natural por nível de conversa, sem abertura robótica e sem apresentação espontânea como IA | Concluída |
| 8 | Canal interno de dúvida com fila para administrador/supervisor | Concluída |
| 9 | Resposta do responsável reinjetada no contexto e retomada automática pela IA | Concluída |
| 10 | Simulador de ticket/OS com deduplicação e nenhuma escrita externa | Concluída |
| 11 | Contrato inicial do Olho de Deus e normalização de eventos em simulação | Concluída no limite das informações confirmadas |

## Comportamento implementado

### IA como responsável principal

- Reclamações, cancelamentos, linguagem ofensiva e presença de CPF não transferem automaticamente o atendimento.
- A IA consulta memória da conversa, memória do contato, RAG e IXC antes de declarar GAP.
- GAPs são usados para falta real de informação, baixa confiança, indisponibilidade crítica ou necessidade de autoridade.
- O cliente recebe uma mensagem natural informando que a situação será confirmada com o responsável.
- A conversa não muda para uma etapa humana e a IA não é desativada.

### Canal interno de GAP

- Uma dúvida pendente por conversa, evitando duplicação em retries ou mensagens repetidas.
- Tela **Configurações → Dúvidas da IA** disponível para ADMIN e SUPERVISOR.
- O responsável fornece somente a orientação interna.
- A orientação gera novo processamento da IA e fica registrada para auditoria.
- Após uso, o GAP muda de `ANSWERED` para `APPLIED`.

### IXC

- Todas as rotas implementadas continuam exclusivamente em leitura.
- Consultas protegidas exigem identidade válida por 30 minutos.
- O retorno é reduzido a campos seguros; senha, IP, MAC, boleto, PIX e linha digitável não são expostos.
- Tickets foram adicionados às evidências operacionais da IA.
- Assuntos, planos e perfis de velocidade possuem endpoints administrativos de catálogo.
- O simulador compara tickets e OS abertas antes de sugerir uma nova solicitação.
- Nenhuma função `POST`, `PUT`, alteração ou exclusão no IXC foi habilitada.

### OPA

- O inventário observado foi transformado em taxonomia e candidatos de conhecimento em `docs/OPA-KNOWLEDGE-CANDIDATES.md`.
- O material não entra automaticamente no RAG: permanece `PENDING REVIEW` para evitar aprendizado incorreto.
- Respostas humanas podem virar repertório somente pelo fluxo revisável já existente.

### Olho de Deus

Capacidades confirmadas e representadas no contrato:

- monitora OLTs;
- identifica porta PON/rota;
- consulta o IXC para estimar clientes afetados;
- publica alertas no Discord.

Capacidades mantidas explicitamente como **não confirmadas**:

- API consumível pelo Omni;
- leitura programática de eventos;
- criação de ticket ou OS;
- interrupção de ações externas.

O adaptador atual apenas normaliza eventos em modo `SIMULATION` e nunca executa ação externa.

## Segurança e resiliência

- Token IXC cifrado e nunca devolvido ao navegador.
- Allowlist de host contra SSRF.
- Identidade por três últimos dígitos do CPF e mês de nascimento.
- Bloqueio temporário depois de cinco falhas, sem bloqueio definitivo do canal.
- Cache de evidências por recurso e circuit breaker para falhas do IXC.
- Auditoria para consulta, GAP, orientação e simulação operacional.
- Deduplicação determinística por SHA-256 para intenção/cliente/contrato/assunto.
- Nenhuma credencial foi incluída nesta documentação.

## Validação executada

- API NestJS: **31 arquivos / 256 testes aprovados**.
- Serviço de IA: **127 testes aprovados**.
- TypeScript API e Web: `typecheck` aprovado.
- Build da API: aprovado.
- Build Web: código compilado, tipos e 11 páginas aprovados. A cópia final standalone falhou somente no Windows por restrição de criação de symlink; deve ser validada no build Docker Linux da VPS.

## Pendências para ativação real

1. Executar o build Docker Linux e aplicar a migration `000000000012_add_knowledge_gaps`.
2. Fazer homologação visual da tela de dúvidas.
3. Fazer homologação controlada ponta a ponta no suporte.
4. Obter contrato técnico/API do Olho de Deus antes de conectar eventos reais.
5. Definir autorização, aprovação e credencial de menor privilégio antes de qualquer escrita no IXC.
6. Importar conteúdo OPA no RAG somente após revisão dos responsáveis.

## Critério para as etapas 16 a 20

As etapas posteriores devem começar apenas depois da homologação das entregas acima. Elas envolvem ativação progressiva, métricas reais, calibração de confiança, integração efetiva com o Olho de Deus e eventual escrita controlada no IXC. A base técnica está pronta para isso, mas nenhuma capacidade externa não confirmada deve ser presumida.
