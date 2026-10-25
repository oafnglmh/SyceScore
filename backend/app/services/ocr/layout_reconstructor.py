"""
layout_reconstructor.py
=======================
Chuyen ket qua PaddleOCR (text blocks + bounding boxes) thanh
cau truc bang trung gian de gui cho Ollama xu ly dang van ban.

Nguyen tac:
  - Khong tu suy doan truong du lieu (student_id, score...)
  - Khong bo qua hang nao ke ca hang thieu du lieu
  - Canh bao khi khong tim thay tieu de dang tin cay
  - Khong dung khoang cach Y co dinh - tinh dong theo phan bo thuc te
"""
from __future__ import annotations

import logging
import re
import statistics
from typing import Optional

logger = logging.getLogger(__name__)


# --- Data structures ---

class TextBlock:
    """Mot text block tu PaddleOCR voi vi tri va do tin cay."""
    __slots__ = ("text", "confidence", "x0", "y0", "x1", "y1")

    def __init__(self, text: str, confidence: float, bbox):
        self.text = str(text).strip()
        self.confidence = float(confidence)
        self.x0, self.y0, self.x1, self.y1 = _bbox_to_xyxy(bbox)

    @property
    def center_y(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def center_x(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def height(self) -> float:
        return abs(self.y1 - self.y0)


class TableRow:
    """Mot hang trong bang gom nhieu TextBlock sap xep theo X."""
    def __init__(self, blocks: list[TextBlock]):
        self.blocks: list[TextBlock] = sorted(blocks, key=lambda b: b.x0)

    @property
    def text(self) -> str:
        return " | ".join(b.text for b in self.blocks)

    @property
    def texts(self) -> list[str]:
        return [b.text for b in self.blocks]

    @property
    def avg_confidence(self) -> float:
        if not self.blocks:
            return 0.0
        return sum(b.confidence for b in self.blocks) / len(self.blocks)

    @property
    def min_confidence(self) -> float:
        if not self.blocks:
            return 0.0
        return min(b.confidence for b in self.blocks)


class ReconstructedTable:
    """Ket qua khoi phuc cau truc bang tu OCR."""
    def __init__(
        self,
        header_rows: list[TableRow],
        data_rows: list[TableRow],
        pre_table_text: list[str],
        warnings: list[str],
    ):
        self.header_rows = header_rows
        self.data_rows = data_rows
        self.pre_table_text = pre_table_text
        self.warnings = warnings


class PageLayoutResult:
    """Ket qua phan tich layout cua mot trang."""
    def __init__(
        self,
        page_number: int,
        pre_table_text: list[str],
        tables: list[ReconstructedTable],
        all_rows: list[TableRow],
        warnings: list[str],
    ):
        self.page_number = page_number
        self.pre_table_text = pre_table_text
        self.tables = tables
        self.all_rows = all_rows
        self.warnings = warnings

    @property
    def has_reliable_headers(self) -> bool:
        return any(bool(t.header_rows) for t in self.tables)

    def to_structured_text(self) -> str:
        """Tao van ban co cau truc de gui cho Ollama."""
        lines = []

        if self.pre_table_text:
            lines.append("=== THONG TIN TRUOC BANG DAU TIEN (CO THE GOM TEN LOP) ===")
            lines.extend(self.pre_table_text)
            lines.append("")

        for i, table in enumerate(self.tables):
            lines.append(f"=== BANG {i+1} ===")
            if table.pre_table_text:
                lines.append("TEN LOP / THONG TIN NGAY TREN BANG NAY:")
                lines.extend("  " + line for line in table.pre_table_text)
            if table.header_rows:
                lines.append("TIEU DE COT:")
                for hr in table.header_rows:
                    lines.append("  " + hr.text)
                lines.append("DU LIEU:")
            for row in table.data_rows:
                lines.append("  " + row.text)
            lines.append("")

        if not self.tables and self.pre_table_text:
            # Khong co bang ro rang, gui toan bo text
            lines.append("=== NOI DUNG TRANG (khong xac dinh duoc bang) ===")
            for row in self.all_rows:
                lines.append("  " + row.text)

        if self.warnings:
            lines.append("=== CANH BAO ===")
            lines.extend(f"  - {w}" for w in self.warnings)

        return "\n".join(lines)


# --- Helpers ---

def _bbox_to_xyxy(bbox) -> tuple[float, float, float, float]:
    """Chuyen bbox polygon hoac [x0,y0,x1,y1] ve (x0,y0,x1,y1)."""
    if not bbox:
        return 0.0, 0.0, 0.0, 0.0

    # Polygon: [[x0,y0],[x1,y1],...] hoac np.array shape (4,2)
    try:
        first = bbox[0]
        if hasattr(first, "__len__") or isinstance(first, (list, tuple)):
            xs = [float(p[0]) for p in bbox]
            ys = [float(p[1]) for p in bbox]
            return min(xs), min(ys), max(xs), max(ys)
    except (TypeError, IndexError):
        pass

    # Flat: [x0, y0, x1, y1]
    if len(bbox) == 4:
        try:
            return float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
        except (TypeError, ValueError):
            pass

    return 0.0, 0.0, 0.0, 0.0


def _compute_row_threshold(blocks: list[TextBlock]) -> float:
    """
    Tinh nguong khoang cach Y de nhom thanh hang.
    Dua tren chieu cao trung vi thay vi gia tri co dinh.
    """
    heights = [b.height for b in blocks if b.height > 0]
    if not heights:
        return 15.0
    median_h = statistics.median(heights)
    # Nguong = 60% chieu cao trung vi, toi thieu 8px, toi da 35px
    return max(8.0, min(35.0, median_h * 0.6))


def _group_into_rows(
    blocks: list[TextBlock],
    y_threshold: float,
) -> list[TableRow]:
    """Nhom cac text blocks thanh hang dua tren toa do Y trung tam."""
    if not blocks:
        return []

    sorted_blocks = sorted(blocks, key=lambda b: b.center_y)
    rows: list[list[TextBlock]] = []
    current_row: list[TextBlock] = [sorted_blocks[0]]

    for block in sorted_blocks[1:]:
        ref_y = sum(b.center_y for b in current_row) / len(current_row)
        if abs(block.center_y - ref_y) <= y_threshold:
            current_row.append(block)
        else:
            rows.append(current_row)
            current_row = [block]

    if current_row:
        rows.append(current_row)

    return [TableRow(row) for row in rows]


# Tu khoa nhan dien hang tieu de bang
_HEADER_KEYWORDS = {
    "stt", "tt",
    "ma hv", "ma sv", "ma hoc vien", "ma sinh vien", "masv", "mahv",
    "ho va ten", "ho ten",
    "ngay sinh",
    "diem", "diem so", "diem thi", "ket qua", "thi l1", "ktra1", "ktrangayedit",
    "ghi chu",
}


def _normalize_for_match(text: str) -> str:
    """Chuan hoa text de so khop voi tu khoa (bo dau, thuong hoa)."""
    import unicodedata
    s = str(text).lower().strip()
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _is_header_row(row: TableRow) -> bool:
    """Phan doan hang co phai tieu de bang khong."""
    row_normalized = _normalize_for_match(row.text)
    matched = sum(1 for kw in _HEADER_KEYWORDS if kw in row_normalized)
    return matched >= 2


_META_KEYWORDS_NORM = [
    "hoc ky", "hoc phan", "mon thi", "khoa", "lop", "nganh",
    "dia diem", "phong thi", "ngay thi", "gio thi",
    "truong", "trung tam",
]


def _detect_table_start(rows: list[TableRow]) -> int:
    """Tim vi tri bat dau cua bang. Tra ve index hoac -1 neu khong tim thay."""
    for i, row in enumerate(rows):
        if _is_header_row(row):
            return i
    return -1


def _is_table_title_row(row: TableRow) -> bool:
    """Recognize class/subject labels printed between adjacent table blocks."""
    text = _normalize_for_match(row.text)
    if _is_header_row(row):
        return False
    return any(keyword in text for keyword in ("lop", "class:", "hoc phan", "mon thi"))


def _looks_like_student_data_row(row: TableRow) -> bool:
    """Detect a row with a likely ID so a bare class code can remain table context."""
    text = row.text
    return bool(
        re.search(r"\b[A-Z]{2,}\d[\w.\-]{3,}\d{2,}\b", text, re.IGNORECASE)
        or re.search(r"\b\d{6,}\b", text)
    )


def _looks_like_bare_class_code(row: TableRow) -> bool:
    text = _normalize_for_match(row.text).strip()
    return bool(re.fullmatch(r"[a-z]{2,}\d+(?:[.\-][a-z0-9]+)+|[a-z]{2,}-\d{1,4}", text))


# --- Main reconstruction logic ---

def reconstruct_page_layout(
    ocr_blocks: list[dict],
    page_number: int = 1,
    confidence_threshold: float = 0.3,
) -> PageLayoutResult:
    """
    Phan tich layout mot trang tu ket qua PaddleOCR.

    Args:
        ocr_blocks: List dict voi keys 'text', 'confidence', 'bbox'
        page_number: So trang (1-indexed)
        confidence_threshold: Bo qua blocks co confidence duoi nguong nay

    Returns:
        PageLayoutResult chua cau truc bang va text metadata
    """
    warnings: list[str] = []

    # Buoc 1: Chuyen doi dict sang TextBlock
    blocks: list[TextBlock] = []
    low_conf_count = 0

    for item in ocr_blocks:
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        conf = float(item.get("confidence", 1.0))
        bbox = item.get("bbox")
        if bbox is None:
            continue

        block = TextBlock(text=text, confidence=conf, bbox=bbox)
        if conf < confidence_threshold:
            low_conf_count += 1
        blocks.append(block)

    if not blocks:
        return PageLayoutResult(
            page_number=page_number,
            pre_table_text=[],
            tables=[],
            all_rows=[],
            warnings=[f"Trang {page_number}: Khong co text block nao tu OCR"],
        )

    if low_conf_count > 0:
        pct = low_conf_count / len(blocks) * 100
        if pct > 20:
            warnings.append(
                f"Trang {page_number}: {low_conf_count}/{len(blocks)} "
                f"blocks co confidence thap ({pct:.0f}%)"
            )

    # Buoc 2: Nhom thanh hang
    y_threshold = _compute_row_threshold(blocks)
    all_rows = _group_into_rows(blocks, y_threshold)

    logger.debug(
        f"[Layout] Trang {page_number}: {len(blocks)} blocks -> "
        f"{len(all_rows)} hang (y_threshold={y_threshold:.1f}px)"
    )

    # Buoc 3: Tim vi tri bat dau bang
    table_start_idx = _detect_table_start(all_rows)

    if table_start_idx == -1:
        warnings.append(
            f"Trang {page_number}: Khong xac dinh duoc tieu de bang. "
            "Toan bo noi dung se duoc gui cho LLM."
        )
        pre_table = [r.text for r in all_rows]
        return PageLayoutResult(
            page_number=page_number,
            pre_table_text=pre_table,
            tables=[],
            all_rows=all_rows,
            warnings=warnings,
        )

    # Thong tin truoc bang dau tien (thuong co ten lop in o tren bang).
    pre_table_rows = all_rows[:table_start_idx]
    pre_table_text = [r.text for r in pre_table_rows if r.text.strip()]
    # A single page may contain multiple class tables. Split repeated headers,
    # moving an intervening class title onto the following table.
    tables: list[ReconstructedTable] = []
    cursor = table_start_idx
    pending_title: list[str] = []
    while cursor < len(all_rows):
        if not _is_header_row(all_rows[cursor]):
            cursor += 1
            continue

        header_rows = [all_rows[cursor]]
        data_start = cursor + 1
        while data_start < len(all_rows) and data_start <= cursor + 3 and _is_header_row(all_rows[data_start]):
            header_rows.append(all_rows[data_start])
            data_start += 1

        next_header = next(
            (index for index in range(data_start, len(all_rows)) if _is_header_row(all_rows[index])),
            len(all_rows),
        )
        section_rows = [row for row in all_rows[data_start:next_header] if row.text.strip()]
        next_title: list[str] = []
        if next_header < len(all_rows):
            while section_rows and (
                (_is_table_title_row(section_rows[-1]) or _looks_like_bare_class_code(section_rows[-1]))
                and not _looks_like_student_data_row(section_rows[-1])
            ):
                next_title.insert(0, section_rows.pop().text)

        table = ReconstructedTable(
            header_rows=header_rows,
            data_rows=section_rows,
            pre_table_text=pending_title,
            warnings=[],
        )
        tables.append(table)
        pending_title = next_title
        cursor = next_header

    if not tables:
        warnings.append(f"Trang {page_number}: Khong xac dinh duoc hang tieu de bang ro rang.")
    elif not any(table.data_rows for table in tables):
        warnings.append(f"Trang {page_number}: Khong co hang du lieu nao trong bang.")

    logger.info(
        f"[Layout] Trang {page_number}: {len(tables)} bang, "
        f"{sum(len(table.header_rows) for table in tables)} hang tieu de, "
        f"{sum(len(table.data_rows) for table in tables)} hang du lieu, "
        f"{len(pre_table_text)} dong thong tin truoc bang dau tien."
    )

    return PageLayoutResult(
        page_number=page_number,
        pre_table_text=pre_table_text,
        tables=tables,
        all_rows=all_rows,
        warnings=warnings,
    )


def format_ocr_for_llm(
    page_results: list[PageLayoutResult],
    max_chars_per_chunk: int = 6000,
) -> list[dict]:
    """
    Gop ket qua nhieu trang thanh cac chunks phu hop voi context window LLM.

    Returns:
        list[dict] moi dict co:
            - 'text': van ban gui cho LLM
            - 'pages': list so trang trong chunk
            - 'has_header': co tieu de bang khong
            - 'header_context': tieu de bang tu trang truoc
    """
    chunks: list[dict] = []
    current_text_parts: list[str] = []
    current_pages: list[int] = []
    current_chars = 0
    last_header_context: Optional[str] = None

    for page_result in page_results:
        page_text = page_result.to_structured_text()

        # Neu chunk hien tai qua dai -> dong chunk va tao moi
        if current_chars + len(page_text) > max_chars_per_chunk and current_text_parts:
            # Luu header context truoc khi dong chunk
            for pr in page_results:
                if pr.page_number in current_pages:
                    for table in pr.tables:
                        if table.header_rows:
                            last_header_context = "\n".join(
                                hr.text for hr in table.header_rows
                            )

            chunks.append({
                "text": "\n\n".join(current_text_parts),
                "pages": current_pages.copy(),
                "has_header": True,
                "header_context": last_header_context,
            })
            current_text_parts = []
            current_pages = []
            current_chars = 0

        # Neu khong co header trong trang nay nhung co header_context -> them vao dau
        has_table_on_page = bool(
            page_result.tables and any(t.data_rows for t in page_result.tables)
        )
        has_header_on_page = any(bool(t.header_rows) for t in page_result.tables)
        if has_table_on_page and not has_header_on_page and last_header_context:
            prefix = f"[Tieu de cot tu trang truoc: {last_header_context}]\n"
            page_text = prefix + page_text

        current_text_parts.append(page_text)
        current_pages.append(page_result.page_number)
        current_chars += len(page_text)

    if current_text_parts:
        chunks.append({
            "text": "\n\n".join(current_text_parts),
            "pages": current_pages,
            "has_header": True,
            "header_context": last_header_context,
        })

    return chunks
