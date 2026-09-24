# Pipeline offline do histórico do OPA

## Finalidade

Preparar conversas históricas autorizadas para análise, replay e aprendizagem
supervisionada. O OPA não participa do atendimento em produção e nenhum item é
publicado automaticamente no RAG.

## Entrada neutra

```json
{
  "conversations": [
    {
      "id": "identificador-no-opa",
      "department": "Suporte",
      "status": "encerrado",
      "messages": [
        { "direction": "inbound", "text": "mensagem do cliente", "createdAt": "..." },
        { "direction": "outbound", "text": "resposta humana", "createdAt": "..." }
      ]
    }
  ]
}
```

O adaptador definitivo deverá apenas converter o retorno real da API do OPA para
esse formato. Campos desconhecidos são ignorados.

## Processamento

1. Lê uma exportação fornecida explicitamente.
2. Descarta metadados pessoais não necessários.
3. Pseudonimiza o identificador da conversa usando HMAC e salt externo.
4. Remove CPF, contatos, URLs, segredos e identificadores numéricos extensos.
5. Forma pares de pergunta do cliente e resposta humana.
6. Classifica suporte, financeiro, vendas ou ambíguo.
7. Avalia qualidade e riscos.
8. Separa deterministicamente:
   - `REVIEW_PENDING`: candidato para revisão humana;
   - `REPLAY_ONLY`: reservado exclusivamente para avaliação da IA;
   - `QUARANTINED`: conteúdo insuficiente, ambíguo ou arriscado.

## Execução futura

```powershell
$env:OPA_IMPORT_SALT = "segredo-com-ao-menos-16-caracteres"
services\ai\.venv\Scripts\python.exe tools\prepare_opa_history.py `
  --input C:\caminho\exportacao-opa.json `
  --output C:\caminho\opa-anonimizado.json
```

O arquivo de saída deve permanecer fora do repositório e ter acesso restrito.
Nunca utilizar credenciais reais como salt.

## Barreiras obrigatórias

- Nenhum conteúdo entra automaticamente no RAG.
- Casos de replay nunca entram na base de aprendizagem.
- Conteúdo comercial, incerto ou ambíguo entra em quarentena.
- A sanitização automática não substitui revisão humana de privacidade.
- A exportação original deve seguir política de acesso, retenção e descarte do Grupo SEEG.
