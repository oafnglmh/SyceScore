"""
Excel export service using openpyxl.
Generates a multi-sheet workbook with proper formatting.
"""
from datetime import datetime
from io import BytesIO
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import (
    Alignment,
    Border,
    Font,
    PatternFill,
    Side,
)
from openpyxl.utils import get_column_letter

from ...models.schemas import (
    ComparisonRow,
    ComparisonStatus,
    ExamMetadata,
    ReconciliationSession,
    ReconciliationStats,
    SourceData,
)

# Color palette
COLOR_HEADER_BG = "1E293B"  # dark slate
COLOR_HEADER_FG = "FFFFFF"
COLOR_MATCH = "D1FAE5"      # light green
COLOR_MISMATCH = "FEE2E2"   # light red
COLOR_MISSING = "FEF3C7"    # light amber
COLOR_REVIEW = "DBEAFE"     # light blue
COLOR_DUPLICATE = "EDE9FE"  # light purple

STATUS_COLORS = {
    ComparisonStatus.MATCH: COLOR_MATCH,
    ComparisonStatus.MISMATCH: COLOR_MISMATCH,
    ComparisonStatus.MISSING_SOURCE_A: COLOR_MISSING,
    ComparisonStatus.MISSING_SOURCE_B: COLOR_MISSING,
    ComparisonStatus.DUPLICATE: COLOR_DUPLICATE,
    ComparisonStatus.NEEDS_REVIEW: COLOR_REVIEW,
}

STATUS_LABELS_VI = {
    ComparisonStatus.MATCH: "Khớp",
    ComparisonStatus.MISMATCH: "Sai lệch",
    ComparisonStatus.MISSING_SOURCE_A: "Thiếu nguồn A",
    ComparisonStatus.MISSING_SOURCE_B: "Thiếu nguồn B",
    ComparisonStatus.DUPLICATE: "Trùng lặp",
    ComparisonStatus.NEEDS_REVIEW: "Cần kiểm tra",
}


def _header_font():
    return Font(name="Calibri", bold=True, color=COLOR_HEADER_FG, size=10)


def _default_font():
    return Font(name="Calibri", size=10)


def _header_fill():
    return PatternFill("solid", fgColor=COLOR_HEADER_BG)


def _status_fill(status: ComparisonStatus):
    color = STATUS_COLORS.get(status, "FFFFFF")
    return PatternFill("solid", fgColor=color)


def _thin_border():
    thin = Side(style="thin", color="D1D5DB")
    return Border(bottom=thin)


def _set_header_row(ws, headers: list[str], row: int = 1):
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=row, column=col, value=header)
        cell.font = _header_font()
        cell.fill = _header_fill()
        cell.alignment = Alignment(wrap_text=False, vertical="center")
    ws.row_dimensions[row].height = 20


def _auto_width(ws, min_width: int = 10, max_width: int = 50):
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            try:
                val = str(cell.value) if cell.value else ""
                max_len = max(max_len, len(val))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = max(min_width, min(max_len + 2, max_width))


def _freeze_and_filter(ws, freeze_row: int = 2, filter_ref: Optional[str] = None):
    ws.freeze_panes = f"A{freeze_row}"
    if filter_ref:
        ws.auto_filter.ref = filter_ref


class ExcelExportService:

    def generate_workbook(self, session: ReconciliationSession) -> bytes:
        wb = Workbook()
        # Remove default sheet
        wb.remove(wb.active)

        rows = session.comparison_results
        stats = session.stats
        meta = session.metadata

        self._sheet_overview(wb, session, meta, stats)
        self._sheet_detail(wb, rows, "Chi tiết đối soát")
        self._sheet_issues(wb, rows)
        if session.source_a:
            self._sheet_source(wb, session.source_a, "Dữ liệu nguồn A")
        if session.source_b:
            self._sheet_source(wb, session.source_b, "Dữ liệu nguồn B")

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        return buf.read()

    def _sheet_overview(self, wb, session, meta: Optional[ExamMetadata], stats: Optional[ReconciliationStats]):
        ws = wb.create_sheet("Tổng quan")
        row = 1

        # Title
        ws.cell(row=row, column=1, value="CCE ScoreSync – Báo cáo đối soát điểm thi")
        ws.cell(row=row, column=1).font = Font(name="Calibri", bold=True, size=14)
        row += 2

        # Metadata section
        ws.cell(row=row, column=1, value="THÔNG TIN KỲ THI")
        ws.cell(row=row, column=1).font = Font(name="Calibri", bold=True, size=11)
        row += 1

        meta_fields = [
            ("Học kỳ", meta.semester if meta else None),
            ("Học phần thi", meta.subject if meta else None),
            ("Khóa", meta.course if meta else None),
            ("Ngày giờ thi", meta.exam_datetime if meta else None),
            ("Lớp", meta.class_name if meta else None),
            ("Ngành", meta.major if meta else None),
            ("Địa điểm thi", meta.exam_location if meta else None),
            ("Phòng thi", meta.room if meta else None),
        ]
        for label, val in meta_fields:
            ws.cell(row=row, column=1, value=label).font = Font(name="Calibri", bold=True, size=10)
            ws.cell(row=row, column=2, value=val or "—").font = _default_font()
            row += 1

        row += 1
        ws.cell(row=row, column=1, value="THỐNG KÊ ĐỐI SOÁT")
        ws.cell(row=row, column=1).font = Font(name="Calibri", bold=True, size=11)
        row += 1

        if stats:
            match_rate_str = (
                f"{stats.matched_count}/{stats.comparable_count} = {stats.match_rate:.1f}%"
                if stats.match_rate is not None
                else "—"
            )
            stat_rows = [
                ("Tổng bản ghi nguồn A", stats.total_source_a),
                ("Tổng bản ghi nguồn B", stats.total_source_b),
                ("Cặp ghép thành công", stats.matched_count),
                ("Số dòng khớp điểm", stats.match_count),
                ("Số dòng sai lệch", stats.mismatch_count),
                ("Thiếu ở nguồn A", stats.missing_a),
                ("Thiếu ở nguồn B", stats.missing_b),
                ("Trùng lặp", stats.duplicate_count),
                ("Cần xác minh", stats.needs_review_count),
                ("Tỷ lệ khớp điểm", match_rate_str),
            ]
            for label, val in stat_rows:
                ws.cell(row=row, column=1, value=label).font = Font(name="Calibri", bold=True, size=10)
                ws.cell(row=row, column=2, value=val).font = _default_font()
                row += 1

        row += 1
        ws.cell(row=row, column=1, value="Thời gian tạo báo cáo")
        ws.cell(row=row, column=1).font = Font(name="Calibri", bold=True, size=10)
        ws.cell(row=row, column=2, value=datetime.now().strftime("%d/%m/%Y %H:%M"))

        ws.column_dimensions["A"].width = 28
        ws.column_dimensions["B"].width = 40

    def _sheet_detail(self, wb, rows: list[ComparisonRow], title: str):
        ws = wb.create_sheet(title)
        headers = [
            "STT", "Mã HV", "Họ và tên", "Ngày sinh",
            "Điểm viết tay", "Điểm hệ thống CCE", "Chênh lệch",
            "Trạng thái", "Lý do",
            "File nguồn A", "Trang A", "File nguồn B", "Trang B",
        ]
        _set_header_row(ws, headers)

        for i, row in enumerate(rows, 1):
            r = i + 1
            ws.cell(r, 1, i)
            ws.cell(r, 2, row.student_id or "")
            ws.cell(r, 3, row.full_name or "")
            ws.cell(r, 4, row.date_of_birth or "")
            ws.cell(r, 5, row.score_a)
            ws.cell(r, 6, row.score_b)
            ws.cell(r, 7, row.diff)
            ws.cell(r, 8, STATUS_LABELS_VI.get(row.status, str(row.status)))
            ws.cell(r, 9, row.reason or "")
            ws.cell(r, 10, row.source_file_a or "")
            ws.cell(r, 11, row.source_page_a)
            ws.cell(r, 12, row.source_file_b or "")
            ws.cell(r, 13, row.source_page_b)

            # Status color on row
            fill = _status_fill(row.status)
            for col in [7, 8]:
                ws.cell(r, col).fill = fill

        max_row = len(rows) + 1
        _freeze_and_filter(ws, filter_ref=f"A1:{get_column_letter(len(headers))}{max_row}")
        _auto_width(ws)

    def _sheet_issues(self, wb, rows: list[ComparisonRow]):
        issue_rows = [
            r for r in rows
            if r.status != ComparisonStatus.MATCH
        ]
        ws = wb.create_sheet("Chỉ sai lệch")
        headers = [
            "STT", "Mã HV", "Họ và tên", "Ngày sinh",
            "Điểm viết tay", "Điểm hệ thống CCE", "Chênh lệch",
            "Trạng thái", "Lý do",
        ]
        _set_header_row(ws, headers)

        for i, row in enumerate(issue_rows, 1):
            r = i + 1
            ws.cell(r, 1, i)
            ws.cell(r, 2, row.student_id or "")
            ws.cell(r, 3, row.full_name or "")
            ws.cell(r, 4, row.date_of_birth or "")
            ws.cell(r, 5, row.score_a)
            ws.cell(r, 6, row.score_b)
            ws.cell(r, 7, row.diff)
            ws.cell(r, 8, STATUS_LABELS_VI.get(row.status, str(row.status)))
            ws.cell(r, 9, row.reason or "")
            fill = _status_fill(row.status)
            ws.cell(r, 8).fill = fill

        _freeze_and_filter(ws, filter_ref=f"A1:{get_column_letter(len(headers))}{len(issue_rows)+1}")
        _auto_width(ws)

    def _sheet_source(self, wb, source: SourceData, title: str):
        ws = wb.create_sheet(title)
        headers = [
            "STT", "Mã HV", "Họ và tên", "Ngày sinh",
            "Điểm (gốc)", "Điểm (chuẩn hóa)", "Điểm gốc (text)",
            "Cần kiểm tra", "Lý do",
            "File nguồn", "Trang",
            "Conf. Mã HV", "Conf. Tên", "Conf. Ngày sinh", "Conf. Điểm",
        ]
        _set_header_row(ws, headers)

        for i, s in enumerate(source.students, 1):
            r = i + 1
            ws.cell(r, 1, s.stt or i)
            ws.cell(r, 2, s.student_id or "")
            ws.cell(r, 3, s.full_name or "")
            ws.cell(r, 4, s.date_of_birth or "")
            ws.cell(r, 5, str(s.score) if s.score is not None else "")
            ws.cell(r, 6, s.score_normalized)
            ws.cell(r, 7, s.raw_score_text or "")
            ws.cell(r, 8, "Có" if s.needs_review else "Không")
            ws.cell(r, 9, s.review_reason or "")
            ws.cell(r, 10, s.source_file or "")
            ws.cell(r, 11, s.page_number)
            ws.cell(r, 12, s.confidence.student_id)
            ws.cell(r, 13, s.confidence.full_name)
            ws.cell(r, 14, s.confidence.date_of_birth)
            ws.cell(r, 15, s.confidence.score)

        _freeze_and_filter(ws, filter_ref=f"A1:{get_column_letter(len(headers))}{len(source.students)+1}")
        _auto_width(ws)


excel_export_service = ExcelExportService()

