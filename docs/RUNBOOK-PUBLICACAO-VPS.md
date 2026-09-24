# Runbook de publicação na VPS

## Caminho homologado

Use o cliente SSH em Python com a chave `SEEG-Omni-Onboarding/sm-colab_vps_key` e a verificação de host em `work/.seeg_known_hosts`. No servidor, a única elevação necessária é o comando exato abaixo; não usar uma sonda genérica como `sudo -n true`.

```bash
sudo -n /usr/bin/docker compose \
  -f /docker/sistema-mensagem/infra/docker-compose.yml \
  --env-file /docker/sistema-mensagem/.env
```

Se o cliente Python temporário estiver indisponível por bloqueio local, use
`C:\\WINDOWS\\System32\\OpenSSH\\scp.exe`/`ssh.exe` com a mesma chave e o mesmo
`known_hosts`. Como o executor do Codex é uma conta local distinta, copie a chave para um
arquivo temporário de propriedade do executor e conceda leitura somente a essa conta; não altere
a ACL nem o conteúdo da chave original. Essa cópia é somente um mecanismo local para o OpenSSH,
que recusa chaves com ACL compartilhada.

## Sequência

1. Validar somente leitura: diretório da aplicação e executável `/usr/bin/docker`.
2. Enviar o pacote e o script de publicação por SFTP autenticado com a chave acima.
3. Para releases empacotadas que alterem a API, executar `tools/release-api-guard.sh` no servidor. Ele valida o contrato entre código e variáveis de ambiente **antes** da build, cria backup apenas dos arquivos do pacote, reconstrói a API e reverte se o healthcheck falhar.
4. Confirmar `Health: healthy` pelo mesmo `docker compose ps`.

O script de cada release deve restaurar os arquivos anteriores e recriar a API se qualquer etapa falhar. Nunca imprimir ou copiar o conteúdo de `.env`, chaves ou credenciais para o terminal.

## Gate obrigatório para release de API

Antes do envio, executar localmente:

```bash
sh tools/release-api-guard.sh --check-root .
node tools/core-regression-smoke.cjs
pnpm --filter @sm/api typecheck
pnpm --filter @sm/api build
```

No servidor, após enviar o pacote e o próprio guard:

```bash
sh /home/sm-colab/release-api-guard.sh /home/sm-colab/releases/<release>.tar.gz
```

O guard recusa `.env`, caminhos fora da raiz e migrações. Migrações continuam
seguindo um procedimento dedicado, com backup de banco e homologação própria.

## Última validação

Em 2026-09-16 foi publicado o modo sombra de evidência InMap/IXC usando este fluxo. O contêiner `sistema-mensagem-api-1` ficou `healthy` após a reconstrução.
