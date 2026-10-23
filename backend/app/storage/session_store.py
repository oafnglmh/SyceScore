"""
Session storage - stores reconciliation sessions as JSON files.
In production, this can be replaced with a database backend.
"""
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from ..core.config import settings
from ..models.schemas import ReconciliationSession


class SessionStore:
    def __init__(self):
        self.session_dir = Path(settings.SESSION_DIR)
        self.session_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, session_id: str) -> Path:
        return self.session_dir / f"{session_id}.json"

    def create(self) -> ReconciliationSession:
        session = ReconciliationSession()
        self.save(session)
        return session

    def get(self, session_id: str) -> Optional[ReconciliationSession]:
        path = self._path(session_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return ReconciliationSession.model_validate(data)
        except Exception:
            return None

    def save(self, session: ReconciliationSession) -> None:
        path = self._path(session.id)
        path.write_text(
            session.model_dump_json(indent=2),
            encoding="utf-8"
        )

    def list_sessions(self, limit: int = 50, offset: int = 0) -> list[ReconciliationSession]:
        sessions = []
        for path in sorted(
            self.session_dir.glob("*.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        ):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                sessions.append(ReconciliationSession.model_validate(data))
            except Exception:
                continue
        return sessions[offset : offset + limit]

    def delete(self, session_id: str) -> bool:
        path = self._path(session_id)
        if path.exists():
            path.unlink()
            return True
        return False

    def count(self) -> int:
        return len(list(self.session_dir.glob("*.json")))

    def cleanup_stale_sessions(self) -> int:
        """Đánh dấu các session bị bỏ dở hoặc chết ngầm ở trạng thái processing thành error."""
        count = 0
        for path in self.session_dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if data.get("status") == "processing":
                    data["status"] = "error"
                    data["error_message"] = "Tiến trình bị gián đoạn do timeout, lỗi mạng hoặc máy chủ reload."
                    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                    count += 1
            except Exception:
                continue
        return count


# Singleton
session_store = SessionStore()
