"""
Unit tests for core business logic:
- Score normalization
- Student matching algorithm
- Match rate calculation
- Status classification
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.models.schemas import (
    ComparisonStatus,
    ExtractedStudent,
    FieldConfidence,
    SourceData,
)
from app.services.matching.matching_service import (
    MatchingService,
    _normalize_name,
    _normalize_score,
    _normalize_student_id,
)


# ─── Normalization tests ───────────────────────────────────────────────────────

def test_normalize_student_id_strips_spaces():
    assert _normalize_student_id(" HV123 ") == "HV123"
    assert _normalize_student_id("hv 123") == "HV123"


def test_normalize_student_id_none():
    assert _normalize_student_id(None) is None
    assert _normalize_student_id("") is None


def test_normalize_score_float():
    assert _normalize_score(8.5) == 8.5
    assert _normalize_score("8.5") == 8.5


def test_normalize_score_comma_decimal():
    assert _normalize_score("8,5") == 8.5


def test_normalize_score_int():
    assert _normalize_score(7) == 7.0


def test_normalize_score_invalid():
    assert _normalize_score("abc") is None
    assert _normalize_score(None)
    rows, stats = service.match_and_compare(a, b)

    assert stats.total_source_a == 3
    assert stats.total_source_b == 2
    assert stats.match_count == 1
    assert stats.mismatch_count == 1
    assert stats.missing_b == 1
    # comparable = 2 (HV001 + HV002), matched = 1
    assert stats.comparable_count == 2
    assert stats.match_rate == pytest.approx(50.0, abs=0.1)


def test_match_rate_all_match(service):
    students = [make_student(f"HV{i:03d}", score=float(i)) for i in range(1, 6)]
    a = make_source(students)
    b = make_source([make_student(f"HV{i:03d}", score=float(i)) for i in range(1, 6)])
    _, stats = service.match_and_compare(a, b)
    assert stats.match_rate == 100.0
    assert stats.mismatch_count == 0


def test_match_rate_none_when_no_comparable(service):
    """If no comparable pairs, match_rate should be None"""
    a = make_source([make_student("HV001", score=8.0, needs_review=True)])
    b = make_source([make_student("HV001", score=8.0)])
    _, stats = service.match_and_compare(a, b)
    assert stats.match_rate is None


def test_multiple_files_different_ids(service):
    """Students from multiple files matched correctly by ID"""
    a = make_source([
        make_student("HV001", score=8.0, source_file="file1.pdf"),
        make_student("HV002", score=9.0, source_file="file2.pdf"),
    ])
    b = make_source([
        make_student("HV002", score=9.0, source_file="b.pdf"),
        make_student("HV001", score=8.0, source_file="b.pdf"),
    ])
    rows, stats = service.match_and_compare(a, b)
    assert all(r.status == ComparisonStatus.MATCH for r in rows)
    assert stats.match_count == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

