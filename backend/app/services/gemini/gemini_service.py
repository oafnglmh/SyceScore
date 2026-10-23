"""
Gemini AI service - handles model listing, connection testing,
and document extraction with retry/backoff logic.
"""
import asyncio
import base64
import json
import logging
import time
from typing import Optional

import google.generativeai as genai

from ...core.config import settings
from ...models.schemas import ExamMetadata, ExtractedStudent, FieldConfidence, SourceData
from ...storage.ai_settings_store import ai_settings_store

logger = logging.getLogger(__name__)


# ─── Prompt template ──────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """
Bạn là hệ thống OCR chuyên nghiệp để trích xuất dữ liệu từ biên bản kết quả thi.

Hãy phân tích tài liệu và trích xuất thông tin theo đúng cấu trúc JSON sau.
KHÔNG thêm giải thích. CHỈ trả về JSON hợp lệ.

Yêu cầu quan trọng:
- Chỉ trích xuất những gì thực sự có trong tài liệu
- Nếu không đọc được rõ ràng, đặt giá trị là null và ghi lý do vào review_reason
- Nếu có chữ viết tay khó đọc hoặc nhiều cách đọc, đặt needs_review = true
- Điểm số: chỉ lấy điểm thi, không lấy chữ ký, số tờ giấy, hay điểm thành phần
- Mã HV: mã số học viên, thường là dãy số
- exam_location và room là hai trường khác nhau
- confidence: 0.0 đến 1.0, đánh giá độ chắc chắn khi đọc từng trường

Trả về JSON với cấu trúc sau (đây là cấu trúc bắt buộc):
{
  "exam_metadata": {
    "semester": null,
    "subject": null,
    "course": null,
    "exam_datetime": null,
    "class_name": null,
    "major": null,
    "exam_location": null,
    "room": null
  },
  "students": [
    {
      "stt": 1,
      "student_id": null,
      "full_name": null,
      "date_of_birth": null,
      "score": null,
      "raw_score_text": null,
      "confidence": {
        "student_id": 0.0,
        "full_name": 0.0,
        "date_of_birth": 0.0,
        "score": 0.0
      },
      "needs_review": true,
      "review_reason": null
    }
  ]
}
"""


# ─── Model capability check ───────────────────────────────────────────────────

KNOWN_VISION_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
    "gemini-2.5-flash-preview",
    "gemini-2.5-pro-preview",
    "gemini-3.6-flash",
]


def _supports_vision(model_name: str) -> bool:
    name = model_name.lower()
    return any(m in name for m in [
        "gemini-1.5", "gemini-2.0", "gemini-2.5", "gemini-pro-vision"
    ])


# ─── Service class ────────────────────────────────────────────────────────────

class GeminiService:

    def _configure(self, api_key: Optional[str] = None) -> str:
        key = api_key or ai_settings_store.get_api_key()
        if not key:
            raise ValueError("Gemini API key chưa được cấu hình")
        genai.configure(api_key=key)
        return key

    def get_model_name(self) -> str:
        return ai_settings_store.get_model()

    async def list_models(self, api_key: Optional[str] = None) -> list[dict]:
        """Return list of available Gemini models supporting text/vision generation."""
        try:
            self._configure(api_key)
            models_out = []
            for m in genai.list_models():
                if "generateContent" not in (m.supported_generation_methods or []):
                    continue
                name = m.name
                display_name = getattr(m, "display_name", name)
                supports_v = _supports_vision(name)
                models_out.append({
                    "id": name,
                    "display_name": display_name,
                    "supports_vision": supports_v,
                    "supports_json_output": True,
                })
            # Sort: vision-capable first, then by name
            models_out.sort(key=lambda x: (not x["supports_vision"], x["id"]))
            return models_out
        except Exception as e:
            logger.warning(f"list_models failed: {e}")
            # Return known defaults
            return [
                {"id": f"models/{m}", "display_name": m, "supports_vision": True, "supports_json_output": True}
                for m in KNOWN_VISION_MODELS
            ]

    async def test_connection(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> dict:
        """Test API key + model connectivity."""
        try:
            self._configure(api_key)
            model_name = model or self.get_model_name()
            m = genai.GenerativeModel(model_name)
            # Minimal prompt to verify connectivity
            resp = m.generate_content("Trả lời: OK")
            if resp.text:
                return {
                    "success": True,
                    "message": "Kết nối thành công",
                    "model": model_name,
                }
        except Exception as e:
            err = str(e)
            if "API_KEY_INVALID" in err or "invalid" in err.lower():
                msg = "API key không hợp lệ hoặc đã bị thu hồi"
            elif "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
                msg = "Hết hạn mức sử dụng (quota). Vui lòng đợi hoặc sử dụng key khác."
            elif "RATE_LIMIT" in err:
                msg = "Vượt giới hạn tốc độ (rate limit). Thử lại sau vài giây."
            else:
                msg = f"Lỗi kết nối: {err}"
            return {"success": False, "message": msg, "model": None}
        return {"success": False, "message": "Không nhận được phản hồi từ Gemini", "model": None}

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
        """Extract structured data from an image page using Gemini vision."""
        self._configure(api_key)
        model_name = model_name or self.get_model_name()
        model = genai.GenerativeModel(model_name)

        last_err = None
        for attempt in range(retries):
            try:
                image_part = {"mime_type": mime_type, "data": image_bytes}
                response = model.generate_content(
                    [EXTRACTION_PROMPT, image_part],
                    generation_config={"response_mime_type": "application/json"},
                )
                raw = response.text.strip()
                # Strip markdown fences if present
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[1] if "\n" in raw else raw
                    raw = raw.rsplit("```", 1)[0].strip()
                data = json.loads(raw)
                # Inject source info into each student record
                for s in data.get("students", []):
                    s["source_file"] = source_file
                    s["page_number"] = page_number
                return data
            except Exception as e:
                last_err = e
                err_str = str(e)
                if "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                    raise ValueError(
                        f"Hết quota Gemini API. Vui lòng đợi hoặc thay key khác. ({err_str})"
                    )
                if attempt < retries - 1:
                    wait = settings.RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        f"Gemini attempt {attempt+1} failed ({e}). Retrying in {wait}s..."
                    )
                    await asyncio.sleep(wait)

        raise RuntimeError(f"Gemini extraction failed after {retries} attempts: {last_err}")

    async def extract_from_text(
        self,
        text: str,
        source_file: str,
        page_number: int,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        retries: int = 3,
    ) -> dict:
        """Extract structured data from text content (PDF with text layer)."""
        self._configure(api_key)
        model_name = model_name or self.get_model_name()
        model = genai.GenerativeModel(model_name)

        prompt = EXTRACTION_PROMPT + f"\n\nNội dung trang:\n{text}"

        last_err = None
        for attempt in range(retries):
            try:
                response = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"},
                )
                raw = response.text.strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[1] if "\n" in raw else raw
                    raw = raw.rsplit("```", 1)[0].strip()
                data = json.loads(raw)
                for s in data.get("students", []):
                    s["source_file"] = source_file
                    s["page_number"] = page_number
                return data
            except Exception as e:
                last_err = e
                err_str = str(e)
                if "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                    raise ValueError(
                        f"Hết quota Gemini API: {err_str}"
                    )
                if attempt < retries - 1:
                    await asyncio.sleep(settings.RETRY_BASE_DELAY * (2 ** attempt))

        raise RuntimeError(f"Gemini text extraction failed: {last_err}")


gemini_service = GeminiService()

