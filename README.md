# CCE ScoreSync

Ứng dụng có **2 chức năng độc lập**, mỗi chức năng một route (chuyển bằng tab trên thanh tiêu đề):

| Route | Chức năng |
|---|---|
| `#/` | **Số hóa điểm** – đọc biên bản thi viết tay, soát và xuất Excel theo mẫu (chức năng gốc, giữ nguyên). |
| `#/do-diem` | **Dò điểm** – so bảng điểm hệ thống với biên bản viết tay, báo dòng sai (mô tả bên dưới). |

Trang nào đã mở thì giữ nguyên trạng thái khi chuyển qua lại giữa hai tab.

## Dò điểm

**Dò điểm** giữa **bảng điểm in từ hệ thống** (PDF scan) và **biên bản chấm có điểm viết tay** (PDF scan): ghép theo
**cùng môn thi** (không xét lớp), so từng học viên và báo chính xác **dòng nào sai**.
Ứng dụng chạy hoàn toàn trên trình duyệt (không có backend) – ảnh trang scan được gửi tới API của AI CCE (Google AI Studio) qua proxy của server Vite – xem mục API key.

## Chạy

```bash
cd cce-scoresync
npm install
npm run dev        # http://localhost:5173
```

### API key (chỉ nằm trên server)

API key **không bao giờ được gửi xuống trình duyệt**. Trình duyệt gọi `/ai-api/...` trên chính server của app; server Vite
(`npm run dev` / `npm run preview`) tự gắn key rồi chuyển tiếp tới Google. Người dùng mở DevTools cũng không thấy key.

1. Sao chép `cce-scoresync/.env.example` thành `cce-scoresync/.env` và điền key:

   ```
   GEMINI_API_KEY=key_của_bạn
   ```

2. Lưu file: server tự khởi động lại. Trên giao diện bấm 🔑 → **Kiểm tra lại**.

- Cấu hình không bí mật (model, số trang đọc song song) nằm ở `cce-scoresync/public/ai-config.json`.
- `.env` nằm trong `.gitignore` và bị Vite chặn truy cập qua web (403). **Không** đặt key trong `public/` – mọi file
  trong đó đều tải được từ trình duyệt.
- Bản build (`dist/`) không chứa key. Muốn chạy bản build thì dùng `npm run preview` (có proxy); mở thẳng `dist/` trên web
  server tĩnh sẽ không gọi được AI.
- Ai truy cập được app (kể cả qua mạng LAN, vì server mở `host: true`) đều *dùng* được key qua proxy, dù không *thấy* key.

## Quy trình Dò điểm

1. Tải lên 2 bộ file (PDF scan hoặc ảnh JPG/PNG, mỗi ô nhiều file được):
   - **Bảng điểm hệ thống** – một trang có thể có nhiều học phần (Ngữ pháp…, Ngữ âm…, Pháp luật…), cột `TT | Mã SV | Ngày sinh | Họ tên | Ktra1 | Ktra1NgayEdit …`;
   - **Biên bản viết tay** – “Kết quả chấm bài kiểm tra giữa kỳ” / “Kết quả thi kết thúc học phần”, có thể nhiều biên bản.
2. **Đọc chéo**: mỗi trang đọc **2 lần độc lập** (ảnh màu + ảnh xám tương phản cao); còn chỗ lệch – hoặc ô Số khác ô Chữ –
   thì đọc thêm có trọng tâm (tối đa **5 lần**) và lấy đa số.
3. **Ghép biên bản ↔ học phần** theo **tên môn thi** – không xét lớp
   (so không dấu, chịu lỗi đọc vài ký tự; khác số hiệu “… 1” / “… 2” là khác môn). Nhiều bảng cùng tên môn → chọn bảng có
   nhiều Mã HV trùng nhất. Không tìm thấy môn → báo lỗi kèm danh sách môn có trong file hệ thống. Có thể chọn lại cặp bằng tay.
4. **Tự chọn cột điểm**: biên bản kiểm tra/giữa kỳ → cột `Ktra…` (ưu tiên `Ktra1`), thi kết thúc → cột `Thi…`; bỏ cột ngày
   (`Ktra1NgayEdit`). Có thể đổi cột.
5. **So từng dòng** theo Mã HV (bỏ qua nhầm I/1, O/0; sót thì khớp theo họ tên + ngày sinh). Điểm viết tay không có dấu
   thập phân được hiểu đúng: `98` = 9.8, `10` = 10. Báo:
   - **Sai** (đỏ): lệch điểm, có ở bên này mà không có ở bên kia, viết tay vắng nhưng hệ thống có điểm (và ngược lại),
     ô Số ≠ ô Chữ trên biên bản, khác môn thi;
   - **Cần xem lại** (vàng): AI đọc chưa thống nhất, họ tên / ngày sinh / Mã HV khác, “Số bài thi” không khớp.
6. Màn hình kết quả: bảng dò từng dòng + ảnh gốc **cả hai bên** (tự cuộn tới dòng). AI đọc sai thì sửa ô điểm – kết quả tính lại ngay.
7. **Xuất Excel** `DoDiem_<ngày>.xlsx`: sheet *Tổng hợp* (mỗi biên bản một dòng), *Dòng sai*, *Chi tiết*.

## Cấu trúc mã

```
cce-scoresync/src/
├── App.jsx                  # Khung chung: header + tab, router (#/, #/do-diem), API key
├── pages/
│   ├── SoHoaPage.jsx        # #/        Số hóa điểm: tải lên → đọc → soát → xuất Excel
│   └── DoDiemPage.jsx       # #/do-diem Dò điểm: tải 2 bộ file → đọc → dò → xuất Excel
├── hooks/                   # useReadJob (hàng đợi đọc trang dùng chung), useHashRoute
├── components/              # Số hóa: UploadView, ReviewView · Dò điểm: DoDiemUploadView, ResultView
│                            # Dùng chung: ProcessingView, PageViewer, KeyStatusDialog, ui
└── lib/
    ├── ai.js                # Gọi API, prompt biên bản thi (Số hóa), thử lại khi 429/5xx
    ├── extract.js, excel.js # Số hóa: bỏ phiếu, ghép biên bản, xuất Excel theo mẫu
    ├── keys.js              # Đọc ai-config.json + trạng thái key trên server, ghi nhớ key hết quota
    ├── pages.js             # Tách PDF/ảnh thành ảnh trang (pdf.js)
    ├── prompts.js           # Prompt + JSON schema: bảng điểm hệ thống, biên bản viết tay
    ├── read.js              # Đọc chéo, bỏ phiếu, ghép trang thành học phần / biên bản
    ├── compare.js           # Ghép theo môn thi, chọn cột điểm, so từng dòng
    ├── report.js            # Xuất Excel kết quả dò
    ├── text.js              # Chuẩn hóa chữ, Mã HV, so tên học phần
    └── score.js             # Chuẩn hóa điểm số, đọc điểm bằng chữ tiếng Việt
```
