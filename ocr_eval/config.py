import os
from typing import Optional


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv()


def env(name: str, default: Optional[str] = None) -> Optional[str]:
    load_env()
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def env_required(name: str) -> str:
    value = env(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_float(name: str, default: float = 0.0) -> float:
    value = env(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default
