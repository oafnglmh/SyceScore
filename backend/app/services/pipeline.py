"""
Reconciliation background task processor.
Handles the async pipeline: file save → extract → match → save results.
"""
import asyncio
import logging
import shutil
from datetime import datetime
from pathlib import Path

from ..core.config import settings
from ..models.schemas import (
    ProcessingStep,
    ProgressInfo,
    ReconciliationSession,
    ReconciliationStatus,
    SourceData,
)
from .extraction.extraction_service import extraction_service
from .matching.matching_service import matching_service
from ..storage.session_store import session_store

logger = logging.getLogger(__name__)


# In-memory progress store (keyed by session_id)
# For production, use Redis or DB
_progress: dict[str, ProgressInfo] = {}


def get_progress(session_id: str) -> ProgressInfo | None:
    return _progress.get(session_id)


def _update_progress(session_id: str, **kwargs):
    prog = _progress.get(session_id)
    if prog:
        for k, v in kwargs.items():
            setattr(prog, k, v)


def _check_and_emit_fallback_warning(session_id: str, source_data: SourceData):
    """Emit a warning_message if any student was processed by PaddleOCR/Ollama fallback."""
    if not source_data or not source_data.students:
        return
    fallback_engines = {"paddle+ollama", "paddle_ollama", "ollama", "ollama+paddle"}
    used_fallback = any(
        (s.ocr_engine or "").lower() in fallback_engines
        for s in source_data.students
    )
    if used_fallback:
        _update_progress(
            session_id,
            warning_message=(
                "⚠️ Hạn mức Gemini API đã hết — hệ thống tự động chuyển sang "
                "PaddleOCR + Ollama (local) để xử lý phần còn lại. "
                "Kết quả trích xuất có thể kém chính xác hơn."
            ),
        )


async def process_reconciliation(
    session_id: str,
    files_a: list[tuple[Path, str]],  # (saved_path, original_filename)
    files_b: list[tuple[Path, str]],
):
    """
    Full pipeline:
    1. Upload (already done, just init)
    2. Extract source A
    3. Extract source B
    4. Validate + normalize
    5. Match + compare
    6. Save results
    """
    session = session_store.get(session_id)
    if not session:
        logger.error(f"Session {session_id} not found for processing")
        return

    progress = ProgressInfo(
        session_id=session_id,
        status=ReconciliationStatus.PROCESSING,
        current_step=ProcessingStep.UPLOAD,
        total_files=len(files_a) + len(files_b),
        processed_files=0,
    )
    _progress[session_id] = progress

    try:
        # ── Step 1: Extract Source A ─────────────────────────────────────────
        _update_progress(
            session_id,
            current_step=ProcessingStep.EXTRACT,
            message="Đang trích xuất nguồn A...",
            percent=10,
        )

        total_files_count = len(files_a) + len(files_b)

        def progress_cb_a(done, total, filename):
            pct = 10 + int(30 * (done / max(total, 1)))
            fname_clean = Path(filename).name
            _update_progress(
                session_id,
                processed_files=done,
                total_files=total_files_count,
                message=f"Nguồn A: {done}/{total} file ({fname_clean})",
                percent=pct,
            )

        source_a = await extraction_service.extract_multiple_files(files_a, progress_callback=progress_cb_a)

        # Detect if Gemini → PaddleOCR/Ollama fallback was triggered
        _check_and_emit_fallback_warning(session_id, source_a)

        # ── Step 2: Extract Source B ─────────────────────────────────────────
        _update_progress(
            session_id,
            message="Đang trích xuất nguồn B...",
            percent=40,
        )

        def progress_cb_b(done, total, filename):
            pct = 40 + int(30 * (done / max(total, 1)))
            fname_clean = Path(filename).name
            _update_progress(
                session_id,
                processed_files=len(files_a) + done,
                total_files=total_files_count,
                message=f"Nguồn B: {done}/{total} file ({fname_clean})",
                percent=pct,
            )

        source_b = await extraction_service.extract_multiple_files(files_b, progress_callback=progress_cb_b)

        # Detect fallback for source B as well
        _check_and_emit_fallback_warning(session_id, source_b)

        # ── Step 3: Validate ─────────────────────────────────────────────────
        _update_progress(
            session_id,
            current_step=ProcessingStep.VALIDATE,
            message="Kiểm tra và chuẩn hóa dữ liệu...",
            percent=70,
        )
        await asyncio.sleep(0.1)  # Yield

        # ── Step 4: Match + Compare ──────────────────────────────────────────
        _update_progress(
            session_id,
            current_step=ProcessingStep.MATCH,
            message="Đối chiếu học viên...",
            percent=80,
        )

        matching_res = matching_service.match_and_compare(source_a, source_b)

        # ── Step 5: Save ─────────────────────────────────────────────────────
        _update_progress(
            session_id,
            current_step=ProcessingStep.DONE,
            message="Hoàn tất...",
            percent=95,
        )

        session.source_a = source_a
        session.source_b = source_b
        session.comparison_results = matching_res.rows
        session.stats = matching_res.stats
        session.subject_groups = matching_res.subject_groups
        session.subject_pairs = matching_res.subject_pairs
        session.discarded_classes = matching_res.discarded_classes
        session.metadata = source_a.exam_metadata or source_b.exam_metadata
        session.status = ReconciliationStatus.COMPLETED
        session.completed_at = datetime.utcnow()
        session_store.save(session)

        _update_progress(
            session_id,
            status=ReconciliationStatus.COMPLETED,
            current_step=ProcessingStep.DONE,
            message="Hoàn tất",
            percent=100,
        )

    except ValueError as e:
        # Quota or config error - user-facing
        logger.error(f"Processing error (user-facing) for {session_id}: {e}")
        session.status = ReconciliationStatus.ERROR
        session.error_message = str(e)
        session_store.save(session)
        _update_progress(
            session_id,
            status=ReconciliationStatus.ERROR,
            error_message=str(e),
        )
    except Exception as e:
        logger.exception(f"Unexpected error processing session {session_id}: {e}")
        session.status = ReconciliationStatus.ERROR
        session.error_message = f"Lỗi xử lý: {str(e)}"
        session_store.save(session)
        _update_progress(
            session_id,
            status=ReconciliationStatus.ERROR,
            error_message=session.error_message,
        )
    finally:
        # Cleanup uploaded files
        for path, _ in files_a + files_b:
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass

