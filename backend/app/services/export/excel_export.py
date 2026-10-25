"""
Excel export service using openpyxl.
Generates a multi-sheet workbook with proper formatting.
"""
from datetime import datetime
from io import BytesIO
import re
from typing import Optional
from zipfile import ZIP_DEFLATED, ZipFile

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
    thin = Side(style="thin", color="CBD5E1")
    return Border(bottom=thin)


def _set_header_row(ws, headers: list[str], row: int = 1):
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=row, column=col, value=header)
        cell.font = _header_font()
        cell.fill = _header_fill()
        cell.alignment = Alignment(horizontal="center", wrap_text=False, vertical="center")
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

    TEMPLATE_HEADERS = [
        "STT", "M\u00e3 HV", "H\u1ecd v\u00e0 t\u00ean", "Ng\u00e0y sinh", "H\u1ecdc k\u1ef3",
        "H\u1ecdc ph\u1ea7n thi", "L\u1edbp", "Ng\u00e0nh", "\u0110\u1ecba \u0111i\u1ec3m thi", "Ph\u00f2ng thi",
        "\u0110i\u1ec3m s\u1ed1 ngu\u1ed3n A",
    ]
    TEMPLATE_WIDTHS = [8, 15, 23, 13, 9, 23, 11, 15, 40, 12, 18]

    @staticmethod
    def _student_class(student, session) -> str:
        source_meta = session.source_a.exam_metadata if session.source_a else None
        return str(
            student.class_name
            or (source_meta.class_name if source_meta else None)
            or (session.metadata.class_name if session.metadata else None)
            or "L\u1edbp ch\u01b0a x\u00e1c \u0111\u1ecbnh"
        ).strip()

    @staticmethod
    def _student_major(student, session) -> str:
        source_meta = session.source_a.exam_metadata if session.source_a else None
        return str(
            student.major
            or (source_meta.major if source_meta else None)
            or (session.metadata.major if session.metadata else None)
            or "Ng\u00e0nh ch\u01b0a x\u00e1c \u0111\u1ecbnh"
        ).strip()

    @staticmethod
    def _safe_filename_part(value: str) -> str:
        value = re.sub(r'[<>:"/\\|?*]+', "", value).strip().rstrip(".")
        value = re.sub(r"\s+", "_", value)
        return value or "Chua_xac_dinh"

    def filename_for(self, class_name: str, major: str) -> str:
        return f"{self._safe_filename_part(class_name)}_{self._safe_filename_part(major)}.xlsx"

    def export_groups(self, session: ReconciliationSession) -> list[tuple[str, str]]:
        source = session.source_a
        if not source:
            return []
        groups = {
            (self._student_class(student, session), self._student_major(student, session))
            for student in source.students
        }
        if not groups and session.metadata:
            groups.add((
                session.metadata.class_name or "L\u1edbp ch\u01b0a x\u00e1c \u0111\u1ecbnh",
                session.metadata.major or "Ng\u00e0nh ch\u01b0a x\u00e1c \u0111\u1ecbnh",
            ))
        return sorted(groups)

    def generate_export(
        self,
        session: ReconciliationSession,
        class_name: Optional[str] = None,
        major: Optional[str] = None,
        subject: Optional[str] = None,
    ) -> tuple[bytes, str, str]:
        """Return one template workbook or a ZIP of workbooks for multiple classes."""
        if class_name or major:
            data = self.generate_workbook(session, class_name, major, subject)
            groups = self.export_groups(session)
            selected_group = next(
                ((cls, maj) for cls, maj in groups
                 if (not class_name or cls.casefold() == class_name.strip().casefold())
                 and (not major or maj.casefold() == major.strip().casefold())),
                None,
            )
            fallback = selected_group or (
                class_name or (session.metadata.class_name if session.metadata else None) or "L\u1edbp ch\u01b0a x\u00e1c \u0111\u1ecbnh",
                major or (session.metadata.major if session.metadata else None) or "Ng\u00e0nh ch\u01b0a x\u00e1c \u0111\u1ecbnh",
            )
            return data, self.filename_for(*fallback), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        groups = self.export_groups(session)
        if subject:
            groups = [
                (class_value, major_value)
                for class_value, major_value in groups
                if any(
                    self._student_class(student, session) == class_value
                    and self._student_major(student, session) == major_value
                    and (student.subject or "").strip().casefold() == subject.strip().casefold()
                    for student in session.source_a.students
                )
            ]
        if len(groups) <= 1:
            class_value, major_value = groups[0] if groups else (
                (session.metadata.class_name if session.metadata else None) or "L\u1edbp ch\u01b0a x\u00e1c \u0111\u1ecbnh",
                (session.metadata.major if session.metadata else None) or "Ng\u00e0nh ch\u01b0a x\u00e1c \u0111\u1ecbnh",
            )
            return (
                self.generate_workbook(session, class_value, major_value, subject),
                self.filename_for(class_value, major_value),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )

        archive = BytesIO()
        with ZipFile(archive, "w", ZIP_DEFLATED) as zipped:
            for class_value, major_value in groups:
                zipped.writestr(
                    self.filename_for(class_value, major_value),
                    self.generate_workbook(session, class_value, major_value, subject),
                )
        return archive.getvalue(), "DoiSoatDiem.zip", "application/zip"

    def generate_workbook(
        self,
        session: ReconciliationSession,
        class_name: Optional[str] = None,
        major: Optional[str] = None,
        subject: Optional[str] = None,
    ) -> bytes:
        wb = Workbook()
        ws = wb.active
        ws.title = "DoiSoatDiem"
        _set_header_row(ws, self.TEMPLATE_HEADERS)
        ws.row_dimensions[1].height = 22

        source = session.source_a
        metadata = source.exam_metadata if source else session.metadata
        students = source.students if source else []
        for student in students:
            student_class = self._student_class(student, session)
            student_major = self._student_major(student, session)
            if class_name and student_class.casefold() != class_name.strip().casefold():
                continue
            if major and student_major.casefold() != major.strip().casefold():
                continue
            if subject and (student.subject or "").strip().casefold() != subject.strip().casefold():
                continue

            score = student.score_normalized
            if score is None:
                try:
                    score = float(str(student.score).replace(",", ".")) if student.score is not None else None
                except (TypeError, ValueError):
                    score = None
            ws.append([
                ws.max_row,
                student.student_id or "",
                student.full_name or "",
                student.date_of_birth or "",
                student.semester or (metadata.semester if metadata else None) or "",
                student.subject or (metadata.subject if metadata else None) or "",
                student_class,
                student_major,
                student.exam_location or (metadata.exam_location if metadata else None) or "",
                student.room or (metadata.room if metadata else None) or "",
                score,
            ])
            for cell in ws[ws.max_row]:
                cell.font = _default_font()
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = _thin_border()

        for index, width in enumerate(self.TEMPLATE_WIDTHS, 1):
            ws.column_dimensions[get_column_letter(index)].width = width
        ws.freeze_panes = "A5"

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

