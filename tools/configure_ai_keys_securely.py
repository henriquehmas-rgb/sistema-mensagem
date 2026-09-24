from __future__ import annotations

import getpass
import io
import os
import posixpath
import sys
from datetime import datetime, timezone

import paramiko


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY_PATH = os.path.join(ROOT, "SEEG-Omni-Onboarding", "sm-colab_vps_key")
KNOWN_HOSTS = os.path.join(ROOT, ".seeg_known_hosts")
HOST = "191.96.251.71"
USER = "sm-colab"
ENV_PATH = "/docker/sistema-mensagem/.env"


def read_secret(prompt: str, prefix: str) -> str:
    value = getpass.getpass(prompt).strip()
    if not value.startswith(prefix) or len(value) < 30 or any(char.isspace() for char in value):
        raise ValueError(f"Valor inválido: era esperada uma chave iniciada por {prefix}")
    return value


def replace_env_value(content: str, name: str, value: str) -> str:
    lines = content.splitlines()
    replacement = f"{name}={value}"
    found = False
    output: list[str] = []
    for line in lines:
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
    print("As chaves não serão exibidas. Cole e pressione Enter.")
    anthropic_key = read_secret("ANTHROPIC_API_KEY: ", "sk-ant-")
    openai_key = read_secret("OPENAI_API_KEY: ", "sk-")

    client = paramiko.SSHClient()
    client.load_host_keys(KNOWN_HOSTS)
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        HOST,
        username=USER,
        key_filename=KEY_PATH,
        look_for_keys=False,
        allow_agent=False,
        timeout=15,
    )
    try:
        with client.open_sftp() as sftp:
            with sftp.open(ENV_PATH, "r") as remote:
                original = remote.read().decode("utf-8")

            updated = replace_env_value(original, "ANTHROPIC_API_KEY", anthropic_key)
            updated = replace_env_value(updated, "OPENAI_API_KEY", openai_key)

            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            backup_path = f"{ENV_PATH}.bak-ai-keys-{stamp}"
            temp_path = f"{ENV_PATH}.tmp-ai-keys-{stamp}"
            with sftp.open(backup_path, "wb") as remote:
                remote.write(original.encode("utf-8"))
            with sftp.open(temp_path, "wb") as remote:
                remote.write(updated.encode("utf-8"))
            sftp.chmod(temp_path, 0o600)
            sftp.posix_rename(temp_path, ENV_PATH)

        command = (
            "awk -F= '"
            "$1==\"OPENAI_API_KEY\" {o=($2 ~ /^sk-/ && length($2)>30)} "
            "$1==\"ANTHROPIC_API_KEY\" {a=($2 ~ /^sk-ant-/ && length($2)>30)} "
            "END {if(o&&a) print \"KEYS_PRESENT_MASKED\"; else exit 1}' "
            f"{ENV_PATH}"
        )
        _, stdout, stderr = client.exec_command(command, timeout=15)
        result = stdout.read().decode("utf-8", errors="replace").strip()
        error = stderr.read().decode("utf-8", errors="replace").strip()
        status = stdout.channel.recv_exit_status()
        if status != 0 or result != "KEYS_PRESENT_MASKED":
            raise RuntimeError(error or "Falha na validação mascarada das chaves")
        print("Chaves inseridas e validadas sem exposição.")
        print(f"Backup remoto: {backup_path}")
        print("Serviços ainda não foram reiniciados.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, OSError, paramiko.SSHException) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(1)
