from __future__ import annotations

import getpass
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import paramiko


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY_PATH = os.path.join(ROOT, "SEEG-Omni-Onboarding", "sm-colab_vps_key")
KNOWN_HOSTS = os.path.join(ROOT, ".seeg_known_hosts")
HOST = "191.96.251.71"
USER = "sm-colab"
ENV_PATH = "/docker/sistema-mensagem/.env"

PROVIDERS = {
    "anthropic": {
        "env": "ANTHROPIC_API_KEY",
        "prefix": "sk-ant-",
        "url": "https://api.anthropic.com/v1/models",
    },
    "openai": {
        "env": "OPENAI_API_KEY",
        "prefix": "sk-",
        "url": "https://api.openai.com/v1/models",
    },
}


def validate(provider: str, secret: str) -> None:
    headers = (
        {"x-api-key": secret, "anthropic-version": "2023-06-01"}
        if provider == "anthropic"
        else {"Authorization": f"Bearer {secret}"}
    )
    request = urllib.request.Request(PROVIDERS[provider]["url"], headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError(f"provedor respondeu HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"provedor recusou a chave (HTTP {exc.code})") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"não foi possível alcançar o provedor: {exc.reason}") from exc


def replace_value(content: str, name: str, value: str) -> str:
    replacement = f"{name}={value}"
    output: list[str] = []
    found = False
    for line in content.splitlines():
        if line.startswith(f"{name}="):
            if not found:
                output.append(replacement)
                found = True
            continue
        output.append(line)
    if not found:
        output.append(replacement)
    return "\n".join(output) + "\n"


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in PROVIDERS:
        print("Uso: configure_single_ai_key.py anthropic|openai", file=sys.stderr)
        return 2
    provider = sys.argv[1]
    config = PROVIDERS[provider]
    secret = getpass.getpass(f"{config['env']}: ").strip().replace("\\_", "_")
    if not secret.startswith(config["prefix"]) or len(secret) < 30 or any(c.isspace() for c in secret):
        raise RuntimeError("formato de chave inválido")

    validate(provider, secret)
    print("Autenticação aceita pelo provedor.")

    client = paramiko.SSHClient()
    client.load_host_keys(KNOWN_HOSTS)
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(HOST, username=USER, key_filename=KEY_PATH, look_for_keys=False, allow_agent=False, timeout=15)
    try:
        with client.open_sftp() as sftp:
            with sftp.open(ENV_PATH, "r") as remote:
                original = remote.read().decode("utf-8")
            updated = replace_value(original, config["env"], secret)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            backup = f"{ENV_PATH}.bak-{provider}-{stamp}"
            temporary = f"{ENV_PATH}.tmp-{provider}-{stamp}"
            with sftp.open(backup, "wb") as remote:
                remote.write(original.encode("utf-8"))
            with sftp.open(temporary, "wb") as remote:
                remote.write(updated.encode("utf-8"))
            sftp.chmod(temporary, 0o600)
            sftp.posix_rename(temporary, ENV_PATH)
        print(f"{config['env']} gravada na VPS sem exposição.")
        print(f"Backup remoto: {backup}")
        print("Serviços ainda não foram reiniciados.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, paramiko.SSHException) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(1)
