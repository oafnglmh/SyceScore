"""
OpenAI ChatGPT Service - handles model listing, connection testing,
and document extraction with vision using GPT-4o / GPT-4o-mini.
"""
import asyncio
import base64
import json
import logging
from typing import Optional

from openai import AsyncOpenAI, OpenAI

from ...core.config import settings

logger = logging.getLogger(__name__)

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

OPENAI_VISION_MODELS = [
    {
        "id": "gpt-5.6-sol",
        "display_name": "GPT-5.6 Sol (Mặc định)",
        "supports_vision": True,
        "supports_json_output": True,
    },
    {
        "id": "gpt-4o-mini",
        "display_name": "GPT-4o Mini (Khuyên dùng - Nhanh & Tối ưu chi phí)",
        "supports_vision": True,
        "supports_json_output": True,
    },
    {
        "id": "gpt-4o",
        "display_name": "GPT-4o (Độ chính xác cao cho chữ viết tay)",
        "supports_vision": True,
        "supports_json_output": True,
    },
    {
        "id": "gpt-4-turbo",
        "display_name": "GPT-4 Turbo with Vision",
        "supports_vision": True,
        "supports_json_output": True,
    },
]


class OpenAIService:

    def _get_client(self, api_key: Optional[str] = None, base_url: Optional[str] = None) -> AsyncOpenAI:
        from ...storage.ai_settings_store import ai_settings_store
        key = api_key or ai_settings_store.get_api_key()
        if not key:
            raise ValueError("OpenAI API key chưa được cấu hình. Vui lòng nhập API key bắt đầu bằng 'sk-'.")
        burl = base_url or ai_settings_store.get_base_url()
        return AsyncOpenAI(api_key=key, base_url=burl)

    def _get_sync_client(self, api_key: Optional[str] = None, base_url: Optional[str] = None) -> OpenAI:
        from ...storage.ai_settings_store import ai_settings_store
        key = api_key or ai_settings_store.get_api_key()
        if not key:
            raise ValueError("OpenAI API key chưa được cấu hình. Vui lòng nhập API key bắt đầu bằng 'sk-'.")
        burl = base_url or ai_settings_store.get_base_url()
        return OpenAI(api_key=key, base_url=burl)

    def list_models(self) -> list[dict]:
        return OPENAI_VISION_MODELS

    async def test_connection(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> dict:
        """Kiểm tra tính hợp lệ của API Key và kết nối tới OpenAI."""
        try:
            client = self._get_sync_client(api_key, base_url=base_url)
            target_model = model or "gpt-5.6-sol"
            if "gemini" in target_model.lower():
                target_model = "gpt-5.6-sol"

            # Test gọi thử một prompt ngắn
            resp = client.chat.completions.create(
                model=target_model,
                messages=[{"role": "user", "content": "Trả lời: OK"}],
                max_tokens=5,
            )
            if resp.choices:
                return {
                    "success": True,
                    "message": "Kết nối OpenAI ChatGPT thành công!",
                    "model": target_model,
                }
        except Exception as e:
            err = str(e)
            if "invalid_api_key" in err or "Incorrect API key" in err:
                msg = "OpenAI API Key không chính xác hoặc đã bị thu hồi. Vui lòng lấy key tại https://platform.openai.com/api-keys"
            elif "insufficient_quota" in err or "quota" in err.lower():
                msg = "Tài khoản OpenAI đã hết số dư (insufficient_quota). Vui lòng nạp thêm credit."
            elif "rate_limit" in err.lower():
                msg = "Vượt giới hạn tốc độ OpenAI (rate limit). Vui lòng thử lại sau vài giây."
            else:
                msg = f"Lỗi OpenAI: {err}"
            return {"success": False, "message": msg, "model": None}

        return {"success": False, "message": "Không nhận được phản hồi từ OpenAI", "model": None}

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
        """Trích xuất dữ liệu bảng điểm từ ảnh/trang tài liệu bằng OpenAI GPT-4o Vision."""
        client = self._get_client(api_key)
        target_model = model_name or "gpt-4o-mini"
        if "gemini" in target_model.lower():
            target_model = "gpt-4o-mini"

        base64_img = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{base64_img}"

        last_err = None
        for attempt in range(retries):
            try:
                response = await client.chat.completions.create(
                    model=target_model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": EXTRACTION_PROMPT},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": data_uri,
                                        "detail": "high",
                                    },
                                },
                            ],
                        }
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.1,
                )

                content = response.choices[0].message.content or "{}"
                raw = content.strip()
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
                if "insufficient_quota" in err_str:
                    raise ValueError(f"Hết quota OpenAI API: {err_str}")
                if attempt < retries - 1:
                    wait = settings.RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        f"OpenAI attempt {attempt+1} thất bại ({e}). Thử lại sau {wait}s..."
                    )
                    await asyncio.sleep(wait)

        raise RuntimeError(f"OpenAI extraction thất bại sau {retries} lần thử: {last_err}")


openai_service = OpenAIService()
