from __future__ import annotations

import os
from pathlib import Path
from typing import Any

try:
    from typing import Annotated

    from pydantic import field_validator
    from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

    class Settings(BaseSettings):
        DATABASE_URL: str = ""
        CORS_ORIGINS: Annotated[list[str], NoDecode] = [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
        ACCESS_TOKEN_EXPIRE_MINUTES: int = 600
        SQL_ECHO: bool = False
        DB_POOL_SIZE: int = 20
        DB_MAX_OVERFLOW: int = 10

        model_config = SettingsConfigDict(
            env_file=str(Path(__file__).resolve().parents[2] / ".env"),
            extra="ignore",
        )

        @field_validator("CORS_ORIGINS", mode="before")
        @classmethod
        def _split_cors_origins(cls, v: Any) -> Any:
            """Aceita a lista separada por vírgulas documentada no .env.example.

            Sem este validator, pydantic-settings tenta interpretar o valor como
            JSON (comportamento por omissão para campos list[str]) e falha o
            arranque da aplicação com o formato "a,b,c" que o .env.example usa.
            """
            if isinstance(v, str):
                return [o.strip() for o in v.split(",") if o.strip()]
            return v

except ImportError:
    # Fallback when pydantic-settings is not installed — read .env manually.
    from pydantic import BaseModel

    def _load_env() -> dict[str, Any]:
        env_path = Path(__file__).resolve().parents[2] / ".env"
        result: dict[str, Any] = {}
        if not env_path.exists():
            return result
        with env_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key, val = key.strip(), val.strip()
                if (val.startswith('"') and val.endswith('"')) or (
                    val.startswith("'") and val.endswith("'")
                ):
                    val = val[1:-1]
                result[key] = val
        return result

    _env = _load_env()

    class Settings(BaseModel):  # type: ignore[no-redef]
        DATABASE_URL: str = _env.get("DATABASE_URL", os.getenv("DATABASE_URL", ""))
        CORS_ORIGINS: list[str] = [
            o.strip()
            for o in _env.get(
                "CORS_ORIGINS",
                os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
            ).split(",")
            if o.strip()
        ]
        ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
            _env.get("ACCESS_TOKEN_EXPIRE_MINUTES", os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "600"))
        )
        SQL_ECHO: bool = (
            _env.get("SQL_ECHO", os.getenv("SQL_ECHO", "false")).strip().lower() == "true"
        )
        DB_POOL_SIZE: int = int(_env.get("DB_POOL_SIZE", os.getenv("DB_POOL_SIZE", "20")))
        DB_MAX_OVERFLOW: int = int(_env.get("DB_MAX_OVERFLOW", os.getenv("DB_MAX_OVERFLOW", "10")))


settings = Settings()
