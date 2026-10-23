"""
API routes for reconciliation sessions.
"""
import asyncio
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

from ..core.config import settings
from ..models.schemas import (
    ConfirmSubjectRequest,
    ExtractedDataResponse,
    ProgressInfo,
    ReconciliationStatus,
    ResultsResponse,
    SessionListItem,
    SessionListResponse,
    SourceData,
    SubjectMatchStatus,
    SubjectPair,
    UpdateSessionNameRequest,
)
from ..services.export.excel_export import excel_export_service
from ..services.matching.matching_service import matching_service
from ..services.pipeline import get_progress, process_reconciliation
from ..storage.session_store import session_store

router = APIRouter(prefix="/reconciliations", tags=["reconciliations"])

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = settings.MAX_FILE_SIZE_MB * 1024 * 1024


def _validate_file(f: UploadFile):
    ext = Path(f.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Định dạng không hỗ trợ: {ext}")


async def _save_upload(f: UploadFile, session_id: str, prefix: str) -> tuple[Path, str]:
    content = await f.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, f"File {f.filename} vượt quá {settings.MAX_FILE_SIZE_MB}MB")
    upload_dir = Path(settings.UPLOAD_DIR) / session_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{prefix}_{uuid.uuid4().hex[:8]}_{Path(f.filename).name}"
    dest = upload_dir / safe_name
    dest.write_bytes(content)
    return dest, f.filename or safe_name


@router.post("")
async def create_reconciliation(
    background_tasks: BackgroundTasks,
    name: Optional[str] = Form(None),
    files_a: list[UploadFile] = File(...),
    files_b: list[UploadFile] = File(...),
):
    """Create a new reconciliation session and start processing."""
    if not files_a or not files_b:
        raise HTTPException(400, "Phải cung cấp ít nhất 1 file cho mỗi nguồn")
    if len(files_a) > settings.MAX_FILES_PER_SOURCE:
        raise HTTPException(400, f"Nguồn A vượt quá {settings.MAX_FILES_PER_SOURCE} file")
    if len(files_b) > settings.MAX_FILES_PER_SOURCE:
        raise HTTPException(400, f"Nguồn B vượt quá {settings.MAX_FILES_PER_SOURCE} file")

    # Validate types
    for f in files_a + files_b:
        _validate_file(f)

    # Create session
    session = session_store.create()
    if name and name.strip():
        session.name = name.strip()
    session.file_count_a = len(files_a)
    session.file_count_b = len(files_b)
    session.status = ReconciliationStatus.PROCESSING
    session_store.save(session)

    # Save uploads
    saved_a = []
    for f in files_a:
        path, fname = await _save_upload(f, session.id, "A")
        saved_a.append((path, fname))

    saved_b = []
    for f in files_b:
        path, fname = await _save_upload(f, session.id, "B")
        saved_b.append((path, fname))

    # Start background processing
    background_tasks.add_task(process_reconciliation, session.id, saved_a, saved_b)

    return {"id": session.id, "status": session.status}


@router.get("")
async def list_reconciliations(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    sessions = session_store.list_sessions(limit=limit, offset=offset)
    items = [SessionListItem(**s.model_dump()) for s in sessions]
    return SessionListResponse(items=items, total=session_store.count())


@router.get("/{session_id}")
async def get_reconciliation(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    return session


@router.get("/{session_id}/progress")
async def get_progress_endpoint(session_id: str):
    progress = get_progress(session_id)
    if not progress:
        # Try from saved session
        session = session_store.get(session_id)
        if not session:
            raise HTTPException(404, "Phiên không tìm thấy")
        return {
            "session_id": session_id,
            "status": session.status,
            "current_step": "done" if session.status == ReconciliationStatus.COMPLETED else "upload",
            "percent": 100 if session.status == ReconciliationStatus.COMPLETED else 0,
            "error_message": session.error_message,
        }
    return progress


@router.patch("/{session_id}/name")
async def update_session_name(session_id: str, payload: UpdateSessionNameRequest):
    """Cập nhật hoặc đặt tên cho phiên đối soát."""
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    session.name = payload.name.strip() if payload.name and payload.name.strip() else None
    session_store.save(session)
    return {"id": session.id, "name": session.name}


@router.get("/{session_id}/extracted-data")
async def get_extracted_data(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    return ExtractedDataResponse(
        session_id=session_id,
        name=session.name,
        source_a=session.source_a,
        source_b=session.source_b,
    )


@router.put("/{session_id}/extracted-data")
async def update_extracted_data(session_id: str, data: ExtractedDataResponse):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    session.source_a = data.source_a
    session.source_b = data.source_b
    session_store.save(session)
    return {"ok": True}


@router.post("/{session_id}/compare")
async def run_comparison(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    if not session.source_a or not session.source_b:
        raise HTTPException(400, "Chưa có dữ liệu trích xuất")

    rows, stats = matching_service.match_and_compare(session.source_a, session.source_b)
    session.comparison_results = rows
    session.stats = stats
    session.status = ReconciliationStatus.COMPLETED
    session_store.save(session)
    return {"ok": True, "stats": stats}


@router.get("/{session_id}/results")
async def get_results(
    session_id: str,
    status: str = Query(default=None),
    search: str = Query(default=None),
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0),
):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")

    rows = session.comparison_results
    if status:
        rows = [r for r in rows if r.status == status]
    if search:
        q = search.lower()
        rows = [
            r for r in rows
            if (r.student_id and q in r.student_id.lower())
            or (r.full_name and q in r.full_name.lower())
        ]

    total = len(rows)
    rows = rows[offset : offset + limit]
    return ResultsResponse(
        session_id=session_id,
        name=session.name,
        stats=session.stats,
        items=rows,
        total=total,
    )


@router.get("/{session_id}/export")
async def export_excel(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    if session.status != ReconciliationStatus.COMPLETED:
        raise HTTPException(400, "Phiên chưa hoàn tất")

    xlsx_bytes = excel_export_service.generate_workbook(session)
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"CCE_ScoreSync_DoiSoat_{ts}.xlsx"

    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{session_id}")
async def delete_reconciliation(session_id: str):
    session = session_store.get(session_id)
    if not session:
        raise HTTPException(404, "Phiên không tìm thấy")
    session_store.delete(session_id)
    # Clean uploads
    upload_dir = Path(settings.UPLOAD_DIR) / session_id
    if upload_dir.exists():
        import shutil
        shutil.rmtree(upload_dir, ignore_errors=True)
    return {"ok": True}

