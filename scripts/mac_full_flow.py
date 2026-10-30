#!/usr/bin/env python3
"""
Chuỗi hành động đầy đủ trên app Thanh niên Việt Nam (macOS):
  Mở app -> Công tác đoàn -> Học và thi -> Cuộc thi trực tuyến -> chọn banner
  -> BẮT ĐẦU / LÀM LẠI BÀI THI -> làm bài theo đáp án -> NỘP BÀI -> xác nhận.
Điều hướng dựa trên OCR (tìm chữ trên màn hình), fallback toạ độ đã học.
Usage: python3 scripts/mac_full_flow.py [banner_id]   (mặc định banner_2)
"""
import json, os, re, subprocess, sys, time, urllib.request

BANNER = sys.argv[1] if len(sys.argv) > 1 else 'banner_2'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANS_FILE = os.path.join(ROOT, 'data', f'answers_{BANNER}.json')
sys.argv = [sys.argv[0], ANS_FILE]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mac_exam_loop as m  # noqa: E402

# Từ khoá nhận diện tiêu đề banner trong danh sách "Đang diễn ra"
BANNER_KEYS = {
    'banner_1': ['NGHIEN CUU'],
    'banner_2': ['XIV'],
    'banner_3': ['DVTN'],
    'banner_4': ['HUU LAU'],
    'banner_6': ['CB', 'DOAN'],
}


def fetch_answers():
    try:
        with urllib.request.urlopen(f'http://localhost:3000/api/banners/{BANNER}/answers', timeout=8) as r:
            data = json.loads(r.read().decode())
        ans = data.get('answers', [])
        if ans:
            json.dump(ans, open(ANS_FILE, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            return ans
    except Exception as e:
        print('⚠️  Không gọi được API, dùng file local:', e)
    m.ANS_FILE = ANS_FILE
    return m.load_answers()


def screen(win, name='flow_cur.png'):
    m.activate(win); time.sleep(0.15)
    return m.ocr(m.capture(win, name))


def plain(s):
    import unicodedata
    s = unicodedata.normalize('NFD', s or '').replace('đ', 'd').replace('Đ', 'D')
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()


def find(lines, *keys, ymin=0.0, ymax=1.0):
    for l in lines:
        t = plain(l['t'])
        if ymin <= l['y'] <= ymax and all(plain(k) in t for k in keys):
            return l
    return None


def click_line(win, l, label):
    m.click(win, l['x'] + l['w'] / 2, l['y'] + l['h'] / 2, label)


def click_coord(win, key, label):
    return m.click_coord(win, key, label)


def locate_login_controls(win, lines=None):
    """
    Xác định chính xác toạ độ (rx, ry) của (ô Username, ô Password, nút ĐĂNG NHẬP)
    bằng OCR nút ĐĂNG NHẬP kết hợp quy đổi chiều cao cửa sổ thực tế.
    """
    m.refresh_window(win)
    if lines is None:
        lines = screen(win, 'flow_login.png')

    _, cal_h = m._cal_size()
    h = float(win.get('h') or cal_h)

    u_cfg = m.COORDS.get('login_username', {'rx': 0.50, 'ry': 0.58})
    p_cfg = m.COORDS.get('login_password', {'rx': 0.50, 'ry': 0.69})
    b_cfg = m.COORDS.get('login_button', {'rx': 0.50, 'ry': 0.88})

    u_rx = m.scale_rx(win, float(u_cfg.get('rx', 0.50)), 'center')
    p_rx = m.scale_rx(win, float(p_cfg.get('rx', 0.50)), 'center')
    b_rx = m.scale_rx(win, float(b_cfg.get('rx', 0.50)), 'center')

    u_px_cal = float(u_cfg.get('ry', 0.58)) * cal_h
    p_px_cal = float(p_cfg.get('ry', 0.69)) * cal_h
    b_px_cal = float(b_cfg.get('ry', 0.88)) * cal_h

    btn_candidates = []
    for l in lines:
        clean_t = re.sub(r'[^A-Z ]', '', plain(l['t'])).strip()
        cx = l['x'] + l['w'] / 2.0
        if clean_t in ('DANG NHAP', 'DANGNHAP') and l['y'] > 0.52 and 0.25 <= cx <= 0.75:
            btn_candidates.append(l)

    if btn_candidates:
        btn_line = max(btn_candidates, key=lambda d: d['y'])
        b_rx = btn_line['x'] + btn_line['w'] / 2.0
        b_ry = btn_line['y'] + btn_line['h'] / 2.0
        btn_px = b_ry * h
        delta_btn = btn_px - b_px_cal
        if abs(delta_btn) <= 65.0:
            u_px = u_px_cal + delta_btn
            p_px = p_px_cal + delta_btn
        else:
            u_px = u_px_cal
            p_px = p_px_cal
        u_ry = max(0.05, min(0.95, u_px / h))
        p_ry = max(0.05, min(0.95, p_px / h))
        return (u_rx, u_ry), (p_rx, p_ry), (b_rx, b_ry)

    return (
        (u_rx, m.scale_ry(win, float(u_cfg.get('ry', 0.58)), 'top')),
        (p_rx, m.scale_ry(win, float(p_cfg.get('ry', 0.69)), 'top')),
        (b_rx, m.scale_ry(win, float(b_cfg.get('ry', 0.88)), 'top')),
    )


def is_exam(lines):
    qnum, _, opts = m.parse_screen(lines)
    return qnum is not None and find(lines, 'NỘP') is not None and len(opts) >= 2


EXAM_START_MAX_WAIT = 60.0


def wait_contest_list_loaded(win, max_wait=90.0):
    """Chờ tối đa max_wait giây để 'Cuộc thi trực tuyến' tải xong; nếu xong sớm trả về ngay."""
    t0 = time.monotonic()
    time.sleep(0.30)
    while True:
        m.check_emergency_stop()
        lines = screen(win)
        elapsed = time.monotonic() - t0
        if (
            not (find(lines, 'Bảng xếp hạng') and find(lines, 'Chứng chỉ'))
            and (find(lines, 'Đang diễn ra') or find(lines, 'Sắp diễn ra') or find(lines, 'Đã kết thúc'))
        ):
            print(f'⚡ Danh sách "Cuộc thi trực tuyến" đã tải xong sau {elapsed:.1f}s -> Thi ngay!')
            return True, lines
        remain = max_wait - (time.monotonic() - t0)
        if remain <= 0:
            print(f'⏰ Đã chờ tối đa {max_wait:g}s cho "Cuộc thi trực tuyến".')
            return False, lines
        time.sleep(min(0.35, remain))


def wait_exam_start_loaded(win, max_wait=EXAM_START_MAX_WAIT):
    """
    Chờ thông minh sau khi click 'BẮT ĐẦU BÀI THI' / 'LÀM LẠI' (tối đa max_wait giây - mặc định 60s / 1 phút):
    - Nếu đề thi tải xong sớm -> trả về (True, lines) ngay lập tức để làm bài luôn ("xong sớm thi sớm").
    - Nếu hệ thống quá tải/chậm -> kiên nhẫn chờ đủ max_wait giây, không vội click thao tác khác.
    - Tự động click popup xác nhận nếu có.
    """
    t0 = time.monotonic()
    last_log_t = 0.0
    handled_popup = False

    print(f'⏳ Đã ấn thi -> Chờ tải vào bài thi (tối đa {max_wait:g}s / 1 phút do hệ thống quá tải, xong sớm thi sớm)...', flush=True)
    time.sleep(0.35)

    while True:
        m.check_emergency_stop()
        lines = screen(win)
        elapsed = time.monotonic() - t0

        if is_exam(lines):
            print(f'⚡ Đã vào màn hình làm bài sau {elapsed:.1f}s -> Bắt đầu làm bài ngay!', flush=True)
            return True, lines

        if not handled_popup and elapsed < 15.0:
            p = find(lines, 'ĐỒNG Ý') or find(lines, 'XÁC NHẬN') or find(lines, 'TIẾP TỤC')
            if p:
                print(f'📋 Popup xác nhận: "{p["t"]}" -> Click xác nhận', flush=True)
                click_line(win, p, p['t'])
                handled_popup = True
                time.sleep(0.40)
                continue

        if find(lines, 'Lỗi hệ thống') or find(lines, 'Vui lòng thử lại') or find(lines, 'Hệ thống đang bận'):
            print(f'⚠️ Phát hiện lỗi hệ thống sau {elapsed:.1f}s.', flush=True)
            return False, lines

        remain = max_wait - (time.monotonic() - t0)
        if remain <= 0:
            print(f'⏰ Đã chờ đủ {max_wait:g}s (1 phút) sau khi ấn thi nhưng chưa vào được bài thi.', flush=True)
            return False, lines

        if elapsed - last_log_t >= 2.0:
            print(f'   ⏳ Đang chờ hệ thống mở bài thi... ({elapsed:.1f}s/{max_wait:g}s)', flush=True)
            last_log_t = elapsed

        time.sleep(min(0.35, remain))


def main():
    answers = fetch_answers()
    print(f'📚 {BANNER}: nạp {len(answers)} câu đáp án')
    print('⚠️  Tool sẽ điều khiển chuột thật — đừng chạm chuột cho tới khi xong!')
    win = m.window()
    m.activate(win); time.sleep(0.6)
    clicked_banner = False
    cached_lines = None

    for step in range(25):
        if cached_lines is not None:
            lines = cached_lines
            cached_lines = None
        else:
            lines = screen(win)
        if is_exam(lines):
            print('📝 Đang ở màn hình làm bài -> bắt đầu trả lời')
            m.run_exam(win, answers)
            return
        if find(lines, 'ĐĂNG NHẬP') and not find(lines, 'Công tác đoàn'):
            print('🔐 App đang ở màn đăng nhập — vui lòng đăng nhập tay rồi chạy lại.')
            m.capture(win, 'flow_login.png'); return

        l = find(lines, 'BẮT ĐẦU') or find(lines, 'LÀM LẠI') or find(lines, 'VÀO THI')
        if l:
            click_line(win, l, l['t'])
            loaded, next_lines = wait_exam_start_loaded(win, max_wait=EXAM_START_MAX_WAIT)
            if loaded:
                print('📝 Đã vào màn hình làm bài -> bắt đầu trả lời')
                m.run_exam(win, answers)
                return
            cached_lines = next_lines
            continue

        if find(lines, 'Đang diễn ra') or find(lines, 'Sắp diễn ra') or find(lines, 'Đã kết thúc'):
            if clicked_banner:
                print('⚠️  Đã click banner nhưng chưa vào chi tiết, thử toạ độ đã lưu')
                click_coord(win, BANNER, BANNER)
            else:
                keys = BANNER_KEYS.get(BANNER)
                l = find(lines, *keys, ymin=0.15) if keys else None
                if not l and BANNER == 'banner_1':
                    l = find(lines, 'XIII', ymin=0.15)
                if l:
                    click_line(win, l, f'{BANNER}: {l["t"][:40]}')
                else:
                    click_coord(win, BANNER, BANNER)
                clicked_banner = True
            time.sleep(1.5); continue

        l = find(lines, 'Cuộc thi trực tuyến', ymin=0.1)
        if l and find(lines, 'Bảng xếp hạng'):
            click_line(win, l, 'Cuộc thi trực tuyến')
            loaded, next_lines = wait_contest_list_loaded(win, max_wait=90.0)
            if loaded:
                cached_lines = next_lines
            continue

        # Đang ở màn hình tải danh sách 'Cuộc thi trực tuyến' (chưa hiện tab Đang diễn ra)
        if find(lines, 'Cuộc thi trực tuyến') and not find(lines, 'Bảng xếp hạng'):
            loaded, next_lines = wait_contest_list_loaded(win, max_wait=90.0)
            if loaded:
                cached_lines = next_lines
                continue

        l = find(lines, 'Học và thi')
        if l:
            click_line(win, l, 'Học và thi'); time.sleep(1.5); continue

        l = find(lines, 'Công tác đoàn', ymin=0.9)
        if l:
            click_line(win, l, 'Tab Công tác đoàn'); time.sleep(1.5); continue

        print('❓ Không nhận ra màn hình hiện tại, dừng lại. Ảnh:',
              m.capture(win, 'flow_unknown.png'))
        for x in lines[:30]:
            print(f'   {x["y"]:.3f} {x["t"]}')
        return
    print('⛔ Quá số bước điều hướng cho phép.')


if __name__ == '__main__':
    main()
