"""
Tests for data normalization utilities.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.extraction.extraction_service import (
    _normalize_students,
    _normalize_metadata,
)


def test_normalize_score_comma():
    raw = [{"stt": 1, "student_id": "HV001", "full_name": "Nguyen A",
            "date_of_birth": "01/01/2000", "score": "8,5",
            "raw_score_text": "8,5", "confidence": {"student_id": 0.9, "full_name": 0.9,
            "date_of_birth": 0.9, "score": 0.9},
            "needs_review": False, "review_reason": None,
            "source_file": "test.pdf", "page_number": 1}]
    students = _normalize_students(raw)
    assert students[0].score_normalized == pytest.approx(8.5)


def test_normalize_score_none_triggers_review():
    raw = [{"stt": 1, "student_id": "HV001", "full_name": "Nguyen A",
            "date_of_birth": None, "score": None,
            "raw_score_text": None,
            "confidence": {"student_id": 0.9, "full_name": 0.9, "date_of_birth": 0.9, "score": 0.0},
            "needs_review": False, "review_reason": "Không đọc được điểm",
            "source_file": "test.pdf", "page_number": 1}]
    students = _normalize_students(raw)
    assert students[0].needs_review is True


def test_normalize_metadata_fields():
    raw = {
        "exam_metadata": {
            "semester": "6",
            "subject": "Tư tưởng HCM",
            "course": "30",
            "exam_datetime": "13h30 ngày 07/03/2026",
            "class_name": "AV30.2B1",
            "major": "Ngôn ngữ Anh",
            "exam_location": "Cơ sở 1",
            "room": "303",
        },
        "students": []
    }
    meta = _normalize_metadata(raw)
    assert meta.semester == "6"
    assert meta.room == "303"
    assert meta.subject == "Tư tưởng HCM"
    # Ensure room != exam_location
    assert meta.room != meta.exam_location


import pytest

if __name__ == "__main__":
    pytest.main([__file__, "-v"])

