# CCE ScoreSync

Đọc điểm **viết tay** trên biên bản scan “Kết quả thi kết thúc học phần” bằng **AI CCE** và xuất ra Excel theo mẫu chuẩn.
Ứng dụng chạy hoàn toàn trên trình duyệt (không có backend) – ảnh trang scan được gửi thẳng tới API của AI CCE (Google AI Studio).

## Chạy

```bash
cd cce-scoresync
npm install
npm run dev        # http://localhost:5173
```

### API key

Mở file `cce-scoresync/public/api-keys.json` và dán key vào mảng `keys` (mỗi ô một key, ô trống tự bỏ qua):

```json
{
  "model": "3.5-flash",
  "concurrency": 4,
  "keys": ["AIza...key1", "AIza...key2", "..."]
}
```

- Hệ thống **xoay vòng** giữa các key. Key hết hạn mức trong ngày sẽ bị bỏ qua (được ghi nhớ tới khi Google reset quota),
  key không hợp lệ bị loại, key chạm giới hạn/phút được tạm nghỉ rồi dùng lại.
- Sửa file xong bấm biểu tượng 🔑 trên thanh tiêu đề → **Tải lại file key** (không cần khởi động lại).
- Các key **cùng một Google Cloud project dùng chung hạn mức** – muốn nhân quota thì key phải thuộc các project/tài khoản khác nhau.
- `api-keys.json` đã nằm trong `.gitignore`; mẫu trống ở `public/api-keys.example.json`. Khi `npm run build`, file này được
  chép vào `dist/` – chỉ deploy bản build trong mạng nội bộ.

## Quy trình

1. Tải lên một hoặc nhiều file PDF scan (hoặc ảnh JPG/PNG).
2. **Kiểm tra chéo**: mỗi trang được đọc **2 lần độc lập** (ảnh màu và ảnh xám tăng tương phản). Còn chỗ lệch – hoặc
   điểm cột Số khác cột Chữ – thì đọc thêm có trọng tâm (tối đa **5 lần**) tới khi mọi trường có đa số rõ ràng (> 1/2).
3. Kiểm tra tự động:
   - điểm cột **Số** phải khớp cột **Chữ** (“chín ba” = 9.3);
   - TT liên tục; số dòng khớp “Số học viên dự thi”, số người có điểm khớp “Số bài thi”;
   - Mã HV bắt đầu bằng mã lớp, ngày sinh hợp lệ, không trùng Mã HV.
4. Màn hình soát: mục nào chưa chắc chắn được tô màu, có ảnh trang scan bên cạnh (tự cuộn tới dòng). Sửa trực tiếp
   hoặc bấm “Đã đối chiếu – đúng”.
5. **Xuất Excel**: mỗi Lớp + Ngành một file `Lop_Nganh.xlsx` (nhiều lớp thì nén `DoiSoatDiem.zip`), cột:
   `STT | Lớp | Ngành | Học phần thi | Ngày giờ thi | Mã HV | Họ và tên | Ngày sinh | Điểm`.
   Học viên vắng thi để trống ô Điểm.

## Cấu trúc mã

```
cce-scoresync/src/
├── App.jsx                  # Điều phối: tải lên → đọc → soát → xuất
├── components/              # UploadView, ProcessingView, ReviewView, PageViewer, KeyStatusDialog, ui
└── lib/
    ├── ai.js                # Prompt, JSON schema, gọi API, thử lại khi 429/5xx
    ├── keys.js              # Đọc api-keys.json, kho key xoay vòng, ghi nhớ key hết quota
    ├── pages.js             # Tách PDF/ảnh thành ảnh trang (pdf.js)
    ├── extract.js           # Bỏ phiếu giữa các lần đọc, ghép trang thành biên bản, kiểm tra
    ├── score.js             # Chuẩn hóa điểm số, đọc điểm bằng chữ tiếng Việt
    └── excel.js             # Xuất Excel/ZIP theo mẫu
```
