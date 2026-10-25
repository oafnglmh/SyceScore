"""
Student matching and score comparison algorithm.
Supports:
- Vietnamese subject name normalization and fuzzy matching (MATCHED, POSSIBLE_MATCH, UNMATCHED)
- Class-level grouping and separate comparison tables
- Student matching by Student ID within confirmed subject/class
- Strict separation of Source B-only students
- Standardized match rate formula: match_count / comparable_count * 100
"""
import difflib
import logging
import re
import unicodedata
import uuid
from typing import Optional, Union

from ...core.config import settings
from ...models.schemas import (
    ClassGroup,
    ComparisonRow,
    ComparisonStatus,
    DiscardedClassInfo,
    DiscardedStudentInfo,
    ExamMetadata,
    ExtractedStudent,
    ReconciliationStats,
    SourceData,
    SubjectGroup,
    SubjectMatchStatus,
    SubjectPair,
)

logger = logging.getLogger(__name__)


# ─── Text normalization ───────────────────────────────────────────────────────

def _normalize_student_id(sid: Optional[str]) -> Optional[str]:
    """Normalize student ID: strip whitespace, uppercase."""
    if not sid:
        return None
    return re.sub(r"\s+", "", str(sid)).upper()


def _normalize_name(name: Optional[str]) -> Optional[str]:
    """Normalize name for comparison: remove diacritics, lowercase, collapse spaces."""
    if not name:
        return None
    nfkd = unicodedata.normalize("NFKD", str(name))
    ascii_name = "".join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", ascii_name).lower().strip()


def _normalize_score(score_val) -> Optional[float]:
    """Normalize a score value to float."""
    if score_val is None:
        return None
    if isinstance(score_val, (int, float)):
        return float(score_val)
    try:
        return float(str(score_val).replace(",", ".").strip())
    except (ValueError, TypeError):
        return None


def normalize_subject_name(name: Optional[str]) -> str:
    """
    Normalize subject name for comparison:
    - Vietnamese Unicode NFC
    - Lowercase
    - Strip meaningless punctuation and extra spaces
    - Expand common Vietnamese academic abbreviations
    """
    if not name:
        return ""
    nfc = unicodedata.normalize("NFC", str(name).strip())
    s = nfc.lower()
    # Strip common punctuation
    s = re.sub(r"[\-_:.,()\[\]/\\]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _expand_subject_abbreviations(text: str) -> str:
    """Expand common abbreviations in subject names."""
    words = text.split()
    expanded = []
    for w in words:
        if w == "hcm":
            expanded.extend(["hồ", "chí", "minh"])
        elif w == "gdqp":
            expanded.extend(["giáo", "dục", "quốc", "phòng"])
        elif w == "gdtc":
            expanded.extend(["giáo", "dục", "thể", "chất"])
        elif w == "cntt":
            expanded.extend(["công", "nghệ", "thông", "tin"])
        elif w == "ktct":
            expanded.extend(["kinh", "tế", "chính", "trị"])
        elif w == "tieng":
            expanded.append("tiếng")
        else:
            expanded.append(w)
    return " ".join(expanded)


def compare_subject_names(
    name_a: Optional[str], name_b: Optional[str]
) -> tuple[SubjectMatchStatus, float, str]:
    """
    Compare two subject names and return (status, similarity_score, reason).
    Status can be:
    - MATCHED: Exact or normalized match
    - POSSIBLE_MATCH: Similar by abbreviation or fuzzy ratio >= 0.65
    - UNMATCHED: Clearly different
    """
    norm_a = normalize_subject_name(name_a)
    norm_b = normalize_subject_name(name_b)

    if not norm_a or not norm_b:
        return SubjectMatchStatus.UNMATCHED, 0.0, "Thiếu tên học phần để so sánh"

    if norm_a == norm_b:
        return SubjectMatchStatus.MATCHED, 1.0, "Tên học phần khớp chính xác sau chuẩn hóa"

    exp_a = _expand_subject_abbreviations(norm_a)
    exp_b = _expand_subject_abbreviations(norm_b)

    if exp_a == exp_b:
        return SubjectMatchStatus.MATCHED, 0.98, "Tên học phần khớp sau khi chuẩn hóa viết tắt"

    # Fuzzy sequence ratio
    ratio = difflib.SequenceMatcher(None, exp_a, exp_b).ratio()
    if ratio >= 0.80:
        return (
            SubjectMatchStatus.POSSIBLE_MATCH,
            round(ratio, 2),
            f"Tên học phần tương đồng cao ({int(ratio*100)}%), cần xác nhận",
        )
    elif ratio >= 0.65:
        return (
            SubjectMatchStatus.POSSIBLE_MATCH,
            round(ratio, 2),
            f"Tên học phần gần giống ({int(ratio*100)}%), cần xác nhận",
        )
    else:
        return SubjectMatchStatus.UNMATCHED, round(ratio, 2), "Tên học phần khác nhau"


def normalize_class_name(name: Optional[str]) -> str:
    """
    Normalize class name for comparison, ignoring case, punctuation, spaces, and 'Lớp' prefix.
    Examples:
      'AV30.2B1' -> 'AV302B1'
      'Lớp: AV30.2B1' -> 'AV302B1'
      'av 30-2b1' -> 'AV302B1'
    """
    if not name:
        return ""
    s = unicodedata.normalize("NFC", str(name)).strip()
    # Strip common prefixes like "Lớp:", "Lớp ", "Class ", "Lop "
    s = re.sub(r"^(lớp|lop|class)\s*:?\s*", "", s, flags=re.IGNORECASE)
    # Remove all whitespace, dots, dashes, underscores, slashes
    return re.sub(r"[\s\.\-_/]", "", s).upper()


def classes_match(cls_a: Optional[str], cls_b: Optional[str]) -> bool:
    """
    Check if two class names match, handling variations such as:
      - 'AV32.1B2' vs 'AV32.1B2HCM' (location suffix HCM, HN, DN...)
      - 'AV32.1B2HCM1D' vs 'AV32.1B2HCM'
    """
    norm_a = normalize_class_name(cls_a)
    norm_b = normalize_class_name(cls_b)
    if not norm_a or not norm_b:
        return False
    if norm_a == norm_b:
        return True

    # Strip common location or section suffixes: HCM, HN, DN, CT, BD, VT, QN, TH...
    strip_suffix = lambda s: re.sub(r"(HCM|HN|DN|CT|BD|VT|QN|TH|\d+[A-Z]|\d+)$", "", s)
    sa = strip_suffix(norm_a)
    sb = strip_suffix(norm_b)
    if sa and sb:
        if sa == sb:
            return True
        if sa.startswith(sb) or sb.startswith(sa):
            return True
    if norm_a.startswith(norm_b) or norm_b.startswith(norm_a):
        return True
    return False


# ─── Matching Result Wrapper ──────────────────────────────────────────────────

class MatchingResult(tuple):
    """
    A tuple subclass returning (comparison_rows, stats) for backward compatibility,
    while also exposing .subject_groups, .subject_pairs, and .discarded_classes.
    """
    def __new__(cls, rows, stats, subject_groups=None, subject_pairs=None, discarded_classes=None):
        return super().__new__(cls, (rows, stats))

    def __init__(self, rows, stats, subject_groups=None, subject_pairs=None, discarded_classes=None):
        self.rows = rows
        self.stats = stats
        self.subject_groups = subject_groups or []
        self.subject_pairs = subject_pairs or []
        self.discarded_classes = discarded_classes or []


# ─── Matching Service ─────────────────────────────────────────────────────────

class MatchingService:

    def reconcile_subjects(
        self, source_a: SourceData, source_b: SourceData
    ) -> list[SubjectPair]:
        """
        Identify distinct subjects from Source A and Source B, and generate candidate SubjectPairs.
        """
        # Collect distinct subjects from Source A
        subjects_a = set()
        for s in source_a.students:
            subj = s.subject or (source_a.exam_metadata.subject if source_a.exam_metadata else None)
            if subj:
                subjects_a.add(subj)
        if not subjects_a and source_a.exam_metadata and source_a.exam_metadata.subject:
            subjects_a.add(source_a.exam_metadata.subject)
        if not subjects_a:
            subjects_a.add("Học phần chưa xác định")

        # Collect distinct subjects from Source B
        subjects_b = set()
        for s in source_b.students:
            subj = s.subject or (source_b.exam_metadata.subject if source_b.exam_metadata else None)
            if subj:
                subjects_b.add(subj)
        if not subjects_b and source_b.exam_metadata and source_b.exam_metadata.subject:
            subjects_b.add(source_b.exam_metadata.subject)
        if not subjects_b:
            subjects_b.add("Học phần chưa xác định")

        pairs = []
        for s_a in sorted(subjects_a):
            best_match = None
            best_status = SubjectMatchStatus.UNMATCHED
            best_score = 0.0
            best_reason = "Không tìm thấy học phần tương ứng ở nguồn B"

            for s_b in sorted(subjects_b):
                status, score, reason = compare_subject_names(s_a, s_b)
                if score > best_score:
                    best_score = score
                    best_match = s_b
                    best_status = status
                    best_reason = reason

            is_confirmed = (best_status == SubjectMatchStatus.MATCHED)
            pair = SubjectPair(
                id=str(uuid.uuid4()),
                subject_a=s_a,
                subject_b=best_match,
                status=best_status,
                similarity_score=best_score,
                reason=best_reason,
                metadata_a=source_a.exam_metadata,
                metadata_b=source_b.exam_metadata,
                is_confirmed=is_confirmed,
            )
            pairs.append(pair)

        return pairs

    def filter_source_b_by_source_a(
        self,
        source_a: SourceData,
        source_b: SourceData,
        confirmed_subject_pairs: Optional[list[SubjectPair]] = None,
        return_discarded: bool = False,
    ) -> Union[SourceData, tuple[SourceData, list[DiscardedClassInfo]]]:
        """
        Filter Source B (CCE system scores):
        If Source B contains surplus classes or surplus subjects compared to Source A,
        eliminate the lists of those surplus classes/subjects.
        ONLY keep the classes of exam subjects that match with Option A.
        When return_discarded=True, returns (filtered_source_b, discarded_classes).
        """
        if not source_a or not source_a.students or not source_b or not source_b.students:
            empty_data = source_b or SourceData()
            return (empty_data, []) if return_discarded else empty_data

        # 1. Map each subject in Source A to its set of normalized class names and raw class names
        a_classes_by_subject: dict[str, set[str]] = {}
        a_raw_classes_by_subject: dict[str, set[str]] = {}
        a_student_ids_by_subject: dict[str, set[str]] = {}
        for s in source_a.students:
            subj = s.subject or (source_a.exam_metadata.subject if source_a.exam_metadata else None) or "Học phần chưa xác định"
            sid = _normalize_student_id(s.student_id)
            if sid:
                a_student_ids_by_subject.setdefault(subj, set()).add(sid)
            cls_name = s.class_name or (source_a.exam_metadata.class_name if source_a.exam_metadata else None)
            if cls_name:
                norm_c = normalize_class_name(cls_name)
                if norm_c and norm_c != "CHƯAXÁCĐỊNH":
                    a_classes_by_subject.setdefault(subj, set()).add(norm_c)
                    a_raw_classes_by_subject.setdefault(subj, set()).add(str(cls_name).strip())
            else:
                a_classes_by_subject.setdefault(subj, set())
                a_raw_classes_by_subject.setdefault(subj, set())

        # If Source A students didn't have class names, check source_a.exam_metadata
        if source_a.exam_metadata and source_a.exam_metadata.class_name:
            norm_c = normalize_class_name(source_a.exam_metadata.class_name)
            raw_c = str(source_a.exam_metadata.class_name).strip()
            if norm_c and norm_c != "CHƯAXÁCĐỊNH":
                for subj in a_classes_by_subject:
                    a_classes_by_subject[subj].add(norm_c)
                    a_raw_classes_by_subject[subj].add(raw_c)

        # 2. Reconcile subjects between A and B
        if confirmed_subject_pairs:
            pairs = confirmed_subject_pairs
        else:
            pairs = self.reconcile_subjects(source_a, source_b)

        # Build mapping from normalized subject_b to matching subject_a
        b_to_a_subject: dict[str, str] = {}
        for p in pairs:
            if (p.is_confirmed or p.status == SubjectMatchStatus.MATCHED) and p.subject_b:
                b_to_a_subject[normalize_subject_name(p.subject_b)] = p.subject_a

        # If only 1 subject in A and only 1 subject in B, associate them by default
        single_a_subj = list(a_classes_by_subject.keys())[0] if len(a_classes_by_subject) == 1 else None

        kept_students_b: list[ExtractedStudent] = []
        discarded_groups: dict[str, dict] = {}

        for s_b in source_b.students:
            subj_b = s_b.subject or (source_b.exam_metadata.subject if source_b.exam_metadata else None) or "Học phần chưa xác định"
            norm_subj_b = normalize_subject_name(subj_b)

            matching_subj_a = b_to_a_subject.get(norm_subj_b)
            if not matching_subj_a:
                # Try fuzzy matching against confirmed pair.subject_b
                for p_sb, p_sa in b_to_a_subject.items():
                    st, sc, _ = compare_subject_names(norm_subj_b, p_sb)
                    if st == SubjectMatchStatus.MATCHED or sc >= 0.8:
                        matching_subj_a = p_sa
                        break

            if not matching_subj_a and subj_b in ("Học phần chưa xác định", None, ""):
                matching_subj_a = single_a_subj

            cls_b = s_b.class_name or (source_b.exam_metadata.class_name if source_b.exam_metadata else None)
            norm_cls_b = normalize_class_name(cls_b)

            if not matching_subj_a:
                # Surplus subject in Source B -> DISCARD
                logger.info(f"Loại bỏ học viên {s_b.student_id}: Học phần '{subj_b}' không có trong Nguồn A")
                group_key = f"subj_b:{norm_subj_b}:{norm_cls_b}"
                if group_key not in discarded_groups:
                    discarded_groups[group_key] = {
                        "class_name": cls_b or "Lớp chưa xác định",
                        "norm_class_name": norm_cls_b or "CHƯAXÁCĐỊNH",
                        "subject": subj_b,
                        "reason": f"Học phần '{subj_b}' trong File B (Điểm hệ thống) không có học phần tương ứng trong File A (Bảng điểm quét).",
                        "suggested_action": "Kiểm tra xem File B có xuất nhầm học phần khác không, hoặc vào mục 'Ghép học phần' để ghép thủ công.",
                        "source_file": s_b.source_file,
                        "counterparts": sorted(list(a_classes_by_subject.keys())),
                        "students": [],
                    }
                discarded_groups[group_key]["students"].append(s_b)
                continue

            valid_classes_in_a = a_classes_by_subject.get(matching_subj_a, set())
            if not valid_classes_in_a:
                # Source A did not specify any specific class for this subject -> keep student
                kept_students_b.append(s_b)
                continue

            matches_class_in_a = (
                norm_cls_b in valid_classes_in_a
                or any(classes_match(cls_b, a_c) for a_c in a_raw_classes_by_subject.get(matching_subj_a, set()))
            )
            sid_b = _normalize_student_id(s_b.student_id)
            if (
                not matches_class_in_a
                and sid_b
                and sid_b in a_student_ids_by_subject.get(matching_subj_a, set())
            ):
                # A row-level student ID is stronger evidence than a different
                # internal class code used by the system export.
                matches_class_in_a = True

            if matches_class_in_a:
                # Class matches Option A -> KEEP
                kept_students_b.append(s_b)
            else:
                # Surplus class in Source B (dư lớp so với option A) -> DISCARD
                logger.info(
                    f"Loại bỏ học viên {s_b.student_id} thuộc lớp dư '{cls_b}' "
                    f"(không có trong Option A cho học phần '{matching_subj_a}')"
                )
                group_key = f"cls_b:{matching_subj_a}:{norm_cls_b}"
                raw_a_classes = sorted(list(a_raw_classes_by_subject.get(matching_subj_a, set())))
                if group_key not in discarded_groups:
                    counterparts_str = f" (File A chỉ có các lớp: {', '.join(raw_a_classes)})" if raw_a_classes else ""
                    discarded_groups[group_key] = {
                        "class_name": cls_b or "Lớp chưa xác định",
                        "norm_class_name": norm_cls_b or "CHƯAXÁCĐỊNH",
                        "subject": matching_subj_a,
                        "reason": f"Lớp '{cls_b or 'Chưa xác định'}' trong File B (Điểm hệ thống) không khớp với bất kỳ lớp nào của File A trong học phần '{matching_subj_a}'{counterparts_str}.",
                        "suggested_action": (
                            f"Kiểm tra xem File B có xuất dư lớp '{cls_b}' không, hoặc kiểm tra xem tên lớp "
                            f"ở File A ({', '.join(raw_a_classes) if raw_a_classes else 'chưa rõ'}) và File B có bị lệch dấu chấm, khoảng trắng, gạch nối không."
                        ),
                        "source_file": s_b.source_file,
                        "counterparts": raw_a_classes,
                        "students": [],
                    }
                discarded_groups[group_key]["students"].append(s_b)

        # Build list of DiscardedClassInfo
        discarded_classes: list[DiscardedClassInfo] = []
        for g in discarded_groups.values():
            st_list = [
                DiscardedStudentInfo(
                    student_id=st.student_id,
                    full_name=st.full_name,
                    class_name=st.class_name,
                    subject=st.subject or g["subject"],
                    score=st.score or st.score_normalized,
                    source_file=st.source_file,
                    page_number=st.page_number,
                )
                for st in g["students"]
            ]
            discarded_classes.append(
                DiscardedClassInfo(
                    class_name=g["class_name"],
                    normalized_class_name=g["norm_class_name"],
                    subject=g["subject"],
                    source="source_b",
                    reason=g["reason"],
                    suggested_action=g["suggested_action"],
                    student_count=len(st_list),
                    students=st_list,
                    source_file=g.get("source_file"),
                    available_classes_in_counterpart=g.get("counterparts", []),
                )
            )

        filtered_b = SourceData(
            students=kept_students_b,
            exam_metadata=source_b.exam_metadata,
            total_students=len(kept_students_b),
            total_pages_processed=source_b.total_pages_processed,
            extraction_errors=source_b.extraction_errors,
        )

        if return_discarded:
            return filtered_b, discarded_classes
        return filtered_b

    def match_and_compare(
        self,
        source_a: SourceData,
        source_b: SourceData,
        score_tolerance: float = 0.0,
        confirmed_subject_pairs: Optional[list[SubjectPair]] = None,
    ) -> MatchingResult:
        """
        Reconcile subjects, group by class within each subject, match students by Student ID,
        and calculate statistics.
        """
        # Step 0: Filter out surplus classes and surplus subjects from Source B
        source_b, discarded_b = self.filter_source_b_by_source_a(
            source_a, source_b, confirmed_subject_pairs=confirmed_subject_pairs, return_discarded=True
        )

        # Step 1: Reconcile subject pairs
        if confirmed_subject_pairs:
            subject_pairs = confirmed_subject_pairs
        else:
            subject_pairs = self.reconcile_subjects(source_a, source_b)

        # Mapping from subject_a name to pair
        pair_by_subject_a = {p.subject_a: p for p in subject_pairs}

        # Step 2: Group Source A students by subject
        a_by_subject: dict[str, list[ExtractedStudent]] = {}
        for s in source_a.students:
            subj = s.subject or (source_a.exam_metadata.subject if source_a.exam_metadata else None) or "Học phần chưa xác định"
            a_by_subject.setdefault(subj, []).append(s)

        # Group Source B students by subject
        b_by_subject: dict[str, list[ExtractedStudent]] = {}
        for s in source_b.students:
            subj = s.subject or (source_b.exam_metadata.subject if source_b.exam_metadata else None) or "Học phần chưa xác định"
            b_by_subject.setdefault(subj, []).append(s)

        all_comparison_rows: list[ComparisonRow] = []
        subject_groups: list[SubjectGroup] = []
        discarded_a: list[DiscardedClassInfo] = []

        # If Source A is empty but Source B has students:
        if not a_by_subject and b_by_subject:
            missing_a_rows = []
            for subj_b, s_b_list in b_by_subject.items():
                for s_b in s_b_list:
                    missing_a_rows.append(ComparisonRow(
                        stt=len(missing_a_rows) + 1,
                        student_id=s_b.student_id,
                        full_name=s_b.full_name,
                        date_of_birth=s_b.date_of_birth,
                        score_a=None,
                        score_b=s_b.score_normalized,
                        diff=None,
                        status=ComparisonStatus.MISSING_SOURCE_A,
                        reason="Không tìm thấy ở nguồn A",
                        source_file_b=s_b.source_file,
                        source_page_b=s_b.page_number,
                    ))
            stats = ReconciliationStats(
                total_source_a=0,
                total_source_b=len(source_b.students),
                missing_a=len(missing_a_rows),
                source_b_only_count=len(missing_a_rows),
            )
            return MatchingResult(missing_a_rows, stats, [], subject_pairs, discarded_classes=discarded_b)

        if not a_by_subject:
            return MatchingResult([], ReconciliationStats(), [], subject_pairs, discarded_classes=discarded_b)

        for subj_a, students_a in a_by_subject.items():
            pair = pair_by_subject_a.get(subj_a)
            subj_b = pair.subject_b if pair else None
            is_matched_or_confirmed = pair and (pair.is_confirmed or pair.status == SubjectMatchStatus.MATCHED)

            subj_metadata = ExamMetadata(
                subject=subj_a,
                semester=students_a[0].semester if students_a else (source_a.exam_metadata.semester if source_a.exam_metadata else None),
                course=students_a[0].course if students_a else (source_a.exam_metadata.course if source_a.exam_metadata else None),
                exam_datetime=students_a[0].exam_datetime if students_a else (source_a.exam_metadata.exam_datetime if source_a.exam_metadata else None),
                class_name=students_a[0].class_name if students_a else (source_a.exam_metadata.class_name if source_a.exam_metadata else None),
                major=students_a[0].major if students_a else (source_a.exam_metadata.major if source_a.exam_metadata else None),
                exam_location=students_a[0].exam_location if students_a else (source_a.exam_metadata.exam_location if source_a.exam_metadata else None),
                room=students_a[0].room if students_a else (source_a.exam_metadata.room if source_a.exam_metadata else None),
            )

            # Get candidate B students for this subject
            students_b_for_subject: list[ExtractedStudent] = []
            if is_matched_or_confirmed and subj_b:
                students_b_for_subject = b_by_subject.get(subj_b, [])
                if not students_b_for_subject:
                    # Try normalized lookup in B
                    for b_name, b_list in b_by_subject.items():
                        if normalize_subject_name(b_name) == normalize_subject_name(subj_b):
                            students_b_for_subject = b_list
                            break
            elif is_matched_or_confirmed and not subj_b and len(b_by_subject) == 1:
                # If single subject in B, associate with it
                students_b_for_subject = list(b_by_subject.values())[0]

            # Group students by class
            a_by_class: dict[str, list[ExtractedStudent]] = {}
            for s in students_a:
                cls_name = s.class_name or (source_a.exam_metadata.class_name if source_a.exam_metadata else None) or "Lớp chưa xác định"
                a_by_class.setdefault(cls_name, []).append(s)

            b_by_class: dict[str, list[ExtractedStudent]] = {}
            for s in students_b_for_subject:
                cls_name = s.class_name or (source_b.exam_metadata.class_name if source_b.exam_metadata else None) or "Lớp chưa xác định"
                b_by_class.setdefault(cls_name, []).append(s)

            class_groups: list[ClassGroup] = []
            subject_all_rows: list[ComparisonRow] = []
            fallback_class_assignments: set[str] = set()

            for cls_name, cls_students_a in a_by_class.items():
                cls_students_b = b_by_class.get(cls_name, [])
                if not cls_students_b:
                    for b_cname, b_clist in b_by_class.items():
                        if classes_match(cls_name, b_cname):
                            cls_students_b = b_clist
                            break
                if not cls_students_b:
                    a_ids = {_normalize_student_id(s.student_id) for s in cls_students_a}
                    a_ids.discard(None)
                    candidates = []
                    for b_cname, b_clist in b_by_class.items():
                        if b_cname in fallback_class_assignments:
                            continue
                        b_ids = {_normalize_student_id(s.student_id) for s in b_clist}
                        b_ids.discard(None)
                        shared_ids = a_ids & b_ids
                        denominator = min(len(a_ids), len(b_ids))
                        coverage = len(shared_ids) / denominator if denominator else 0.0
                        if coverage >= 0.5:
                            candidates.append((coverage, len(shared_ids), b_cname, b_clist))
                    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
                    if candidates and (
                        len(candidates) == 1
                        or (candidates[0][0], candidates[0][1]) > (candidates[1][0], candidates[1][1])
                    ):
                        _, _, matched_b_class, cls_students_b = candidates[0]
                        fallback_class_assignments.add(matched_b_class)

                if not cls_students_b and len(b_by_class) == 1:
                    single_b_name = list(b_by_class.keys())[0]
                    # Only fallback if the single class in B is unlabeled/unspecified
                    if single_b_name in ("Lớp chưa xác định", None, ""):
                        cls_students_b = list(b_by_class.values())[0]

                # If class in A has no matching class in B, track as unmatched Source A class
                if not cls_students_b and is_matched_or_confirmed:
                    avail_b_classes = sorted(list(b_by_class.keys()))
                    st_a_info = [
                        DiscardedStudentInfo(
                            student_id=st.student_id,
                            full_name=st.full_name,
                            class_name=st.class_name or cls_name,
                            subject=st.subject or subj_a,
                            score=st.score or st.score_normalized,
                            source_file=st.source_file,
                            page_number=st.page_number,
                        )
                        for st in cls_students_a
                    ]
                    discarded_a.append(
                        DiscardedClassInfo(
                            class_name=cls_name,
                            normalized_class_name=normalize_class_name(cls_name),
                            subject=subj_a,
                            source="source_a",
                            reason=f"Lớp '{cls_name}' có trong File A (Bảng điểm quét) nhưng File B (Điểm hệ thống) không có dữ liệu lớp này.",
                            suggested_action=(
                                f"Kiểm tra xem File B đã xuất đủ dữ liệu của lớp '{cls_name}' chưa, hoặc tên lớp ở File B có khác định dạng không. "
                                f"(Các lớp tìm thấy trong File B: {', '.join(avail_b_classes) if avail_b_classes else 'Không có lớp nào'})."
                            ),
                            student_count=len(st_a_info),
                            students=st_a_info,
                            source_file=cls_students_a[0].source_file if cls_students_a else None,
                            available_classes_in_counterpart=avail_b_classes,
                        )
                    )

                cls_rows, b_only_students, cls_stats = self._compare_class_students(
                    cls_students_a=cls_students_a,
                    cls_students_b=cls_students_b,
                    is_subject_confirmed=is_matched_or_confirmed,
                    score_tolerance=score_tolerance,
                    parent_metadata=subj_metadata,
                )

                class_meta = ExamMetadata(
                    semester=cls_students_a[0].semester if cls_students_a else subj_metadata.semester,
                    subject=subj_a,
                    course=cls_students_a[0].course if cls_students_a else subj_metadata.course,
                    exam_datetime=cls_students_a[0].exam_datetime if cls_students_a else subj_metadata.exam_datetime,
                    class_name=cls_name,
                    major=cls_students_a[0].major if cls_students_a else subj_metadata.major,
                    exam_location=cls_students_a[0].exam_location if cls_students_a else subj_metadata.exam_location,
                    room=cls_students_a[0].room if cls_students_a else subj_metadata.room,
                )

                cg = ClassGroup(
                    class_name=cls_name,
                    metadata=class_meta,
                    comparison_rows=cls_rows,
                    source_b_only_students=b_only_students,
                    stats=cls_stats,
                )
                class_groups.append(cg)
                subject_all_rows.extend(cls_rows)
                all_comparison_rows.extend(cls_rows)

            # Compute subject stats: total_b is sum across matching classes
            subj_stats = self._aggregate_stats(
                [cg.stats for cg in class_groups],
                total_a=len(students_a),
                total_b=sum(cg.stats.total_source_b for cg in class_groups),
            )

            sg = SubjectGroup(
                subject_name=subj_a,
                subject_b_name=subj_b,
                pair_id=pair.id if pair else None,
                status=pair.status if pair else SubjectMatchStatus.UNMATCHED,
                is_confirmed=is_matched_or_confirmed,
                metadata=subj_metadata,
                classes=class_groups,
                stats=subj_stats,
            )
            subject_groups.append(sg)

        # Compute overall stats across all subjects: total_b is sum across all subject groups
        overall_stats = self._aggregate_stats(
            [sg.stats for sg in subject_groups],
            total_a=len(source_a.students),
            total_b=sum(sg.stats.total_source_b for sg in subject_groups),
        )

        all_discarded = discarded_b + discarded_a

        return MatchingResult(
            all_comparison_rows, overall_stats, subject_groups, subject_pairs, discarded_classes=all_discarded
        )

    def _compare_class_students(
        self,
        cls_students_a: list[ExtractedStudent],
        cls_students_b: list[ExtractedStudent],
        is_subject_confirmed: bool,
        score_tolerance: float,
        parent_metadata: Optional[ExamMetadata],
    ) -> tuple[list[ComparisonRow], list[ExtractedStudent], ReconciliationStats]:
        """Compare students in a single class."""
        # Index B students by normalized student_id
        b_by_id: dict[str, list[ExtractedStudent]] = {}
        for s in cls_students_b:
            nid = _normalize_student_id(s.student_id)
            if nid:
                b_by_id.setdefault(nid, []).append(s)

        # Detect duplicates in A
        a_id_counts: dict[str, int] = {}
        for s in cls_students_a:
            nid = _normalize_student_id(s.student_id)
            if nid:
                a_id_counts[nid] = a_id_counts.get(nid, 0) + 1

        rows: list[ComparisonRow] = []
        matched_b_ids: set[int] = set()
        stt_counter = 1

        for s_a in cls_students_a:
            nid_a = _normalize_student_id(s_a.student_id)

            # Base metadata for row
            meta_sem = s_a.semester or (parent_metadata.semester if parent_metadata else None)
            meta_subj = s_a.subject or (parent_metadata.subject if parent_metadata else None)
            meta_course = s_a.course or (parent_metadata.course if parent_metadata else None)
            meta_dt = s_a.exam_datetime or (parent_metadata.exam_datetime if parent_metadata else None)
            meta_cls = s_a.class_name or (parent_metadata.class_name if parent_metadata else None)
            meta_maj = s_a.major or (parent_metadata.major if parent_metadata else None)
            meta_loc = s_a.exam_location or (parent_metadata.exam_location if parent_metadata else None)
            meta_rm = s_a.room or (parent_metadata.room if parent_metadata else None)

            # If subject not confirmed:
            if not is_subject_confirmed:
                rows.append(ComparisonRow(
                    stt=stt_counter,
                    student_id=s_a.student_id,
                    full_name=s_a.full_name,
                    date_of_birth=s_a.date_of_birth,
                    semester=meta_sem,
                    subject=meta_subj,
                    course=meta_course,
                    exam_datetime=meta_dt,
                    class_name=meta_cls,
                    major=meta_maj,
                    exam_location=meta_loc,
                    room=meta_rm,
                    score_a=s_a.score_normalized,
                    score_b=None,
                    diff=None,
                    status=ComparisonStatus.NEEDS_REVIEW,
                    reason="Học phần chưa được xác nhận tương ứng giữa 2 nguồn",
                    source_file_a=s_a.source_file,
                    source_page_a=s_a.page_number,
                    cross_confidence=s_a.cross_confidence,
                    ocr_engine=s_a.ocr_engine,
                ))
                stt_counter += 1
                continue

            # Handle missing student_id in Source A
            if not nid_a:
                rows.append(ComparisonRow(
                    stt=stt_counter,
                    student_id=s_a.student_id,
                    full_name=s_a.full_name,
                    date_of_birth=s_a.date_of_birth,
                    semester=meta_sem,
                    subject=meta_subj,
                    course=meta_course,
                    exam_datetime=meta_dt,
                    class_name=meta_cls,
                    major=meta_maj,
                    exam_location=meta_loc,
                    room=meta_rm,
                    score_a=s_a.score_normalized,
                    score_b=None,
                    diff=None,
                    status=ComparisonStatus.NEEDS_REVIEW,
                    reason="Thiếu Mã HV ở nguồn A",
                    source_file_a=s_a.source_file,
                    source_page_a=s_a.page_number,
                    cross_confidence=s_a.cross_confidence,
                    ocr_engine=s_a.ocr_engine,
                ))
                stt_counter += 1
                continue

            # Handle duplicate ID in Source A
            if a_id_counts.get(nid_a, 0) > 1:
                rows.append(ComparisonRow(
                    stt=stt_counter,
                    student_id=s_a.student_id,
                    full_name=s_a.full_name,
                    date_of_birth=s_a.date_of_birth,
                    semester=meta_sem,
                    subject=meta_subj,
                    course=meta_course,
                    exam_datetime=meta_dt,
                    class_name=meta_cls,
                    major=meta_maj,
                    exam_location=meta_loc,
                    room=meta_rm,
                    score_a=s_a.score_normalized,
                    score_b=None,
                    diff=None,
                    status=ComparisonStatus.DUPLICATE,
                    reason="Mã HV trùng lặp trong nguồn A",
                    source_file_a=s_a.source_file,
                    source_page_a=s_a.page_number,
                    cross_confidence=s_a.cross_confidence,
                    ocr_engine=s_a.ocr_engine,
                ))
                stt_counter += 1
                continue

            b_matches = b_by_id.get(nid_a, [])
            if not b_matches:
                # Student in A not found in B
                rows.append(ComparisonRow(
                    stt=stt_counter,
                    student_id=s_a.student_id,
                    full_name=s_a.full_name,
                    date_of_birth=s_a.date_of_birth,
                    semester=meta_sem,
                    subject=meta_subj,
                    course=meta_course,
                    exam_datetime=meta_dt,
                    class_name=meta_cls,
                    major=meta_maj,
                    exam_location=meta_loc,
                    room=meta_rm,
                    score_a=s_a.score_normalized,
                    score_b=None,
                    diff=None,
                    status=ComparisonStatus.MISSING_SOURCE_B,
                    reason="Không tìm thấy điểm ở nguồn B",
                    source_file_a=s_a.source_file,
                    source_page_a=s_a.page_number,
                    cross_confidence=s_a.cross_confidence,
                    ocr_engine=s_a.ocr_engine,
                ))
                stt_counter += 1
                continue

            if len(b_matches) > 1:
                # Multiple matches in B
                rows.append(ComparisonRow(
                    stt=stt_counter,
                    student_id=s_a.student_id,
                    full_name=s_a.full_name,
                    date_of_birth=s_a.date_of_birth,
                    semester=meta_sem,
                    subject=meta_subj,
                    course=meta_course,
                    exam_datetime=meta_dt,
                    class_name=meta_cls,
                    major=meta_maj,
                    exam_location=meta_loc,
                    room=meta_rm,
                    score_a=s_a.score_normalized,
                    score_b=None,
                    diff=None,
                    status=ComparisonStatus.DUPLICATE,
                    reason="Mã HV trùng lặp trong nguồn B",
                    source_file_a=s_a.source_file,
                    source_page_a=s_a.page_number,
                    cross_confidence=s_a.cross_confidence,
                    ocr_engine=s_a.ocr_engine,
                ))
                for bm in b_matches:
                    matched_b_ids.add(id(bm))
                stt_counter += 1
                continue

            # Exactly 1 match in B
            s_b = b_matches[0]
            matched_b_ids.add(id(s_b))

            name_note = ""
            if s_a.full_name and s_b.full_name:
                na = _normalize_name(s_a.full_name)
                nb = _normalize_name(s_b.full_name)
                if na and nb and na != nb:
                    name_note = f"Họ tên khác nhau ('{s_a.full_name}' vs '{s_b.full_name}'). "

            score_a = s_a.score_normalized
            score_b = s_b.score_normalized

            if s_a.needs_review:
                status = ComparisonStatus.NEEDS_REVIEW
                reason = "Điểm nguồn A cần kiểm tra: " + (s_a.review_reason or "") + " " + name_note
                diff = None
            elif s_b.needs_review:
                status = ComparisonStatus.NEEDS_REVIEW
                reason = "Dữ liệu nguồn B cần kiểm tra: " + (s_b.review_reason or "") + " " + name_note
                diff = None
            elif score_a is None:
                status = ComparisonStatus.NEEDS_REVIEW
                reason = "Điểm nguồn A không đọc được. " + name_note
                diff = None
            elif score_b is None:
                status = ComparisonStatus.MISSING_SOURCE_B
                reason = "Điểm nguồn B trống. " + name_note
                diff = None
            else:
                diff = round(score_a - score_b, 4)
                if abs(diff) <= score_tolerance:
                    status = ComparisonStatus.MATCH
                    reason = name_note.strip() or "Khớp điểm"
                else:
                    status = ComparisonStatus.MISMATCH
                    reason = f"Chênh lệch: {diff:+.1f}. " + name_note

            rows.append(ComparisonRow(
                stt=stt_counter,
                student_id=s_a.student_id,
                full_name=s_a.full_name,
                date_of_birth=s_a.date_of_birth,
                semester=meta_sem,
                subject=meta_subj,
                course=meta_course,
                exam_datetime=meta_dt,
                class_name=meta_cls,
                major=meta_maj,
                exam_location=meta_loc,
                room=meta_rm,
                score_a=score_a,
                score_b=score_b,
                diff=diff,
                status=status,
                reason=reason.strip() if reason else None,
                source_file_a=s_a.source_file,
                source_page_a=s_a.page_number,
                source_file_b=s_b.source_file,
                source_page_b=s_b.page_number,
                cross_confidence=s_a.cross_confidence,
                ocr_engine=s_a.ocr_engine,
            ))
            stt_counter += 1

        # Collect students only present in Source B (not matched to any in A)
        b_only_students: list[ExtractedStudent] = [
            s_b for s_b in cls_students_b if id(s_b) not in matched_b_ids
        ]

        # For comparison completeness and test compatibility, also add MISSING_SOURCE_A rows
        for s_b in b_only_students:
            rows.append(ComparisonRow(
                stt=stt_counter,
                student_id=s_b.student_id,
                full_name=s_b.full_name,
                date_of_birth=s_b.date_of_birth,
                semester=s_b.semester or (parent_metadata.semester if parent_metadata else None),
                subject=s_b.subject or (parent_metadata.subject if parent_metadata else None),
                course=s_b.course or (parent_metadata.course if parent_metadata else None),
                exam_datetime=s_b.exam_datetime or (parent_metadata.exam_datetime if parent_metadata else None),
                class_name=s_b.class_name or (parent_metadata.class_name if parent_metadata else None),
                major=s_b.major or (parent_metadata.major if parent_metadata else None),
                exam_location=s_b.exam_location or (parent_metadata.exam_location if parent_metadata else None),
                room=s_b.room or (parent_metadata.room if parent_metadata else None),
                score_a=None,
                score_b=s_b.score_normalized,
                diff=None,
                status=ComparisonStatus.MISSING_SOURCE_A,
                reason="Không tìm thấy ở nguồn A",
                source_file_b=s_b.source_file,
                source_page_b=s_b.page_number,
            ))
            stt_counter += 1

        # Calculate class stats
        cls_stats = self._compute_class_stats(rows, len(cls_students_a), len(cls_students_b), len(b_only_students))
        return rows, b_only_students, cls_stats

    def _compute_class_stats(
        self,
        rows: list[ComparisonRow],
        total_a: int,
        total_b: int,
        b_only_count: int,
    ) -> ReconciliationStats:
        comparable_rows = [
            r for r in rows
            if r.score_a is not None and r.score_b is not None and r.status in (ComparisonStatus.MATCH, ComparisonStatus.MISMATCH)
        ]
        match_count = sum(1 for r in comparable_rows if r.status == ComparisonStatus.MATCH)
        mismatch_count = sum(1 for r in comparable_rows if r.status == ComparisonStatus.MISMATCH)
        missing_b = sum(1 for r in rows if r.status == ComparisonStatus.MISSING_SOURCE_B)
        duplicate_count = sum(1 for r in rows if r.status == ComparisonStatus.DUPLICATE)
        needs_review = sum(1 for r in rows if r.status == ComparisonStatus.NEEDS_REVIEW)
        matched_count = len(comparable_rows) + sum(1 for r in rows if r.score_a is not None and r.score_b is not None and r.status == ComparisonStatus.NEEDS_REVIEW)

        comparable_count = len(comparable_rows)
        match_rate = (
            round((match_count / comparable_count) * 100, 2)
            if comparable_count > 0
            else None
        )

        return ReconciliationStats(
            total_source_a=total_a,
            total_source_b=total_b,
            matched_count=matched_count,
            comparable_count=comparable_count,
            match_count=match_count,
            mismatch_count=mismatch_count,
            missing_a=0,
            missing_b=missing_b,
            duplicate_count=duplicate_count,
            needs_review_count=needs_review,
            source_b_only_count=b_only_count,
            match_rate=match_rate,
        )

    def _aggregate_stats(
        self,
        stats_list: list[ReconciliationStats],
        total_a: int,
        total_b: int,
    ) -> ReconciliationStats:
        matched_count = sum(s.matched_count for s in stats_list)
        comparable_count = sum(s.comparable_count for s in stats_list)
        match_count = sum(s.match_count for s in stats_list)
        mismatch_count = sum(s.mismatch_count for s in stats_list)
        missing_a = sum(s.missing_a for s in stats_list)
        missing_b = sum(s.missing_b for s in stats_list)
        duplicate_count = sum(s.duplicate_count for s in stats_list)
        needs_review_count = sum(s.needs_review_count for s in stats_list)
        b_only_count = sum(s.source_b_only_count for s in stats_list)

        match_rate = (
            round((match_count / comparable_count) * 100, 2)
            if comparable_count > 0
            else None
        )

        return ReconciliationStats(
            total_source_a=total_a,
            total_source_b=total_b,
            matched_count=matched_count,
            comparable_count=comparable_count,
            match_count=match_count,
            mismatch_count=mismatch_count,
            missing_a=missing_a,
            missing_b=missing_b,
            duplicate_count=duplicate_count,
            needs_review_count=needs_review_count,
            source_b_only_count=b_only_count,
            match_rate=match_rate,
        )


matching_service = MatchingService()


