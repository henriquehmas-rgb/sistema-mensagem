# Relatório de evolução — SEEG Omni

**Data de consolidação:** 22/08/2026  
**Ambiente:** aplicação publicada em VPS  
**Objetivo principal:** estruturar um atendimento omnichannel no qual a IA resolva a maior parte das solicitações com linguagem natural, contexto, segurança e encaminhamento humano apenas quando necessário.

## 1. Situação geral

O SEEG Omni já possui uma base funcional publicada, formada por interface web, API, serviço de IA, PostgreSQL e Redis. As evoluções realizadas até o momento concentraram-se em cinco frentes:

1. Organização do atendimento em camadas e setores.
2. Humanização e resiliência da IA.
3. Memória, aprendizado supervisionado e análise de padrões.
4. Integração segura de leitura com o IXC.
5. Validação de identidade antes do acesso a dados protegidos.

O ambiente ainda não está liberado para operação real. A homologação controlada e a homologação visual permanecem como etapas obrigatórias antes do piloto.

## 2. Estrutura do atendimento

- Organização das conversas por setor/departamento.
- Restrição de visualização e atuação dos atendentes conforme seu setor.
- Manutenção de perfis distintos: administrador, supervisor e atendente.
- Encaminhamento humano reservado para situações complexas, baixa confiança, indisponibilidade operacional ou incapacidade de resolução pela IA.
- Preservação da IA como responsável principal pelo atendimento.
- Criação de resumo do caso para facilitar a continuidade pelo atendente humano.
- Registro da necessidade identificada, destino do encaminhamento e próxima ação.
- Tratamento de conversas antigas sem contexto suficiente, evitando exibição de informações incorretas ou inventadas.
- Processo de enriquecimento retroativo de triagem para conversas legadas, sem gerar mensagens automáticas ao cliente.

## 3. Humanização da IA

- Respostas orientadas pela pergunta real do cliente e pelas informações encontradas na base, evitando textos fixos como fonte principal.
- Variações de linguagem para reduzir repetição e aparência robotizada.
- Remoção de aberturas consideradas artificiais, como o uso recorrente de “certo”.
- Níveis de conversa ajustados ao contexto, incluindo comunicação direta, cautelosa e acolhedora.
- Adequação do tom conforme o perfil conhecido do cliente, sem limitar a IA a uma única formulação.
- Continuidade de contexto entre mensagens da mesma conversa.
- Uso do histórico recente e da memória resumida do contato como camadas distintas.
- Mensagens de encaminhamento mais naturais, evitando referências explícitas a “IA”, “robô” ou processos internos.
- Respostas específicas para falha de validação, formato inválido, bloqueio temporário e indisponibilidade, sem repetição cega da mesma pergunta.
- Limite de esclarecimentos para impedir ciclos intermináveis antes do encaminhamento.
- Proteção de saída para impedir que a IA revele informações financeiras ou operacionais sem identidade validada.

## 4. Memória, repertório e aprendizado

- Memória resumida individual por contato, separada do histórico recente da conversa.
- Geração de candidatos a aprendizado a partir de atendimentos humanos concluídos.
- Aprendizado supervisionado: conteúdos novos não entram diretamente na base geral sem critérios de qualidade.
- Identificação de respostas recorrentes e padrões observados ao longo de dias, semanas e meses.
- Detecção de duplicidade por impressão digital do conteúdo.
- Pontuação de qualidade e critérios para publicação automática controlada.
- Exclusão de dados pessoais, instruções maliciosas e respostas de baixa qualidade do repertório geral.
- Separação entre experiência específica do cliente e conhecimento reutilizável pela organização.

## 5. Resiliência operacional

- Tratamento de mensagens antigas ou vazias sem criação de contexto fictício.
- Resumo provisório do caso antes da chamada ao serviço de IA, preservando informações para o atendente em caso de falha.
- Idempotência em filas e mensagens para reduzir respostas ou ações duplicadas.
- Retentativas controladas e circuit breaker nas consultas ao IXC.
- Timeout e limite de tamanho para respostas externas.
- Cache temporário de evidências operacionais, separado por empresa, conversa e tipo de consulta.
- Continuidade de consultas em múltiplos turnos sem exigir que o cliente repita toda a solicitação.
- Falha segura quando Redis, IA ou IXC não estão disponíveis.
- Encaminhamento humano quando a fonte operacional está indisponível ou a confiança é insuficiente.

## 6. Integração IXC

### Implementado

- Configuração da URL e das credenciais do IXC exclusivamente no backend.
- Credenciais armazenadas de forma cifrada.
- Token nunca enviado ao navegador ou ao serviço de IA.
- Allowlist de host e validação obrigatória de HTTPS e do caminho `/webservice/v1`.
- Proteção contra SSRF, URLs com credenciais e parâmetros inesperados.
- Teste de conexão antes da ativação da integração.
- Busca de cliente por identificador, CPF/CNPJ ou telefone.
- Consulta de contratos, faturas, ordens de serviço e conexões.
- Planejador que identifica quais recursos do IXC são necessários conforme a solicitação do cliente.
- Executor de consultas operacionais com cache e rastreabilidade.
- Respostas do IXC reduzidas por lista de campos permitidos.
- Exclusão de senha, IP, MAC, dados de Wi-Fi, Pix, linha digitável e outros dados desnecessários das respostas entregues à IA.
- Auditoria do tipo de consulta e quantidade de resultados, sem registrar CPF ou telefone.

### Fronteira atual

- O Omni permanece estritamente em modo de leitura no IXC.
- Não existem chamadas implementadas para alteração ou exclusão.
- Criação de atendimentos ou ordens de serviço permanece desativada.
- O token recebido é considerado privilegiado, pois é o mesmo utilizado pelo OPA e pode possuir permissões de escrita.
- Qualquer escrita futura deverá possuir confirmação explícita, idempotência, auditoria, allowlist de ações e regra formal de autorização.

## 7. Validação de identidade

- Exigência de identidade validada antes de consultar faturas, contratos, chamados ou outros dados protegidos.
- Validação automática por dois fatores:
  - três últimos dígitos do CPF;
  - mês de nascimento.
- Comparação realizada exclusivamente no backend contra o cadastro do IXC.
- Comparação resistente a diferenças de tempo de processamento.
- Validade da confirmação por 30 minutos.
- Máximo de cinco tentativas antes do bloqueio.
- Bloqueios progressivos de 15, 30 e 60 minutos.
- Contadores separados por empresa, contato e conversa.
- Desbloqueio manual restrito a administrador ou supervisor.
- Confirmação manual limitada ao atendimento presencial e restrita a administrador ou supervisor.
- Falha de dados do IXC, ambiguidade cadastral ou ausência do campo necessário não aprova a identidade nem consome tentativas do cliente.
- Resposta genérica: o sistema não informa qual fator estava incorreto.
- CPF e mês de nascimento não são armazenados em mensagens, auditoria, métricas ou logs.
- Redação preventiva desses campos na camada central de logs.

## 8. Validação de identidade integrada à conversa

- A IA detecta quando a solicitação exige dados protegidos.
- O backend abre um desafio temporário com duração de dez minutos.
- A IA solicita os fatores em linguagem natural, com exemplo de formato.
- A resposta do cliente é interceptada antes da persistência.
- Os valores não são enviados ao modelo de IA.
- O histórico recebe somente um marcador seguro indicando o resultado do processamento.
- Após sucesso, o sistema retoma automaticamente a intenção original e consulta o IXC.
- Formato inválido gera orientação clara sem expor detalhes internos.
- Bloqueio gera mensagem de espera, sem novas tentativas imediatas.
- Indisponibilidade da fonte provoca encaminhamento seguro.
- Mensagens legítimas com três dígitos fora de um desafio ativo não são apagadas nem alteradas.

## 9. Métricas e auditoria

- Métricas HTTP, latência da IA, profundidade das filas e saúde dos serviços.
- Métricas agregadas de validação de identidade:
  - sucesso;
  - falha;
  - bloqueio;
  - indisponibilidade;
  - desbloqueio.
- As métricas não contêm telefone, CPF, usuário ou identificador da conversa.
- Auditoria das configurações e consultas do IXC.
- Auditoria de validação, falha, bloqueio e desbloqueio sem os fatores informados.
- Registro do plano operacional executado e da origem das evidências utilizadas pela IA.

## 10. Interface e usabilidade

- Evolução da visualização da conversa com resumo operacional.
- Exibição da necessidade do cliente, setor de destino e próxima ação.
- Informações técnicas do IXC direcionadas principalmente a administradores e desenvolvedores.
- Manutenção de uma experiência mais simples para atendentes com menor familiaridade com computadores.
- Organização visual priorizando entendimento rápido, segurança e redução de confusão entre setores.

## 11. Segurança aplicada

- Isolamento de dados por organização.
- Controle de acesso por perfil e setor.
- Credenciais externas cifradas e restritas ao servidor.
- Proteção contra vazamento de segredos e dados pessoais em logs e telemetria.
- Limitação de requisições nas rotas sensíveis.
- Bloqueio progressivo contra adivinhação dos fatores de identidade.
- Operações sensíveis com comportamento fail-closed: indisponibilidade não resulta em autorização.
- Nenhuma exclusão ou alteração no IXC implementada.
- Nenhum dado operacional protegido entregue à IA antes da validação.

## 12. Validações técnicas realizadas

- Compilação e verificação de tipos da API aprovadas.
- Builds das imagens da API, web e IA aprovados na VPS.
- Health check público da API aprovado após as publicações.
- API, serviço de IA, PostgreSQL e Redis observados em estado saudável após os deploys.
- Testes direcionados de IXC, limitação de tentativas, redação de logs e validação de identidade aprovados.
- Testes de isolamento por organização, contato e conversa aprovados.
- Testes de bloqueio atômico, falha segura e encerramento do desafio aprovados.
- Na última execução completa da API, 242 de 249 testes foram aprovados. As sete falhas eram de uma fixture antiga incompatível com a regra atual de setores; a fixture foi corrigida e os 28 testes diretamente relacionados e afetados foram executados novamente com aprovação total.

## 13. Informações confirmadas com o desenvolvedor anterior

- A integração entre OPA e IXC ocorre pelo backend.
- O OPA utiliza um token de API para acessar o IXC.
- A URL informada para o IXC é a base `/webservice/v1` da instalação da SEEG.
- O conector possui capacidade de consultar a base e, conforme informado, criar atendimentos e ordens de serviço.
- Alterações não ocorrem sem intervenção humana no fluxo atual do OPA.
- O mesmo token fornecido ao Omni é utilizado pelo OPA; portanto, ele deve ser tratado como credencial de alto privilégio.
- O Omni adotará seus próprios endpoints internos e não precisa reproduzir o padrão interno do OPA.

## 14. Pendências e próximos passos

### Prioridade imediata

1. Homologar o fluxo com um cadastro autorizado do IXC.
2. Confirmar o nome e o formato real do campo de data de nascimento.
3. Confirmar que a busca pelo telefone retorna exatamente um cliente.
4. Testar fatores corretos, incorretos, formatos variados e bloqueio após cinco falhas.
5. Verificar diretamente no ambiente que os fatores não aparecem no histórico, logs ou auditoria.
6. Validar a retomada automática de consultas de fatura, contrato, conexão e ordem de serviço.

### Antes do piloto

1. Executar homologação visual com a equipe responsável.
2. Executar homologação controlada ponta a ponta pelo canal que substituirá o OPA.
3. Avaliar naturalidade, clareza e acessibilidade das mensagens com usuários de perfis diferentes.
4. Criar visualização administrativa do estado de validação e bloqueios, sem exibir fatores.
5. Definir indicadores de sucesso, taxa de resolução automática e motivos de encaminhamento.
6. Liberar piloto gradual para um grupo restrito.

### Evoluções posteriores

1. Solicitar uma credencial exclusiva do Omni com princípio de menor privilégio.
2. Definir formalmente se a IA poderá criar atendimentos ou ordens de serviço.
3. Caso autorizada, implementar escrita no IXC com confirmação, idempotência e auditoria completa.
4. Ampliar o repertório aprovado com base nos padrões reais de atendimento.
5. Revisar periodicamente respostas, métricas e critérios de encaminhamento.

## 15. Conclusão

O SEEG Omni encontra-se tecnicamente bem encaminhado: a arquitetura principal está publicada, a IA já possui contexto, memória, triagem, setores, mecanismos de aprendizado e integração operacional de leitura com o IXC. Também foi criada uma camada robusta de segurança para impedir acesso indevido a informações protegidas.

O ponto crítico atual não é uma nova implementação estrutural, mas a homologação com dados controlados do IXC. Essa etapa confirmará os campos reais da instalação e permitirá validar o funcionamento ponta a ponta antes de qualquer piloto ou autorização de escrita.
