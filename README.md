# CCE ScoreSync

Hệ thống đối chiếu điểm thi tự động, sử dụng Gemini AI để trích xuất dữ liệu từ biên bản điểm viết tay và so sánh với dữ liệu đã nhập trên hệ thống CCE.

## Cấu trúc dự án

```
CCE/
├── cce-scoresync/       # Frontend (React + Vite + Tailwind)
└── backend/             # Backend (FastAPI + Python)
    ├── app/
    │   ├── api/         # API routes
    │   ├── core/        # Config
    │   ├── models/      # Pydantic schemas
    │   ├── services/    # Business logic
    │   │   ├── gemini/      # Gemini AI integration
    │   │   ├── extraction/  # PDF/image extraction
    │   │   ├── matching/    # Student matching algorithm
    │   │   └── export/      # Excel export
    │   └── storage/     # Session & settings persistence
    ├── tests/           # Unit tests
    ├── venv/            # Python virtual environment
    ├── .env             # Environment config (from .env.example)
    └── requirements.txt
```

---

## Cài đặt và chạy

### Yêu cầu

- Python 3.10+
- Node.js 18+
- Gemini API key (lấy tại https://aistudio.google.com/app/apikey)

---

### 1. Backend (FastAPI)

```bash
# Di chuyển vào thư mục backend
cd backend

# Tạo virtual environment
python -m venv venv

# Kích hoạt venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Cài packages
pip install -r requirements.txt

# Tạo file .env từ template
copy .env.example .env
# Rồi mở .env và điền GEMINI_API_KEY của bạn

# Chạy backend
uvicorn app.main:app --reload --port 8000
```

Backend chạy tại: http://localhost:8000  
API docs: http://localhost:8000/docs

---

### 2. Frontend (React + Vite)

```bash
# Di chuyển vào thư mục frontend
cd cce-scoresync

# Cài dependencies (nếu chưa)
npm install

# Chạy development server
npm run dev
```

Frontend chạy tại: http://localhost:5173

> Vite đã cấu hình proxy `/api` → `http://localhost:8000`, nên frontend và backend giao tiếp qua cùng origin.

---

### 3. Cấu hình Gemini API

Có hai cách cấu hình API key:

**Cách 1 – File .env (khuyến nghị cho production):**
```
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-1.5-flash
```

**Cách 2 – Giao diện Cài đặt AI:**  
Vào menu "Cài đặt AI" trong ứng dụng → nhập API key → nhấn "Kiểm tra kết nối" → "Lưu cài đặt".

---

### 4. Chạy unit tests

```bash
cd backend
.\venv\Scripts\activate
python -m pytest tests/ -v
```

---

## Tính năng chính

| Tính năng | Mô tả |
|-----------|-------|
| Tải file đa nguồn | PDF, JPG, JPEG, PNG – nhiều file mỗi nguồn |
| OCR thông minh | Gemini AI đọc chữ viết tay, PDF scan |
| Trích xuất có cấu trúc | Thông tin kỳ thi + danh sách học viên + điểm |
| Xem trước & chỉnh sửa | Kiểm tra dữ liệu trích xuất trước khi đối soát |
| Đối chiếu xác định | Ghép theo Mã HV, phát hiện trùng/thiếu/sai lệch |
| Kết quả chi tiết | Bảng lọc/sắp xếp, tỷ lệ khớp có mẫu số rõ ràng |
| Xuất Excel | 5 sheet: tổng quan, chi tiết, sai lệch, nguồn A, nguồn B |
| Lịch sử | Lưu và xem lại các phiên đối soát đã thực hiện |

---

## Quy trình đối soát

1. **Tải file** → Chọn file nguồn A (biên bản viết tay) và nguồn B (điểm CCE)
2. **Trích xuất** → Gemini AI phân tích từng trang
3. **Xem trước** → Kiểm tra dữ liệu, chỉnh sửa nếu AI đọc sai
4. **Đối soát** → Hệ thống ghép học viên theo Mã HV và so sánh điểm
5. **Kết quả** → Xem bảng chi tiết, lọc theo trạng thái
6. **Xuất Excel** → Tạo file báo cáo đầy đủ

---

## Trạng thái đối soát

| Trạng thái | Ý nghĩa |
|-----------|---------|
| `MATCH` | Điểm khớp nhau |
| `MISMATCH` | Điểm khác nhau |
| `MISSING_SOURCE_A` | Học viên chỉ có ở nguồn B |
| `MISSING_SOURCE_B` | Học viên chỉ có ở nguồn A |
| `DUPLICATE` | Mã HV trùng trong cùng nguồn |
| `NEEDS_REVIEW` | Điểm chưa đọc được hoặc độ tin cậy thấp |

---

## Bảo mật

- API key **không** được lưu trong source code hay commit vào Git
- API key được mã hóa khi lưu phía server
- Frontend chỉ nhận được 4 ký tự cuối của key (để nhận biết)
- Mọi yêu cầu đến Gemini đều đi qua backend

---

## Môi trường phát triển

| Công nghệ | Phiên bản |
|-----------|-----------|
| Python | 3.10+ |
| FastAPI | 0.100+ |
| React | 19 |
| Vite | 8 |
| Tailwind CSS | 4 |
| google-generativeai | 0.7+ |
| openpyxl | 3.1+ |
| PyMuPDF | 1.23+ |
