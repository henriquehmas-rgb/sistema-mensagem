# Fluxo de Suporte — evento regional

Este fluxo é exclusivo de **Suporte**. Ele não reutiliza dados, regras ou decisões de Financeiro e Vendas.

## Quatro fases obrigatórias

1. **Identificar o cliente.** O Omni acolhe o relato e confirma o vínculo com o cadastro/contrato correto pelo desafio de identidade homologado. CEP, endereço e coordenadas não fazem parte do fluxo normal de Suporte.
2. **Consultar as fontes antes de diagnosticar.** Com o vínculo confirmado, lê IXC (conexão, chamados, OS e o equipamento FTTH ligado ao contrato) e Olho de Deus/OLT como evidência de rede. No IXC, a leitura do endpoint `radpop_radio_cliente_fibra` é filtrada primeiro por `id_contrato` e, quando existe uma única caixa vinculada, por `id_caixa_ftth` para obter somente uma coorte agregada. Sinal registrado não é tratado como disponibilidade atual ou rompimento; ele só compõe a correlação factual. Ausência de leitura não é ausência de evento.
3. **Tratar evento coletivo confirmado.** No IXC, a confirmação não é inferida: exige a cadeia `radusuarios` → `su_oss_chamado_regiao_manutencao_radusuarios` → `su_oss_chamado`, com o login do assinante listado como afetado e uma OS de estrutura (`tipo=E`, `status=A`) ativa. Olho de Deus/OLT continua como fonte independente de correlação. Se uma dessas fontes confirmar evento coletivo ligado ao cliente/região, o Omni:
   - registra uma ocorrência operacional deduplicada para o NOC;
   - não abre OS individual nem pede testes individuais repetidos;
   - informa apenas o evento confirmado, sem estimar prazo ou prometer retorno.
4. **Diagnosticar somente quando não houver confirmação coletiva.** Se a evidência estiver inconclusiva, indisponível ou não confirmar evento, o Omni não nega rompimento: segue uma pergunta diagnóstica segura por vez e só considera chamado/OS depois de checar duplicidade e falha individual.

O registro regional usa uma chave opaca derivada da OS estrutural ou do evento externo, sem endereço, contrato, cliente ou conteúdo da conversa. A ocorrência aparece no painel operacional e notifica o canal de operações configurado; a integração continua sem escrita no IXC e não cria OS automaticamente. A primeira homologação lê somente essas rotas e confirma os valores reais retornados pelo IXC; resposta fora do contrato permanece inconclusiva, nunca negativa.
