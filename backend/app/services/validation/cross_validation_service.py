"""
CrossValidationService — so sánh kết quả từ 2 OCR engine và tính cross-confidence.

Luồng:
  engine_1 (Ollama/LLaVA)  +  engine_2 (PaddleOCR)
          ↓                           ↓
     list[student_dict]          list[student_dict]
                  ↓ compare_page()
          list[student dict + cross_confidence + needs_review]
"""
import logging
from difflib import SequenceMatcher
from typing import Optional

logger = logging.getLogger(__name__)

# Các trường đem so sánh
FIELDS_TO_COMPARE = ["student_id", "full_name", "score", "date_of_birth"]

# Threshold mặc định (có thể override từ config)
DEFAULT_THRESHOLD = 0.85


def _str_sim(a: str, b: str) -> float:
    """Tính độ tương đồng chuỗi (0–1)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _score_sim(v1, v2) -> float:
    """So sánh điểm số (chuyển sang float, cho phép sai lệch nhỏ ±0.05)."""
    try:
        f1 = float(str(v1).replace(",", ".")) if v1 is not None else None
        f2 = float(str(v2).replace(",", ".")) if v2 is not None else None
    except (ValueError, TypeError):
        return _str_sim(str(v1) if v1 else "", str(v2) if v2 else "")

    if f1 is None and f2 is None:
        return 1.0
    if f1 is None or f2 is None:
        return 0.3

    diff = abs(f1 - f2)
    if diff <= 0.05:
        return 1.0
    elif diff <= 0.25:
        return 0.8
    elif diff <= 0.5:
        return 0.5
    else:
        return 0.0


class CrossValidationService:

    def __init__(self, threshold: Optional[float] = None):
        self.threshold = threshold or DEFAULT_THRESHOLD

    def compare_student(
        self,
        primary: dict,
        secondary: dict,
        source_primary: str = "engine1",
        source_secondary: str = "engine2",
    ) -> dict:
        """
        So sánh một học viên từ 2 engine.

        Returns dict với:
          cross_confidence   : float 0–1
          field_confidences  : dict {field: float}
          needs_review       : bool
          review_reason      : str | None
        """
        field_scores: dict[str, float] = {}
        mismatches: list[str] = []

        for field in FIELDS_TO_COMPARE:
            v1 = primary.get(field)
            v2 = secondary.get(field)

            if field == "score":
                sim = _score_sim(v1, v2)
            else:
                v1_s = str(v1 or "").strip()
                v2_s = str(v2 or "").strip()
                if not v1_s and not v2_s:
                    sim = 1.0
                elif not v1_s or not v2_s:
                    sim = 0.3
                    mismatches.append(
                        f"{field}: '{v1_s}' ({source_primary}) vs '{v2_s}' ({source_secondary})"
                    )
                else:
                    sim = _str_sim(v1_s, v2_s)

            field_scores[field] = round(sim, 4)
            if sim < self.threshold:
                v1_display = str(v1 or "").strip() or "null"
                v2_display = str(v2 or "").strip() or "null"
                mismatches.append(
                    f"{field}: '{v1_display}' vs '{v2_display}' ({sim:.0%})"
                )

        cross_confidence = round(
            sum(field_scores.values()) / len(field_scores), 4
        )
        needs_review = cross_confidence < self.threshold

        review_reason = None
        if needs_review:
            review_reason = (
                f"OCR cross-check không đồng nhất ({cross_confidence:.0%}): "
                + "; ".join(mismatches)
            )

        return {
            "cross_confidence": cross_confidence,
            "field_confidences": field_scores,
            "needs_review": needs_review,
            "review_reason": review_reason,
        }

    def _match_students(
        self,
        primary_students: list[dict],
        secondary_students: list[dict],
    ) -> list[tuple[dict, Optional[dict]]]:
        """
        Ghép học viên từ 2 engine theo student_id (best-effort).
        Trả về list[(primary_student, secondary_student | None)].
        """
        sec_by_id: dict[str, dict] = {}
        for s in secondary_students:
            sid = str(s.get("student_id") or "").strip().upper()
            if sid:
                sec_by_id[sid] = s

        pairs: list[tuple[dict, Optional[dict]]] = []
        for p in primary_students:
            pid = str(p.get("student_id") or "").strip().upper()
            matched_sec = sec_by_id.get(pid)

            # Nếu không khớp ID, thử ghép theo STT
            if matched_sec is None:
                p_stt = p.get("stt")
                if p_stt is not None:
                    for s in secondary_students:
                        if s.get("stt") == p_stt:
                            matched_sec = s
                            break

            pairs.append((p, matched_sec))
        return pairs

    def validate_page(
        self,
        primary_result: dict,
        secondary_result: dict,
        source_primary: str = "llava",
        source_secondary: str = "paddle",
    ) -> list[dict]:
        """
        Validate một trang: ghép học viên từ 2 engine và tính cross-confidence.

        Args:
            primary_result:   dict {'exam_metadata':…, 'students':[…]} từ engine 1
            secondary_result: dict từ engine 2

        Returns:
            list[dict] — danh sách học viên từ primary, mỗi học viên được gắn thêm:
                cross_confidence, cross_validation_detail, needs_review, review_reason
        """
        primary_students = primary_result.get("students", [])
        secondary_students = secondary_result.get("students", [])

        if not secondary_students:
            # PaddleOCR không trả về gì → giữ nguyên kết quả primary
            logger.warning(
                "[CrossValidation] Secondary engine không trả về học viên nào. "
                "Bỏ qua cross-validation."
            )
            for s in primary_students:
                s.setdefault("cross_confidence", None)
                s.setdefault("cross_validation_detail", None)
            return primary_students

        pairs = self._match_students(primary_students, secondary_students)
        validated = []

        for primary_s, secondary_s in pairs:
            result_s = dict(primary_s)

            if secondary_s is None:
                # Không tìm thấy học viên tương ứng trong engine 2
                result_s["cross_confidence"] = None
                result_s["cross_validation_detail"] = {
                    "note": "Không tìm thấy học viên tương ứng trong secondary engine"
                }
            else:
                cv = self.compare_student(
                    primary_s, secondary_s,
                    source_primary=source_primary,
                    source_secondary=source_secondary,
                )
                result_s["cross_confidence"] = cv["cross_confidence"]
                result_s["cross_validation_detail"] = cv["field_confidences"]

                # Override needs_review nếu cross-check fail
                if cv["needs_review"]:
                    result_s["needs_review"] = True
                    existing_reason = result_s.get("review_reason")
                    if existing_reason:
                        result_s["review_reason"] = (
                            f"{existing_reason} | {cv['review_reason']}"
                        )
                    else:
                        result_s["review_reason"] = cv["review_reason"]

            validated.append(result_s)

        logger.info(
            f"[CrossValidation] {len(validated)} học viên đã được cross-validate "
            f"(threshold={self.threshold:.0%})."
        )
        return validated


cross_validation_service = CrossValidationService()
