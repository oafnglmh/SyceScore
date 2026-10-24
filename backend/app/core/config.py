from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import Optional
import os


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "CCE ScoreSync"
    DEBUG: bool = False
    ALLOWED_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    ALLOWED_ORIGIN_REGEX: Optional[str] = r"^https?:\/\/.*"

    # File storage
    UPLOAD_DIR: str = "storage/uploads"
    SESSION_DIR: str = "storage/sessions"
    MAX_FILE_SIZE_MB: int = 50
    MAX_FILES_PER_SOURCE: int = 50
    MAX_PAGES_PER_FILE: int = 100

    # Gemini
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-1.5-flash"

    # Score comparison
    SCORE_TOLERANCE: float = 0.0  # Default: exact match
    MIN_CONFIDENCE_THRESHOLD: float = 0.7  # Below this -> NEEDS_REVIEW

    # Retry and Timeout
    MAX_GEMINI_RETRIES: int = 1
    RETRY_BASE_DELAY: float = 2.0
    GEMINI_TIMEOUT_SECONDS: int = 25  # Timeout 25s cho mỗi lần gọi AI Vision

    # Ollama (local AI)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llava:7b"
    OLLAMA_TIMEOUT: int = 120

    # Cross-validation (Ollama + PaddleOCR)
    ENABLE_CROSS_VALIDATION: bool = True
    CROSS_CONFIDENCE_THRESHOLD: float = 0.85
    OCR_PROVIDER: str = "gemini"  # "gemini" | "ollama" | "paddle_ollama"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def validate_allowed_origins(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    @field_validator("GEMINI_API_KEY", mode="before")
    @classmethod
    def validate_api_key(cls, v):
        return v if v and v.strip() else None


settings = Settings()

# Ensure directories exist
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.SESSION_DIR, exist_ok=True)
