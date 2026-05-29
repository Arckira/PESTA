"""Funções criptográficas e extração de token."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from fastapi import HTTPException


def _hash_pin(pin: str) -> str:
    """Encripta o PIN usando PBKDF2-SHA256 com sal único."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt.encode("ascii"), 150000)
    return f"{salt}${digest.hex()}"


def _verificar_pin(pin: str, pin_hash: str) -> bool:
    """Verifica que o PIN introduzido corresponde ao hash armazenado."""
    try:
        salt, esperado = pin_hash.split("$", 1)
    except ValueError:
        return False
    atual = hashlib.pbkdf2_hmac(
        "sha256", pin.encode("utf-8"), salt.encode("ascii"), 150000
    ).hex()
    return hmac.compare_digest(atual, esperado)


def _extrair_token(authorization: Optional[str]) -> str:
    """Extrai o token Bearer do cabeçalho Authorization."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
    prefixo = "Bearer "
    if not authorization.startswith(prefixo):
        raise HTTPException(status_code=401, detail="Formato de autorização inválido")
    return authorization[len(prefixo):].strip()
