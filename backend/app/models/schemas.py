"""
Pydantic models (schemas) for the CCE ScoreSync API.
"""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any
from enum import Enum
import uuid
from datetime import datetime


# ─── Enums ────────────────────────────────────────────────────────────────────

class ReconciliationStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


class ComparisonStatus(str, Enum):
    MATCH = "MATCH"
    MISMATCH = "MISMATCH"
    MISSING_SOURCE_A = "MISSING_SOURCE_A"
    MISSING_SOURCE_B = "MISSING_SOURCE_B"
    DUPLICATE = "DUPLICATE"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class SubjectMatchStatus(str, Enum):
    MATCHED = "MATCHED"
    POSSIBLE_MATCH = "POSSIBLE_MATCH"
    UNMATCHED = "UNMATCHED"


class ProcessingStep(str, Enum):
    UPLOAD = "upload"
    EXTRACT = "extract"
    VALIDATE = "validate"
    MATCH = "match"
    DONE = "done"


# ─── Confidence ───────────────────────────────────────────────────────────────

class FieldConfidence(BaseModel):
    student_id: float = Field(default=0.0, ge=0.0, le=1.0)
    full_name: float = Field(default=0.0, ge=0.0, le=1.0)
    date_of_birth: float = Field(default=0.0, ge=0.0, le=1.0)
    score: float = Field(default=0.0, ge=0.0, le=1.0)


# ─── Exam metadata ────────────────────────────────────────────────────────────

class ExamMetadata(BaseModel):
    semester: Optional[str] = None          # Học kỳ (e.g., "6")
    subject: Optional[str] = None           # Học phần thi (e.g., "Tư tưởng Hồ Chí Minh")
    course: Optional[str] = None            # Khóa (e.g., "30")
    exam_datetime: Optional[str] = None     # Ngày giờ thi (e.g., "13h30 ngày 07/03/2026")
    class_name: Optional[str] = None        # Lớp (e.g., "AV30.2B1")
    major: Optional[str] = None             # Ngành (e.g., "Ngôn ngữ Anh")
    exam_location: Optional[str] = None     # Địa điểm thi (e.g., "Trường Cán bộ quản lý giáo dục TP.HCM")
    room: Optional[str] = None              # Phòng thi (e.g., "303")
    metadata_unreadable_reasons: Optional[dict[str, str]] = None
    source_file: Optional[str] = None
    page_number: Optional[int] = None


# ─── Extracted student ────────────────────────────────────────────────────────

class ExtractedStudent(BaseModel):
    stt: Optional[int] = None
    student_id: Optional[str] = None
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    score: Optional[Any] = None  # Keep raw value; normalize separately
    score_normalized: Optional[float] = None
    confidence: FieldConfidence = Field(default_factory=FieldConfidence)
    source_file: Optional[str] = None
    page_number: Optional[int] = None
    needs_review: bool = True
    review_reason: Optional[str] = None
    raw_score_text: Optional[str] = None  # Original text before normalization
    edits: Optional[dict[str, Any]] = None  # { field: { original, corrected } }
    # Exam metadata associated with the student's sheet
    semester: Optional[str] = None
    subject: Optional[str] = None
    course: Optional[str] = None
    exam_datetime: Optional[str] = None
    class_name: Optional[str] = None
    major: Optional[str] = None
    exam_location: Optional[str] = None
    room: Optional[str] = None


# ─── Source data ──────────────────────────────────────────────────────────────

class SourceData(BaseModel):
    exam_metadata: Optional[ExamMetadata] = None
    students: list[ExtractedStudent] = Field(default_factory=list)
    source_files: list[str] = Field(default_factory=list)
    total_pages_processed: int = 0
    extraction_errors: list[str] = Field(default_factory=list)


# ─── Comparison result row ────────────────────────────────────────────────────

class ComparisonRow(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    stt: Optional[int] = None
    student_id: Optional[str] = None
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    semester: Optional[str] = None
    subject: Optional[str] = None
    course: Optional[str] = None
    exam_datetime: Optional[str] = None
    class_name: Optional[str] = None
    major: Optional[str] = None
    exam_location: Optional[str] = None
    room: Optional[str] = None
    score_a: Optional[float] = None
    score_b: Optional[float] = None
    diff: Optional[float] = None
    status: ComparisonStatus
    reason: Optional[str] = None
    source_file_a: Optional[str] = None
    source_page_a: Optional[int] = None
    source_file_b: Optional[str] = None
    source_page_b: Optional[int] = None


# ─── Session stats ────────────────────────────────────────────────────────────

class ReconciliationStats(BaseModel):
    total_source_a: int = 0
    total_source_b: int = 0
    matched_count: int = 0
    comparable_count: int = 0  # matched with both scores available
    match_count: int = 0
    mismatch_count: int = 0
    missing_a: int = 0
    missing_b: int = 0
    duplicate_count: int = 0
    needs_review_count: int = 0
    source_b_only_count: int = 0
    match_rate: Optional[float] = None  # percentage, None if no comparable pairs


# ─── Subject Pairing & Grouping Models ────────────────────────────────────────

class SubjectPair(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    subject_a: Optional[str] = None
    subject_b: Optional[str] = None
    status: SubjectMatchStatus = SubjectMatchStatus.UNMATCHED
    similarity_score: float = 0.0
    reason: Optional[str] = None
    metadata_a: Optional[ExamMetadata] = None
    metadata_b: Optional[ExamMetadata] = None
    is_confirmed: bool = False


class ClassGroup(BaseModel):
    class_name: str
    metadata: Optional[ExamMetadata] = None
    comparison_rows: list[ComparisonRow] = Field(default_factory=list)
    source_b_only_students: list[ExtractedStudent] = Field(default_factory=list)
    stats: ReconciliationStats = Field(default_factory=ReconciliationStats)


class SubjectGroup(BaseModel):
    subject_name: str
    subject_b_name: Optional[str] = None
    pair_id: Optional[str] = None
    status: SubjectMatchStatus = SubjectMatchStatus.UNMATCHED
    is_confirmed: bool = False
    metadata: Optional[ExamMetadata] = None
    classes: list[ClassGroup] = Field(default_factory=list)
    stats: ReconciliationStats = Field(default_factory=ReconciliationStats)


# ─── Discarded / Unmatched Class Models ───────────────────────────────────────

class DiscardedStudentInfo(BaseModel):
    student_id: Optional[str] = None
    full_name: Optional[str] = None
    class_name: Optional[str] = None
    subject: Optional[str] = None
    score: Optional[Any] = None
    source_file: Optional[str] = None
    page_number: Optional[int] = None


class DiscardedClassInfo(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    class_name: str
    normalized_class_name: str
    subject: Optional[str] = None
    source: str = "source_b"  # "source_b" | "source_a"
    reason: str
    suggested_action: Optional[str] = None
    student_count: int = 0
    students: list[DiscardedStudentInfo] = Field(default_factory=list)
    source_file: Optional[str] = None
    available_classes_in_counterpart: list[str] = Field(default_factory=list)


# ─── Reconciliation session ───────────────────────────────────────────────────

class ReconciliationSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: Optional[str] = None              # Tên phiên đối soát (do người dùng đặt)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: ReconciliationStatus = ReconciliationStatus.PENDING
    metadata: Optional[ExamMetadata] = None
    file_count_a: int = 0
    file_count_b: int = 0
    stats: Optional[ReconciliationStats] = None
    error_message: Optional[str] = None
    completed_at: Optional[datetime] = None
    source_a: Optional[SourceData] = None
    source_b: Optional[SourceData] = None
    comparison_results: list[ComparisonRow] = Field(default_factory=list)
    subject_pairs: list[SubjectPair] = Field(default_factory=list)
    subject_groups: list[SubjectGroup] = Field(default_factory=list)
    discarded_classes: list[DiscardedClassInfo] = Field(default_factory=list)


# ─── Progress ─────────────────────────────────────────────────────────────────

class ProgressInfo(BaseModel):
    session_id: str
    status: ReconciliationStatus
    current_step: ProcessingStep = ProcessingStep.UPLOAD
    message: Optional[str] = None
    percent: Optional[int] = None
    total_files: Optional[int] = None
    processed_files: int = 0
    total_pages: Optional[int] = None
    processed_pages: int = 0
    error_message: Optional[str] = None


# ─── API request/response models ──────────────────────────────────────────────

class AISettingsResponse(BaseModel):
    is_configured: bool
    api_key_masked: Optional[str] = None  # Last 4 chars only
    model: Optional[str] = None


class AISettingsUpdate(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None


class AITestRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None


class AITestResponse(BaseModel):
    success: bool
    message: str
    model: Optional[str] = None


class ModelInfo(BaseModel):
    id: str
    display_name: str
    supports_vision: bool = False
    supports_json_output: bool = False


class ModelsListResponse(BaseModel):
    models: list[ModelInfo]


class SessionListItem(BaseModel):
    id: str
    name: Optional[str] = None
    created_at: datetime
    status: ReconciliationStatus
    metadata: Optional[ExamMetadata] = None
    file_count_a: int = 0
    file_count_b: int = 0
    stats: Optional[ReconciliationStats] = None


class SessionListResponse(BaseModel):
    items: list[SessionListItem]
    total: int


class ExtractedDataResponse(BaseModel):
    session_id: str
    name: Optional[str] = None
    source_a: Optional[SourceData] = None
    source_b: Optional[SourceData] = None
    subject_pairs: list[SubjectPair] = Field(default_factory=list)
    subject_groups: list[SubjectGroup] = Field(default_factory=list)
    comparison_results: list[ComparisonRow] = Field(default_factory=list)
    stats: Optional[ReconciliationStats] = None
    discarded_classes: list[DiscardedClassInfo] = Field(default_factory=list)


class ConfirmSubjectRequest(BaseModel):
    subject_a: str
    subject_b: Optional[str] = None
    confirmed: bool = True


class UpdateSessionNameRequest(BaseModel):
    name: Optional[str] = None


class ResultsResponse(BaseModel):
    session_id: str
    name: Optional[str] = None
    stats: Optional[ReconciliationStats] = None
    items: list[ComparisonRow]
    total: int
    subject_groups: list[SubjectGroup] = Field(default_factory=list)
    subject_pairs: list[SubjectPair] = Field(default_factory=list)
    discarded_classes: list[DiscardedClassInfo] = Field(default_factory=list)

