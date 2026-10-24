"""
ollama_text_service.py
======================
Gui ket qua OCR (van ban co cau truc) cho Ollama de chuyen doi thanh JSON.

Khac voi ollama_service.py (gui anh cho LLaVA),
module nay KHONG gui anh — chi gui text da duoc PaddleOCR nhan dien.
Do do co the dung voi moi model text (llava:7b, mistral, llama3, v.v.)
va khong bi gioi han boi VRAM cho viec xu ly anh.

Luong:
  PaddleOCR text + bbox → LayoutReconstructor → structured_text
  → OllamaTextService.extract_from_ocr_text()
  → JSON validate → ExtractedStudent list
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import socket
from typing import Any, Optional
from urllib import request as urllib_request
from urllib.error import HTTPError
from urllib.request import Request

from ...core.config import settings

logger = logging.getLogger(__name__)


# --- Prompt template ---

_SYSTEM_PROMPT = """Ban la he thong xu ly du lieu ky thi. Nhiem vu la phan tich noi dung OCR tu bang diem va tra ve JSON hop le.

QUY TAC TUYET DOI:
1. Chi tra ve JSON thuan tuy, KHONG markdown, KHONG giai thich
2. Khong tu tao du lieu khong co trong tai lieu
3. Khong tu dien gia tri cho o trong hoac khong ro
4. Ma HV luon la chuoi (string), giu so 0 o dau
5. Diem so: so thuc (float), null neu khong ro hoac o trong
6. Ngay sinh: dinh dang YYYY-MM-DD neu du can cu, null neu khong ro
7. Khong loai bo hang du lieu nao ke ca hang thieu truong
8. STT: so nguyen theo thu tu trong bang"""

_EXTRACTION_PROMPT_TEMPLATE = """{system}

SCHEMA JSON YEU CAU:
{{
  "exam_info": {{
    "semester": null,
    "subject": null,
    "course": null,
    "exam_datetime": null,
    "class_name": null,
    "major": null,
    "exam_location": null,
    "room": null
  }},
  "students": [
    {{
      "stt": 1,
      "student_id": "000123",
      "full_name": "Nguyen Van A",
      "date_of_birth": "2003-01-15",
      "score": 8.5,
      "needs_review": false,
      "review_reason": null
    }}
  ],
  "warnings": []
}}

NOI DUNG OCR CAN PHAN TICH:
{ocr_text}

Tra ve JSON theo schema tren. Neu mot truong khong tim thay trong tai lieu, dat gia tri null.
Neu mot o co van de (mo, kho doc, nhieu kha nang sai), dat needs_review: true va ghi ly do.
"""


def _build_prompt(ocr_text: str) -> str:
    return _EXTRACTION_PROMPT_TEMPLATE.format(
        system=_SYSTEM_PROMPT,
        ocr_text=ocr_text,
    )


# --- JSON repair helpers ---

def _strip_markdown_fences(text: str) -> str:
    """Xoa markdown code fences neu LLM tra ve trong backtick."""
    text = text.strip()
    if text.startswith("```"):
        # Remove first line (```json or ```)
        lines = text.split("\n", 1)
        if len(lines) > 1:
            text = lines[1]
        # Remove trailing ```
        text = text.rsplit("```", 1)[0].strip()
    return text


def _extract_json_from_text(text: str) -> str:
    """
    Co gang trich JSON tu text co the chua them noi dung ngoai.
    Tim chuoi bat dau tu { va ket thuc tai } hop le.
    """
    text = text.strip()
    # Tim vi tri { dau tien
    start = text.find("{")
    if start == -1:
        return text

    # Tim } ket thuc bang cach dem cap ngoac
    depth = 0
    end = -1
    in_string = False
    escape = False

    for i, ch in enumerate(text[start:], start):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"' and not escape:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break

    if end != -1:
        return text[start:end+1]
    return text[start:]


def _repair_json_simple(text: str) -> str:
    """Sua loi JSON don gian: trailing comma, single quotes."""
    # Trailing commas
    text = re.sub(r",\s*([\]}])", r"\1", text)
    # Single quotes thay vi double quotes (chi cho key/value don gian)
    # Khong xu ly truong hop phuc tap
    return text


# --- Service class ---

class OllamaTextService:
    """
    Gui van ban OCR co cau truc cho Ollama va nhan JSON ket qua.
    Khong gui anh — only text inference.
    """

    def __init__(self):
        self._base_url: str = settings.OLLAMA_BASE_URL
        self._model: str = settings.OLLAMA_MODEL
        self._timeout: int = settings.OLLAMA_TIMEOUT
        self._max_retries: int = getattr(settings, "OLLAMA_MAX_RETRIES", 3)

    def _get_base_url(self) -> str:
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

    def is_available(self) -> bool:
        return self._is_port_open()

    def _sync_post(self, url: str, payload: dict) -> dict:
        """HTTP POST dong bo (chay trong asyncio.to_thread)."""
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
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

    def _parse_ollama_response(self, response_data: dict) -> dict:
        """Trich xuat va parse JSON tu response Ollama."""
        raw_text = response_data.get("response", "").strip()

        if not raw_text:
            raise ValueError("Ollama tra ve response rong")

        # Xoa markdown fences
        raw_text = _strip_markdown_fences(raw_text)

        # Trich JSON tu text
        json_str = _extract_json_from_text(raw_text)

        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            # Thu sua loi don gian
            repaired = _repair_json_simple(json_str)
            try:
                return json.loads(repaired)
            except json.JSONDecodeError as e:
                raise ValueError(
                    f"Khong the parse JSON tu Ollama: {e}\n"
                    f"Raw text (100 chars): {raw_text[:100]}"
                ) from e

    async def extract_from_ocr_text(
        self,
        ocr_text: str,
        source_file: str,
        pages: list[int],
        retries: Optional[int] = None,
    ) -> dict:
        """
        Gui van ban OCR co cau truc cho Ollama va nhan JSON.

        Args:
            ocr_text: Van ban da duoc PaddleOCR nhan dien va tao cau truc
            source_file: Ten file goc (de log)
            pages: Danh sach so trang (de log)
            retries: So lan thu lai (mac dinh lay tu config)

        Returns:
            dict co cau truc:
            {
                "exam_info": {...},
                "students": [...],
                "warnings": [...]
            }
        """
        if not self.is_available():
            raise ConnectionError(
                "Ollama server khong chay tai localhost:11434. "
                "Chay 'ollama serve' truoc khi xu ly."
            )

        max_retries = retries if retries is not None else self._max_retries
        model = self._get_model()
        url = f"{self._get_base_url()}/api/generate"
        prompt = _build_prompt(ocr_text)

        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        # Model 7B/13B (nhu llava:7b 4.7GB) vuot qua 4GB VRAM cua RTX 3050, mac dinh offload sang RAM/CPU
        if any(size in model.lower() for size in ("7b", "13b")):
            payload["options"] = {"num_gpu": 0}

        last_err: Optional[Exception] = None
        pages_str = ",".join(str(p) for p in pages)

        for attempt in range(max_retries):
            try:
                logger.info(
                    f"[OllamaText] '{source_file}' trang [{pages_str}]: "
                    f"goi Ollama ({model}), lan thu {attempt+1}/{max_retries}..."
                )

                response_data = await asyncio.to_thread(
                    self._sync_post, url, payload
                )
                result = self._parse_ollama_response(response_data)

                # Inject source info vao tung student
                for s in result.get("students", []):
                    s.setdefault("source_file", source_file)
                    s.setdefault("pages", pages)

                student_count = len(result.get("students", []))
                warnings = result.get("warnings", [])
                logger.info(
                    f"[OllamaText] '{source_file}' trang [{pages_str}]: "
                    f"{student_count} hoc vien, {len(warnings)} canh bao."
                )
                return result

            except (ValueError, json.JSONDecodeError) as e:
                # Loi parse JSON -> thu lai co the cai thien
                last_err = e
                logger.warning(
                    f"[OllamaText] Parse JSON that bai (lan {attempt+1}): {e}"
                )
                if attempt < max_retries - 1:
                    # Lan thu lai: them chi dan nhat quan hoan JSON
                    payload["prompt"] = (
                        prompt + "\n\nQUAN TRONG: Chi tra ve JSON thuan tuy, bat dau bang { va ket thuc bang }."
                    )
                    await asyncio.sleep(1.0 * (attempt + 1))

            except Exception as e:
                last_err = e
                err_str = str(e).lower()
                logger.warning(
                    f"[OllamaText] Loi lan thu {attempt+1}: {e}"
                )
                # Neu loi do bo nho GPU VRAM (Vulkan buffer allocation failed, OOM...)
                if any(k in err_str for k in ("vulkan", "allocate", "buffer", "memory", "cuda")):
                    logger.warning(
                        "[OllamaText] Phat hien loi tran bo nho GPU (VRAM). Tu dong chuyen sang chay tren CPU/RAM (num_gpu=0)..."
                    )
                    if "options" not in payload:
                        payload["options"] = {}
                    payload["options"]["num_gpu"] = 0

                if attempt < max_retries - 1:
                    wait = 1.5 * (2 ** attempt)
                    await asyncio.sleep(wait)

        raise RuntimeError(
            f"[OllamaText] Extraction that bai sau {max_retries} lan thu: {last_err}"
        )

    async def validate_json_output(
        self,
        invalid_json_text: str,
        schema_hint: str,
        source_file: str,
    ) -> Optional[dict]:
        """
        Thu su dung Ollama de sua JSON sai dinh dang.
        Chi duoc goi mot lan va chi sua dinh dang, KHONG them du lieu.
        """
        if not self.is_available():
            return None

        repair_prompt = f"""Sau day la JSON bi loi cu phap. Hay sua loi cu phap de JSON hop le.
TUYET DOI KHONG them hoac xoa bat ky truong du lieu nao.
Chi sua ky tu cu phap sai (dau phay thua, ngoac sai, v.v.).
Tra ve JSON hop le thuan tuy.

JSON loi:
{invalid_json_text}

Schema mong doi:
{schema_hint}"""

        model = self._get_model()
        url = f"{self._get_base_url()}/api/generate"
        payload = {"model": model, "prompt": repair_prompt, "stream": False}

        try:
            response_data = await asyncio.to_thread(self._sync_post, url, payload)
            return self._parse_ollama_response(response_data)
        except Exception as e:
            logger.warning(f"[OllamaText] validate_json_output that bai: {e}")
            return None


ollama_text_service = OllamaTextService()
