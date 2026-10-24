"""
PaddleOCR service — OCR cuc bo bang PaddleOCR (tieng Viet).

Chuc nang chinh:
  1. extract_text_blocks(): nhan image bytes → list text blocks voi bbox + confidence
     (dung cho layout_reconstructor → ollama_text_service pipeline)
  2. extract_structured(): nhan image bytes → dict cau truc (giu tuong thich cu)
     (dung cho cross-validation voi LLaVA/Gemini)

Luu y:
  - Model duoc khoi tao lazy (lan goi dau tien) de tranh ton RAM khi khong dung.
  - Khong tu sua hoac tu suy doan noi dung OCR.
  - Tra ve raw text blocks; chuyen doi cau truc do layout_reconstructor dam nhan.
"""
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


# --- PaddleOCR lazy init ---

_paddle_ocr_instance = None
_paddle_available: Optional[bool] = None


def _get_paddle_ocr():
    global _paddle_ocr_instance, _paddle_available
    if _paddle_available is False:
        return None
    if _paddle_ocr_instance is not None:
        return _paddle_ocr_instance
    try:
        from paddleocr import PaddleOCR  # noqa: PLC0415
        try:
            # PaddleOCR v3: chi truyen lang
            _paddle_ocr_instance = PaddleOCR(lang="vi")
        except TypeError:
            # PaddleOCR v2 fallback
            _paddle_ocr_instance = PaddleOCR(
                use_angle_cls=True,
                lang="vi",
                use_gpu=False,
                show_log=False,
            )
        _paddle_available = True
        logger.info("[PaddleOCR] Model da khoi tao thanh cong (lang=vi).")
        return _paddle_ocr_instance
    except ImportError:
        _paddle_available = False
        logger.warning(
            "[PaddleOCR] Thu vien paddleocr chua duoc cai dat. "
            "Chay: pip install paddlepaddle paddleocr"
        )
        return None
    except Exception as e:
        _paddle_available = False
        logger.error(f"[PaddleOCR] Khong khoi tao duoc model: {e}")
        return None


# --- Text block extraction from PaddleOCR result ---

def _extract_text_blocks_from_result(paddle_result) -> list[dict]:
    """
    Chuyen ket qua PaddleOCR thanh list text blocks chuan hoa.
    Ho tro ca PaddleOCR v2 va v3.

    Returns:
        list[dict] voi keys: 'text', 'confidence', 'bbox'
        bbox la polygon [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] hoac [x0,y0,x1,y1]
    """
    blocks = []
    if not paddle_result:
        return blocks

    item = paddle_result[0]

    # PaddleOCR v3: dict-like voi rec_texts
    if isinstance(item, dict) or (hasattr(item, "get") and "rec_texts" in str(type(item))):
        try:
            texts = item.get("rec_texts", [])
            scores = item.get("rec_scores", [])
            polys = item.get("rec_polys", [])
            boxes = item.get("rec_boxes", [])

            for i, text in enumerate(texts):
                if not text or not str(text).strip():
                    continue
                conf = float(scores[i]) if i < len(scores) else 1.0

                bbox = None
                if i < len(polys) and len(polys[i]) > 0:
                    poly = polys[i]
                    # Chuyen numpy array neu can
                    try:
                        bbox = [[float(p[0]), float(p[1])] for p in poly]
                    except (TypeError, IndexError):
                        bbox = poly
                elif i < len(boxes) and len(boxes[i]) > 0:
                    b = boxes[i]
                    try:
                        if len(b) == 4 and not hasattr(b[0], "__len__"):
                            bbox = [
                                [float(b[0]), float(b[1])],
                                [float(b[2]), float(b[1])],
                                [float(b[2]), float(b[3])],
                                [float(b[0]), float(b[3])],
                            ]
                        else:
                            bbox = [[float(p[0]), float(p[1])] for p in b]
                    except (TypeError, IndexError):
                        bbox = b
                else:
                    # Fallback: bbox gia dinh theo thu tu
                    y = i * 20
                    bbox = [[0, y], [200, y], [200, y+18], [0, y+18]]

                blocks.append({
                    "text": str(text).strip(),
                    "confidence": round(conf, 4),
                    "bbox": bbox,
                })
            return blocks
        except Exception as e:
            logger.warning(f"[PaddleOCR] Loi xu ly v3 result: {e}, thu v2 format...")

    # PaddleOCR v2: list of [bbox, (text, confidence)]
    if isinstance(item, list):
        for line in item:
            if not line or len(line) < 2:
                continue
            try:
                bbox, text_conf = line[0], line[1]
                if isinstance(text_conf, (list, tuple)) and len(text_conf) >= 2:
                    text, confidence = text_conf[0], text_conf[1]
                elif isinstance(text_conf, str):
                    text, confidence = text_conf, 1.0
                else:
                    continue
                if text and str(text).strip():
                    blocks.append({
                        "text": str(text).strip(),
                        "confidence": round(float(confidence), 4),
                        "bbox": bbox,
                    })
            except Exception:
                continue

    return blocks


# --- Heuristic helpers (giu tuong thich cu) ---

_STUDENT_ID_PATTERN = re.compile(
    r"\b([A-Z]{2,4}\d{2}[.\-]?\d[A-Z0-9]{1,6}\d{3,})\b", re.IGNORECASE
)
_SCORE_PATTERN = re.compile(r"\b(\d{1,2}[,.]\d{1,2}|\d{1,2})\b")
_DATE_PATTERN = re.compile(r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b")


def _blocks_to_rows(blocks: list[dict]) -> list[list[dict]]:
    """
    Nhom cac text blocks thanh hang (rows) dua tren toa do Y.
    Cac blocks co top-Y gan nhau (+/-18px) duoc coi la cung hang.
    """
    if not blocks:
        return []

    def block_y(b):
        bbox = b["bbox"]
        if bbox and isinstance(bbox[0], (list, tuple)):
            return float(bbox[0][1])
        elif bbox and len(bbox) >= 2:
            return float(bbox[1])
        return 0.0

    sorted_blocks = sorted(blocks, key=block_y)
    rows = []
    current_row = [sorted_blocks[0]]

    for b in sorted_blocks[1:]:
        if abs(block_y(b) - block_y(current_row[0])) < 18:
            current_row.append(b)
        else:
            rows.append(sorted(current_row, key=lambda x: (
                float(x["bbox"][0][0]) if x["bbox"] and isinstance(x["bbox"][0], (list, tuple))
                else float(x["bbox"][0]) if x["bbox"] else 0.0
            )))
            current_row = [b]
    if current_row:
        rows.append(sorted(current_row, key=lambda x: (
            float(x["bbox"][0][0]) if x["bbox"] and isinstance(x["bbox"][0], (list, tuple))
            else float(x["bbox"][0]) if x["bbox"] else 0.0
        )))
    return rows


def _row_text(row: list[dict]) -> str:
    return " ".join(b["text"] for b in row)


def _avg_confidence(row: list[dict]) -> float:
    if not row:
        return 0.0
    return sum(b["confidence"] for b in row) / len(row)


def _parse_student_rows(rows: list[list[dict]]) -> list[dict]:
    """
    Nhan dien heuristic cac hang hoc vien tu danh sach rows.
    Chi dung cho extract_structured() (tuong thich cu).
    """
    students = []
    stt_counter = 0

    for row in rows:
        text = _row_text(row)
        lower = text.lower()
        if any(h in lower for h in ["hoc vien", "hoc sinh", "stt", "ma hv", "diem", "ghi chu"]):
            continue

        sid_match = _STUDENT_ID_PATTERN.search(text)
        if not sid_match:
            continue

        student_id = sid_match.group(1)
        avg_conf = _avg_confidence(row)
        stt_counter += 1

        parts = text.split()
        name_parts = [
            p for p in parts
            if not _STUDENT_ID_PATTERN.match(p)
            and not _SCORE_PATTERN.fullmatch(p)
            and not _DATE_PATTERN.match(p)
            and not p.isdigit()
            and len(p) >= 2
        ]
        full_name = " ".join(name_parts).strip() or None

        dob_match = _DATE_PATTERN.search(text)
        date_of_birth = dob_match.group(1) if dob_match else None

        score_matches = _SCORE_PATTERN.findall(text)
        score = None
        if score_matches:
            for sm in reversed(score_matches):
                try:
                    val = float(sm.replace(",", "."))
                    if 0.0 <= val <= 10.0:
                        score = val
                        break
                except ValueError:
                    pass

        students.append({
            "stt": stt_counter,
            "student_id": student_id,
            "full_name": full_name,
            "date_of_birth": date_of_birth,
            "score": score,
            "raw_score_text": score_matches[-1] if score_matches else None,
            "confidence": {
                "student_id": avg_conf,
                "full_name": avg_conf * 0.85,
                "date_of_birth": avg_conf if date_of_birth else 0.3,
                "score": avg_conf if score is not None else 0.3,
            },
            "needs_review": avg_conf < 0.8 or score is None,
            "review_reason": (
                "PaddleOCR: do tin cay thap hoac khong doc duoc diem"
                if avg_conf < 0.8 or score is None
                else None
            ),
        })

    return students


def _parse_exam_metadata(rows: list[list[dict]]) -> dict:
    """Trich xuat metadata ky thi tu cac hang dau tai lieu (heuristic)."""
    meta = {
        "semester": None, "subject": None, "course": None,
        "exam_datetime": None, "class_name": None, "major": None,
        "exam_location": None, "room": None,
    }
    for row in rows[:20]:
        text = _row_text(row)
        lower = text.lower()

        if "hoc ky" in lower and not meta["semester"]:
            m = re.search(r"hoc ky\s*(\d+)", lower)
            meta["semester"] = m.group(1) if m else None

        if ("hoc phan" in lower or "mon" in lower) and not meta["subject"]:
            m = re.search(r"(?:hoc phan|mon)[:\s]+(.+)", text, re.IGNORECASE)
            meta["subject"] = m.group(1).strip()[:80] if m else None

        if "lop" in lower and not meta["class_name"]:
            m = re.search(r"lop[:\s]+([A-Z0-9.\-]+)", text, re.IGNORECASE)
            meta["class_name"] = m.group(1).strip() if m else None

        if "phong" in lower and not meta["room"]:
            m = re.search(r"phong[:\s]+(\S+)", text, re.IGNORECASE)
            meta["room"] = m.group(1).strip() if m else None

    return meta


# --- Service class ---

class PaddleOCRService:
    """
    OCR cuc bo bang PaddleOCR.

    Hai chuc nang chinh:
    1. extract_text_blocks(): cho pipeline moi (PaddleOCR → LayoutReconstructor → Ollama text)
    2. extract_structured(): cho cross-validation cu (tuong thich nguoc)
    """

    def is_available(self) -> bool:
        """Kiem tra PaddleOCR da duoc cai dat chua."""
        return _get_paddle_ocr() is not None

    def _run_ocr(self, image_bytes: bytes) -> list[dict]:
        """
        Chay PaddleOCR va tra ve raw text blocks.
        Returns list rong neu that bai.
        """
        ocr = _get_paddle_ocr()
        if ocr is None:
            return []
        try:
            import io  # noqa: PLC0415
            import numpy as np  # noqa: PLC0415
            from PIL import Image  # noqa: PLC0415

            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img_np = np.array(img)
            try:
                result = ocr.ocr(img_np)
            except TypeError:
                result = ocr.ocr(img_np, cls=True)
            return _extract_text_blocks_from_result(result)
        except Exception as e:
            logger.error(f"[PaddleOCR] _run_ocr loi: {e}")
            return []

    def extract_text_blocks(self, image_bytes: bytes) -> list[dict]:
        """
        Nhan image bytes → list text blocks voi bbox + confidence.

        Returns:
            list[dict] moi dict co:
                - 'text': str — noi dung van ban
                - 'confidence': float 0.0-1.0
                - 'bbox': list — polygon [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]
        """
        blocks = self._run_ocr(image_bytes)
        if blocks:
            logger.info(f"[PaddleOCR] Nhan dien duoc {len(blocks)} text blocks.")
        return blocks

    def extract_structured(self, image_bytes: bytes) -> dict:
        """
        Nhan image bytes → dict cung cau truc voi gemini/ollama.
        Dung cho cross-validation (tuong thich nguoc).

        Returns:
            dict: { "exam_metadata": {...}, "students": [...] }
        """
        blocks = self._run_ocr(image_bytes)
        if not blocks:
            return {"exam_metadata": {}, "students": []}
        rows = _blocks_to_rows(blocks)
        students = _parse_student_rows(rows)
        exam_meta = _parse_exam_metadata(rows)
        return {
            "exam_metadata": exam_meta,
            "students": students,
        }


paddle_ocr_service = PaddleOCRService()
