# 🦙 Kế hoạch: Ollama LLaVA + PaddleOCR Dual-Validation System

> **Mục tiêu**: Dùng 2 engine OCR độc lập (LLaVA:7b qua Ollama + PaddleOCR) để cross-validate,
> tính confidence score tự động và đánh dấu `needs_review` cho từng học viên.

---

## 📋 Tổng quan luồng xử lý

```
Ảnh bảng điểm (PNG/JPG)
        │
   ┌────┴────┐
   ▼         ▼
LLaVA:7b   PaddleOCR
(Ollama)    (local)
   │         │
   └────┬────┘
        ▼
  So sánh từng trường
  (student_id, full_name, score, date_of_birth)
        │
   ┌────┴──────────────────────────┐
   │  Cross-Confidence Score       │
   │  >= 0.9  → ✅ Tự tin cao      │
   │  0.7–0.9 → ⚠️ Cần xem lại    │
   │  < 0.7   → ❌ Bắt buộc review │
   └────┬──────────────────────────┘
        ▼
  needs_review + review_reason tự động
```

---

## 🛠️ Các bước thực hiện

### Bước 0 — Cài đặt môi trường (làm trước)

```powershell
# 1. Cài Ollama
winget install Ollama.Ollama

# 2. Khởi động Ollama service
ollama serve

# 3. Pull model LLaVA:7b (~4.7GB)
ollama pull llava:7b

# 4. Cài PaddleOCR vào backend virtualenv
cd e:\Ongoing_Projects\CCE\backend
.\venv\Scripts\activate
pip install paddlepaddle paddleocr
```

---

### Bước 1 — Tạo `OllamaService`

**File cần tạo**: `backend/app/services/ollama/ollama_service.py`

**Chức năng**:
- Gọi Ollama REST API tại `http://localhost:11434`
- Gửi ảnh (base64) + prompt trích xuất JSON
- Retry với exponential backoff
- Trả về dict cùng cấu trúc với `gemini_service`

```python
# Endpoint Ollama dùng
POST http://localhost:11434/api/generate
{
  "model": "llava:7b",
  "prompt": "<EXTRACTION_PROMPT>",
  "images": ["<base64_image>"],
  "stream": false,
  "format": "json"
}
```

**Interface cần implement**:
```python
class OllamaService:
    async def extract_from_image_bytes(image_bytes, mime_type, source_file, page_number) -> dict
    async def test_connection() -> dict
    async def list_models() -> list[dict]
    def is_available() -> bool  # ping localhost:11434
```

---

### Bước 2 — Tạo `PaddleOCRService`

**File cần tạo**: `backend/app/services/ocr/paddle_ocr_service.py`

**Chức năng**:
- Load PaddleOCR model (tiếng Việt: `lang='vi'`)
- Nhận image bytes → trả về raw text blocks với bounding boxes
- Extract các trường: student_id, full_name, score, date_of_birth từ text layout

```python
from paddleocr import PaddleOCR

ocr = PaddleOCR(use_angle_cls=True, lang='vi', use_gpu=True)

class PaddleOCRService:
    def extract_text_blocks(self, image_bytes: bytes) -> list[dict]
    # Trả về: [{"text": "...", "confidence": 0.98, "bbox": [...]}]
    
    def extract_structured(self, image_bytes: bytes) -> dict
    # Trả về cùng cấu trúc JSON như gemini/ollama
```

---

### Bước 3 — Tạo `CrossValidationService`

**File cần tạo**: `backend/app/services/validation/cross_validation_service.py`

**Chức năng**: So sánh kết quả từ 2 engine, tính cross-confidence

```python
from difflib import SequenceMatcher

FIELDS_TO_COMPARE = ["student_id", "full_name", "score", "date_of_birth"]
CONFIDENCE_THRESHOLD = 0.85

class CrossValidationService:
    
    def compare_student(self, llava_student: dict, ocr_student: dict) -> dict:
        scores = {}
        mismatches = []
        
        for field in FIELDS_TO_COMPARE:
            v1 = str(llava_student.get(field) or "").strip()
            v2 = str(ocr_student.get(field) or "").strip()
            
            if not v1 and not v2:
                scores[field] = 1.0
            elif not v1 or not v2:
                scores[field] = 0.3
                mismatches.append(field)
            else:
                ratio = SequenceMatcher(None, v1.lower(), v2.lower()).ratio()
                scores[field] = ratio
                if ratio < CONFIDENCE_THRESHOLD:
                    mismatches.append(f"{field}: '{v1}' vs '{v2}'")
        
        cross_confidence = sum(scores.values()) / len(scores)
        needs_review = cross_confidence < CONFIDENCE_THRESHOLD
        
        return {
            "cross_confidence": round(cross_confidence, 3),
            "field_confidences": scores,
            "needs_review": needs_review,
            "review_reason": (
                f"OCR cross-check không đồng nhất ({cross_confidence:.0%}): "
                + "; ".join(mismatches)
            ) if needs_review else None
        }
```

---

### Bước 4 — Sửa `ExtractionService`

**File sửa**: `backend/app/services/extraction/extraction_service.py`

**Thay đổi**:
- Chạy **tuần tự** LLaVA rồi PaddleOCR (tránh VRAM conflict)
- Gọi `CrossValidationService.validate_page()` sau khi có cả 2 kết quả
- Gắn `cross_confidence` vào từng `ExtractedStudent`

```python
# Chạy tuần tự (RTX 3050 VRAM hạn chế)
llava_result = await ollama_service.extract_from_image_bytes(...)
ocr_result = await asyncio.to_thread(paddle_ocr_service.extract_structured, img_bytes)

# Cross-validate
validated = cross_validation_service.validate_page(llava_result, ocr_result)
```

---

### Bước 5 — Cập nhật Schemas

**File sửa**: `backend/app/models/schemas.py`

**Thêm vào `ExtractedStudent`**:
```python
cross_confidence: Optional[float] = None       # 0.0 → 1.0
cross_validation_detail: Optional[dict] = None  # per-field confidence
ocr_engine: Optional[str] = None               # "ollama+paddle" | "gemini"
```

---

### Bước 6 — Cập nhật AI Settings Store & API

**Thêm vào store**:
```python
def get_ocr_provider(self) -> str:  # "gemini" | "ollama"
def set_ocr_provider(self, provider: str) -> None:
def get_ollama_model(self) -> str:  # default "llava:7b"
```

**Thêm endpoints**:
```
GET  /api/ai/ollama/status    # Kiểm tra Ollama đang chạy không
GET  /api/ai/ollama/models    # Liệt kê models đã pull
```

---

### Bước 7 — Cập nhật Frontend

**`AISettingsPage.jsx`** — Thêm section "Ollama (Local AI)":
- Toggle bật/tắt Ollama
- Hiển thị status: 🟢 Running / 🔴 Not available
- Chọn model: `llava:7b`, `llava:13b`, `minicpm-v`

**ResultsTable** — Thêm confidence badge mỗi row:
```
>= 0.9  → 🟢 "Tin cậy cao"
0.7–0.9 → 🟡 "Xem lại"
< 0.7   → 🔴 "Cần kiểm tra"
```

---

## 📁 Cấu trúc file mới

```
backend/app/services/
├── gemini/
│   └── gemini_service.py          (đã có ✅)
├── ollama/                        ← MỚI
│   ├── __init__.py
│   └── ollama_service.py
├── ocr/                           ← MỚI
│   ├── __init__.py
│   └── paddle_ocr_service.py
├── validation/                    ← MỚI
│   ├── __init__.py
│   └── cross_validation_service.py
└── extraction/
    └── extraction_service.py      (sửa)
```

---

## ⚙️ Config mới cần thêm vào `config.py`

```python
OLLAMA_BASE_URL: str = "http://localhost:11434"
OLLAMA_MODEL: str = "llava:7b"
OLLAMA_TIMEOUT: int = 120
ENABLE_CROSS_VALIDATION: bool = True
CROSS_CONFIDENCE_THRESHOLD: float = 0.85
OCR_PROVIDER: str = "gemini"  # "gemini" | "ollama"
```

---

## 🎯 Thứ tự ưu tiên khi làm

| # | Task | Độ khó | Thời gian |
|---|------|--------|-----------|
| 0 | Cài Ollama + pull llava:7b | Dễ | 15 phút (chờ download) |
| 1 | Tạo `OllamaService` | Trung bình | 30 phút |
| 2 | Tạo `PaddleOCRService` | Trung bình | 30 phút |
| 3 | Tạo `CrossValidationService` | Dễ | 20 phút |
| 4 | Sửa `ExtractionService` | Trung bình | 30 phút |
| 5 | Sửa `Schemas` | Dễ | 10 phút |
| 6 | Sửa `AISettingsPage` frontend | Trung bình | 45 phút |
| 7 | Thêm confidence badge | Dễ | 20 phút |
| 8 | Test & fine-tune threshold | Khó | 60 phút |

**Tổng ước tính: ~4 giờ**

---

## ⚠️ Lưu ý quan trọng

- **Fallback**: Nếu Ollama không chạy → tự động dùng Gemini đơn lẻ, không crash
- **VRAM conflict**: LLaVA + PaddleOCR không chạy song song được trên RTX 3050 4GB → chạy tuần tự
- **PaddleOCR lang**: Dùng `lang='vi'` (tiếng Việt), không dùng `lang='ch'`
- **Threshold**: Bắt đầu `0.85`, điều chỉnh sau khi test với dữ liệu thực
- **Gemini vẫn là mặc định**: Ollama là tùy chọn thêm, không bắt buộc

---

*📅 Kế hoạch tạo: 2026-10-23 | Project: CCE ScoreSync*
