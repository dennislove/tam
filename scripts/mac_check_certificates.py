#!/usr/bin/env python3
"""
Kiểm tra và tổng hợp số lượng chứng chỉ hàng loạt trên app Thanh niên Việt Nam (macOS).
Quy trình:
  1. Đăng nhập từng tài khoản
  2. Vào trang chủ -> Bấm Tab "Công tác đoàn" -> Bấm "Học và thi"
  3. Tại menu con: Thay vì chọn "Cuộc thi trực tuyến", chọn "Chứng chỉ"
  4. OCR màn hình Chứng chỉ:
     - Lấy Họ và tên (Profile)
     - Nhận diện các khối màu vàng (mỗi khối là 1 CHỨNG NHẬN)
     - Trích xuất tên của từng chứng chỉ
     - Đếm tổng số lượng chứng chỉ
  5. Đăng xuất về màn hình đăng nhập
  6. Tự động lưu và cập nhật file tổng hợp:
     - logs/certificates_result.json
     - logs/certificates_summary.csv (UTF-8 BOM mở bằng Excel không lỗi font)

Usage:
  python3 scripts/mac_check_certificates.py [--start N] [--limit N] [--lot LOT_ID] [--recheck-empty] [--recheck-failed]
"""
import argparse, csv, datetime, json, os, subprocess, sys, time, urllib.request, unicodedata

_saved_argv = list(sys.argv)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import mac_exam_loop as m
import mac_full_flow as flow
sys.argv = _saved_argv

RESULT_JSON = os.path.join(ROOT, 'logs', 'certificates_result.json')
RESULT_CSV = os.path.join(ROOT, 'logs', 'certificates_summary.csv')
os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def emit_event(data):
    print('CERT_EVENT:' + json.dumps(data, ensure_ascii=False), flush=True)


def plain(s):
    s = unicodedata.normalize('NFD', s or '').replace('đ', 'd').replace('Đ', 'D')
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()


def fetch_accounts(lot_id=None):
    try:
        url = 'http://localhost:3000/api/accounts'
        if lot_id:
            import urllib.parse
            url += f'?lotId={urllib.parse.quote(str(lot_id))}'
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read().decode())
        accs = data if isinstance(data, list) else (data.get('accounts') or data.get('data') or [])
        if accs:
            return [a for a in accs if a.get('username') and a.get('password')]
    except Exception as e:
        print('⚠️  Không gọi được API accounts:', e, flush=True)

    local_path = os.path.join(ROOT, 'accounts.json')
    if os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            accs = data if isinstance(data, list) else (data.get('accounts') or [])
            return [a for a in accs if a.get('username') and a.get('password')]
        except Exception as e:
            print('⚠️  Lỗi đọc accounts.json:', e, flush=True)

    return []


def type_text(win, rx, ry, text):
    m.click(win, rx, ry, 'Click ô nhập liệu')
    time.sleep(0.12)
    p = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
    p.communicate((text or '').encode('utf-8'))
    time.sleep(0.05)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "a" using command down'])
    time.sleep(0.05)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "v" using command down'])
    time.sleep(0.12)


def click_back_button(win, label='Quay lại (<)'):
    m.click_header_back(win, label)


def do_login(win, username, password):
    """Đăng nhập và trả về (status, error_message).
    status: 'OK' | 'OVERLOAD' | 'FAIL'
    """
    print(f'   🔑 Đăng nhập: {username} ...', flush=True)
    m.activate(win)

    login_lines = None
    for _ in range(4):
        lines = flow.screen(win)
        if flow.find(lines, 'Đăng nhập') and not flow.find(lines, 'Công tác đoàn'):
            login_lines = lines
            break
        time.sleep(0.6)
    else:
        return 'OVERLOAD', 'Chưa sẵn sàng màn đăng nhập'

    (u_rx, u_ry), (p_rx, p_ry), (b_rx, b_ry) = flow.locate_login_controls(win, login_lines)
    type_text(win, u_rx, u_ry, username)
    type_text(win, p_rx, p_ry, password)

    max_login_retries = 2
    for retry in range(max_login_retries):
        if retry > 0:
            print(f'   ⏳ Thử lại đăng nhập lần {retry + 1} cho {username}...', flush=True)
            time.sleep(2.0)
            _, _, (b_rx, b_ry) = flow.locate_login_controls(win)

        m.click(win, b_rx, b_ry, 'Bấm ĐĂNG NHẬP')
        time.sleep(1.0)

        server_overloaded = False
        for _ in range(15):
            lines = flow.screen(win)

            # Thành công: vào được trang chủ
            if flow.find(lines, 'Công tác đoàn') or flow.find(lines, 'Bảng tin'):
                return 'OK', ''

            # Bắt toast lỗi ở đáy màn hình
            toast_err = next(
                (l['t'] for l in lines
                 if l['y'] > 0.82
                 and any(k in l['t'].lower() for k in ['504', 'lỗi', 'thử lại', 'chính xác', 'không đúng', 'tồn tại', 'thất bại'])
                 and 'bạn chưa có' not in l['t'].lower()),
                None
            )
            if toast_err:
                lower_t = toast_err.lower()
                if any(w in lower_t for w in ['chính xác', 'không đúng', 'sai', 'không tồn tại', 'chưa đăng ký']):
                    print(f'   ❌ [Sai thông tin] {toast_err}', flush=True)
                    return 'FAIL', f'Sai tài khoản hoặc mật khẩu ({toast_err.strip()})'

                server_overloaded = True
                print(f'   ⏳ [App quá tải] {toast_err}', flush=True)
                break

            # Popup lỗi
            err_ok = (flow.find(lines, 'ĐÓNG') or flow.find(lines, 'ĐỒNG Ý')
                      or flow.find(lines, 'XÁC NHẬN') or flow.find(lines, 'OK'))
            if err_ok:
                err_text = next(
                    (l['t'] for l in lines
                     if 0.28 < l['y'] < 0.78
                     and l['t'].strip() not in ('ĐÓNG', 'ĐỒNG Ý', 'XÁC NHẬN', 'OK', username, password)
                     and len(l['t'].strip()) > 3),
                    'Lỗi popup'
                )
                flow.click_line(win, err_ok, 'Đóng popup lỗi')
                time.sleep(0.5)
                lower_p = err_text.lower()
                if any(w in lower_p for w in ['chính xác', 'không đúng', 'sai', 'không tồn tại']):
                    print(f'   ❌ [Sai thông tin] {err_text}', flush=True)
                    return 'FAIL', f'Sai tài khoản hoặc mật khẩu ({err_text.strip()})'
                else:
                    server_overloaded = True
                    print(f'   ⏳ [App quá tải] {err_text}', flush=True)
                    break

            time.sleep(0.6)

        if not server_overloaded:
            return 'OVERLOAD', 'Server phản hồi quá lâu (>10s) do nghẽn mạng'

    return 'OVERLOAD', 'App quá tải / Mã 504 Gateway Timeout'


def navigate_to_certificates(win):
    """Điều hướng từ trang chủ vào màn hình Chứng chỉ."""
    print('   🧭 Điều hướng: Công tác đoàn -> Học và thi -> Chứng chỉ...', flush=True)

    for step in range(12):
        lines = flow.screen(win)

        # 1. Đã vào màn hình Chứng chỉ (có chữ Chứng chỉ ở header y < 0.12 và không có Bảng xếp hạng)
        header_cert = flow.find(lines, 'Chứng chỉ', ymax=0.12) or flow.find(lines, 'Chung chi', ymax=0.12)
        if header_cert and not flow.find(lines, 'Bảng xếp hạng'):
            print('   👉 Đã vào màn hình "Chứng chỉ"!', flush=True)
            return True

        # 2. Đang ở menu "Học và thi": Có 3 mục (Cuộc thi trực tuyến, Bảng xếp hạng, Chứng chỉ)
        # -> Thay vì chọn "Cuộc thi trực tuyến", click vào "Chứng chỉ" (card 3)
        if flow.find(lines, 'Bảng xếp hạng') and (flow.find(lines, 'Cuộc thi trực tuyến') or flow.find(lines, 'Chứng chỉ') or flow.find(lines, 'Chung chi')):
            l_cert = flow.find(lines, 'Chứng chỉ', ymin=0.15) or flow.find(lines, 'Chung chi', ymin=0.15)
            if l_cert:
                print('   📋 Menu Học và thi -> Click "Chứng chỉ"')
                flow.click_line(win, l_cert, 'Chứng chỉ (menu)')
            else:
                print('   📋 Menu Học và thi -> Click tọa độ card Chứng chỉ')
                m.click(win, 0.50, m.scale_ry(win, 0.33, 'top'), 'Card Chứng chỉ (fallback)')
            time.sleep(1.8)
            continue

        # 3. Đang ở trang Công tác đoàn -> Click "Học và thi"
        l_hvt = flow.find(lines, 'Học và thi') or flow.find(lines, 'Hoc va thi')
        if l_hvt:
            print('   📋 Click "Học và thi"')
            flow.click_line(win, l_hvt, 'Học và thi')
            time.sleep(1.2)
            continue

        # 4. Đang ở trang chủ -> Click Tab "Công tác đoàn"
        l_ctd = flow.find(lines, 'Công tác đoàn', ymin=0.88) or flow.find(lines, 'Cong tac doan', ymin=0.88)
        if l_ctd:
            print('   📋 Click Tab "Công tác đoàn"')
            flow.click_line(win, l_ctd, 'Tab Công tác đoàn')
            time.sleep(1.0)
            continue

        # Fallback click toạ độ tab Công tác đoàn
        print('   🔄 Fallback click tab Công tác đoàn...')
        m.click_coord(win, 'tab_cong_tac_doan', 'Tab Công tác đoàn')
        time.sleep(1.0)

    return False


def back_out_of_certificates(win):
    """Thoát khỏi màn hình Chứng chỉ (bấm nút Back < / ← hoặc Close x)."""
    lines = flow.screen(win)
    # Kiểm tra xem có đang ở màn Chứng chỉ không
    header_cert = flow.find(lines, 'Chứng chỉ', ymax=0.12) or flow.find(lines, 'Chung chi', ymax=0.12)
    if not header_cert or flow.find(lines, 'Bảng xếp hạng'):
        return

    # Thử tìm nút close ở góc trên phải (x > 0.85, y < 0.12)
    btn_close = next((l for l in lines if l['y'] < 0.12 and l['x'] > 0.85 and l['w'] < 0.15 and any(c in l['t'].lower() for c in ['x', '+', '×', '✕'])), None)
    if btn_close:
        flow.click_line(win, btn_close, 'Nút Đóng (x)')
        time.sleep(1.0)
        return

    # Bấm thẳng vào tâm nút Back góc trên trái của thanh header xanh
    m.click_header_back(win, 'Nút Back màn Chứng chỉ')
    time.sleep(1.0)


def is_system_notice(text):
    p = plain(text)
    return any(w in p for w in [
        'DANG XU LY', 'VUI LONG', 'QUAY LAI', 'TAI CHUNG CHI',
        'KHONG CO DU LIEU', 'CHUA CO DU LIEU', 'THU LAI SAU',
        'DANG TAI', 'LOADING'
    ])


def parse_certificates_screen(lines):
    """Trích xuất Họ tên và danh sách chứng chỉ từ kết quả OCR."""
    full_name = ''
    is_processing = False
    is_empty_data = False

    for l in lines:
        p = plain(l['t'])
        if 'DANG XU LY' in p or 'VUI LONG QUAY LAI' in p:
            is_processing = True
        if 'KHONG CO DU LIEU' in p or 'CHUA CO DU LIEU' in p:
            is_empty_data = True

        if 0.12 <= l['y'] <= 0.23 and l['x'] > 0.08:
            t_clean = l['t'].strip()
            p_clean = plain(t_clean)
            if 'CHUNG CHI' not in p_clean and 'THANH NIEN' not in p_clean and not is_system_notice(p_clean) and len(t_clean) > 2:
                full_name = t_clean

    # Tìm các Anchor "CHỨNG NHẬN" (mỗi khối vàng bắt đầu bằng CHỨNG NHẬN)
    anchors = []
    for idx, l in enumerate(lines):
        p = plain(l['t']).strip()
        if l['y'] > 0.20 and not is_system_notice(p):
            # Khối chứng nhận luôn có tiêu đề CHỨNG NHẬN
            if 'CHUNG NHAN' in p or p in ('CHUNG CHI', 'CHUNG CHI TRUC TUYEN'):
                anchors.append((idx, l))

    certs = []
    for i, (a_idx, a_line) in enumerate(anchors):
        next_y = anchors[i + 1][1]['y'] if i + 1 < len(anchors) else a_line['y'] + 0.16
        desc_lines = []
        for l in lines:
            if a_line['y'] + 0.010 <= l['y'] < next_y:
                t = l['t'].strip()
                if t not in ('>', '›', '<', '‹', '»', '«') and len(t) > 1 and not is_system_notice(t):
                    desc_lines.append(t)
        cert_title = ' '.join(desc_lines).strip()
        if not cert_title:
            cert_title = f'Chứng chỉ #{i + 1}'
        certs.append(cert_title)

    return full_name, certs, is_processing, is_empty_data


def wait_for_certificates_load(win, username, timeout_sec=5.0):
    """
    Đợi khoảng 5s trong màn hình Chứng chỉ để nội dung tải về.
    Nếu phát hiện có chứng chỉ thì hoàn thành ngay.
    Nếu phát hiện 'Hệ thống đang xử lý...', tiếp tục đợi để dữ liệu load.
    """
    start_time = time.time()
    best_name = ''
    best_certs = []

    while time.time() - start_time < timeout_sec:
        elapsed = round(time.time() - start_time, 1)
        shot_path = m.capture(win, f'cert_{username}.png')
        lines = m.ocr(shot_path)

        # Xử lý nếu có popup lỗi máy chủ (504, lỗi kết nối...)
        err_ok = (flow.find(lines, 'ĐÓNG') or flow.find(lines, 'ĐỒNG Ý')
                  or flow.find(lines, 'XÁC NHẬN') or flow.find(lines, 'OK'))
        if err_ok:
            print('   ⚠️ Phát hiện popup thông báo trong màn Chứng chỉ, bấm đóng...')
            flow.click_line(win, err_ok, 'Đóng popup thông báo')
            time.sleep(0.5)

        fn, certs, is_processing, is_empty = parse_certificates_screen(lines)
        if fn:
            best_name = fn
        if certs:
            best_certs = certs
            time.sleep(0.5)
            shot_path2 = m.capture(win, f'cert_{username}.png')
            lines2 = m.ocr(shot_path2)
            fn2, certs2, _, _ = parse_certificates_screen(lines2)
            if certs2 and len(certs2) >= len(best_certs):
                best_certs = certs2
            if fn2:
                best_name = fn2
            print(f'   ✨ Đã nhận diện được {len(best_certs)} chứng chỉ sau ~{elapsed}s!', flush=True)
            return best_name, best_certs, True

        if is_processing:
            print(f'   ⏳ Hệ thống đang xử lý chứng chỉ ({elapsed}s)... tiếp tục đợi...', flush=True)

        time.sleep(1.0)

    has_certs = len(best_certs) > 0
    return best_name, best_certs, has_certs


def inspect_certificates(win, username):
    """
    Quy trình kiểm tra chứng chỉ:
    1. Khi load vào mục Chứng chỉ, đợi lâu xíu khoảng 5s để nội dung tải về.
    2. Nếu không có phản hồi / chưa có chứng chỉ sau 5s -> Back ra ngoài menu và vào lại lần nữa.
    3. Đợi tiếp ~5s. Nếu vẫn không có phản hồi / chứng chỉ -> Thoát hẳn.
    """
    # Lần 1: Chờ tải khoảng 5s
    print('   ⏳ [Lần 1] Đợi tải mục Chứng chỉ (~5s)...', flush=True)
    full_name, certs, has_certs = wait_for_certificates_load(win, username, timeout_sec=5.0)

    if has_certs and len(certs) > 0:
        cert_count = len(certs)
        print(f'   🎖️ KẾT QUẢ (Lần 1): {cert_count} chứng chỉ | Họ tên: {full_name or "N/A"}', flush=True)
        for ci, ct in enumerate(certs, 1):
            print(f'      [{ci}] {ct}', flush=True)
        return full_name, cert_count, certs

    # Lần 1: Không có phản hồi chứng chỉ sau 5s -> Back ra menu và vào lại
    print('   ⚠️ [Lần 1] Không có phản hồi chứng chỉ sau 5s -> Back ra vào lại lần nữa...', flush=True)
    back_out_of_certificates(win)
    time.sleep(1.2)

    # Vào lại lần 2
    in_cert_again = navigate_to_certificates(win)
    if not in_cert_again:
        print('   ❌ Không thể vào lại màn Chứng chỉ lần 2 -> Thoát hẳn!', flush=True)
        back_out_of_certificates(win)
        return full_name, 0, []

    # Lần 2: Đợi tiếp khoảng 5s
    print('   ⏳ [Lần 2] Đợi tải mục Chứng chỉ lần 2 (~5s)...', flush=True)
    full_name2, certs2, has_certs2 = wait_for_certificates_load(win, username, timeout_sec=5.0)
    if full_name2:
        full_name = full_name2

    if has_certs2 and len(certs2) > 0:
        cert_count = len(certs2)
        print(f'   🎖️ KẾT QUẢ (Lần 2 thành công): {cert_count} chứng chỉ | Họ tên: {full_name or "N/A"}', flush=True)
        for ci, ct in enumerate(certs2, 1):
            print(f'      [{ci}] {ct}', flush=True)
        return full_name, cert_count, certs2

    # Sau lần 2 vẫn không có -> Thoát hẳn
    print('   🛑 [Lần 2] Vẫn không có phản hồi / không có chứng chỉ -> Thoát hẳn!', flush=True)
    back_out_of_certificates(win)
    time.sleep(0.5)
    return full_name, 0, []


BANNER_INFO_LIST = [
    {'id': 'banner_1', 'short': 'B1: ĐH Đoàn', 'name': 'Banner 1 (ĐH Đoàn)', 'keys': ['XIII', 'XII', 'DAI HOI DOAN', 'NGHIEN CUU', 'NGHI QUYET DOAN']},
    {'id': 'banner_2', 'short': 'B2: ĐH XIV', 'name': 'Banner 2 (ĐH XIV)', 'keys': ['XIV', 'DAI HOI XIV', 'NGHI QUYET XIV']},
    {'id': 'banner_3', 'short': 'B3: ĐVTN', 'name': 'Banner 3 (ĐVTN)', 'keys': ['DVTN', 'DVIN', 'HO CHI MINH', 'TU TUONG', 'PHONG CACH', 'DOAN VIEN THANH NIEN', 'DOAN VIEN', 'THANH NIEN VIET NAM']},
    {'id': 'banner_4', 'short': 'B4: Hữu Lầu', 'name': 'Banner 4 (Phạm Hữu Lầu)', 'keys': ['PHAM HUU LAU', 'HUU LAU', 'PHAM HƯU LAU']},
    {'id': 'banner_6', 'short': 'B6: CB Đoàn', 'name': 'Banner 6 (CB Đoàn)', 'keys': ['CB DOAN', 'CAN BO DOAN', 'CAN BO']},
]


def map_certificates_to_banners(cert_list):
    """
    Nhận diện danh sách chứng chỉ xem tài khoản đã hoàn thành những Banner nào.
    Trả về (completed_banner_ids, banner_status_dict).
    """
    completed_ids = set()
    for cert in cert_list:
        p = plain(cert)
        # 1. Banner 4: Phạm Hữu Lầu
        if any(k in p for k in ['PHAM HUU LAU', 'HUU LAU', 'PHAM HƯU LAU']):
            completed_ids.add('banner_4')
            continue
        # 2. Banner 6: CB Đoàn
        if any(k in p for k in ['CB DOAN', 'CAN BO DOAN', 'CAN BO']):
            completed_ids.add('banner_6')
            continue
        # 3. Banner 3: ĐVTN / Học tập Bác
        if any(k in p for k in ['DVTN', 'DVIN', 'HO CHI MINH', 'TU TUONG', 'PHONG CACH', 'DOAN VIEN THANH NIEN', 'DOAN VIEN', 'THANH NIEN']) and ('CB' not in p and 'CAN BO' not in p):
            completed_ids.add('banner_3')
            continue
        # 4. Banner 2: Đại hội Đảng XIV
        if any(k in p for k in ['XIV', 'DAI HOI XIV', 'NGHI QUYET XIV']):
            completed_ids.add('banner_2')
            continue
        # 5. Banner 1: Đại hội Đoàn / Nghiên cứu học tập
        if any(k in p for k in ['XIII', 'XII', 'DAI HOI DOAN', 'NGHIEN CUU', 'NGHI QUYET DOAN']):
            completed_ids.add('banner_1')
            continue

    banner_status = {
        'banner_1': 'banner_1' in completed_ids,
        'banner_2': 'banner_2' in completed_ids,
        'banner_3': 'banner_3' in completed_ids,
        'banner_4': 'banner_4' in completed_ids,
        'banner_6': 'banner_6' in completed_ids,
    }
    return sorted(list(completed_ids)), banner_status


def do_logout(win):
    """Đăng xuất nhanh về màn đăng nhập."""
    print('   🚪 Đăng xuất...', flush=True)
    for _ in range(6):
        lines = flow.screen(win)
        if flow.find(lines, 'Đăng nhập') and not flow.find(lines, 'Công tác đoàn'):
            return True

        # Nếu có nút Back (<) hoặc Close (x)
        close_btn = flow.find(lines, '<', ymax=0.12) or flow.find(lines, 'x', ymax=0.12) or flow.find(lines, '+', ymax=0.12)
        if close_btn and not flow.find(lines, 'Cá nhân'):
            click_back_button(win, 'Back (<)')
            time.sleep(0.6)
            continue

        # Tab Cá nhân
        cn = flow.find(lines, 'Cá nhân', ymin=0.88)
        if cn:
            flow.click_line(win, cn, 'Tab Cá nhân')
            time.sleep(0.7)
            lines2 = flow.screen(win)
            dx = flow.find(lines2, 'Đăng xuất')
            if dx:
                flow.click_line(win, dx, 'Nút Đăng xuất')
                time.sleep(1.0)
                return True

        # Fallback toạ độ Cá nhân
        m.click_coord(win, 'tab_ca_nhan', 'Tab Cá nhân (fallback)')
        time.sleep(0.6)
        lines3 = flow.screen(win)
        dx2 = flow.find(lines3, 'Đăng xuất')
        if dx2:
            flow.click_line(win, dx2, 'Nút Đăng xuất')
            time.sleep(1.0)
            return True

    return False


def load_existing_results():
    try:
        return json.load(open(RESULT_JSON, encoding='utf-8'))
    except Exception:
        return {}


def save_results(results):
    json.dump(results, open(RESULT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    # Cập nhật song song file CSV tổng hợp với UTF-8 BOM, bổ sung cột từng Banner
    try:
        with open(RESULT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                'STT', 'Tài Khoản', 'Mật Khẩu', 'Họ Và Tên', 'Số Chứng Chỉ',
                'Banner 1 (ĐH Đoàn)', 'Banner 2 (ĐH XIV)', 'Banner 3 (ĐVTN)', 'Banner 4 (Phạm Hữu Lầu)', 'Banner 6 (CB Đoàn)',
                'Các Banner Đã Thi', 'Danh Sách Chứng Chỉ', 'Lô', 'Trạng Thái', 'Chi Tiết Lỗi', 'Thời Gian Kiểm Tra'
            ])
            for u, item in sorted(results.items(), key=lambda x: x[1].get('index', 999999)):
                cert_str = ' ; '.join(item.get('certificates', []))
                b_status = item.get('bannerStatus')
                if not b_status:
                    _, b_status = map_certificates_to_banners(item.get('certificates', []))

                completed_banners = [k for k, v in b_status.items() if v]
                completed_str = ', '.join([b.upper().replace('_', ' ') for b in completed_banners]) if completed_banners else 'Chưa có'

                writer.writerow([
                    item.get('index', ''),
                    u,
                    item.get('password', ''),
                    item.get('fullName', ''),
                    item.get('certCount', 0),
                    'ĐÃ THI' if b_status.get('banner_1') else 'CHƯA THI',
                    'ĐÃ THI' if b_status.get('banner_2') else 'CHƯA THI',
                    'ĐÃ THI' if b_status.get('banner_3') else 'CHƯA THI',
                    'ĐÃ THI' if b_status.get('banner_4') else 'CHƯA THI',
                    'ĐÃ THI' if b_status.get('banner_6') else 'CHƯA THI',
                    completed_str,
                    cert_str,
                    item.get('lotId', ''),
                    item.get('status', ''),
                    item.get('error', ''),
                    item.get('checked_at', '')
                ])
    except Exception as e:
        print('⚠️  Lỗi ghi file CSV tổng hợp:', e, flush=True)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Kiểm tra và tổng hợp chứng chỉ hàng loạt TNVN')
    parser.add_argument('--start', type=int, default=1, help='Bắt đầu từ tài khoản thứ N (1-indexed)')
    parser.add_argument('--limit', type=int, default=None, help='Số tài khoản tối đa cần check')
    parser.add_argument('--lot', type=str, default=None, help='Chỉ check tài khoản trong lô cụ thể')
    parser.add_argument('--recheck-empty', action='store_true',
                        help='Chỉ check lại các tài khoản có 0 chứng chỉ hoặc lỗi')
    parser.add_argument('--recheck-failed', action='store_true',
                        help='Chỉ check lại các tài khoản bị lỗi đăng nhập')
    args = parser.parse_args()

    accounts = fetch_accounts(args.lot)
    if args.lot and not accounts:
        all_accs = fetch_accounts()
        accounts = [a for a in all_accs if a.get('lotId') == args.lot]
    print(f'📋 Tổng số tài khoản tìm thấy: {len(accounts)}', flush=True)
    if not accounts:
        print('❌ Không có tài khoản nào để kiểm tra.', flush=True)
        return

    start_pos = max(0, args.start - 1)
    run_list = accounts[start_pos:]
    if args.limit:
        run_list = run_list[:args.limit]

    existing = load_existing_results()
    if args.recheck_empty:
        run_list = [a for a in run_list
                    if existing.get(a['username'], {}).get('certCount', 0) == 0
                    or existing.get(a['username'], {}).get('status') in ('FAIL', 'OVERLOAD')]
        print(f'🔁 Recheck {len(run_list)} tài khoản chưa có chứng chỉ hoặc lỗi', flush=True)
    elif args.recheck_failed:
        run_list = [a for a in run_list
                    if existing.get(a['username'], {}).get('status') in ('FAIL', 'OVERLOAD')]
        print(f'🔁 Recheck {len(run_list)} tài khoản bị lỗi', flush=True)

    print(f'▶️  Sẽ kiểm tra {len(run_list)} tài khoản (bắt đầu từ #{args.start})', flush=True)
    print(f'📄 File JSON tổng hợp: {RESULT_JSON}', flush=True)
    print(f'📊 File CSV tổng hợp:  {RESULT_CSV}\n', flush=True)

    emit_event({
        'type': 'start',
        'total': len(run_list),
        'start': args.start,
        'lotId': args.lot or '',
    })

    m.open_or_restart_app()
    win = m.window()
    m.activate(win)
    time.sleep(1.0)

    checked_count = 0
    with_certs_count = 0
    no_certs_count = 0
    fail_count = 0
    total_certs_sum = 0

    for idx, acc in enumerate(run_list, 1):
        u = acc['username']
        actual_num = acc.get('index', start_pos + idx)
        lot_id = acc.get('lotId') or ''
        m.check_emergency_stop()
        print(f"\n[{idx}/{len(run_list)}] #{actual_num} | {u}", flush=True)

        emit_event({
            'type': 'account_start',
            'current': idx,
            'total': len(run_list),
            'index': actual_num,
            'username': u,
            'lotId': lot_id,
        })

        # Đảm bảo ở màn đăng nhập
        lines = flow.screen(win)
        if not (flow.find(lines, 'Đăng nhập') and not flow.find(lines, 'Công tác đoàn')):
            do_logout(win)

        login_status, err_msg = do_login(win, u, acc['password'])
        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        if login_status == 'OK':
            # Điều hướng vào "Chứng chỉ"
            in_cert = navigate_to_certificates(win)
            if in_cert:
                full_name, cert_count, certs = inspect_certificates(win, u)
                status = 'OK'
                err_msg = ''
                if cert_count > 0:
                    with_certs_count += 1
                    total_certs_sum += cert_count
                else:
                    no_certs_count += 1
            else:
                full_name = ''
                cert_count = 0
                certs = []
                status = 'FAIL'
                err_msg = 'Không thể điều hướng vào mục Chứng chỉ'
                fail_count += 1

            completed_banners, banner_status = map_certificates_to_banners(certs)
            existing[u] = {
                'status': status,
                'username': u,
                'password': acc.get('password', ''),
                'fullName': full_name,
                'certCount': cert_count,
                'certificates': certs,
                'completedBanners': completed_banners,
                'bannerStatus': banner_status,
                'error': err_msg,
                'checked_at': now,
                'index': actual_num,
                'lotId': lot_id,
            }

            emit_event({
                'type': 'account_done',
                'current': idx,
                'total': len(run_list),
                'index': actual_num,
                'username': u,
                'fullName': full_name,
                'certCount': cert_count,
                'certificates': certs,
                'completedBanners': completed_banners,
                'bannerStatus': banner_status,
                'status': status,
                'error': err_msg,
                'checked_at': now,
                'lotId': lot_id,
                'withCertsCount': with_certs_count,
                'noCertsCount': no_certs_count,
                'failCount': fail_count,
                'totalCertsCount': total_certs_sum,
            })

            # Thoát và Đăng xuất
            back_out_of_certificates(win)
            time.sleep(0.5)
            do_logout(win)

        else:
            # Đăng nhập thất bại (sai mật khẩu hoặc quá tải)
            fail_count += 1
            print(f'   ❌ Đăng nhập lỗi: {err_msg}', flush=True)
            existing[u] = {
                'status': login_status,
                'username': u,
                'password': acc.get('password', ''),
                'fullName': '',
                'certCount': 0,
                'certificates': [],
                'error': err_msg,
                'checked_at': now,
                'index': actual_num,
                'lotId': lot_id,
            }
            emit_event({
                'type': 'account_done',
                'current': idx,
                'total': len(run_list),
                'index': actual_num,
                'username': u,
                'fullName': '',
                'certCount': 0,
                'certificates': [],
                'status': login_status,
                'error': err_msg,
                'checked_at': now,
                'lotId': lot_id,
                'withCertsCount': with_certs_count,
                'noCertsCount': no_certs_count,
                'failCount': fail_count,
                'totalCertsCount': total_certs_sum,
            })

        checked_count += 1
        save_results(existing)
        time.sleep(0.4)

    # ─── Tổng kết ─────────────────────────────────────────────────────────────
    print(f"\n{'='*64}", flush=True)
    print(f"📊 KẾT QUẢ TỔNG HỢP CHỨNG CHỈ:", flush=True)
    print(f"   • Tổng tài khoản kiểm tra: {len(run_list)}", flush=True)
    print(f"   • Tài khoản có chứng chỉ:  {with_certs_count} (Tổng: {total_certs_sum} chứng chỉ)", flush=True)
    print(f"   • Chưa có chứng chỉ:       {no_certs_count}", flush=True)
    print(f"   • Lỗi đăng nhập:           {fail_count}", flush=True)
    print(f"📄 Kết quả lưu tại:", flush=True)
    print(f"   - File JSON: {RESULT_JSON}", flush=True)
    print(f"   - File CSV:  {RESULT_CSV}", flush=True)
    print(f"{'='*64}", flush=True)

    emit_event({
        'type': 'finish',
        'total': len(run_list),
        'withCertsCount': with_certs_count,
        'noCertsCount': no_certs_count,
        'failCount': fail_count,
        'totalCertsCount': total_certs_sum,
    })


if __name__ == '__main__':
    main()
