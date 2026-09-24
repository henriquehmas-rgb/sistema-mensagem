# Aprendizagem linguística pontual

## Primeiro recorte: aberturas sociais

Uma fila diária examina, fora do caminho da resposta, até mil conversas encerradas mais recentes por organização nos últimos 30 dias. Somente conversas com intenção específica (suporte, financeiro ou vendas), confiança de triagem de pelo menos 0,85 e sem conflito fornecem amostras. São consideradas apenas as duas primeiras mensagens textuais consecutivas do cliente.

Uma forma de saudação só é ativada após aparecer em pelo menos três conversas independentes e dois setores distintos, ser curta e próxima das formas sociais conhecidas, e não conter dígitos, contato, identificadores ou termos operacionais/comerciais/financeiros. O catálogo guarda apenas a frase normalizada, a contagem de evidências e a quantidade de setores; não guarda texto bruto, cliente nem resposta humana.

No atendimento, a regra estática continua sendo a primeira opção. Uma frase nova e socialmente próxima é comparada apenas com o catálogo da própria organização, carregado antes de o serviço ficar pronto e atualizado em segundo plano a cada cinco minutos. Não há consulta ao banco por mensagem. A equivalência pode apenas produzir uma saudação; não escolhe setor, não consulta cadastro, não cria resposta factual e não autoriza ação. Se a atualização falhar, o último catálogo válido permanece em memória; no primeiro início sem catálogo, prevalece o comportamento estático.

Casos sem evidência suficiente ou com conteúdo sensível não são ativados automaticamente. Continuam nos fluxos atuais e só devem ser investigados pontualmente quando houver falha observada; não há fila de revisão por mensagem. O catálogo não é fonte do RAG, não usa a importação histórica do OPA e não mede, por si só, taxa de acerto de 90%.

## Publicação e validação

Aplicar a migração `000000000036_add_language_variants` antes de iniciar a API e o serviço de IA atualizados. Em homologação, confirmar: saudação conhecida; variante nova ativada por amostras de suporte, vendas e financeiro; pedido real misturado à saudação; isolamento entre organizações; comportamento com tabela indisponível. A publicação em produção deve manter o piloto controlado e observar a fila `language-learning` e eventuais avisos de consulta indisponível.
