"""
Unified AI Router Service: routes calls to OpenAI ChatGPT or Google Gemini
depending on configured API key / model selection.
"""
import logging
from typing import Optional

from ..storage.ai_settings_store import ai_settings_store
from .gemini.gemini_service import gemini_service
from .openai.openai_service import openai_service

logger = logging.getLogger(__name__)


class AIRouterService:

    def get_provider(self, api_key: Optional[str] = None, model: Optional[str] = None) -> str:
        """
        Xác định nhà cung cấp AI: 'openai' (ChatGPT) hoặc 'gemini'.
        Ưu tiên OpenAI nếu key bắt đầu bằng 'sk-' hoặc model là 'gpt-'.
        """
        key = (api_key or ai_settings_store.get_api_key() or "").strip()
        m = (model or ai_settings_store.get_model() or "").lower()

        if key.startswith("sk-") or "gpt-" in m:
            return "openai"
        if key.startswith("aizasy") or "gemini" in m:
            return "gemini"

        # Nếu có key bất kỳ, mặc định ưu tiên OpenAI
        if key:
            return "openai" if key.startswith("sk-") else "gemini"

        return "openai"

    async def list_models(self, api_key: Optional[str] = None) -> list[dict]:
        provider = self.get_provider(api_key=api_key)
        if provider == "openai":
            return openai_service.list_models()
        return await gemini_service.list_models(api_key=api_key)

    async def test_connection(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> dict:
        provider = self.get_provider(api_key=api_key, model=model)
        if provider == "openai":
            return await openai_service.test_connection(api_key=api_key, model=model, base_url=base_url)
        return await gemini_service.test_connection(api_key=api_key, model=model)

    async def extract_from_image_bytes(
        self,
        image_bytes: bytes,
        mime_type: str,
        source_file: str,
        page_number: int,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        retries: int = 3,
    ) -> dict:
        provider = self.get_provider(api_key=api_key, model=model_name)
        if provider == "openai":
            logger.info(f"[OpenAI ChatGPT] Trích xuất '{source_file}' trang {page_number}")
            return await openai_service.extract_from_image_bytes(
                image_bytes=image_bytes,
                mime_type=mime_type,
                source_file=source_file,
                page_number=page_number,
                api_key=api_key,
                model_name=model_name,
                retries=retries,
            )
        else:
            logger.info(f"[Gemini] Trích xuất '{source_file}' trang {page_number}")
            return await gemini_service.extract_from_image_bytes(
                image_bytes=image_bytes,
                mime_type=mime_type,
                source_file=source_file,
                page_number=page_number,
                api_key=api_key,
                model_name=model_name,
                retries=retries,
            )


ai_router_service = AIRouterService()
