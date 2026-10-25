"""
Ollama service — giao tiếp với Ollama local REST API để OCR ảnh bảng điểm.

Dùng model LLaVA (vision) qua endpoint POST /api/generate.
Trả về dict cùng cấu trúc với gemini_service để có thể dùng chung
trong ExtractionService.
"""
import asyncio
import base64
import json
import logging
import socket
from typing import Optional
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError
from urllib.request import Request

from ...core.config import settings

logger = logging.getLogger(__name__)

# ─── Prompt (cùng cấu trúc JSON với Gemini prompt) ───────────────────────────

OLLAMA_EXTRACTION_PROMPT = """Bạn là hệ thống OCR chuyên nghiệp để trích xuất dữ liệu từ biên bản kết quả thi.

Phân tích ảnh và trả về JSON THUẦN TÚY (không có markdown, không có giải thích) với cấu trúc sau:
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
      "class_name": null,
      "subject": null,
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

Yêu cầu:
- CHỈ trả về JSON hợp lệ, KHÔNG thêm bất kỳ văn bản nào khác
- Điểm số: chỉ lấy điểm thi cuối (dạng số: 8.5, 7, 4.25…)
- Với bảng điểm CCE, lấy điểm từ cột Ktra1 (hoặc tên cột tương đương nhìn thấy được); KtraNgayEdit là ngày sửa, tuyệt đối không phải điểm.
- Tên lớp có thể nằm thành một dòng tiêu đề ở PHÍA TRÊN mỗi bảng. Gán tiêu đề gần nhất phía trên cho mọi dòng sinh viên thuộc bảng ngay sau nó. Nếu một trang có nhiều bảng, mỗi bảng có thể là một lớp khác nhau.
- Ghi class_name vào TỪNG student. Chỉ điền exam_metadata.class_name khi cả trang chỉ có một lớp; nếu có nhiều lớp thì để null ở metadata cấp trang.
- Giữ riêng từng bảng/lớp. Cùng mã học viên hoặc STT có thể xuất hiện hợp lệ ở các lớp khác nhau; không gộp, không bỏ và không lặp lại dòng. STT có thể bắt đầu lại từ 1 ở mỗi bảng.
- Ghép điểm với học viên trên cùng một hàng và đúng cột Ktra1. Trả đúng một đối tượng cho mỗi hàng dữ liệu nhìn thấy; không dừng ở bảng đầu tiên.
- confidence: 0.0-1.0 cho từng trường
- Nếu không đọc được rõ → null + needs_review: true"""


class OllamaService:
    """Client cho Ollama local API (LLaVA vision model)."""

    def __init__(self):
        self._base_url: str = settings.OLLAMA_BASE_URL
        self._model: str = settings.OLLAMA_MODEL
        self._timeout: int = settings.OLLAMA_TIMEOUT
        self._force_cpu: bool = False

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _get_base_url(self) -> str:
        """Đọc config động (ai_settings_store có thể override)."""
        return self._base_url

    def _get_model(self) -> str:
        try:
            from ...storage.ai_settings_store import ai_settings_store
            return ai_settings_store.get_ollama_model() or self._model
        except Exception:
            return self._model

    def _is_port_open(self, host: str = "localhost", port: int = 11434) -> bool:
        try:
            with socket.create_connection((host, port), timeout=2):
                return True
        except OSError:
            return False

    def _sync_request(self, url: str, payload: dict) -> dict:
        """Thực hiện HTTP POST đồng bộ (dùng từ asyncio.to_thread)."""
        body = json.dumps(payload).encode("utf-8")
        req = Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib_request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except HTTPError as err:
            err_body = ""
            try:
                err_body = err.read().decode("utf-8")
                err_json = json.loads(err_body)
                err_msg = err_json.get("error", err_body)
            except Exception:
                err_msg = err_body or str(err)
            raise RuntimeError(f"Ollama HTTP {err.code}: {err_msg}") from err

    def _sync_get(self, url: str) -> dict:
        req = Request(url, method="GET")
        with urllib_request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ── Public API ─────────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """Ping Ollama server — trả về True nếu đang chạy."""
        return self._is_port_open()

    async def test_connection(self) -> dict:
        """Kiểm tra kết nối và model."""
        try:
            if not self.is_available():
                return {
                    "success": False,
                    "message": "Ollama server không chạy tại localhost:11434",
                    "model": None,
                }
            models = await self.list_models()
            model_ids = [m.get("name", "") for m in models]
            current_model = self._get_model()
            model_ok = any(current_model in mid for mid in model_ids)
            if not model_ok:
                return {
                    "success": False,
                    "message": (
                        f"Model '{current_model}' chưa được pull. "
                        f"Các model hiện có: {', '.join(model_ids) or 'Không có'}. "
                        f"Chạy: ollama pull {current_model}"
                    ),
                    "model": current_model,
                }
            return {
                "success": True,
                "message": f"Ollama đang chạy · Model: {current_model}",
                "model": current_model,
            }
        except Exception as e:
            return {"success": False, "message": str(e), "model": None}

    async def list_models(self) -> list[dict]:
        """Lấy danh sách models đã pull từ Ollama."""
        try:
            url = f"{self._get_base_url()}/api/tags"
            data = await asyncio.to_thread(self._sync_get, url)
            return data.get("models", [])
        except Exception as e:
            logger.warning(f"[Ollama] list_models failed: {e}")
            return []

    async def extract_from_image_bytes(
        self,
        image_bytes: bytes,
        mime_type: str,
        source_file: str,
        page_number: int,
        retries: int = 2,
    ) -> dict:
        """
        Gửi ảnh (base64) lên Ollama LLaVA → trả về dict có key 'students' và 'exam_metadata'.
        Interface giống với gemini_service.extract_from_image_bytes().
        """
        if not self.is_available():
            raise ConnectionError("Ollama server không chạy tại localhost:11434")

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        model = self._get_model()
        url = f"{self._get_base_url()}/api/generate"

        payload = {
            "model": model,
            "prompt": OLLAMA_EXTRACTION_PROMPT,
            "images": [image_b64],
            "stream": False,
            "format": "json",
        }
        if self._force_cpu:
            payload["options"] = {"num_gpu": 0}

        last_err = None
        for attempt in range(retries):
            try:
                response_data = await asyncio.to_thread(
                    self._sync_request, url, payload
                )
                raw_text = response_data.get("response", "").strip()

                # Strip markdown fences nếu có
                if raw_text.startswith("```"):
                    raw_text = raw_text.split("\n", 1)[1] if "\n" in raw_text else raw_text
                    raw_text = raw_text.rsplit("```", 1)[0].strip()

                if not raw_text:
                    raise ValueError("Ollama trả về response rỗng")

                data = json.loads(raw_text)

                # Inject source info
                for s in data.get("students", []):
                    s["source_file"] = source_file
                    s["page_number"] = page_number

                logger.info(
                    f"[Ollama] '{source_file}' trang {page_number}: "
                    f"{len(data.get('students', []))} học viên."
                )
                return data

            except Exception as e:
                last_err = e
                err_str = str(e).lower()
                # Nếu GPU VRAM không đủ (out-of-memory / Vulkan / buffer allocation) -> tự động chuyển sang CPU
                if "out-of-memory" in err_str or "vulkan" in err_str or "buffer" in err_str or "projector" in err_str or "alloc" in err_str:
                    self._force_cpu = True
                    logger.warning(
                        f"[Ollama] GPU VRAM không đủ cho LLaVA vision projector ({e}). "
                        f"Tự động chuyển sang chế độ CPU (num_gpu=0) và thử lại ngay..."
                    )
                    payload["options"] = {"num_gpu": 0}

                if attempt < retries - 1:
                    wait = 1.0 * (2 ** attempt)
                    logger.warning(
                        f"[Ollama] Lần thử {attempt + 1} thất bại ({e}). "
                        f"Thử lại sau {wait}s..."
                    )
                    await asyncio.sleep(wait)

        raise RuntimeError(
            f"[Ollama] Extraction thất bại sau {retries} lần thử: {last_err}"
        )


ollama_service = OllamaService()
