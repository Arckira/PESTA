"""Testes unitários às funções criptográficas do módulo app.core.security."""

from __future__ import annotations

import inspect

from app.core import security
from app.core.security import _hash_pin, _verificar_pin


def test_hash_e_verificar_pin_correto():
    """Garante que um PIN correto é verificado com sucesso após fazer hash.

    Edge case: fluxo feliz — o utilizador introduz o PIN original e a verificação
    deve devolver True.
    """
    pin = "1234"
    hashed = _hash_pin(pin)
    assert _verificar_pin(pin, hashed) is True


def test_verificar_pin_errado():
    """Garante que um PIN errado é rejeitado sem exceção.

    Edge case: tentativa de autenticação com credencial inválida — deve devolver
    False em vez de lançar uma exceção.
    """
    hashed = _hash_pin("1234")
    assert _verificar_pin("0000", hashed) is False


def test_hash_unico():
    """Garante que dois hashes do mesmo PIN são diferentes (sal aleatório).

    Edge case: determinismo vs. aleatoriedade — sem sal aleatório, hashes
    idênticos permitiriam ataques de rainbow table.
    """
    pin = "9999"
    hash1 = _hash_pin(pin)
    hash2 = _hash_pin(pin)
    assert hash1 != hash2


def test_timing_safe():
    """Garante que a verificação usa hmac.compare_digest (comparação em tempo constante).

    Edge case: timing attack — uma comparação ingénua (==) vaza informação sobre
    o prefixo correto do hash através do tempo de execução. hmac.compare_digest
    mitiga isso ao comparar em tempo constante.
    """
    source = inspect.getsource(security)
    assert "hmac.compare_digest" in source
