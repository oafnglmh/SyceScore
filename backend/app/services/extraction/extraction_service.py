"""
Extraction service — Gemini AI Vision only pipeline.

Luồng xử lý (mọi nguồn A và B):
  • PDF   → render từng trang thành ảnh PNG → gửi Gemini AI Vision → JSON
  • Ảnh (JPG/PNG) → gửi Gemini AI Vision → JSON

pdfplumber và Tesseract đã bị loại bỏ hoàn toàn.
Mọi file đều xử lý qua Gemini để đảm bảo độ chính xác cao nhất.
"""
import asyncio
import io
import logging
import re
from pathlib import Path
from typing import Callable, Optional

import fitz  # PyMuPDF
from PIL import Image, ImageOps

from ...core.config import settings
from ...models.schemas import (
    ExamMetadata,
    ExtractedStudent,
    FieldConfidence,
    SourceData,
)
from ...storage.ai_settings_store import ai_settings_store
from ..gemini.gemini_service import gemini_service

logger = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _clean_str(v) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


def _pdf_page_to_image_bytes(page: fitz.Page, dpi: int = 200) -> bytes:
    """Render PDF page → PNG bytes (respect rotation)."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return pix.tobytes("png")


def _normalize_metadata(
    raw: dict,
    source_file: Optional[str] = None,
    page_number: Optional[int] = None,
) -> ExamMetadata:
    meta = raw.get("exam_metadata", {}) or {}
    unreadable = meta.get("metadata_unreadable_reasons")
    if not isinstance(unreadable, dict):
        unreadable = {}
    return ExamMetadata(
        semester=_clean_str(meta.get("semester")),
        subject=_clean_str(meta.get("subject")),
        course=_clean_str(meta.get("course")),
        exam_datetime=_clean_str(meta.get("exam_datetime")),
        class_name=_clean_str(meta.get("class_name")),
        major=_clean_str(meta.get("major")),
        exam_location=_clean_str(meta.get("exam_location")),
        room=_clean_str(meta.get("room")),
        metadata_unreadable_reasons=unreadable,
        source_file=source_file,
        page_number=page_number,
    )


def _merge_metadata(base: Optional[ExamMetadata], new: ExamMetadata) -> ExamMetadata:
    """Merge metadata từ nhiều trang, ưu tiên giá trị không null."""
    if base is None:
        return new
    merged = {}
    for field in ExamMetadata.model_fields:
        if field == "metadata_unreadable_reasons":
            reasons = {}
            if base.metadata_unreadable_reasons:
                reasons.update(base.metadata_unreadable_reasons)
            if new.metadata_unreadable_reasons:
                reasons.update(new.metadata_unreadable_reasons)
            merged[field] = reasons
            continue
        existing = getattr(base, field)
        incoming = getattr(new, field)
        merged[field] = incoming if incoming is not None else existing
    return ExamMetadata(**merged)


def _extract_class_from_student_id(sid: Optional[str]) -> Optional[str]:
    """
    Trích mã lớp từ mã sinh viên.
    Ví dụ: 'AV30.2B10001' hoặc 'AV30.2B1BS01' → 'AV30.2B1'
    """
    if not sid:
        return None
    s = str(sid).strip().upper()
    m = re.match(r"^([A-Z]{2,}\d+[\.\-_]\d+[A-Z0-9]+?)(?:\d{3,}|BS\d+)", s)
    if m:
        return m.group(1)
    return None


def _normalize_students(
    raw_students: list[dict],
    page_meta: Optional[ExamMetadata] = None,
    source_file: Optional[str] = None,
    page_number: Optional[int] = None,
) -> list[ExtractedStudent]:
    students = []
    for s in raw_students:
        score_raw = s.get("score")
        score_normalized = None
        if score_raw is not None:
            try:
                score_str = str(score_raw).replace(",", ".").strip()
                score_normalized = float(score_str)
            except (ValueError, TypeError):
                score_normalized = None

        conf_data = s.get("confidence", {})
        confidence = FieldConfidence(
            student_id=float(conf_data.get("student_id", 0.0)),
            full_name=float(conf_data.get("full_name", 0.0)),
            date_of_birth=float(conf_data.get("date_of_birth", 0.0)),
            score=float(conf_data.get("score", 0.0)),
        )

        needs_review = s.get("needs_review", False)
        review_reason = s.get("review_reason")
        if score_normalized is None and score_raw is not None:
            needs_review = True
            if not review_reason:
                review_reason = "Điểm không thể chuẩn hóa thành số"
        elif score_raw is None:
            needs_review = True
            if not review_reason:
                review_reason = "Không đọc được điểm số"

        if confidence.score < settings.MIN_CONFIDENCE_THRESHOLD:
            needs_review = True

        sid_clean = _clean_str(s.get("student_id"))
        subj = _clean_str(s.get("subject")) or (page_meta.subject if page_meta else None)
        extracted_cls = _extract_class_from_student_id(sid_clean)
        cls_name = (
            _clean_str(s.get("class_name"))
            or extracted_cls
            or (page_meta.class_name if page_meta else None)
        )

        student = ExtractedStudent(
            stt=s.get("stt"),
            student_id=sid_clean,
            full_name=_clean_str(s.get("full_name")),
            date_of_birth=_clean_str(s.get("date_of_birth")),
            score=score_raw,
            score_normalized=score_normalized,
            raw_score_text=_clean_str(s.get("raw_score_text")),
            confidence=confidence,
            source_file=source_file or s.get("source_file"),
            page_number=page_number or s.get("page_number"),
            needs_review=needs_review,
            review_reason=review_reason,
            semester=page_meta.semester if page_meta else None,
            subject=subj,
            course=page_meta.course if page_meta else None,
            exam_datetime=page_meta.exam_datetime if page_meta else None,
            class_name=cls_name,
            major=page_meta.major if page_meta else None,
            exam_location=page_meta.exam_location if page_meta else None,
            room=page_meta.room if page_meta else None,
        )
        students.append(student)
    return students


def _check_ai_configured(filename: str) -> None:
    """Raise rõ ràng nếu AI chưa được cấu hình."""
    if not (
        ai_settings_store.is_configured()
        or ai_settings_store.get_api_key()
        or settings.GEMINI_API_KEY
    ):
        raise ValueError(
            f"File '{filename}' cần AI (ChatGPT / Gemini) để xử lý. "
            "Vui lòng nhập API Key trong trang Cài đặt AI."
        )


# ─── Service ──────────────────────────────────────────────────────────────────

class ExtractionService:

    async def _extract_pdf_with_ai(
        self,
        file_path: Path,
        filename: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> SourceData:
        """
        Render từng trang PDF → ảnh PNG → gửi Gemini AI Vision.
        Áp dụng cho CẢ Nguồn A (biên bản viết tay) lẫn Nguồn B (PDF số CCE).
        """
        source_data = SourceData(source_files=[filename])
        all_students: list[ExtractedStudent] = []
        overall_meta: Optional[ExamMetadata] = None
        active_meta: Optional[ExamMetadata] = None
        errors: list[str] = []

        doc = fitz.open(str(file_path))
        total_pages = len(doc)
        source_data.total_pages_processed = total_pages

        for page_num in range(total_pages):
            page = doc[page_num]
            try:
                img_bytes = _pdf_page_to_image_bytes(page, dpi=200)
                raw_data = await gemini_service.extract_from_image_bytes(
                    image_bytes=img_bytes,
                    mime_type="image/png",
                    source_file=filename,
                    page_number=page_num + 1,
                )

                page_meta = _normalize_metadata(
                    raw_data, source_file=filename, page_number=page_num + 1
                )

                # Nếu trang có thông tin tiêu đề → cập nhật active_meta
                has_header = any([
                    page_meta.subject,
                    page_meta.class_name,
                    page_meta.semester,
                    page_meta.exam_location,
                    page_meta.room,
                ])
                if has_header:
                    active_meta = _merge_metadata(active_meta, page_meta)
                elif active_meta:
                    page_meta = active_meta

                students = _normalize_students(
                    raw_data.get("students", []),
                    page_meta=active_meta or page_meta,
                    source_file=filename,
                    page_number=page_num + 1,
                )
                all_students.extend(students)
                overall_meta = _merge_metadata(overall_meta, active_meta or page_meta)

                logger.info(
                    f"[Gemini] '{filename}' trang {page_num+1}/{total_pages}: "
                    f"trích xuất {len(students)} học viên."
                )

            except (ValueError, TimeoutError, asyncio.TimeoutError) as e:
                logger.error(
                    f"[Gemini] Lỗi trang {page_num+1} của '{filename}': {e}"
                )
                errors.append(f"Trang {page_num+1}: {str(e)}")
                # Ném lên để caller biết (rate-limit / quota nên dừng hẳn)
                raise
            except Exception as e:
                logger.error(f"[Gemini] Lỗi không xác định trang {page_num+1} '{filename}': {e}")
                errors.append(f"Trang {page_num+1}: {str(e)}")

            if progress_callback:
                progress_callback(page_num + 1, total_pages)

            # Throttle nhẹ giữa các trang để tránh rate-limit
            if page_num < total_pages - 1:
                await asyncio.sleep(0.5)

        doc.close()

        source_data.exam_metadata = overall_meta
        source_data.students = all_students
        source_data.extraction_errors = errors
        return source_data

    async def extract_file(
        self,
        file_path: Path,
        filename: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> SourceData:
        """
        Trích xuất dữ liệu học viên và metadata kỳ thi từ một file.

        Chiến lược (Gemini AI Vision cho mọi nguồn):
          • PDF (Nguồn A hoặc B) → render từng trang → Gemini AI Vision → JSON
          • Ảnh JPG/PNG          → Gemini AI Vision trực tiếp → JSON
        """
        _check_ai_configured(filename)
        ext = file_path.suffix.lower()

        # ── PDF ───────────────────────────────────────────────────────────────
        if ext == ".pdf":
            logger.info(f"[Gemini] Bắt đầu xử lý PDF '{filename}' bằng AI Vision.")
            return await self._extract_pdf_with_ai(file_path, filename, progress_callback)

        # ── Ảnh JPG / PNG ────────────────────────────────────────────────────
        elif ext in {".jpg", ".jpeg", ".png"}:
            source_data = SourceData(source_files=[filename])
            source_data.total_pages_processed = 1

            try:
                img = Image.open(file_path)
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception as ex:
                    logger.warning(f"EXIF transpose thất bại cho '{filename}': {ex}")

                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")

                buf = io.BytesIO()
                img.save(buf, format="PNG")
                img_bytes = buf.getvalue()

                raw_data = await gemini_service.extract_from_image_bytes(
                    image_bytes=img_bytes,
                    mime_type="image/png",
                    source_file=filename,
                    page_number=1,
                )
                page_meta = _normalize_metadata(raw_data, source_file=filename, page_number=1)
                students = _normalize_students(
                    raw_data.get("students", []),
                    page_meta=page_meta,
                    source_file=filename,
                    page_number=1,
                )
                logger.info(
                    f"[Gemini] '{filename}': trích xuất thành công {len(students)} học viên từ ảnh."
                )
                source_data.exam_metadata = page_meta
                source_data.students = students
                return source_data

            except (ValueError, TimeoutError, asyncio.TimeoutError):
                raise
            except Exception as e:
                logger.error(f"[Gemini] Lỗi đọc ảnh '{filename}': {e}")
                source_data.extraction_errors.append(f"Lỗi đọc ảnh: {str(e)}")
                return source_data

        # ── Định dạng không hỗ trợ ───────────────────────────────────────────
        else:
            source_data = SourceData(source_files=[filename])
            source_data.extraction_errors.append(f"Định dạng không hỗ trợ: {ext}")
            logger.warning(f"Định dạng không hỗ trợ: {ext} ('{filename}')")
            return source_data

    async def extract_multiple_files(
        self,
        file_paths: list[tuple[Path, str]],  # (path, filename)
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> SourceData:
        """Trích xuất và gộp dữ liệu từ nhiều file."""
        merged = SourceData()
        merged_meta: Optional[ExamMetadata] = None

        for idx, (path, filename) in enumerate(file_paths):
            if progress_callback:
                progress_callback(idx, len(file_paths), filename)

            file_data = await self.extract_file(path, filename)
            merged.students.extend(file_data.students)
            merged.source_files.append(filename)
            merged.total_pages_processed += file_data.total_pages_processed
            merged.extraction_errors.extend(file_data.extraction_errors)
            if file_data.exam_metadata:
                merged_meta = _merge_metadata(merged_meta, file_data.exam_metadata)

            # Throttle giữa các file để tránh rate-limit
            if idx < len(file_paths) - 1:
                await asyncio.sleep(1.0)

        merged.exam_metadata = merged_meta

        # Phát hiện mã sinh viên trùng lặp trong cùng học phần / lớp
        seen_keys: dict[tuple, int] = {}
        for i, s in enumerate(merged.students):
            if s.student_id:
                key = (
                    s.subject or "",
                    s.class_name or "",
                    s.student_id.strip().upper(),
                )
                if key in seen_keys:
                    s.needs_review = True
                    prev_idx = seen_keys[key]
                    merged.students[prev_idx].needs_review = True
                    reason = f"Mã HV trùng lặp trong cùng học phần/lớp: {s.student_id}"
                    if not merged.students[prev_idx].review_reason:
                        merged.students[prev_idx].review_reason = reason
                    if not s.review_reason:
                        s.review_reason = reason
                else:
                    seen_keys[key] = i

        return merged


extraction_service = ExtractionService()
