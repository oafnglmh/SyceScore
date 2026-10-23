"""
tesseract_extractor.py
======================
Extractor không dùng AI cho tài liệu dạng hình ảnh hoặc PDF scan (Nguồn A),
sử dụng Tesseract OCR và xử lý ảnh (Pillow, PyMuPDF).
Có tính toán độ tin cậy (confidence score) và gắn cờ needs_review.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import pytesseract

from ...models.schemas import (
    ExamMetadata,
    ExtractedStudent,
    FieldConfidence,
    SourceData,
)

logger = logging.getLogger(__name__)

# Các đường dẫn Tesseract phổ biến trên Windows
COMMON_TESSERACT_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
    r"C:\Tesseract-OCR\tesseract.exe",
    r"D:\Program Files\Tesseract-OCR\tesseract.exe",
    r"D:\Tesseract-OCR\tesseract.exe",
    r"E:\Program Files\Tesseract-OCR\tesseract.exe",
    r"E:\Tesseract-OCR\tesseract.exe",
]


def find_tesseract_cmd() -> Optional[str]:
    """Tìm đường dẫn tesseract executable nếu có trên máy."""
    cmd = shutil.which("tesseract")
    if cmd:
        return cmd
    for p in COMMON_TESSERACT_PATHS:
        if os.path.exists(p):
            return p
    return None


def is_tesseract_available() -> bool:
    cmd = find_tesseract_cmd()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
        return True
    return False


def _norm(s: Optional[str]) -> str:
    if not s:
        return ""
    s = str(s).strip().lower()
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _preprocess_image_for_ocr(img: Image.Image) -> Image.Image:
    """Tiền xử lý ảnh để tăng độ chính xác của OCR."""
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    # Chuyển grayscale
    gray = img.convert("L")
    # Tăng tương phản
    enhancer = ImageEnhance.Contrast(gray)
    enhanced = enhancer.enhance(1.8)
    return enhanced


def _parse_score_text(raw: str) -> tuple[Optional[float], float, bool, Optional[str]]:
    """
    Trả về (score_float, confidence, needs_review, review_reason)
    """
    if not raw:
        return None, 0.0, True, "Không nhận diện được điểm số"

    cleaned = raw.strip().replace(",", ".")
    # Tìm số thập phân hoặc số nguyên từ 0 đến 10
    m = re.search(r"\b(10(?:\.0+)?|[0-9](?:\.[0-9]+)?)\b", cleaned)
    if m:
        try:
            val = float(m.group(1))
            if 0.0 <= val <= 10.0:
                return val, 0.85, False, None
        except ValueError:
            pass

    return None, 0.3, True, f"Không thể chuẩn hóa điểm từ chuỗi OCR: '{raw}'"


def _extract_class_from_student_id(sid: Optional[str]) -> Optional[str]:
    if not sid:
        return None
    s = str(sid).strip().upper()
    m = re.match(r"^([A-Z]{2,}\d+[\.\-_]\d+[A-Z0-9]+?)(?:\d{3,}|BS\d+)", s)
    if m:
        return m.group(1)
    return None


def extract_image_with_tesseract(
    image: Image.Image,
    source_file: str,
    page_number: int,
) -> tuple[ExamMetadata, list[ExtractedStudent]]:
    """
    Dùng pytesseract để lấy text kèm data box và confidence level.
    """
    tess_cmd = find_tesseract_cmd()
    if tess_cmd:
        pytesseract.pytesseract.tesseract_cmd = tess_cmd
    else:
        raise RuntimeError(
            "Tesseract OCR chưa được cài đặt trên máy. "
            "Vui lòng cài đặt Tesseract-OCR (https://github.com/UB-Mannheim/tesseract/wiki) "
            "hoặc đặt đường dẫn tesseract.exe."
        )

    processed_img = _preprocess_image_for_ocr(image)

    # Lấy text tổng thể để tìm thông tin kỳ thi (Header Metadata)
    # Thử với ngôn ngữ vie+eng nếu có, nếu lỗi thử eng
    raw_text = ""
    try:
        raw_text = pytesseract.image_to_string(processed_img, lang="vie+eng")
    except Exception:
        raw_text = pytesseract.image_to_string(processed_img, lang="eng")

    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]

    def search_metadata(patterns: list[str]) -> Optional[str]:
        for pat in patterns:
            for l in lines:
                m = re.search(pat, l, re.IGNORECASE)
                if m:
                    return m.group(1).strip()
        return None

    meta = ExamMetadata(
        semester=search_metadata([r"h[oọ]c\s*k[yỳ][:\s]*([I\d]+)", r"HK[:\s]*(\d+)"]),
        subject=search_metadata([r"h[oọ]c\s*ph[àầ]n\s*thi[:\s]+(.+)", r"h[oọ]c\s*ph[àầ]n[:\s]+(.+)", r"m[oô]n[:\s]+(.+)"]),
        course=search_metadata([r"kh[oó]a[\s:đào tạo]*[:\s]*([K\d]+\d*)"]),
        exam_datetime=search_metadata([r"([\d]{1,2}h\d*\s+ng[àầ]y\s+\d{1,2}/\d{1,2}/\d{4})", r"ng[àầ]y[:\s]+(\d{1,2}[/-]\d{1,2}[/-]\d{4})"]),
        class_name=search_metadata([r"l[oớ]p[:\s]*([A-Z]{2,}\d+[\.\-]\d+[A-Z0-9]+)"]),
        major=search_metadata([r"ng[àaành]+[:\s]+(.+)"]),
        room=search_metadata([r"ph[oòng]+\s*thi[:\s]*(\S+)", r"ph[oòng]+[:\s]+(\d+)"]),
        exam_location=search_metadata([r"[đd][ịi][aà]\s*[đd][ịi][eể]m[:\s]+(.+)"]),
        source_file=source_file,
        page_number=page_number,
    )

    # Đọc chi tiết từng dòng học viên bằng image_to_data
    try:
        ocr_data = pytesseract.image_to_data(
            processed_img,
            lang="vie+eng",
            output_type=pytesseract.Output.DICT,
        )
    except Exception:
        ocr_data = pytesseract.image_to_data(
            processed_img,
            lang="eng",
            output_type=pytesseract.Output.DICT,
        )

    # Gom các từ theo dòng (line_num hoặc par_num, block_num)
    line_groups: dict[tuple[int, int, int], list[dict]] = {}
    n_boxes = len(ocr_data["text"])
    for i in range(n_boxes):
        text = ocr_data["text"][i].strip()
        if not text:
            continue
        conf = float(ocr_data["conf"][i])
        block = ocr_data["block_num"][i]
        par = ocr_data["par_num"][i]
        line = ocr_data["line_num"][i]
        key = (block, par, line)
        if key not in line_groups:
            line_groups[key] = []
        line_groups[key].append({
            "text": text,
            "conf": max(0.0, min(100.0, conf)) / 100.0,
            "left": ocr_data["left"][i],
            "top": ocr_data["top"][i],
            "width": ocr_data["width"][i],
            "height": ocr_data["height"][i],
        })

    students: list[ExtractedStudent] = []

    # Nhận diện dòng chứa Mã Sinh Viên
    # Format mã SV thường gặp: AV30.2B10001, 20261234, AV..., hoặc chuỗi chữ + số
    id_pattern = re.compile(r"\b([A-Z]{2,}\d+[\.\-_]\d+[A-Z0-9]+|\d{7,12})\b", re.IGNORECASE)
    date_pattern = re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b")

    for key, words in line_groups.items():
        line_str = " ".join(w["text"] for w in words)
        m_id = id_pattern.search(line_str)
        if not m_id:
            continue

        student_id = m_id.group(1).upper()
        # Tìm confidence của từ chứa student_id
        sid_conf = 0.8
        for w in words:
            if student_id in w["text"].upper():
                sid_conf = w["conf"]
                break

        # Tìm ngày sinh nếu có
        dob = None
        dob_conf = 0.5
        m_dob = date_pattern.search(line_str)
        if m_dob:
            dob = m_dob.group(1)
            dob_conf = 0.8

        # Tìm số điểm: thường là số ở cuối dòng
        score_val = None
        score_conf = 0.0
        score_raw = None
        needs_review = False
        review_reason = None

        # Quét các số ở cuối dòng
        possible_scores = re.findall(r"\b(10(?:\.0+)?|[0-9](?:[\.,][0-9]+)?)\b", line_str)
        if possible_scores:
            # Lấy số cuối cùng thường là điểm
            score_raw = possible_scores[-1]
            score_val, score_conf, needs_rev, rev_msg = _parse_score_text(score_raw)
            needs_review = needs_rev
            review_reason = rev_msg
        else:
            needs_review = True
            review_reason = "Không tìm thấy điểm số qua OCR Tesseract"

        # Tên học viên: các từ nằm giữa STT/Mã và Ngày sinh/Điểm
        cls_from_id = _extract_class_from_student_id(student_id)
        class_name = meta.class_name or cls_from_id

        student = ExtractedStudent(
            student_id=student_id,
            full_name=None,  # Tesseract scan chữ tay tên tiếng Việt dễ sai lệch, để người dùng review
            date_of_birth=dob,
            score=score_raw,
            score_normalized=score_val,
            raw_score_text=score_raw,
            confidence=FieldConfidence(
                student_id=sid_conf,
                full_name=0.5,
                date_of_birth=dob_conf,
                score=score_conf,
            ),
            source_file=source_file,
            page_number=page_number,
            needs_review=needs_review,
            review_reason=review_reason,
            semester=meta.semester,
            subject=meta.subject,
            course=meta.course,
            exam_datetime=meta.exam_datetime,
            class_name=class_name,
            major=meta.major,
            exam_location=meta.exam_location,
            room=meta.room,
        )
        students.append(student)

    return meta, students


def extract_pdf_with_tesseract(
    file_path: Path,
    filename: str,
) -> SourceData:
    """OCR toàn bộ file PDF bằng Tesseract qua chuyển đổi từng trang sang ảnh."""
    source_data = SourceData(source_files=[filename])
    all_students: list[ExtractedStudent] = []
    overall_meta: Optional[ExamMetadata] = None
    errors: list[str] = []

    try:
        doc = fitz.open(str(file_path))
        source_data.total_pages_processed = len(doc)
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(200 / 72, 200 / 72)
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            try:
                page_meta, students = extract_image_with_tesseract(
                    img, source_file=filename, page_number=page_num + 1
                )
                if overall_meta is None:
                    overall_meta = page_meta
                all_students.extend(students)
            except Exception as e:
                errors.append(f"Trang {page_num + 1}: {e}")
        doc.close()
    except Exception as e:
        errors.append(f"Lỗi đọc PDF Tesseract {filename}: {e}")

    source_data.exam_metadata = overall_meta
    source_data.students = all_students
    source_data.extraction_errors = errors
    return source_data
