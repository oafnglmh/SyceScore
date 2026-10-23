"""
pdfplumber_extractor.py
=======================
AI-free extractor for DIGITAL (text-layer) PDFs — primarily CCE Nguồn B.

How it works:
  1. Use pdfplumber to extract all tables from each page.
  2. Detect which table contains student data by checking column headers.
  3. Parse each row into ExtractedStudent.
  4. Read exam metadata from the text blocks above each table.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from pathlib import Path
from typing import Optional

import pdfplumber

from ...models.schemas import (
    ExamMetadata,
    ExtractedStudent,
    FieldConfidence,
    SourceData,
)

logger = logging.getLogger(__name__)

# ─── String helpers ───────────────────────────────────────────────────────────

def _norm(s: Optional[str]) -> str:
    """Normalize: strip, lowercase, remove Vietnamese diacritics."""
    if not s:
        return ""
    s = str(s).strip().lower()
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _clean(v) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _parse_score(raw) -> tuple[Optional[float], bool, Optional[str]]:
    """Returns (score_float, needs_review, review_reason)."""
    if raw is None or str(raw).strip() == "":
        return None, True, "Không có điểm trong ô"
    s = str(raw).strip().replace(",", ".")
    # Remove any trailing edit-date pattern like 19/09/2026 (date mixed in cell)
    s = re.sub(r"\s+\d{1,2}/\d{1,2}/\d{4}.*", "", s).strip()
    try:
        f = float(s)
        if 0.0 <= f <= 10.0:
            return f, False, None
        else:
            return None, True, f"Điểm ngoài khoảng hợp lệ (0-10): '{raw}'"
    except ValueError:
        return None, True, f"Không thể chuyển điểm thành số: '{raw}'"


# ─── Column detection ─────────────────────────────────────────────────────────

_COL_STT    = {"tt", "stt", "so thu tu"}
_COL_ID     = {"ma sv", "ma hv", "masv", "mahv", "ma sinh vien", "ma hoc vien"}
_COL_NAME   = {"ho ten", "ho va ten", "hoten"}
_COL_DOB    = {"ngay sinh", "ngaysinh", "ngay sinh"}
# "Thi L1" is the score column in CCE system — also match "diem", "diem so"
_COL_SCORE  = {"thi l1", "thil1", "l1", "diem thi l1", "diem", "diem so", "ket qua", "diem kthp"}
_COL_CLASS  = {"lop", "ma lop", "lophoc", "lop hoc"}


def _match_col(header: str, keywords: set[str]) -> bool:
    h = _norm(header)
    return any(kw in h for kw in keywords)


def _detect_columns(headers: list[Optional[str]]) -> dict[str, int]:
    """Map field name -> column index."""
    mapping: dict[str, int] = {}
    for i, h in enumerate(headers):
        if h is None:
            continue
        h_stripped = str(h).strip()
        if not h_stripped:
            continue
        if _match_col(h_stripped, _COL_STT) and "stt" not in mapping:
            mapping["stt"] = i
        if _match_col(h_stripped, _COL_ID) and "student_id" not in mapping:
            mapping["student_id"] = i
        if _match_col(h_stripped, _COL_NAME) and "full_name" not in mapping:
            mapping["full_name"] = i
        if _match_col(h_stripped, _COL_DOB) and "date_of_birth" not in mapping:
            mapping["date_of_birth"] = i
        if _match_col(h_stripped, _COL_SCORE) and "score" not in mapping:
            mapping["score"] = i
        if _match_col(h_stripped, _COL_CLASS) and "class_name" not in mapping:
            mapping["class_name"] = i
    return mapping


def _is_student_table(col_map: dict[str, int]) -> bool:
    """A table is a student table if it has student_id + score."""
    return "student_id" in col_map and "score" in col_map


# ─── Metadata extraction from page text ───────────────────────────────────────

def _extract_metadata_from_text(text: str, source_file: str, page_number: int) -> ExamMetadata:
    """Extract exam metadata from the page's raw text."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    def find_field(patterns: list[str]) -> Optional[str]:
        for pat in patterns:
            for line in lines:
                m = re.search(pat, line, re.IGNORECASE)
                if m:
                    return m.group(1).strip()
        return None

    semester = find_field([
        r"h[oọ]c\s*k[yỳ][:\s]*([I\d]+)",
        r"HK[:\s]*(\d+)",
        r"k[yỳ][:\s]*(\d+)",
    ])
    subject = find_field([
        r"h[oọ]c\s*ph[àầ]n\s*thi[:\s]+(.+)",
        r"h[oọ]c\s*ph[àầ]n[:\s]+(.+)",
        r"môn\s*thi[:\s]+(.+)",
    ])
    course = find_field([
        r"kh[oó]a\s*[đd][àaà]o\s*t[aạ]o[:\s]*([K\d]+\d*)",
        r"\bkh[oó]a[:\s]*([K\d]+\d*)",
    ])
    exam_datetime = find_field([
        r"([\d]{1,2}h\d*\s+ng[àầ]y\s+\d{1,2}/\d{1,2}/\d{4})",
        r"ng[àầ]y\s+thi[:\s]+(.+)",
        r"th[ờờ]i\s*gian[:\s]+(.+)",
    ])
    class_name = find_field([
        r"\bl[oớ]p[:\s]*([A-Z]{2,}\d+[\.\-]\d+[A-Z0-9]+)",
    ])
    major = find_field([
        r"ng[àaành]+[:\s]+(.+)",
    ])
    room = find_field([
        r"ph[oòng]+\s*thi[:\s]*(\S+)",
        r"ph[oòng]+[:\s]+(\d+[A-Z]?)",
    ])
    exam_location = find_field([
        r"[đd][ịi][aà]\s*[đd][ịi][eể]m\s*thi[:\s]+(.+)",
        r"t[rr][uư][oờ][nng]+[:\s]+(.+)",
    ])

    return ExamMetadata(
        semester=semester,
        subject=subject,
        course=course,
        exam_datetime=exam_datetime,
        class_name=class_name,
        major=major,
        room=room,
        exam_location=exam_location,
        source_file=source_file,
        page_number=page_number,
    )


def _extract_subject_above_table(page, table_obj) -> Optional[str]:
    """
    For multi-table CCE pages: find the subject name that appears
    as an ALL-CAPS line just above the table's bounding box.
    Returns title-cased version, e.g. 'Tư Tưởng Hồ Chí Minh'.
    """
    try:
        if table_obj is None or table_obj.bbox is None:
            return None
        table_top = table_obj.bbox[1]  # y0 of table (PDF coordinates, origin bottom-left)
        # pdfplumber: y increases upward. We want lines whose y1 <= table_top
        subject = None
        for word_group in page.extract_words():
            # extract_words returns bottom-left coords; y0 is bottom of word
            # For words ABOVE the table, their y0 > table_top in PDF coordinates
            if word_group.get("top", 0) < table_top:
                text = word_group.get("text", "").strip()
                if text and text == text.upper() and len(text) >= 3 and not text.isdigit():
                    subject = text
        if subject:
            # Convert "TƯ TƯỞNG HỒ CHÍ MINH" -> "Tư Tưởng Hồ Chí Minh"
            return subject.title()
    except Exception as e:
        logger.debug(f"_extract_subject_above_table error: {e}")
    return None


def _extract_class_from_student_id(sid: Optional[str]) -> Optional[str]:
    if not sid:
        return None
    s = str(sid).strip().upper()
    m = re.match(r"^([A-Z]{2,}\d+[\.\-_]\d+[A-Z0-9]+?)(?:\d{3,}|BS\d+)", s)
    if m:
        return m.group(1)
    return None


def _merge_meta(base: Optional[ExamMetadata], new: ExamMetadata) -> ExamMetadata:
    if base is None:
        return new
    for field in ExamMetadata.model_fields:
        if field in ("source_file", "page_number", "metadata_unreadable_reasons"):
            continue
        if getattr(base, field) is None and getattr(new, field) is not None:
            setattr(base, field, getattr(new, field))
    return base


# ─── Main extractor ───────────────────────────────────────────────────────────

def extract_pdf_with_pdfplumber(
    file_path: Path,
    filename: str,
) -> SourceData:
    """
    Extract student data from a DIGITAL PDF using pdfplumber.
    Confidence scores are set to 0.95 for machine-read data.
    Does NOT call any AI API.
    """
    source_data = SourceData(source_files=[filename])
    all_students: list[ExtractedStudent] = []
    overall_meta: Optional[ExamMetadata] = None
    errors: list[str] = []

    try:
        with pdfplumber.open(str(file_path)) as pdf:
            source_data.total_pages_processed = len(pdf.pages)

            for page_num, page in enumerate(pdf.pages):
                page_number = page_num + 1
                try:
                    page_text = page.extract_text() or ""
                    page_meta = _extract_metadata_from_text(page_text, filename, page_number)
                    overall_meta = _merge_meta(overall_meta, page_meta)

                    # Get tables with bounding boxes for subject detection
                    tables_objs = page.find_tables()
                    tables_data = [t.extract() for t in tables_objs]

                    if not tables_data:
                        logger.debug(f"Page {page_number}: no tables found")
                        continue

                    for table_idx, (table_obj, table) in enumerate(zip(tables_objs, tables_data)):
                        if not table or len(table) < 2:
                            continue

                        headers = table[0]
                        col_map = _detect_columns(headers)
                        if not _is_student_table(col_map):
                            logger.debug(
                                f"Page {page_number} table {table_idx+1}: not a student table "
                                f"(headers={headers})"
                            )
                            continue

                        # For multi-table pages: try to detect subject from text above table
                        subject_for_table = (
                            _extract_subject_above_table(page, table_obj)
                            or page_meta.subject
                        )

                        for row in table[1:]:
                            if not row or all(
                                c is None or str(c).strip() == "" for c in row
                            ):
                                continue

                            def get(col: str) -> Optional[str]:
                                idx = col_map.get(col)
                                if idx is None or idx >= len(row):
                                    return None
                                return _clean(row[idx])

                            sid = get("student_id")
                            if not sid:
                                continue

                            stt_raw = get("stt")
                            stt = None
                            if stt_raw:
                                try:
                                    stt = int(re.sub(r"[^\d]", "", stt_raw))
                                except ValueError:
                                    pass

                            score_raw = get("score")
                            score_float, needs_review, review_reason = _parse_score(score_raw)

                            cls_from_id = _extract_class_from_student_id(sid)
                            cls = get("class_name") or cls_from_id or page_meta.class_name

                            student = ExtractedStudent(
                                stt=stt,
                                student_id=sid,
                                full_name=get("full_name"),
                                date_of_birth=get("date_of_birth"),
                                score=score_raw,
                                score_normalized=score_float,
                                raw_score_text=score_raw,
                                confidence=FieldConfidence(
                                    student_id=0.95 if sid else 0.0,
                                    full_name=0.95 if get("full_name") else 0.5,
                                    date_of_birth=0.95 if get("date_of_birth") else 0.5,
                                    score=0.95 if score_float is not None else 0.0,
                                ),
                                source_file=filename,
                                page_number=page_number,
                                needs_review=needs_review,
                                review_reason=review_reason,
                                semester=page_meta.semester,
                                subject=subject_for_table,
                                course=page_meta.course,
                                exam_datetime=page_meta.exam_datetime,
                                class_name=cls,
                                major=page_meta.major,
                                exam_location=page_meta.exam_location,
                                room=page_meta.room,
                            )
                            all_students.append(student)

                except Exception as e:
                    logger.error(f"pdfplumber page {page_number} error: {e}", exc_info=True)
                    errors.append(f"Trang {page_number}: {e}")

    except Exception as e:
        logger.error(f"pdfplumber open error {filename}: {e}")
        errors.append(f"Không thể mở file với pdfplumber: {e}")

    source_data.exam_metadata = overall_meta
    source_data.students = all_students
    source_data.extraction_errors = errors
    return source_data
