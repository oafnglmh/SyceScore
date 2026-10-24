"""
AI settings storage - persists Gemini API key (encrypted) and model selection.
The API key is stored server-side only. Only masked version is returned to client.
"""
import json
import os
import re
from pathlib import Path
from typing import Optional, Union
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

    def _sync_keys_pool(self, data: dict) -> list[dict]:
        """Ensure keys_pool exists and is properly structured with metadata."""
        pool = data.get("keys_pool", [])
        if not isinstance(pool, list):
            pool = []

        # If pool is empty but legacy api_keys_enc exists, populate pool
        if not pool:
            legacy_keys = data.get("api_keys_enc", [])
            if not legacy_keys and "api_key_enc" in data:
                legacy_keys = [data["api_key_enc"]]
            for enc in legacy_keys:
                try:
                    dec = _deobfuscate(enc).strip()
                    if dec:
                        masked = f"...{dec[-4:]}" if len(dec) >= 4 else "****"
                        pool.append({
                            "key_enc": enc,
                            "masked": masked,
                            "status": "active",
                            "exhausted_at": None,
                            "requests_count": 0,
                            "error_message": None,
                        })
                except Exception:
                    continue
            data["keys_pool"] = pool

        # Auto-reset keys that have been exhausted for more than 24 hours (Google daily reset)
        from datetime import datetime, timedelta
        now = datetime.utcnow()
        changed = False
        for item in pool:
            if item.get("status") == "exhausted" and item.get("exhausted_at"):
                try:
                    ex_time = datetime.fromisoformat(item["exhausted_at"])
                    if now - ex_time > timedelta(hours=23, minutes=30):
                        item["status"] = "active"
                        item["exhausted_at"] = None
                        item["error_message"] = None
                        changed = True
                except Exception:
                    pass

        if changed:
            self._save(data)

        return pool

    def get_key_pool(self) -> list[dict]:
        """Return key pool metadata (safe for UI display, no plain keys)."""
        data = self._load()
        pool = self._sync_keys_pool(data)
        out = []
        for idx, item in enumerate(pool):
            out.append({
                "index": idx,
                "masked_key": item.get("masked", "****"),
                "status": item.get("status", "active"),
                "exhausted_at": item.get("exhausted_at"),
                "requests_count": item.get("requests_count", 0),
                "error_message": item.get("error_message"),
            })
        return out

    def get_api_keys(self) -> list[str]:
        """Get all plain API keys from env (priority) or stored key pool."""
        env_val = os.environ.get("GEMINI_API_KEY", "").strip()
        if env_val:
            keys = [k.strip() for k in re.split(r"[\n,;]+", env_val) if k.strip()]
            if keys:
                return keys

        data = self._load()
        pool = self._sync_keys_pool(data)
        keys = []
        for item in pool:
            enc = item.get("key_enc")
            if enc:
                try:
                    dec = _deobfuscate(enc).strip()
                    if dec and dec not in keys:
                        keys.append(dec)
                except Exception:
                    continue
        return keys

    def get_api_key(self) -> Optional[str]:
        """Get the first active API key."""
        active = self.get_active_key()
        if active:
            return active[0]
        keys = self.get_api_keys()
        return keys[0] if keys else None

    def get_active_key(self) -> Optional[tuple[str, int, str]]:
        """
        Return (plain_key, index, masked_key) for the first available key with status == 'active'.
        Returns None if all keys are exhausted or pool is empty.
        """
        env_val = os.environ.get("GEMINI_API_KEY", "").strip()
        if env_val:
            keys = [k.strip() for k in re.split(r"[\n,;]+", env_val) if k.strip()]
            if keys:
                k = keys[0]
                masked = f"...{k[-4:]}" if len(k) >= 4 else "****"
                return k, 0, masked

        data = self._load()
        pool = self._sync_keys_pool(data)
        for idx, item in enumerate(pool):
            if item.get("status", "active") == "active":
                enc = item.get("key_enc")
                if enc:
                    try:
                        dec = _deobfuscate(enc).strip()
                        if dec:
                            return dec, idx, item.get("masked", "****")
                    except Exception:
                        continue
        return None

    def mark_key_exhausted(self, index_or_key: Union[int, str], reason: str = "429 Quota Exceeded") -> None:
        """Mark a key as exhausted (reached daily quota)."""
        from datetime import datetime
        data = self._load()
        pool = self._sync_keys_pool(data)
        changed = False

        if isinstance(index_or_key, int):
            if 0 <= index_or_key < len(pool):
                pool[index_or_key]["status"] = "exhausted"
                pool[index_or_key]["exhausted_at"] = datetime.utcnow().isoformat()
                pool[index_or_key]["error_message"] = reason
                changed = True
        else:
            for item in pool:
                try:
                    dec = _deobfuscate(item.get("key_enc", "")).strip()
                    if dec == str(index_or_key).strip():
                        item["status"] = "exhausted"
                        item["exhausted_at"] = datetime.utcnow().isoformat()
                        item["error_message"] = reason
                        changed = True
                except Exception:
                    continue

        if changed:
            data["keys_pool"] = pool
            self._save(data)

    def mark_key_success(self, index: int) -> None:
        """Increment success requests count for the key."""
        data = self._load()
        pool = self._sync_keys_pool(data)
        if 0 <= index < len(pool):
            pool[index]["requests_count"] = pool[index].get("requests_count", 0) + 1
            data["keys_pool"] = pool
            self._save(data)

    def mark_key_error(self, index: int, error_message: str) -> None:
        """Mark a key as error (e.g. invalid key)."""
        data = self._load()
        pool = self._sync_keys_pool(data)
        if 0 <= index < len(pool):
            pool[index]["status"] = "error"
            pool[index]["error_message"] = error_message
            data["keys_pool"] = pool
            self._save(data)

    def reset_key_status(self, index: Optional[int] = None) -> None:
        """Reset exhausted or error keys back to 'active'."""
        data = self._load()
        pool = self._sync_keys_pool(data)
        if index is not None:
            if 0 <= index < len(pool):
                pool[index]["status"] = "active"
                pool[index]["exhausted_at"] = None
                pool[index]["error_message"] = None
        else:
            for item in pool:
                item["status"] = "active"
                item["exhausted_at"] = None
                item["error_message"] = None

        data["keys_pool"] = pool
        self._save(data)

    def add_keys_bulk(self, raw_text: str) -> int:
        """Parse raw text (lines/commas), add new unique keys into pool. Returns count of added keys."""
        parts = [k.strip() for k in re.split(r"[\n,;]+", str(raw_text).strip()) if k.strip()]
        if not parts:
            return 0

        data = self._load()
        pool = self._sync_keys_pool(data)

        # Existing plain keys
        existing = set()
        for item in pool:
            try:
                dec = _deobfuscate(item.get("key_enc", "")).strip()
                if dec:
                    existing.add(dec)
            except Exception:
                continue

        added_count = 0
        for k in parts:
            if len(k) >= 10 and k not in existing:
                enc = _obfuscate(k)
                masked = f"...{k[-4:]}" if len(k) >= 4 else "****"
                pool.append({
                    "key_enc": enc,
                    "masked": masked,
                    "status": "active",
                    "exhausted_at": None,
                    "requests_count": 0,
                    "error_message": None,
                })
                existing.add(k)
                added_count += 1

        if added_count > 0:
            data["keys_pool"] = pool
            # Keep legacy compatibility
            data["api_keys_enc"] = [item["key_enc"] for item in pool]
            if pool:
                data["api_key_enc"] = pool[0]["key_enc"]
            self._save(data)

        return added_count

    def remove_key_by_index(self, index: int) -> bool:
        """Remove a key at the specified index."""
        data = self._load()
        pool = self._sync_keys_pool(data)
        if 0 <= index < len(pool):
            pool.pop(index)
            data["keys_pool"] = pool
            data["api_keys_enc"] = [item["key_enc"] for item in pool]
            if pool:
                data["api_key_enc"] = pool[0]["key_enc"]
            else:
                data.pop("api_key_enc", None)
                data.pop("api_keys_enc", None)
            self._save(data)
            return True
        return False

    def set_api_keys(self, keys: list[str]) -> None:
        """Store multiple API keys (overwrites entire pool)."""
        data = self._load()
        pool = []
        seen = set()
        for k in keys:
            s = str(k).strip()
            if s and s not in seen and len(s) >= 10:
                seen.add(s)
                enc = _obfuscate(s)
                masked = f"...{s[-4:]}" if len(s) >= 4 else "****"
                pool.append({
                    "key_enc": enc,
                    "masked": masked,
                    "status": "active",
                    "exhausted_at": None,
                    "requests_count": 0,
                    "error_message": None,
                })

        data["keys_pool"] = pool
        data["api_keys_enc"] = [item["key_enc"] for item in pool]
        if pool:
            data["api_key_enc"] = pool[0]["key_enc"]
        else:
            data.pop("api_key_enc", None)
            data.pop("api_keys_enc", None)
        self._save(data)

    def set_api_key(self, key: str) -> None:
        """Add or set API keys from string."""
        self.add_keys_bulk(key)

    def get_masked_keys(self) -> list[str]:
        """Return masked versions of all keys."""
        pool = self.get_key_pool()
        return [item["masked_key"] for item in pool]

    def get_masked_key(self) -> Optional[str]:
        """Return only masked version of primary active key."""
        active = self.get_active_key()
        if active:
            return active[2]
        pool = self.get_key_pool()
        return pool[0]["masked_key"] if pool else None

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

    # ── Ollama / OCR provider settings ────────────────────────────────────────

    def get_ocr_provider(self) -> str:
        """Return active OCR provider: 'gemini' | 'ollama' | 'paddle_ollama'. Default: 'gemini'."""
        from ..core.config import settings
        data = self._load()
        return data.get("ocr_provider") or settings.OCR_PROVIDER or "gemini"

    def set_ocr_provider(self, provider: str) -> None:
        data = self._load()
        data["ocr_provider"] = provider.strip() if provider else "gemini"
        self._save(data)

    def get_ollama_model(self) -> str:
        """Return Ollama model name. Default: 'llava:7b'."""
        from ..core.config import settings
        data = self._load()
        return data.get("ollama_model") or settings.OLLAMA_MODEL or "llava:7b"

    def set_ollama_model(self, model: str) -> None:
        data = self._load()
        data["ollama_model"] = model.strip() if model else "llava:7b"
        self._save(data)

    def get_cross_validation_enabled(self) -> bool:
        """Return whether dual-OCR cross-validation is enabled."""
        from ..core.config import settings
        data = self._load()
        val = data.get("enable_cross_validation")
        if val is None:
            return settings.ENABLE_CROSS_VALIDATION
        return bool(val)

    def set_cross_validation_enabled(self, enabled: bool) -> None:
        data = self._load()
        data["enable_cross_validation"] = enabled
        self._save(data)


ai_settings_store = AISettingsStore()
