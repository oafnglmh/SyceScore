"""
json_validator.py
=================
Kiem tra doc lap ket qua JSON tu Ollama - khong dung AI de validate.

Kiem tra:
  - JSON co parse duoc khong
  - Dung schema va kieu du lieu
  - Ma HV la string, giu so 0 o dau
  - Diem so trong pham vi hop le (0.0 - 10.0)
  - Ngay thang hop le neu co
  - Ban ghi trung lap hoac bat thuong
  - So hang so voi du lieu dau vao

Nguyen tac:
  - Khong tu sua du lieu nghiep vu
  - Khong loai bo hang chi vi thieu truong
  - Phan biet loi dinh dang JSON voi loi nhan dien du lieu
  - Bao cao chi tiet de nguoi dung kiem tra
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Any, Optional

logger = logging.getLogger(__name__)


# --- Validation result ---

class ValidationResult:
    def __init__(self):
        self.is_valid: bool = True
        self.errors: list[str] = []          # Loi nghiem trong (schema, type)
        self.warnings: list[str] = []        # Canh bao (du lieu bat thuong)
        self.field_issues: list[dict] = []   # Chi tiet tung truong co van de
        self.student_count: int = 0
        self.needs_review_count: int = 0

    def add_error(self, msg: str):
        self.is_valid = False
        self.errors.append(msg)

    def add_warning(self, msg: str):
        self.warnings.append(msg)

    def add_field_issue(self, student_idx: int, field: str, issue: str, value: Any = None):
        self.field_issues.append({
            "student_idx": student_idx,
            "field": field,
            "issue": issue,
            "value": str(value) if value is not None else None,
        })

    def summary(self) -> str:
        parts = [f"{self.student_count} hoc vien"]
        if self.errors:
            parts.append(f"{len(self.errors)} loi")
        if self.warnings:
            parts.append(f"{len(self.warnings)} canh bao")
        if self.field_issues:
            parts.append(f"{len(self.field_issues)} truong can kiem tra")
        return ", ".join(parts)


# --- Validators ---

def _is_valid_date(date_str: str) -> bool:
    """Kiem tra chuoi ngay thang hop le (YYYY-MM-DD hoac DD/MM/YYYY)."""
    if not date_str:
        return False
    # YYYY-MM-DD
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", date_str)
    if m:
        try:
            date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return True
        except ValueError:
            return False
    # DD/MM/YYYY
    m = re.match(r"^(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})$", date_str)
    if m:
        try:
            date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            return True
        except ValueError:
            return False
    return False


def _normalize_student_id(sid: Any) -> Optional[str]:
    """Dam bao ma HV la string, giu so 0 o dau."""
    if sid is None:
        return None
    # Neu la so nguyen -> chuoi hoa
    if isinstance(sid, (int, float)):
        # Canh bao: ma HV bi chuyen thanh so, co the mat so 0 dau
        return str(int(sid))
    return str(sid).strip() or None


def _validate_score(score: Any, idx: int, result: ValidationResult) -> Optional[float]:
    """
    Validate va chuyen diem so.
    Khong tu chuyen o trong thanh 0.
    """
    if score is None:
        return None

    if isinstance(score, bool):
        result.add_field_issue(idx, "score", "Diem so la boolean, khong hop le", score)
        return None

    try:
        score_float = float(str(score).replace(",", "."))
    except (ValueError, TypeError):
        result.add_field_issue(idx, "score", f"Khong chuyen duoc diem thanh so: '{score}'", score)
        return None

    # Kiem tra pham vi (0-10)
    if not (0.0 <= score_float <= 10.0):
        result.add_field_issue(
            idx, "score",
            f"Diem ngoai pham vi hop le (0-10): {score_float}",
            score_float,
        )
        result.add_warning(f"Hoc vien #{idx+1}: diem {score_float} ngoai pham vi 0-10")
        return None

    return score_float


def validate_ollama_output(
    ollama_result: dict,
    expected_student_count: Optional[int] = None,
    source_file: str = "",
) -> tuple[dict, ValidationResult]:
    """
    Validate toan bo ket qua JSON tu Ollama.

    Args:
        ollama_result: Dict JSON tu Ollama
        expected_student_count: So hoc vien mong doi tu bang dau vao
        source_file: Ten file goc de log

    Returns:
        (normalized_result, validation_result)
        normalized_result: dict da duoc chuan hoa (ma HV la string, v.v.)
        validation_result: ket qua validate
    """
    result = ValidationResult()

    if not isinstance(ollama_result, dict):
        result.add_error(f"Ket qua Ollama khong phai dict: {type(ollama_result)}")
        return ollama_result, result

    # -- Validate exam_info --
    exam_info = ollama_result.get("exam_info", {})
    if not isinstance(exam_info, dict):
        result.add_warning("exam_info khong phai dict, dat thanh dict rong")
        ollama_result["exam_info"] = {}
        exam_info = {}

    # Cac truong exam_info cho phep null
    allowed_exam_fields = {
        "semester", "subject", "course", "exam_datetime",
        "class_name", "major", "exam_location", "room",
    }
    for field in list(exam_info.keys()):
        if field not in allowed_exam_fields:
            result.add_warning(f"exam_info co truong la '{field}' khong nam trong schema")

    # -- Validate students --
    students = ollama_result.get("students", [])
    if not isinstance(students, list):
        result.add_error("'students' phai la list")
        return ollama_result, result

    result.student_count = len(students)

    # Kiem tra so luong hoc vien
    if expected_student_count is not None and result.student_count > 0:
        ratio = result.student_count / max(expected_student_count, 1)
        if ratio < 0.5:
            result.add_warning(
                f"So hoc vien trich xuat ({result.student_count}) "
                f"it hon 50% so voi du lieu dau vao ({expected_student_count}). "
                "Co the bi mat du lieu."
            )
        elif ratio > 2.0:
            result.add_warning(
                f"So hoc vien trich xuat ({result.student_count}) "
                f"nhieu hon gap doi so voi du lieu dau vao ({expected_student_count}). "
                "Co the bi trung lap."
            )

    # Phat hien ma HV trung lap
    seen_ids: dict[tuple[str, str, str], int] = {}
    normalized_students = []

    for idx, student in enumerate(students):
        if not isinstance(student, dict):
            result.add_error(f"Hoc vien #{idx+1} khong phai dict: {type(student)}")
            normalized_students.append(student)
            continue

        normalized = dict(student)

        # -- student_id: phai la string, giu so 0 dau --
        raw_sid = student.get("student_id")
        normalized_sid = _normalize_student_id(raw_sid)

        # Kiem tra ma HV bi chuyen thanh so (mat so 0 dau)
        if isinstance(raw_sid, (int, float)) and raw_sid is not None:
            result.add_field_issue(
                idx, "student_id",
                f"Ma HV bi chuyen thanh so: {raw_sid}. Co the da mat so 0 o dau.",
                raw_sid,
            )
            result.add_warning(
                f"Hoc vien #{idx+1}: ma HV '{raw_sid}' la so, co the mat so 0 o dau"
            )

        normalized["student_id"] = normalized_sid

        # Kiem tra ma HV trung lap
        if normalized_sid:
            sid_upper = normalized_sid.upper()
            class_scope = str(student.get("class_name") or exam_info.get("class_name") or "").strip().casefold()
            subject_scope = str(student.get("subject") or exam_info.get("subject") or "").strip().casefold()
            duplicate_key = (subject_scope, class_scope, sid_upper)
            if duplicate_key in seen_ids:
                prev = seen_ids[duplicate_key]
                result.add_warning(
                    f"Ma HV '{normalized_sid}' xuat hien lan 2 "
                    f"(hoc vien #{prev+1} va #{idx+1}). "
                    "Kiem tra co phai loi OCR hay ban ghi thuc su trung."
                )
                result.add_field_issue(
                    idx, "student_id",
                    f"Trung lap voi hoc vien #{prev+1}",
                    normalized_sid,
                )
                # Danh dau can review nhung KHONG loai bo
                normalized["needs_review"] = True
                if not normalized.get("review_reason"):
                    normalized["review_reason"] = f"Ma HV trung lap voi hang #{prev+1}"
                elif "trung lap" not in normalized.get("review_reason", ""):
                    normalized["review_reason"] = (
                        normalized["review_reason"] + f" | Ma HV trung lap voi hang #{prev+1}"
                    )
            else:
                seen_ids[duplicate_key] = idx

        # -- STT: phai la so nguyen hoac null --
        stt = student.get("stt")
        if stt is not None:
            try:
                normalized["stt"] = int(stt)
            except (ValueError, TypeError):
                result.add_field_issue(idx, "stt", f"STT khong phai so nguyen: {stt}", stt)
                normalized["stt"] = None

        # -- score: phai la so thuc 0-10 hoac null --
        raw_score = student.get("score")
        score_float = _validate_score(raw_score, idx, result)
        normalized["score"] = score_float
        normalized["score_normalized"] = score_float

        if score_float is None and raw_score is not None and str(raw_score).strip():
            normalized["needs_review"] = True
            normalized["raw_score_text"] = str(raw_score)
            if not normalized.get("review_reason"):
                normalized["review_reason"] = f"Diem so khong hop le: '{raw_score}'"

        # -- date_of_birth: kiem tra dinh dang neu co --
        dob = student.get("date_of_birth")
        if dob is not None and str(dob).strip():
            dob_str = str(dob).strip()
            if not _is_valid_date(dob_str):
                result.add_field_issue(
                    idx, "date_of_birth",
                    f"Ngay sinh sai dinh dang: '{dob_str}'",
                    dob_str,
                )
                # Giu nguyen, khong xoa
            normalized["date_of_birth"] = dob_str

        # -- full_name: kiem tra co ky tu bat thuong khong --
        full_name = student.get("full_name")
        if full_name:
            name_str = str(full_name).strip()
            if len(name_str) < 3:
                result.add_field_issue(
                    idx, "full_name",
                    f"Ho ten qua ngan: '{name_str}'",
                    name_str,
                )
            # Ky tu bat thuong (chi ky tu dac biet khong phai tieng Viet)
            if re.search(r"[<>{}|\\^~`\x00-\x1f]", name_str):
                result.add_field_issue(
                    idx, "full_name",
                    f"Ho ten chua ky tu bat thuong: '{name_str}'",
                    name_str,
                )

        # -- needs_review: phai la bool --
        needs_review = normalized.get("needs_review")
        if not isinstance(needs_review, bool):
            normalized["needs_review"] = bool(needs_review) if needs_review is not None else False

        if normalized.get("needs_review"):
            result.needs_review_count += 1

        # Them confidence mac dinh neu chua co (giu tuong thich voi schema hien tai)
        if "confidence" not in normalized:
            normalized["confidence"] = {
                "student_id": 0.7 if normalized_sid else 0.0,
                "full_name": 0.7 if normalized.get("full_name") else 0.0,
                "date_of_birth": 0.7 if normalized.get("date_of_birth") else 0.0,
                "score": 0.9 if score_float is not None else 0.0,
            }

        # Them ocr_engine tag
        normalized.setdefault("ocr_engine", "paddle+ollama")

        normalized_students.append(normalized)

    ollama_result["students"] = normalized_students

    # -- Kiem tra warnings tu Ollama --
    ollama_warnings = ollama_result.get("warnings", [])
    if isinstance(ollama_warnings, list):
        for w in ollama_warnings:
            if w:
                result.add_warning(f"[Ollama] {w}")

    if result.is_valid:
        logger.info(
            f"[Validator] '{source_file}': Validate thanh cong. "
            f"{result.summary()}"
        )
    else:
        logger.warning(
            f"[Validator] '{source_file}': Validate co loi. "
            f"{result.summary()}"
        )

    return ollama_result, result


def merge_chunk_results(
    chunk_results: list[dict],
    source_file: str = "",
) -> dict:
    """
    Gop ket qua tu nhieu chunks (khi tai lieu nhieu trang).
    exam_info lay tu chunk dau tien co du lieu.
    students gop tat ca, giu thu tu trang.
    warnings gop tat ca.
    """
    merged_exam_info: dict = {}
    merged_students: list = []
    merged_warnings: list = []

    for chunk in chunk_results:
        if not isinstance(chunk, dict):
            continue

        # exam_info: merge, uu tien gia tri khong null tu truoc
        exam_info = chunk.get("exam_info", {})
        if isinstance(exam_info, dict):
            for key, val in exam_info.items():
                if val is not None and key not in merged_exam_info:
                    merged_exam_info[key] = val

        # students: gop tat ca
        students = chunk.get("students", [])
        if isinstance(students, list):
            merged_students.extend(students)

        # warnings: gop tat ca
        warnings = chunk.get("warnings", [])
        if isinstance(warnings, list):
            merged_warnings.extend(w for w in warnings if w)

    # Gan lai STT theo thu tu sau khi gop
    for idx, student in enumerate(merged_students, 1):
        if isinstance(student, dict) and not student.get("stt"):
            student["stt"] = idx

    result = {
        "exam_info": merged_exam_info,
        "students": merged_students,
        "warnings": merged_warnings,
    }

    logger.info(
        f"[Validator] merge_chunk_results '{source_file}': "
        f"{len(merged_students)} hoc vien tu {len(chunk_results)} chunks."
    )
    return result
