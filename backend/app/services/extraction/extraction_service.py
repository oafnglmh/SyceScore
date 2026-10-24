"""
Extraction service — ho tro nhieu pipeline OCR.

Luong xu ly:
  - OCR_PROVIDER = "gemini":         Gemini AI Vision (mac dinh)
  - OCR_PROVIDER = "ollama":          LLaVA:7b qua Ollama (gui anh truc tiep)
  - OCR_PROVIDER = "paddle_ollama":   PaddleOCR → Layout Reconstruction → Ollama text-only
                                       (pipeline moi, do chinh xac cao hon)
  - Fallback: neu Ollama khong chay → tu dong dung Gemini

Pipeline paddle_ollama:
  PDF/anh → PyMuPDF render → PaddleOCR (text+bbox+conf)
          → LayoutReconstructor (nhom hang/cot theo bbox)
          → OllamaTextService (phan tich structured text → JSON)
          → JSON Validate
"""
import asyncio
import io
import logging
import re
import time
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
from ..gemini.gemini_service import gemini_service, AllKeysExhaustedError
from ..ollama.ollama_service import ollama_service
from ..ollama.ollama_text_service import ollama_text_service
from ..ocr.paddle_ocr_service import paddle_ocr_service
from ..ocr.layout_reconstructor import reconstruct_page_layout, format_ocr_for_llm
from ..validation.cross_validation_service import cross_validation_service
from ..validation.json_validator import validate_ollama_output, merge_chunk_results

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
    ocr_engine: Optional[str] = None,
) -> list[ExtractedStudent]:
    """Chuyen doi list student dicts thanh list ExtractedStudent (dung cho Gemini/LLaVA pipelines)."""
    students = []
    for s in raw_students:
        score_raw = s.get("score")
        score_normalized = s.get("score_normalized")
        if score_normalized is None and score_raw is not None:
            try:
                score_str = str(score_raw).replace(",", ".").strip()
                score_normalized = float(score_str)
            except (ValueError, TypeError):
                score_normalized = None

        conf_data = s.get("confidence", {})
        if not isinstance(conf_data, dict):
            conf_data = {}
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
                review_reason = "Diem khong the chuan hoa thanh so"
        elif score_raw is None:
            needs_review = True
            if not review_reason:
                review_reason = "Khong doc duoc diem so"

        if confidence.score < settings.MIN_CONFIDENCE_THRESHOLD:
            needs_review = True

        sid_clean = _clean_str(s.get("student_id"))
        subj = _clean_str(s.get("subject")) or (page_meta.subject if page_meta else None)
        extracted_cls = _extract_class_from_student_id(sid_clean)
        cls_name = (
            _clean_str(s.get("class_name"))
            or (page_meta.class_name if page_meta else None)
            or extracted_cls
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
            cross_confidence=s.get("cross_confidence"),
            cross_validation_detail=s.get("cross_validation_detail"),
            ocr_engine=ocr_engine or "gemini",
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


def _normalize_students_from_ollama_result(
    ollama_result: dict,
    source_file: str,
    pages: list[int],
    ocr_engine: str = "paddle+ollama",
) -> tuple[Optional[ExamMetadata], list[ExtractedStudent]]:
    """
    Chuyen doi ket qua JSON tu Ollama (sau validate) thanh ExamMetadata va ExtractedStudent.
    Dung cho pipeline PaddleOCR → Ollama text.
    """
    # Exam metadata
    ei = ollama_result.get("exam_info", {}) or {}
    page_meta = ExamMetadata(
        semester=_clean_str(ei.get("semester")),
        subject=_clean_str(ei.get("subject")),
        course=_clean_str(ei.get("course")),
        exam_datetime=_clean_str(ei.get("exam_datetime")),
        class_name=_clean_str(ei.get("class_name")),
        major=_clean_str(ei.get("major")),
        exam_location=_clean_str(ei.get("exam_location")),
        room=_clean_str(ei.get("room")),
        source_file=source_file,
        page_number=pages[0] if pages else None,
    )

    # Students
    raw_students = ollama_result.get("students", [])
    students = []
    page_num_for_record = pages[0] if pages else None

    for s in raw_students:
        if not isinstance(s, dict):
            continue

        score_normalized = s.get("score_normalized")
        score_raw = s.get("score")

        conf_data = s.get("confidence", {})
        if not isinstance(conf_data, dict):
            conf_data = {}
        confidence = FieldConfidence(
            student_id=float(conf_data.get("student_id", 0.7)),
            full_name=float(conf_data.get("full_name", 0.7)),
            date_of_birth=float(conf_data.get("date_of_birth", 0.7)),
            score=float(conf_data.get("score", 0.9 if score_normalized is not None else 0.0)),
        )

        sid_clean = _clean_str(s.get("student_id"))
        extracted_cls = _extract_class_from_student_id(sid_clean)
        cls_name = _clean_str(s.get("class_name")) or page_meta.class_name or extracted_cls

        needs_review = bool(s.get("needs_review", False))
        review_reason = _clean_str(s.get("review_reason"))

        student = ExtractedStudent(
            stt=s.get("stt"),
            student_id=sid_clean,
            full_name=_clean_str(s.get("full_name")),
            date_of_birth=_clean_str(s.get("date_of_birth")),
            score=score_raw,
            score_normalized=score_normalized,
            raw_score_text=_clean_str(s.get("raw_score_text")),
            confidence=confidence,
            source_file=source_file,
            page_number=page_num_for_record,
            needs_review=needs_review,
            review_reason=review_reason,
            cross_confidence=s.get("cross_confidence"),
            cross_validation_detail=s.get("cross_validation_detail"),
            ocr_engine=ocr_engine,
            semester=_clean_str(s.get("semester")) or page_meta.semester,
            subject=_clean_str(s.get("subject")) or page_meta.subject,
            course=_clean_str(s.get("course")) or page_meta.course,
            exam_datetime=_clean_str(s.get("exam_datetime")) or page_meta.exam_datetime,
            class_name=cls_name,
            major=_clean_str(s.get("major")) or page_meta.major,
            exam_location=page_meta.exam_location,
            room=page_meta.room,
        )
        students.append(student)

    return page_meta, students


def _check_ai_configured(filename: str) -> None:
    """Raise rõ ràng nếu AI chưa được cấu hình."""
    provider = ai_settings_store.get_ocr_provider()
    if provider in ("ollama", "paddle_ollama"):
        # Ollama local không cần Cloud API key
        return
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
                    if page_meta.subject and active_meta and page_meta.subject != active_meta.subject:
                        active_meta = page_meta
                    else:
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

            except (ValueError, TimeoutError, asyncio.TimeoutError, AllKeysExhaustedError) as e:
                err_msg = str(e).lower()
                is_quota = isinstance(e, AllKeysExhaustedError) or "quota" in err_msg or "429" in err_msg or "exhausted" in err_msg
                if is_quota and paddle_ocr_service.is_available() and ollama_text_service.is_available():
                    logger.warning(
                        f"[Fallback] Toàn bộ API key Gemini đã cạn hạn mức (429) tại trang {page_num+1}/{total_pages} của '{filename}'. "
                        f"Tự động kích hoạt pipeline PaddleOCR + Ollama local để đọc nốt các trang còn lại..."
                    )
                    ai_settings_store.set_ocr_provider("paddle_ollama")
                    doc.close()
                    return await self._extract_with_paddle_ollama(
                        file_path, filename, progress_callback
                    )

                logger.error(
                    f"[Gemini] Lỗi trang {page_num+1} của '{filename}': {e}"
                )
                errors.append(f"Trang {page_num+1}: {str(e)}")
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

    # ── Internal: Ollama + PaddleOCR dual-engine ───────────────────────────

    async def _extract_image_with_ollama(
        self,
        img_bytes: bytes,
        filename: str,
        page_number: int,
    ) -> dict:
        """
        Ollama → PaddleOCR → cross-validate (chạy tuần tự để tránh VRAM conflict).
        Fallback: nếu Ollama không chạy → dùng Gemini.
        """
        # Step 1: LLaVA via Ollama
        try:
            llava_result = await ollama_service.extract_from_image_bytes(
                image_bytes=img_bytes,
                mime_type="image/png",
                source_file=filename,
                page_number=page_number,
            )
        except Exception as e:
            logger.warning(
                f"[Ollama] Thất bại ({e}), tự động fallback sang Gemini AI Vision."
            )
            return await gemini_service.extract_from_image_bytes(
                image_bytes=img_bytes,
                mime_type="image/png",
                source_file=filename,
                page_number=page_number,
            )

        # Step 2: PaddleOCR (chạy trong thread để không block event loop)
        enable_cv = ai_settings_store.get_cross_validation_enabled()
        if not enable_cv or not paddle_ocr_service.is_available():
            return llava_result

        try:
            paddle_result = await asyncio.to_thread(
                paddle_ocr_service.extract_structured, img_bytes
            )
        except Exception as e:
            logger.warning(f"[PaddleOCR] Lỗi, bỏ qua cross-validation: {e}")
            return llava_result

        # Step 3: Cross-validate
        validated_students = cross_validation_service.validate_page(
            primary_result=llava_result,
            secondary_result=paddle_result,
            source_primary="llava",
            source_secondary="paddle",
        )
        llava_result["students"] = validated_students
        return llava_result

    async def _extract_pdf_with_ollama(
        self,
        file_path: Path,
        filename: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> SourceData:
        """Ollama+PaddleOCR pipeline cho PDF."""
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
                raw_data = await self._extract_image_with_ollama(
                    img_bytes, filename, page_num + 1
                )
                page_meta = _normalize_metadata(
                    raw_data, source_file=filename, page_number=page_num + 1
                )
                has_header = any([
                    page_meta.subject, page_meta.class_name,
                    page_meta.semester, page_meta.exam_location, page_meta.room,
                ])
                if has_header:
                    if page_meta.subject and active_meta and page_meta.subject != active_meta.subject:
                        active_meta = page_meta
                    else:
                        active_meta = _merge_metadata(active_meta, page_meta)
                elif active_meta:
                    page_meta = active_meta

                students = _normalize_students(
                    raw_data.get("students", []),
                    page_meta=active_meta or page_meta,
                    source_file=filename,
                    page_number=page_num + 1,
                    ocr_engine="ollama+paddle",
                )
                all_students.extend(students)
                overall_meta = _merge_metadata(overall_meta, active_meta or page_meta)

                logger.info(
                    f"[Ollama] '{filename}' trang {page_num+1}/{total_pages}: "
                    f"{len(students)} học viên."
                )

            except (ValueError, TimeoutError, asyncio.TimeoutError) as e:
                logger.error(f"[Ollama] Lỗi trang {page_num+1} '{filename}': {e}")
                errors.append(f"Trang {page_num+1}: {str(e)}")
                raise
            except Exception as e:
                logger.error(f"[Ollama] Lỗi không xác định trang {page_num+1} '{filename}': {e}")
                errors.append(f"Trang {page_num+1}: {str(e)}")

            if progress_callback:
                progress_callback(page_num + 1, total_pages)
            if page_num < total_pages - 1:
                await asyncio.sleep(1.0)  # LLaVA cần nghỉ dài hơn

        doc.close()
        source_data.exam_metadata = overall_meta
        source_data.students = all_students
        source_data.extraction_errors = errors
        return source_data

    # ── PaddleOCR → Ollama text pipeline (pipeline moi) ──────────────────────

    async def _extract_with_paddle_ollama(
        self,
        file_path: Path,
        filename: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> SourceData:
        """
        Pipeline moi: PaddleOCR → Layout Reconstruction → Ollama text-only → JSON validate.

        Uu diem:
          - Khong gui anh cho LLM, tranh gioi han VRAM
          - Ollama chi xu ly van ban co cau truc, khong doan hinh anh
          - Co the dung voi bat ky model text nao (khong can vision model)
          - Do chinh xac cao hon voi bang diem nhieu cot
        """
        if not paddle_ocr_service.is_available():
            logger.warning(
                "[PaddleOllama] PaddleOCR khong kha dung, fallback sang Gemini."
            )
            return await self._extract_pdf_with_ai(file_path, filename, progress_callback)

        if not ollama_text_service.is_available():
            logger.warning(
                "[PaddleOllama] Ollama khong chay, fallback sang Gemini."
            )
            return await self._extract_pdf_with_ai(file_path, filename, progress_callback)

        source_data = SourceData(source_files=[filename])
        errors: list[str] = []
        overall_meta: Optional[ExamMetadata] = None
        all_students: list[ExtractedStudent] = []

        ext = file_path.suffix.lower()
        is_pdf = (ext == ".pdf")

        # Thu thap tat ca cac trang
        page_image_list: list[tuple[int, bytes]] = []  # (page_number, img_bytes)

        if is_pdf:
            doc = fitz.open(str(file_path))
            total_pages = len(doc)
            source_data.total_pages_processed = total_pages
            for page_num in range(total_pages):
                img_bytes = _pdf_page_to_image_bytes(doc[page_num], dpi=200)
                page_image_list.append((page_num + 1, img_bytes))
            doc.close()
        else:
            # Anh don
            img = Image.open(file_path)
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            page_image_list.append((1, buf.getvalue()))
            source_data.total_pages_processed = 1

        # Buoc 1: Chay PaddleOCR tren tung trang
        page_layout_results = []
        total_pages_count = len(page_image_list)

        for page_num, img_bytes in page_image_list:
            try:
                t0 = time.time()
                ocr_blocks = await asyncio.to_thread(
                    paddle_ocr_service.extract_text_blocks, img_bytes
                )
                ocr_time = time.time() - t0

                if not ocr_blocks:
                    errors.append(f"Trang {page_num}: PaddleOCR khong nhan dien duoc text nao.")
                    logger.warning(f"[PaddleOllama] Trang {page_num}: khong co text block.")
                    continue

                # Buoc 2: Layout reconstruction
                layout_result = reconstruct_page_layout(
                    ocr_blocks=ocr_blocks,
                    page_number=page_num,
                    confidence_threshold=0.3,
                )

                if layout_result.warnings:
                    for w in layout_result.warnings:
                        logger.warning(f"[Layout] {w}")

                page_layout_results.append(layout_result)

                logger.info(
                    f"[PaddleOllama] Trang {page_num}/{total_pages_count}: "
                    f"{len(ocr_blocks)} blocks, "
                    f"OCR {ocr_time:.1f}s"
                )

            except Exception as e:
                logger.error(f"[PaddleOllama] Loi OCR trang {page_num}: {e}")
                errors.append(f"Trang {page_num}: Loi OCR - {str(e)}")

            if progress_callback:
                progress_callback(page_num, total_pages_count)

            # Nghỉ nhe giua cac trang de giai phong bo nho
            if page_num < total_pages_count:
                await asyncio.sleep(0.2)

        if not page_layout_results:
            source_data.extraction_errors = errors
            errors.append("Khong co trang nao duoc OCR thanh cong.")
            return source_data

        # Buoc 3: Chia thanh chunks va goi Ollama
        chunks = format_ocr_for_llm(
            page_results=page_layout_results,
            max_chars_per_chunk=5000,  # ~1250 tokens, an toan cho llava:7b
        )

        chunk_results: list[dict] = []

        for chunk_idx, chunk in enumerate(chunks):
            chunk_pages = chunk["pages"]
            chunk_text = chunk["text"]

            try:
                t0 = time.time()
                raw_ollama = await ollama_text_service.extract_from_ocr_text(
                    ocr_text=chunk_text,
                    source_file=filename,
                    pages=chunk_pages,
                )
                ollama_time = time.time() - t0

                # Buoc 4: Validate JSON
                validated, val_result = validate_ollama_output(
                    ollama_result=raw_ollama,
                    source_file=filename,
                )

                if val_result.warnings:
                    for w in val_result.warnings:
                        errors.append(f"Chunk {chunk_idx+1} [trang {chunk_pages}]: {w}")

                chunk_results.append(validated)

                logger.info(
                    f"[PaddleOllama] Chunk {chunk_idx+1}/{len(chunks)} "
                    f"(trang {chunk_pages}): "
                    f"{val_result.student_count} hoc vien, "
                    f"Ollama {ollama_time:.1f}s"
                )

            except Exception as e:
                logger.error(
                    f"[PaddleOllama] Loi Ollama chunk {chunk_idx+1} "
                    f"(trang {chunk_pages}): {e}"
                )
                errors.append(
                    f"Trang {chunk_pages}: Loi Ollama - {str(e)[:200]}"
                )

            # Nghỉ giua cac chunk de Ollama xu ly xong hoan toan
            if chunk_idx < len(chunks) - 1:
                await asyncio.sleep(0.5)

        if not chunk_results:
            source_data.extraction_errors = errors
            if ai_settings_store.is_configured() or ai_settings_store.get_api_key() or settings.GEMINI_API_KEY:
                logger.warning(
                    f"[PaddleOllama] Ollama that bai tren '{filename}'. Tu dong fallback sang Gemini AI Vision..."
                )
                return await self._extract_pdf_with_ai(file_path, filename, progress_callback)
            return source_data

        # Buoc 5: Xu ly tung chunk de giu nguyen metadata (Học phần / Lớp) theo tung trang
        all_students: list[ExtractedStudent] = []
        active_meta: Optional[ExamMetadata] = None
        overall_meta: Optional[ExamMetadata] = None

        for chunk_idx, validated_chunk in enumerate(chunk_results):
            chunk_pages = chunks[chunk_idx]["pages"] if chunk_idx < len(chunks) else []
            chunk_meta, chunk_students = _normalize_students_from_ollama_result(
                ollama_result=validated_chunk,
                source_file=filename,
                pages=chunk_pages,
                ocr_engine="paddle+ollama",
            )
            has_header = any([
                chunk_meta.subject, chunk_meta.class_name,
                chunk_meta.semester, chunk_meta.course,
            ])
            if has_header:
                if chunk_meta.subject and active_meta and chunk_meta.subject != active_meta.subject:
                    # Bắt đầu một Lớp học phần mới!
                    active_meta = chunk_meta
                else:
                    active_meta = _merge_metadata(active_meta, chunk_meta)
            elif active_meta:
                chunk_meta = active_meta

            current_meta = active_meta or chunk_meta
            for s in chunk_students:
                if not s.subject and current_meta.subject:
                    s.subject = current_meta.subject
                if not s.class_name and current_meta.class_name:
                    s.class_name = current_meta.class_name
                if not s.semester and current_meta.semester:
                    s.semester = current_meta.semester
                if not s.course and current_meta.course:
                    s.course = current_meta.course
                if not s.exam_datetime and current_meta.exam_datetime:
                    s.exam_datetime = current_meta.exam_datetime

            all_students.extend(chunk_students)
            overall_meta = _merge_metadata(overall_meta, current_meta)

        # Gan lai STT hop ly neu thieu
        for idx, s in enumerate(all_students, 1):
            if s.stt is None:
                s.stt = idx

        source_data.exam_metadata = overall_meta
        source_data.students = all_students
        source_data.extraction_errors = errors

        logger.info(
            f"[PaddleOllama] '{filename}': Hoan tat. "
            f"{len(all_students)} hoc vien, {len(errors)} loi/canh bao."
        )
        return source_data

    async def extract_file(
        self,
        file_path: Path,
        filename: str,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> SourceData:
        """
        Trich xuat du lieu hoc vien va metadata ky thi tu mot file.

        Chien luoc theo provider:
          - gemini:        Gemini AI Vision
          - ollama:        LLaVA:7b qua Ollama (gui anh)
          - paddle_ollama: PaddleOCR → Layout → Ollama text (pipeline moi)
        """
        _check_ai_configured(filename)
        provider = ai_settings_store.get_ocr_provider()
        ext = file_path.suffix.lower()

        # ── PDF ───────────────────────────────────────────────────────────────
        if ext == ".pdf":
            if provider == "paddle_ollama":
                logger.info(
                    f"[PaddleOllama] Bat dau xu ly PDF '{filename}' "
                    f"bang PaddleOCR + Ollama text pipeline."
                )
                return await self._extract_with_paddle_ollama(
                    file_path, filename, progress_callback
                )
            elif provider == "ollama":
                logger.info(f"[Ollama] Bat dau xu ly PDF '{filename}' bang Ollama + PaddleOCR.")
                return await self._extract_pdf_with_ollama(file_path, filename, progress_callback)
            else:
                logger.info(f"[Gemini] Bat dau xu ly PDF '{filename}' bang AI Vision.")
                return await self._extract_pdf_with_ai(file_path, filename, progress_callback)

        # ── Anh JPG / PNG ─────────────────────────────────────────────────────
        elif ext in {".jpg", ".jpeg", ".png"}:
            if provider == "paddle_ollama":
                logger.info(
                    f"[PaddleOllama] Bat dau xu ly anh '{filename}' "
                    f"bang PaddleOCR + Ollama text pipeline."
                )
                return await self._extract_with_paddle_ollama(
                    file_path, filename, progress_callback
                )

            source_data = SourceData(source_files=[filename])
            source_data.total_pages_processed = 1

            try:
                img = Image.open(file_path)
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception as ex:
                    logger.warning(f"EXIF transpose that bai cho '{filename}': {ex}")

                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")

                buf = io.BytesIO()
                img.save(buf, format="PNG")
                img_bytes = buf.getvalue()

                if provider == "ollama":
                    raw_data = await self._extract_image_with_ollama(img_bytes, filename, 1)
                    ocr_engine = "ollama+paddle"
                else:
                    raw_data = await gemini_service.extract_from_image_bytes(
                        image_bytes=img_bytes,
                        mime_type="image/png",
                        source_file=filename,
                        page_number=1,
                    )
                    ocr_engine = "gemini"

                page_meta = _normalize_metadata(raw_data, source_file=filename, page_number=1)
                students = _normalize_students(
                    raw_data.get("students", []),
                    page_meta=page_meta,
                    source_file=filename,
                    page_number=1,
                    ocr_engine=ocr_engine,
                )
                logger.info(
                    f"[{ocr_engine}] '{filename}': trich xuat {len(students)} hoc vien tu anh."
                )
                source_data.exam_metadata = page_meta
                source_data.students = students
                return source_data

            except (ValueError, TimeoutError, asyncio.TimeoutError):
                raise
            except Exception as e:
                engine_tag = locals().get("ocr_engine", provider)
                logger.error(f"[{engine_tag}] Loi doc anh '{filename}': {e}")
                source_data.extraction_errors.append(f"Loi doc anh: {str(e)}")
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
                subj_norm = (s.subject or "").strip().lower()
                cls_norm = (s.class_name or "").strip().upper()
                key = (
                    subj_norm,
                    cls_norm,
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
