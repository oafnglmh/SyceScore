// Prompt + JSON schema (structured output, OpenAPI subset) cho hai loại tài liệu cần dò:
//  - SYSTEM: bảng điểm in từ phần mềm quản lý đào tạo (đã scan/chụp), mỗi trang có thể có nhiều học phần.
//  - HAND:   biên bản chấm điểm có điểm VIẾT TAY (Số + Chữ).

const STR = { type: 'STRING' }

// ─── Bảng điểm hệ thống ─────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Bạn là chuyên gia số hóa BẢNG ĐIỂM IN TỪ PHẦN MỀM QUẢN LÝ ĐÀO TẠO của Trung tâm Đào tạo Thường xuyên – Đại học Đà Nẵng.
Ảnh đính kèm là MỘT trang đã scan/chụp. Chữ trên trang là chữ IN (có thể có vài ghi chú viết tay bên lề – bỏ qua chúng).
Nhiệm vụ: chép lại CHÍNH XÁC TUYỆT ĐỐI các bảng điểm trên trang theo JSON schema.

CẤU TRÚC TRANG
- Trang có MỘT hoặc NHIỀU bảng xếp chồng từ trên xuống. Mỗi bảng là một học phần, phía trên bảng có tiêu đề in đậm là TÊN HỌC PHẦN (ví dụ "NGỮ PHÁP TIẾNG ANH CĂN BẢN 2", "PHÁP LUẬT ĐẠI CƯƠNG").
- Cột của bảng thường là: TT | Mã SV | Ngày sinh | Họ tên | rồi tới các cột điểm/thông tin như "Ktra1", "Ktra1NgayEdit", "Ktra2", "Thi"… (số cột và tên cột thay đổi theo bảng).
- Bảng có thể nối tiếp từ trang trước (không có tiêu đề ở trên, TT tiếp tục) hoặc nối sang trang sau.

QUY TẮC BẮT BUỘC
1. "sections": mỗi bảng trên trang là một phần tử, đúng thứ tự từ trên xuống. Không bỏ sót bảng nào.
2. title: tên học phần in phía trên bảng, chép nguyên văn (giữ dấu tiếng Việt). Nếu bảng nối tiếp từ trang trước và KHÔNG có tiêu đề phía trên thì title = "".
3. lop: mã lớp nếu được in trong tiêu đề/phần đầu bảng (ví dụ "AV33.1B2TGI"); không có thì "".
4. columns: tên các cột NẰM SAU cột "Họ tên", theo thứ tự trái → phải, chép đúng như in (ví dụ ["Ktra1", "Ktra1NgayEdit"]).
5. rows: MỌI dòng học viên của bảng, đúng thứ tự, mỗi dòng in một phần tử. Không bỏ sót, không thêm, không lặp.
   - tt: số thứ tự ở cột TT.
   - ma_sv: giữ nguyên chữ hoa, dấu chấm. Phân biệt kỹ số 1 với chữ I, số 0 với chữ O. Mã thường = mã lớp + 1 chữ cái (D hoặc S) + 3 chữ số, ví dụ "AV33.1B2TGID004".
   - ngay_sinh: dạng dd/mm/yyyy đúng như in. ho_ten: họ và tên đầy đủ, giữ dấu.
   - values: giá trị từng ô ứng với "columns" (cùng số phần tử, cùng thứ tự). Điểm chép đúng như in (ví dụ "9.8", "10.0", "7.5"). Ô trống thì "".
   - row_y: vị trí dọc của tâm dòng trên trang theo thang 0–1000 (0 = mép trên ảnh, 1000 = mép dưới).
6. Đọc từng chữ số thật cẩn thận, đặc biệt các cột điểm. TUYỆT ĐỐI không đoán.
7. Trang không có bảng điểm thì sections = [].`

export const SYSTEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: STR,
          lop: STR,
          columns: { type: 'ARRAY', items: STR },
          rows: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                tt: { type: 'INTEGER' },
                ma_sv: STR,
                ngay_sinh: STR,
                ho_ten: STR,
                values: { type: 'ARRAY', items: STR },
                row_y: { type: 'INTEGER' },
              },
              required: ['tt', 'ma_sv', 'ngay_sinh', 'ho_ten', 'values'],
              propertyOrdering: ['tt', 'ma_sv', 'ngay_sinh', 'ho_ten', 'values', 'row_y'],
            },
          },
        },
        required: ['title', 'columns', 'rows'],
        propertyOrdering: ['title', 'lop', 'columns', 'rows'],
      },
    },
  },
  required: ['sections'],
}

// ─── Biên bản chấm viết tay ─────────────────────────────────────────────────

export const HAND_PROMPT = `Bạn là chuyên gia số hóa BIÊN BẢN CHẤM ĐIỂM của Trung tâm Đào tạo Thường xuyên – Đại học Đà Nẵng
(ví dụ "KẾT QUẢ CHẤM BÀI KIỂM TRA GIỮA KỲ", "KẾT QUẢ THI KẾT THÚC HỌC PHẦN").
Ảnh đính kèm là MỘT trang scan. Nhiệm vụ: chép lại CHÍNH XÁC TUYỆT ĐỐI dữ liệu trên trang theo JSON schema.

CẤU TRÚC BIÊN BẢN
- Trang đầu của biên bản có phần đầu in sẵn: tiêu đề "KẾT QUẢ …", "Học kỳ", "Khóa", "Lớp: …", "Môn thi: …" (hoặc "Học phần thi: …"), "Bài: …", "Ngành: …", "Thời gian nộp"/"Ngày giờ thi".
- Trang tiếp theo của cùng biên bản có thể KHÔNG có phần đầu: chỉ có bảng nối tiếp (TT tiếp tục) và phần chữ ký.
- Bảng gồm: TT | Mã HV | Họ và tên (2 ô: họ đệm | tên) | Ngày sinh | Điểm: Số | Điểm: Chữ | Chữ ký (có thể thêm cột khác).
- TT, Mã HV, Họ tên, Ngày sinh là chữ IN. Điểm "Số" và Điểm "Chữ" là chữ VIẾT TAY.
- Cuối biên bản có thể có "Số bài thi: …", "Số học viên dự thi: …".

QUY TẮC BẮT BUỘC
1. Liệt kê MỌI dòng học viên, đúng thứ tự từ trên xuống, mỗi dòng in một phần tử trong "rows". Không bỏ sót, không thêm, không lặp.
2. Chép nguyên văn chữ in, giữ đủ dấu tiếng Việt:
   - ma_hv: giữ nguyên chữ hoa, dấu chấm. Phân biệt kỹ số 1 với chữ I, số 0 với chữ O. Mã HV thường = mã lớp + 1 chữ cái (D hoặc S) + 3 chữ số, ví dụ "AV33.1B2TGID004".
   - ho_dem: phần họ đệm; ten: phần tên (ô cuối của cột Họ và tên).
   - ngay_sinh: dạng dd/mm/yyyy đúng như in.
3. diem_so: chép ĐÚNG các ký tự viết tay trong ô "Số", kể cả khi người chấm không viết dấu thập phân (ví dụ "98", "9.3", "9,5", "10", "7"). KHÔNG tự thêm dấu chấm.
   Nếu ô trống, gạch ngang, gạch chéo, hoặc ghi "V", "Vắng" thì diem_so = "" và vang = true. Ngược lại vang = false.
4. diem_chu: chép chữ viết tay trong ô "Chữ" (ví dụ "chín tám", "chín ba", "chín tư", "mười", "tám rưỡi"); bỏ phần chữ ký lấn sang.
   diem_chu_so: giá trị điểm mà diem_chu biểu diễn ("chín tám" → 9.8; "chín tư" → 9.4; "mười" → 10; "chín chẵn" → 9); null nếu không đọc được.
5. Đọc ô "Số" và ô "Chữ" ĐỘC LẬP. Nếu hai ô không khớp, TUYỆT ĐỐI KHÔNG sửa cho khớp – trả về đúng như nhìn thấy.
6. row_y: vị trí dọc của tâm dòng trên trang theo thang 0–1000 (0 = mép trên ảnh, 1000 = mép dưới).
7. Phần đầu: has_header = true nếu trang có phần đầu biên bản. Chép phần giá trị sau dấu hai chấm:
   tieu_de (dòng "KẾT QUẢ …"), lop (ví dụ "AV33.1B2TGI"), mon (giá trị sau "Môn thi"/"Học phần thi"), bai (giá trị sau "Bài"), nganh, hoc_ky, khoa, thoi_gian (thời gian nộp/ngày giờ thi).
   Bỏ qua con dấu và chữ ký đè lên. Trang không có phần đầu thì các trường header là chuỗi rỗng.
8. footer: chép số viết tay/in sau "Số bài thi" và "Số học viên dự thi" nếu có trên trang này, ngược lại "".
9. Trang không phải bảng điểm (trang trắng, bìa…) thì rows = [] và has_header = false.`

export const HAND_SCHEMA = {
  type: 'OBJECT',
  properties: {
    has_header: { type: 'BOOLEAN' },
    header: {
      type: 'OBJECT',
      properties: {
        tieu_de: STR,
        hoc_ky: STR,
        khoa: STR,
        lop: STR,
        mon: STR,
        bai: STR,
        nganh: STR,
        thoi_gian: STR,
      },
      required: ['tieu_de', 'lop', 'mon', 'bai'],
      propertyOrdering: ['tieu_de', 'hoc_ky', 'khoa', 'lop', 'mon', 'bai', 'nganh', 'thoi_gian'],
    },
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tt: { type: 'INTEGER' },
          ma_hv: STR,
          ho_dem: STR,
          ten: STR,
          ngay_sinh: STR,
          diem_so: STR,
          diem_chu: STR,
          diem_chu_so: { type: 'NUMBER', nullable: true },
          vang: { type: 'BOOLEAN' },
          row_y: { type: 'INTEGER' },
        },
        required: ['tt', 'ma_hv', 'ho_dem', 'ten', 'ngay_sinh', 'diem_so', 'diem_chu', 'vang'],
        propertyOrdering: ['tt', 'ma_hv', 'ho_dem', 'ten', 'ngay_sinh', 'diem_so', 'diem_chu', 'diem_chu_so', 'vang', 'row_y'],
      },
    },
    footer: {
      type: 'OBJECT',
      properties: { so_bai_thi: STR, so_hoc_vien: STR },
    },
  },
  required: ['has_header', 'header', 'rows', 'footer'],
  propertyOrdering: ['has_header', 'header', 'rows', 'footer'],
}

// ─── Đọc lại có trọng tâm ───────────────────────────────────────────────────

/** spots: ["TT 3", "bảng 2 – TT 5", "phần đầu trang"…] */
export function focusPrompt(base, spots) {
  return `${base}

LƯU Ý ĐẶC BIỆT: Các lần đọc trước cho kết quả KHÁC NHAU ở: ${spots.join('; ')}.
Hãy phóng to và đọc lại thật chậm, từng ký tự một, ở những chỗ đó. Vẫn trả về toàn bộ trang.`
}
