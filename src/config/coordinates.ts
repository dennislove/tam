export interface Point {
  x: number;
  y: number;
  description?: string;
}

export interface ScreenSize {
  width: number;
  height: number;
}

// Độ phân giải màn hình chuẩn dọc 720x1280
export const STANDARD_WIDTH = 720;
export const STANDARD_HEIGHT = 1280;

/**
 * Danh sách package name của ứng dụng Thanh Niên Việt Nam
 * (Bao gồm com.vnpt.tnvn chính thức và alias vn.thanhnienvietnam)
 */
export const APP_PACKAGES = ['com.vnpt.tnvn', 'vn.thanhnienvietnam'];

/**
 * Hàm chuẩn hóa và co giãn tọa độ theo kích thước thực tế của màn hình thiết bị
 * @param point Tọa độ gốc trên màn hình chuẩn 720x1280
 * @param actualWidth Chiều rộng màn hình thực tế (pixel)
 * @param actualHeight Chiều cao màn hình thực tế (pixel)
 * @param jitter Độ lệch ngẫu nhiên pixel (+-jitter) để mô phỏng ngón tay người dùng (mặc định 2px)
 */
export function scaleCoordinate(
  point: Point,
  actualWidth: number,
  actualHeight: number,
  jitter: number = 2
): Point {
  const scaleX = actualWidth / STANDARD_WIDTH;
  const scaleY = actualHeight / STANDARD_HEIGHT;

  const baseX = point.x * scaleX;
  const baseY = point.y * scaleY;

  // Thêm độ lệch ngẫu nhiên nhỏ (human jitter)
  const deltaX = (Math.random() * 2 - 1) * jitter;
  const deltaY = (Math.random() * 2 - 1) * jitter;

  return {
    x: Math.round(baseX + deltaX),
    y: Math.round(baseY + deltaY),
    description: point.description,
  };
}

/**
 * Danh mục toàn bộ tọa độ nút bấm và input chuẩn hóa theo 720x1280
 */
export const COORDINATES = {
  // Bước 1: Màn hình Đăng nhập
  LOGIN: {
    // Ô nhập Email/Số điện thoại/CCCD (bounds chuẩn [40, 706][680, 756])
    USERNAME_INPUT: { x: 360, y: 731, description: 'Ô nhập Email/Số điện thoại/CCCD' },
    // Ô nhập Mật khẩu (bounds chuẩn [40, 848][680, 898])
    PASSWORD_INPUT: { x: 360, y: 873, description: 'Ô nhập Mật khẩu' },
    // Nút cam ĐĂNG NHẬP (bounds chuẩn [66, 1016][654, 1112])
    LOGIN_BUTTON: { x: 360, y: 1064, description: 'Nút cam ĐĂNG NHẬP' },
    // Nút CHO PHÉP gửi thông báo (bounds chuẩn [98, 662][622, 774])
    PERMISSION_ALLOW: { x: 360, y: 718, description: 'Nút CHO PHÉP thông báo' },
  },

  // Bước 2: Điều hướng đến cuộc thi
  NAVIGATION: {
    // Bottom Navigation Bar: Icon thứ 2 hình cặp sách "Công tác đoàn"
    BOTTOM_CONG_TAC_DOAN: { x: 216, y: 1210, description: 'Bottom Bar: Công tác đoàn' },
    // Màn hình Công tác đoàn: Ô thứ 2 "Học và thi" (tập tài liệu bút đỏ)
    HOC_VA_THI: { x: 511, y: 345, description: 'Mục Học và thi' },
    // Màn hình tiếp theo: Mục đầu tiên "Cuộc thi trực tuyến"
    CUOC_THI_TRUC_TUYEN_CARD: { x: 360, y: 230, description: 'Mục Cuộc thi trực tuyến' },
    // Tab "Đang diễn ra"
    TAB_DANG_DIEN_RA: { x: 140, y: 165, description: 'Tab Đang diễn ra' },
    // Banner cuộc thi đầu tiên (dùng làm fallback)
    EXAM_BANNER_FIRST: { x: 360, y: 460, description: 'Banner Cuộc thi đầu tiên' },
    // Banner cuộc thi Tuần 4 Huỳnh Thúc Kháng (sau khi cuộn xuống trang)
    EXAM_BANNER_TUAN_3: { x: 360, y: 500, description: 'Banner Tuần 4_Cuộc thi Huỳnh Thúc Kháng' },
    // Nút màu xanh lớn: "BẮT ĐẦU BÀI THI" hoặc "LÀM LẠI BÀI THI" (bounds [30, 830][690, 905] -> tâm x: 360, y: 868)
    BTN_LAM_BAI_THI: { x: 360, y: 868, description: 'Nút BẮT ĐẦU BÀI THI / LÀM LẠI BÀI THI' },
  },

  // Bước 3: Màn hình làm 20 câu trắc nghiệm
  EXAM: {
    // 4 lựa chọn đáp án A, B, C, D (tâm dòng đáp án chuẩn)
    OPTIONS: {
      A: { x: 200, y: 475, description: 'Đáp án A' },
      B: { x: 200, y: 545, description: 'Đáp án B' },
      C: { x: 200, y: 615, description: 'Đáp án C' },
      D: { x: 200, y: 685, description: 'Đáp án D' },
    },
    // Nút icon Mũi tên sang trái '<' ở góc dưới cùng bên trái (bounds [27, 1164][170, 1247])
    BTN_PREV_QUESTION: { x: 98, y: 1205, description: 'Nút mũi tên sang trái (<)' },
    // Nút "DANH SÁCH CÂU HỎI" ở giữa thanh đáy (bounds [187, 1164][533, 1247])
    BTN_DANH_SACH_CAU_HOI: { x: 360, y: 1205, description: 'Nút DANH SÁCH CÂU HỎI' },
    // Nút icon Mũi tên sang phải '>' ở góc dưới cùng bên phải để chuyển sang câu tiếp theo
    // Bounds [550, 1164][693, 1247] -> Tâm chuẩn (622, 1205)
    BTN_NEXT_QUESTION: { x: 622, y: 1205, description: 'Nút mũi tên sang phải (>)' },
    // Nút xanh "NỘP BÀI" ở góc trên bên phải (bên cạnh đồng hồ đếm ngược)
    // Bounds thực tế trên 720x1280: [437, 189][689, 281] -> Tâm chuẩn (563, 235)
    BTN_NOP_BAI: { x: 563, y: 235, description: 'Nút NỘP BÀI (góc trên phải)' },
    // Popup xác nhận nộp bài: Nút xanh "NỘP BÀI" bên phải (bounds [365, 768][587, 863] -> tâm x: 476, y: 815)
    POPUP_CONFIRM_DONG_Y: { x: 476, y: 815, description: 'Nút NỘP BÀI trên popup xác nhận (bên phải)' },
    // Popup xác nhận: Nút xám "QUAY LẠI" bên trái (bounds [133, 768][355, 863] -> tâm x: 211, y: 815)
    POPUP_QUAY_LAI: { x: 211, y: 815, description: 'Nút QUAY LẠI trên popup xác nhận (bên trái)' },
    // Popup thông báo nộp bài thành công: Nút xanh "XEM KẾT QUẢ" (bounds [129, 892][592, 987] -> tâm x: 361, y: 939)
    POPUP_XEM_KET_QUA: { x: 361, y: 939, description: 'Nút XEM KẾT QUẢ' },
  },
};
