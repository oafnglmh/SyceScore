"""
AI settings storage - persists Gemini API key (encrypted) and model selection.
The API key is stored server-side only. Only masked version is returned to client.
"""
import json
import os
import re
from pathlib import Path
from typing import Optional
import base64
import hashlib


# Simple XOR-based obfuscation for at-rest storage.
# For production, use a proper KMS or secret vault.
def _obfuscate(value: str, key: str = "CCE_SCORESYNC") -> str:
    """XOR obfuscate a string with a key, base64 encode."""
    key_bytes = key.encode()
    val_bytes = value.encode()
    result = bytes(v ^ key_bytes[i % len(key_bytes)] for i, v in enumerate(val_bytes))
    return base64.b64encode(result).decode()


def _deobfuscate(value: str, key: str = "CCE_SCORESYNC") -> str:
    """Reverse of _obfuscate."""
    key_bytes = key.encode()
    val_bytes = base64.b64decode(value.encode())
    result = bytes(v ^ key_bytes[i % len(key_bytes)] for i, v in enumerate(val_bytes))
    return result.decode()


class AISettingsStore:
    SETTINGS_FILE = Path("storage/ai_settings.json")

    def __init__(self):
        self.SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> dict:
        if self.SETTINGS_FILE.exists():
            try:
                return json.loads(self.SETTINGS_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def _save(self, data: dict) -> None:
        self.SETTINGS_FILE.write_text(
            json.dumps(data, indent=2), encoding="utf-8"
        )

    def get_api_keys(self) -> list[str]:
        """Get all API keys from env (priority) or stored settings."""
        env_val = os.environ.get("GEMINI_API_KEY", "").strip()
        if env_val:
            keys = [k.strip() for k in re.split(r"[\n,;]+", env_val) if k.strip()]
            if keys:
                return keys

        data = self._load()
        keys = []
        # Multi-key list in storage
        if "api_keys_enc" in data and isinstance(data["api_keys_enc"], list):
            for enc in data["api_keys_enc"]:
                try:
                    dec = _deobfuscate(enc).strip()
                    if dec and dec not in keys:
                        keys.append(dec)
                except Exception:
                    continue

        # Single-key fallback in storage
        if not keys and "api_key_enc" in data:
            try:
                dec = _deobfuscate(data["api_key_enc"]).strip()
                if dec:
                    keys.append(dec)
            except Exception:
                pass

        return keys

    def get_api_key(self) -> Optional[str]:
        """Get the primary API key (first key in pool)."""
        keys = self.get_api_keys()
        return keys[0] if keys else None

    def set_api_keys(self, keys: list[str]) -> None:
        """Store multiple API keys."""
        cleaned = []
        for k in keys:
            s = str(k).strip()
            if s and s not in cleaned:
                cleaned.append(s)

        data = self._load()
        data["api_keys_enc"] = [_obfuscate(k) for k in cleaned]
        if cleaned:
            data["api_key_enc"] = _obfuscate(cleaned[0])
        else:
            data.pop("api_key_enc", None)
            data.pop("api_keys_enc", None)
        self._save(data)

    def set_api_key(self, key: str) -> None:
        """Store one or multiple API keys (splits by newline, comma, semicolon)."""
        parts = [k.strip() for k in re.split(r"[\n,;]+", str(key).strip()) if k.strip()]
        self.set_api_keys(parts)

    def get_masked_keys(self) -> list[str]:
        """Return masked versions (last 4 chars) of all keys."""
        return [
            k[-4:] if len(k) >= 4 else "****"
            for k in self.get_api_keys()
        ]

    def get_masked_key(self) -> Optional[str]:
        """Return only last 4 chars of the primary key for display."""
        keys = self.get_api_keys()
        if not keys:
            return None
        k = keys[0]
        return k[-4:] if len(k) >= 4 else "****"

    def get_model(self) -> str:
        from ..core.config import settings
        data = self._load()
        model = data.get("model")
        return model or settings.GEMINI_MODEL or "gemini-2.0-flash"

    def set_model(self, model: str) -> None:
        data = self._load()
        data["model"] = model
        self._save(data)

    def get_base_url(self) -> Optional[str]:
        data = self._load()
        url = data.get("base_url")
        return url.strip() if url and url.strip() else None

    def set_base_url(self, base_url: Optional[str]) -> None:
        data = self._load()
        if base_url and base_url.strip():
            data["base_url"] = base_url.strip()
        else:
            data.pop("base_url", None)
        self._save(data)

    def is_configured(self) -> bool:
        return len(self.get_api_keys()) > 0

    def has_service_account(self) -> bool:
        return Path("storage/service_account.json").exists()


ai_settings_store = AISettingsStore()

