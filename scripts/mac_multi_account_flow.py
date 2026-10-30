#!/usr/bin/env python3
"""
Chuỗi hành động đa tài khoản trên app Thanh niên Việt Nam (macOS):
  Lặp từng tài khoản:
    1. Kiểm tra trạng thái: nếu chưa đăng nhập -> đăng nhập tài khoản
    2. Nếu đã đăng nhập tài khoản khác -> đăng xuất -> đăng nhập
    3. Điều hướng: Công tác đoàn -> Học và thi -> Cuộc thi trực tuyến -> chọn banner (mặc định banner_2)
    4. BẮT ĐẦU / LÀM LẠI BÀI THI -> làm bài siêu tốc (15-20s) -> NỘP BÀI -> Xác nhận
    5. Thoát ra màn hình chính -> Tab Cá nhân -> Đăng xuất
    6. Chuyển sang tài khoản tiếp theo
Usage:
  python3 scripts/mac_multi_account_flow.py [banner_id] [--limit N]
"""
import argparse, json, os, subprocess, sys, time, urllib.request, urllib.parse

_saved_argv = list(sys.argv)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import mac_exam_loop as m
import mac_full_flow as flow
sys.argv = _saved_argv

BANNER_KEYS = {
    'banner_1': ['NGHIEN CUU'],
    'banner_2': ['XIV'],
    'banner_3': ['DVTN'],          # Chuyên đề ĐĐ TT HCM - ĐVTN (dòng "2026_ĐVTN")
    'banner_4': ['HUU LAU'],       # Cuộc thi Phạm Hữu Lầu
    'banner_6': ['CB', 'DOAN'],    # Chuyên đề ĐĐ TT HCM - CB Đoàn (dòng "2026_CB Đoàn")
}


def fetch_accounts(lot_id=None):
    try:
        url = 'http://localhost:3000/api/accounts'
        if lot_id:
            url += f'?lotId={urllib.parse.quote(str(lot_id))}'
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read().decode())
        accs = data if isinstance(data, list) else (data.get('accounts') or data.get('data') or [])
        if accs:
            return [a for a in accs if a.get('username') and a.get('password')]
    except Exception as e:
        print('⚠️  Không lấy được danh sách từ API:', e)

    local_path = os.path.join(ROOT, 'accounts.json')
    if os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            accs = data if isinstance(data, list) else (data.get('accounts') or [])
            if lot_id:
                accs = [a for a in accs if str(a.get('lotId', '')) == str(lot_id)]
            return [a for a in accs if a.get('username') and a.get('password')]
        except Exception as e:
            print('⚠️  Lỗi đọc accounts.json fallback:', e)

    return []


def fetch_answers(banner_id):
    # Chuẩn hoá banner_id (nếu là đường dẫn file thì lấy tên file)
    bid = os.path.basename(banner_id).replace('.json', '').replace('answers_', '')
    ans_file = os.path.join(ROOT, 'data', f'answers_{bid}.json')
    try:
        with urllib.request.urlopen(f'http://localhost:3000/api/banners/{bid}/answers', timeout=8) as r:
            data = json.loads(r.read().decode())
        ans = data.get('answers', [])
        if ans:
            json.dump(ans, open(ans_file, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            m.ANS_FILE = ans_file
            return ans
    except Exception as e:
        print('⚠️  Không gọi được API đáp án:', e)
    m.ANS_FILE = ans_file
    return m.load_answers()


def type_text(win, rx, ry, text):
    m.click(win, rx, ry, 'Click ô nhập liệu')
    time.sleep(0.12)
    # Copy vào clipboard để paste, tránh bộ gõ tiếng Việt (Telex/VNI) làm lặp ký tự
    p = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
    p.communicate((text or '').encode('utf-8'))
    time.sleep(0.05)
    # Cmd + A -> Cmd + V
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "a" using command down'])
    time.sleep(0.05)
    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "v" using command down'])
    time.sleep(0.12)


def do_login(win, username, password):
    print(f'🔑 Đang đăng nhập: {username} ...')
    m.activate(win)
    login_lines = flow.screen(win, 'flow_login.png')
    (u_rx, u_ry), (p_rx, p_ry), (b_rx, b_ry) = flow.locate_login_controls(win, login_lines)
    type_text(win, u_rx, u_ry, username)
    type_text(win, p_rx, p_ry, password)

    max_login_retries = 3
    for retry in range(max_login_retries):
        if retry > 0:
            print(f'   ⏳ [App quá tải / 504] Thử lại đăng nhập lần {retry + 1}/{max_login_retries} cho [{username}]...')
            time.sleep(3.0)
            _, _, (b_rx, b_ry) = flow.locate_login_controls(win)

        # Bấm nút ĐĂNG NHẬP (theo OCR + toạ độ chuẩn hoá theo chiều cao cửa sổ)
        m.click(win, b_rx, b_ry, 'Bấm ĐĂNG NHẬP')
        time.sleep(1.0)

        server_overloaded = False
        for attempt in range(15):
            lines = flow.screen(win)
            if flow.find(lines, 'Công tác đoàn') or flow.find(lines, 'Bảng tin'):
                print(f'✅ Đăng nhập thành công cho [{username}].')
                return True

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
                # 1. Nếu app báo sai mật khẩu / tài khoản không chính xác
                if any(w in lower_t for w in ['chính xác', 'không đúng', 'sai', 'không tồn tại', 'chưa đăng ký']):
                    print(f'❌ [Sai thông tin] App báo: {toast_err}')
                    return False

                # 2. Ngược lại: "Có lỗi xảy ra", 504, thử lại -> do app/server quá tải
                print(f'⚠️ [App quá tải/Mạng chậm] App báo: {toast_err}')
                server_overloaded = True
                break

            # Popup thông báo lỗi (có nút đóng)
            err_ok = flow.find(lines, 'ĐÓNG') or flow.find(lines, 'ĐỒNG Ý') or flow.find(lines, 'XÁC NHẬN') or flow.find(lines, 'OK')
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
                    print(f'❌ [Sai thông tin] Popup báo: {err_text}')
                    return False
                else:
                    print(f'⚠️ [App quá tải] Popup báo: {err_text}')
                    server_overloaded = True
                    break

            time.sleep(0.6)

        if not server_overloaded:
            break

    if server_overloaded:
        print(f'⏳ [Tạm dừng tài khoản] App VNPT đang bị quá tải/nghẽn mạng (code 504). Tài khoản [{username}] vẫn chuẩn, sẽ thi lại sau.')
    else:
        print(f'❌ Đăng nhập không thành công cho tài khoản [{username}].')
    return False


def click_back_button(win, label='Quay lại (<)'):
    # Toạ độ nút mũi tên quay lại (<) luôn cố định theo pixel từ đỉnh thanh header xanh
    m.click_header_back(win, label)


def do_logout(win):
    print('🚪 Đang thực hiện đăng xuất...')
    for _ in range(5):
        lines = flow.screen(win)
        # Nếu đã ở màn đăng nhập thì xong
        if flow.find(lines, 'Đăng nhập') and not flow.find(lines, 'Công tác đoàn'):
            return True
        # Nếu đang ở trong màn chi tiết hoặc xem kết quả có nút '<' hoặc 'x'
        close_btn = flow.find(lines, '<', ymax=0.12) or flow.find(lines, 'x', ymax=0.12)
        if close_btn and not flow.find(lines, 'Cá nhân'):
            click_back_button(win, 'Quay lại (<)')
            time.sleep(0.7)
            continue
        # Bấm tab Cá nhân (góc dưới phải)
        cn = flow.find(lines, 'Cá nhân', ymin=0.88)
        if cn:
            flow.click_line(win, cn, 'Tab Cá nhân')
            time.sleep(0.8)
            lines2 = flow.screen(win)
            dx = flow.find(lines2, 'Đăng xuất')
            if dx:
                flow.click_line(win, dx, 'Nút Đăng xuất')
                time.sleep(1.0)
                return True
        m.click_coord(win, 'tab_ca_nhan', 'Tab Cá nhân (fallback toạ độ)')
        time.sleep(0.7)
        lines3 = flow.screen(win)
        dx2 = flow.find(lines3, 'Đăng xuất')
        if dx2:
            flow.click_line(win, dx2, 'Nút Đăng xuất')
            time.sleep(1.0)
            return True
    return False


def is_contest_list_ready(lines):
    """Kiểm tra danh sách 'Cuộc thi trực tuyến' đã tải xong chưa (hiện tab Đang diễn ra / Sắp diễn ra / Đã kết thúc)."""
    if flow.find(lines, 'Bảng xếp hạng') and (flow.find(lines, 'Chứng chỉ') or flow.find(lines, 'Chung chi')):
        return False
    return bool(
        flow.find(lines, 'Đang diễn ra')
        or flow.find(lines, 'Sắp diễn ra')
        or flow.find(lines, 'Đã kết thúc')
    )


CONTEST_LIST_MAX_WAIT = 90.0
EXAM_START_MAX_WAIT = 60.0


def wait_for_exam_start(win, max_wait=EXAM_START_MAX_WAIT):
    """
    Chờ thông minh khi click "BẮT ĐẦU BÀI THI" / "LÀM LẠI" (tối đa max_wait giây - mặc định 60s / 1 phút do hệ thống quá tải):
    - Nếu đề thi tải xong sớm hơn -> trả về (True, lines) ngay lập tức để làm bài luôn ("xong sớm thi sớm").
    - Nếu hệ thống quá tải/chậm -> kiên nhẫn chờ đủ max_wait giây, KHÔNG back ra vội ("ko back ra vội như trước").
    - Tự động click popup xác nhận (ĐỒNG Ý / XÁC NHẬN / TIẾP TỤC) nếu xuất hiện.
    """
    t0 = time.monotonic()
    last_log_t = 0.0
    handled_popup = False

    print(f'⏳ Đã ấn thi -> Chờ tải vào bài thi (tối đa {max_wait:g}s / 1 phút do hệ thống quá tải, xong sớm thi sớm)...', flush=True)
    time.sleep(0.35)

    while True:
        m.check_emergency_stop()
        lines = flow.screen(win)
        elapsed = time.monotonic() - t0

        # 1. Đã vào màn hình làm bài -> Vào thi ngay lập tức!
        if flow.is_exam(lines):
            print(f'⚡ Đã vào màn hình làm bài sau {elapsed:.1f}s -> Bắt đầu làm bài ngay!', flush=True)
            return True, lines

        # 2. Xử lý popup xác nhận (nếu có): ĐỒNG Ý / XÁC NHẬN / TIẾP TỤC
        if not handled_popup and elapsed < 15.0:
            p = (
                flow.find(lines, 'ĐỒNG Ý')
                or flow.find(lines, 'XÁC NHẬN')
                or flow.find(lines, 'TIẾP TỤC')
            )
            if p:
                print(f'📋 Phát hiện popup xác nhận: "{p["t"]}" -> Click xác nhận', flush=True)
                flow.click_line(win, p, p['t'])
                handled_popup = True
                time.sleep(0.40)
                continue

        # 3. Phát hiện lỗi hệ thống / bận từ server
        if flow.find(lines, 'Lỗi hệ thống') or flow.find(lines, 'Vui lòng thử lại') or flow.find(lines, 'Hệ thống đang bận'):
            print(f'⚠️ Phát hiện thông báo lỗi app sau {elapsed:.1f}s.', flush=True)
            return False, lines

        # 4. Kiểm tra hết thời gian chờ (60s)
        remain = max_wait - (time.monotonic() - t0)
        if remain <= 0:
            print(f'⏰ Đã chờ đủ {max_wait:g}s (1 phút) sau khi ấn thi nhưng chưa vào được bài thi.', flush=True)
            return False, lines

        if elapsed - last_log_t >= 2.0:
            print(f'   ⏳ Đang chờ hệ thống mở bài thi... ({elapsed:.1f}s/{max_wait:g}s)', flush=True)
            last_log_t = elapsed

        time.sleep(min(0.35, remain))


def wait_for_contest_list(win, max_wait=CONTEST_LIST_MAX_WAIT):
    """
    Chờ thông minh khi click vào 'Cuộc thi trực tuyến' (tối đa max_wait giây - mặc định 90s / 1p30s):
    - Nếu danh sách cuộc thi tải xong sớm hơn -> trả về (True, lines) ngay lập tức để vào thi luôn.
    - Nếu mạng/app tải chậm -> kiên nhẫn chờ tối đa max_wait giây.
    """
    t0 = time.monotonic()
    last_log_t = 0.0
    retried_click = False

    print(f'⏳ Chờ tải "Cuộc thi trực tuyến" (tối đa {max_wait:g}s, tải xong sớm sẽ thi ngay)...', flush=True)
    time.sleep(0.30)

    while True:
        m.check_emergency_stop()
        lines = flow.screen(win)
        elapsed = time.monotonic() - t0

        # 1. Đã tải xong danh sách cuộc thi (hoặc đã thấy nút thi / màn làm bài) -> vào thi ngay!
        if is_contest_list_ready(lines) or flow.is_exam(lines) or flow.find(lines, 'BẮT ĐẦU') or flow.find(lines, 'LÀM LẠI'):
            print(f'⚡ Danh sách "Cuộc thi trực tuyến" đã tải xong sau {elapsed:.1f}s -> Vào thi ngay!', flush=True)
            return True, lines

        # 2. Phát hiện lỗi hệ thống -> thoát sớm để xử lý tải lại
        if flow.find(lines, 'Lỗi hệ thống') or flow.find(lines, 'Vui lòng thử lại'):
            print(f'⚠️ Phát hiện "Lỗi hệ thống" sau {elapsed:.1f}s.', flush=True)
            return False, lines

        # 3. Phòng trường hợp cú click đầu tiên chưa ăn (vẫn đứng ở menu có 'Bảng xếp hạng')
        if not retried_click and elapsed >= 1.2 and flow.find(lines, 'Bảng xếp hạng'):
            l_retry = flow.find(lines, 'Cuộc thi trực tuyến', ymin=0.10)
            if l_retry:
                print('   🔄 Menu chưa chuyển trang, click lại "Cuộc thi trực tuyến"...', flush=True)
                flow.click_line(win, l_retry, 'Cuộc thi trực tuyến (retry)')
                retried_click = True
                t0 = time.monotonic()
                last_log_t = 0.0
                time.sleep(0.30)
                continue

        # 4. Đã đạt ngưỡng chờ tối đa (90s)
        remain = max_wait - (time.monotonic() - t0)
        if remain <= 0:
            print(f'⏰ Đã chờ tối đa {max_wait:g}s cho "Cuộc thi trực tuyến".', flush=True)
            return False, lines

        if elapsed - last_log_t >= 2.0:
            print(f'   ⏳ Đang tải "Cuộc thi trực tuyến"... ({elapsed:.1f}s/{max_wait:g}s)', flush=True)
            last_log_t = elapsed

        time.sleep(min(0.35, remain))


def navigate_to_exam(win, banner_id, is_single=False):
    clicked_banner = False
    cached_lines = None

    for step in range(25):
        if cached_lines is not None:
            lines = cached_lines
            cached_lines = None
        else:
            lines = flow.screen(win)

        if flow.is_exam(lines):
            return True

        # 1. Phát hiện màn hình "Lỗi hệ thống. Vui lòng thử lại"
        if flow.find(lines, 'Lỗi hệ thống') or flow.find(lines, 'Vui lòng thử lại'):
            print('⚠️ Phát hiện "Lỗi hệ thống. Vui lòng thử lại" -> Bấm nút Back (<) để tải lại trang...')
            click_back_button(win, 'Back (<)')
            time.sleep(1.5)
            clicked_banner = False
            continue

        # 2. Phát hiện màn hình đang tải / kẹt trắng tại 'Cuộc thi trực tuyến' (chưa thấy tab 'Đang diễn ra', 'Sắp diễn ra')
        if flow.find(lines, 'Cuộc thi trực tuyến') and not is_contest_list_ready(lines) and not flow.find(lines, 'Bảng xếp hạng'):
            loaded, next_lines = wait_for_contest_list(win, max_wait=CONTEST_LIST_MAX_WAIT)
            if loaded or flow.find(next_lines, 'Lỗi hệ thống') or flow.find(next_lines, 'Vui lòng thử lại'):
                cached_lines = next_lines
            else:
                print(f'🔄 Kẹt loading quá {CONTEST_LIST_MAX_WAIT:g}s! Bấm nút Back (<) rồi vào lại để reload danh sách banner...', flush=True)
                click_back_button(win, 'Back (<)')
                time.sleep(1.2)
                clicked_banner = False
            continue

        # 3. Nút BẮT ĐẦU / LÀM LẠI / VÀO THI / THI LẠI BÀI THI
        l = (
            flow.find(lines, 'BẮT ĐẦU')
            or flow.find(lines, 'LÀM LẠI')
            or flow.find(lines, 'VÀO THI')
            or flow.find(lines, 'THI LẠI')
        )
        if l:
            flow.click_line(win, l, l['t'])
            loaded, exam_lines = wait_for_exam_start(win, max_wait=EXAM_START_MAX_WAIT)
            if loaded:
                return True
            cached_lines = exam_lines
            continue

        # 4. Màn hình menu con "Học và thi": có Bảng xếp hạng + (Chứng chỉ / Cuộc thi trực tuyến)
        # -> Cần click vào "Cuộc thi trực tuyến" trong danh sách để đi tiếp
        # (Đây KHÔNG phải màn chi tiết cuộc thi - phải xử lý trước is_detail_screen)
        if flow.find(lines, 'Bảng xếp hạng') and (
            flow.find(lines, 'Chứng chỉ') or flow.find(lines, 'Cuộc thi trực tuyến', ymin=0.10)
        ):
            l = flow.find(lines, 'Cuộc thi trực tuyến', ymin=0.10)
            if l:
                print('📋 Màn hình menu "Học và thi" -> Click "Cuộc thi trực tuyến"', flush=True)
                flow.click_line(win, l, 'Cuộc thi trực tuyến (menu)')
            else:
                print('📋 Màn hình menu "Học và thi" -> Click toạ độ "Cuộc thi trực tuyến"', flush=True)
                flow.click_coord(win, 'cuoc_thi_trc_tuyen', 'Cuộc thi trực tuyến (menu)')

            loaded, next_lines = wait_for_contest_list(win, max_wait=CONTEST_LIST_MAX_WAIT)
            if loaded or flow.find(next_lines, 'Lỗi hệ thống') or flow.find(next_lines, 'Vui lòng thử lại'):
                cached_lines = next_lines
            else:
                print(f'🔄 Đã chờ đủ {CONTEST_LIST_MAX_WAIT:g}s vẫn chưa tải xong -> Bấm nút Back (<) rồi vào lại...', flush=True)
                click_back_button(win, 'Back (<)')
                time.sleep(1.0)
                clicked_banner = False
            continue

        # 5. Đang ở màn hình chi tiết cuộc thi:
        is_detail_screen = (
            flow.find(lines, 'BÀI THI CỦA BẠN')
            or flow.find(lines, 'Thí sinh tham gia')
            or flow.find(lines, 'Lượt thi')
        )
        if is_detail_screen:
            # 5a. Có "BÀI THI CỦA BẠN" -> Tài khoản đã hoàn thành hết số lượt thi cho phép
            if flow.find(lines, 'BÀI THI CỦA BẠN'):
                print('⛔ Tài khoản đã thi hết lượt (có "BÀI THI CỦA BẠN") -> Back ra chuyển sang tài khoản/banner tiếp theo...')
                click_back_button(win, 'Back (<)')
                time.sleep(0.7)
                return False

            # 5b. Có "Thí sinh tham gia" / "Lượt thi" nhưng chưa thấy nút:
            # Có thể nút Bắt đầu đang vẽ trễ (do máy/mạng chậm), đợi 1.5s rồi quét lại để tránh back nhầm
            time.sleep(1.5)
            lines_retry = flow.screen(win)
            l_retry = (
                flow.find(lines_retry, 'BẮT ĐẦU')
                or flow.find(lines_retry, 'LÀM LẠI')
                or flow.find(lines_retry, 'VÀO THI')
                or flow.find(lines_retry, 'THI LẠI')
            )
            if l_retry:
                flow.click_line(win, l_retry, l_retry['t'])
                loaded, exam_lines = wait_for_exam_start(win, max_wait=EXAM_START_MAX_WAIT)
                if loaded:
                    return True
                cached_lines = exam_lines
                continue

            # Sau khi đợi vẫn không thấy nút thi
            print('⛔ Màn hình chi tiết cuộc thi không có nút "BẮT ĐẦU / LÀM LẠI BÀI THI"')
            print('   → Back ra và đăng xuất, chuyển sang tài khoản tiếp theo...')
            click_back_button(win, 'Back (<)')
            time.sleep(0.7)
            return False

        if is_contest_list_ready(lines):
            keys = BANNER_KEYS.get(banner_id)
            l = flow.find(lines, *keys, ymin=0.15) if keys else None
            if not l and banner_id == 'banner_1':
                l = flow.find(lines, 'XIII', ymin=0.15)
            if l:
                flow.click_line(win, l, f'{banner_id}: {l["t"][:35]}')
            else:
                flow.click_coord(win, banner_id, banner_id)
            clicked_banner = True
            time.sleep(1.0)
            continue

        l = flow.find(lines, 'Học và thi')
        if l:
            flow.click_line(win, l, 'Học và thi')
            time.sleep(0.55)
            continue

        l = flow.find(lines, 'Công tác đoàn', ymin=0.9)
        if l:
            flow.click_line(win, l, 'Tab Công tác đoàn')
            time.sleep(0.55)
            continue

        # Thử click nút back nếu đang kẹt ở màn khác (tuyệt đối KHÔNG back nếu đang ở màn chi tiết cuộc thi)
        if not is_detail_screen:
            bk = flow.find(lines, '<', ymax=0.1)
            if bk and not flow.find(lines, 'Cá nhân'):
                click_back_button(win, 'Back (<)')
                time.sleep(0.7)
                continue

        # Không nhận ra màn hình -> in debug để trace
        print(f'❓ [step {step}] Không nhận ra màn hình, các dòng OCR đầu:')
        for dbg in lines[:8]:
            print(f'   y={dbg["y"]:.2f} | {dbg["t"][:60]}')
        time.sleep(0.5)
    return False


def back_to_contest_list(win, is_single=False):
    """
    Sau khi thi xong 1 banner và đóng modal kết quả, quay lại màn hình danh sách cuộc thi
    ('Cuộc thi trực tuyến' - có tab 'Đang diễn ra' / 'Sắp diễn ra') để chọn banner tiếp theo.
    """
    print('🔙 Đang quay lại danh sách cuộc thi để chọn banner tiếp theo...', flush=True)
    for _ in range(6):
        lines = flow.screen(win)
        # 1. Đã ở màn hình danh sách cuộc thi (thấy 'Đang diễn ra' hoặc 'Sắp diễn ra' và không phải chi tiết)
        if is_contest_list_ready(lines) and not flow.find(lines, 'BÀI THI CỦA BẠN'):
            print('👉 Đã ở màn hình danh sách cuộc thi!', flush=True)
            return True

        # 2. Đang ở menu "Học và thi": Có Bảng xếp hạng + Cuộc thi / Chứng chỉ
        if flow.find(lines, 'Bảng xếp hạng') and (
            flow.find(lines, 'Chứng chỉ') or flow.find(lines, 'Cuộc thi trực tuyến', ymin=0.10)
        ):
            l = flow.find(lines, 'Cuộc thi trực tuyến', ymin=0.10)
            if l:
                print('📋 Menu Học và thi -> Click Cuộc thi trực tuyến', flush=True)
                flow.click_line(win, l, 'Cuộc thi trực tuyến')
            else:
                flow.click_coord(win, 'cuoc_thi_trc_tuyen', 'Cuộc thi trực tuyến')

            loaded, _ = wait_for_contest_list(win, max_wait=CONTEST_LIST_MAX_WAIT)
            if loaded:
                return True
            click_back_button(win, 'Back (<)')
            time.sleep(1.0)
            continue

        # 3. Đã ở trang 'Cuộc thi trực tuyến' nhưng đang tải danh sách (chưa hiện tab Đang diễn ra)
        if (
            flow.find(lines, 'Cuộc thi trực tuyến')
            and not is_contest_list_ready(lines)
            and not flow.find(lines, 'Bảng xếp hạng')
            and not flow.find(lines, 'BÀI THI CỦA BẠN')
            and not flow.find(lines, 'Thí sinh tham gia')
            and not flow.find(lines, 'Lượt thi')
            and not flow.find(lines, 'BẮT ĐẦU')
            and not flow.find(lines, 'LÀM LẠI')
        ):
            loaded, _ = wait_for_contest_list(win, max_wait=CONTEST_LIST_MAX_WAIT)
            if loaded:
                return True
            click_back_button(win, 'Back (<)')
            time.sleep(1.0)
            continue

        # 4. Đang ở màn hình chi tiết banner (thấy nút Back < ở header)
        bk = flow.find(lines, '<', ymax=0.12) or flow.find(lines, '←', ymax=0.12)
        if bk and not flow.find(lines, 'Cá nhân'):
            click_back_button(win, 'Back (<)')
            time.sleep(1.0)
            continue

        # Fallback click nút Back góc trên trái
        click_back_button(win, 'Back (<) fallback')
        time.sleep(1.0)

    return False


def run_account(win, acc, banner_ids, idx=None, is_single=False):
    if isinstance(banner_ids, str):
        banner_ids = [b.strip() for b in banner_ids.split(',') if b.strip()]

    u, p = acc['username'], acc['password']
    acc_idx = acc.get('index') or idx or '?'
    banner_summary = ', '.join(banner_ids)
    print(f"\n{'='*60}\n🚀 BẮT ĐẦU TÀI KHOẢN [#{acc_idx} - {u}] | THI {len(banner_ids)} BANNER: [{banner_summary}]\n{'='*60}", flush=True)

    lines = flow.screen(win)
    # Kiểm tra nếu chưa ở màn đăng nhập thì đăng xuất tài khoản cũ
    if not (flow.find(lines, 'Đăng nhập') and not flow.find(lines, 'Công tác đoàn')):
        do_logout(win)

    # Đăng nhập 1 lần duy nhất cho tài khoản này
    if not do_login(win, u, p):
        print(f'⏭️ Bỏ qua [{u}] do đăng nhập không thành công -> Next sang tài khoản tiếp theo.', flush=True)
        return False

    completed_banners = []
    skipped_banners = []

    for b_idx, b_id in enumerate(banner_ids, 1):
        print(f"\n--- 🎯 [{b_idx}/{len(banner_ids)}] Chuẩn bị thi {b_id} cho [{u}] ---", flush=True)
        answers = fetch_answers(b_id)
        if not answers:
            print(f'⚠️ Không có bộ đáp án cho {b_id}, bỏ qua.', flush=True)
            skipped_banners.append(b_id)
            continue

        # Vào thi
        print(f'🎯 Đang điều hướng vào {b_id}...', flush=True)
        if not navigate_to_exam(win, b_id, is_single=is_single):
            print(f'⚠️ Không vào được phòng thi {b_id} (hết lượt hoặc không có nút thi)', flush=True)
            skipped_banners.append(b_id)
            if b_idx < len(banner_ids):
                ready = back_to_contest_list(win, is_single=is_single)
                time.sleep(0.25 if ready else 1.0)
            continue

        # Làm bài siêu tốc
        print(f'⚡ Bắt đầu làm bài thi {b_id}...', flush=True)
        submitted = m.run_exam(win, answers)
        if not submitted:
            print(f'⚠️ [{u}] CHƯA xác nhận được NỘP BÀI trong modal cho {b_id}!', flush=True)
        time.sleep(0.8)

        # Đóng màn hình xem kết quả thi (nút X góc trên phải thanh header)
        m.click_header_close(win, 'Đóng kết quả thi')
        time.sleep(0.8)
        completed_banners.append(b_id)
        print(f'✅ Đã hoàn thành thi {b_id}!', flush=True)

        # Nếu còn banner tiếp theo: back ra ngoài danh sách cuộc thi
        if b_idx < len(banner_ids):
            print(f'🔙 Quay lại danh sách cuộc thi để thi tiếp banner tiếp theo...', flush=True)
            ready = back_to_contest_list(win, is_single=is_single)
            time.sleep(0.25 if ready else 1.2)

    # Đăng xuất sau khi hoàn thành tất cả banner
    do_logout(win)
    comp_str = ', '.join(completed_banners) if completed_banners else 'Không có'
    print(f"\n🎉 Hoàn thành tài khoản [{u}]! Đã thi xong: {len(completed_banners)}/{len(banner_ids)} banner ({comp_str})", flush=True)
    return len(completed_banners) > 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('banner', nargs='?', default='banner_2', help='ID banner (vd: banner_2)')
    parser.add_argument('--banners', type=str, default=None, help='Danh sách banner phân tách bằng dấu phẩy (vd: banner_1,banner_2,banner_3)')
    parser.add_argument('--limit', type=int, default=None, help='Số lượng tài khoản muốn chạy liên tiếp')
    parser.add_argument('--start', type=int, default=1, help='Bắt đầu từ tài khoản thứ N (1-indexed)')
    parser.add_argument('--lot', type=str, default=None, help='Chỉ chạy trong lô tài khoản cụ thể')
    parser.add_argument('--accounts-file', type=str, default=None, help='Đường dẫn file JSON chứa danh sách tài khoản đã chọn')
    parser.add_argument('--usernames', type=str, default=None, help='Danh sách username phân tách bằng dấu phẩy (vd: u1,u2,u3)')
    parser.add_argument('--single', action='store_true', help='Chế độ chạy đơn (chờ tải Cuộc thi trực tuyến tối đa 15s)')
    args = parser.parse_args()

    is_single = bool(args.single or args.limit == 1)

    # Xác định danh sách banners
    if args.banners:
        banner_ids = [b.strip() for b in args.banners.split(',') if b.strip()]
    elif args.banner and ',' in args.banner:
        banner_ids = [b.strip() for b in args.banner.split(',') if b.strip()]
    else:
        banner_ids = [os.path.basename(args.banner).replace('.json', '').replace('answers_', '')]

    # Pre-fetch answers cho các banner
    for bid in banner_ids:
        fetch_answers(bid)

    # Nạp toàn bộ tài khoản làm cơ sở tra cứu
    all_known_accounts = fetch_accounts()
    acc_map_by_user = {str(a.get('username', '')).strip().lower(): a for a in all_known_accounts}

    run_list = []
    selected_mode = False

    # 1. Ưu tiên đọc từ file danh sách tài khoản được chọn
    if args.accounts_file and os.path.exists(args.accounts_file):
        try:
            with open(args.accounts_file, 'r', encoding='utf-8') as f:
                raw_items = json.load(f)
            if isinstance(raw_items, dict):
                raw_items = raw_items.get('accounts') or raw_items.get('data') or []
            if isinstance(raw_items, list):
                for item in raw_items:
                    if isinstance(item, str):
                        u_key = item.strip().lower()
                        if u_key in acc_map_by_user:
                            run_list.append(acc_map_by_user[u_key])
                    elif isinstance(item, dict):
                        u = str(item.get('username', '')).strip()
                        u_key = u.lower()
                        if u_key in acc_map_by_user:
                            matched = dict(acc_map_by_user[u_key])
                            if item.get('password'):
                                matched['password'] = item['password']
                            if item.get('index'):
                                matched['index'] = item['index']
                            run_list.append(matched)
                        elif u and item.get('password'):
                            run_list.append(item)
                selected_mode = True
                print(f'📋 Nạp thành công {len(run_list)} tài khoản từ file: {args.accounts_file}', flush=True)
        except Exception as e:
            print(f'⚠️ Lỗi đọc accounts-file {args.accounts_file}:', e, flush=True)

    # 2. Hoặc đọc từ danh sách usernames phân tách bởi dấu phẩy
    elif args.usernames:
        u_list = [u.strip() for u in args.usernames.split(',') if u.strip()]
        for u in u_list:
            u_key = u.lower()
            if u_key in acc_map_by_user:
                run_list.append(acc_map_by_user[u_key])
            else:
                print(f'⚠️ Không tìm thấy tài khoản [{u}] trong hệ thống!', flush=True)
        selected_mode = True
        print(f'📋 Nạp thành công {len(run_list)} tài khoản từ tham số --usernames', flush=True)

    # 3. Chế độ thông thường (theo lô hoặc toàn bộ danh sách)
    if not selected_mode:
        accounts = fetch_accounts(args.lot)
        if args.lot and not accounts:
            accounts = [a for a in all_known_accounts if a.get('lotId') == args.lot]
        print(f'📋 Đã nạp {len(accounts)} tài khoản | Cần thi {len(banner_ids)} banner: {banner_ids}', flush=True)
        if not accounts:
            print('❌ Không có tài khoản nào.', flush=True)
            return

        # Tìm vị trí tài khoản có index hoặc STT trùng khớp với start được chọn trên giao diện
        start_pos = 0
        if args.start:
            target_str = str(args.start).strip()
            found = False
            # 1. Tìm theo trường index
            for i, acc in enumerate(accounts):
                if str(acc.get('index', '')).strip() == target_str:
                    start_pos = i
                    found = True
                    break
            # 2. Nếu không thấy, tìm theo số thứ tự (1-based)
            if not found and args.start <= len(accounts):
                start_pos = max(0, args.start - 1)

        run_list = accounts[start_pos:]
    else:
        print(f'🎯 [Chế độ chạy tài khoản đã chọn]: {len(run_list)} tài khoản | Cần thi {len(banner_ids)} banner: {banner_ids}', flush=True)

    if args.limit:
        run_list = run_list[:args.limit]

    if not run_list:
        print('❌ Không có tài khoản nào hợp lệ để chạy.', flush=True)
        return

    m.open_or_restart_app()
    win = m.window()
    m.activate(win)
    time.sleep(1.0)

    first_acc_name = run_list[0]['username'] if run_list else 'Chưa có'
    first_acc_idx = run_list[0].get('index', 1) if run_list else args.start
    print(f'▶️ Bắt đầu từ tài khoản #{first_acc_idx} [{first_acc_name}] (Còn {len(run_list)} tài khoản)...', flush=True)
    for idx, acc in enumerate(run_list, 1):
        actual_num = acc.get('index', idx)
        print(f"\n[Tiến trình {idx}/{len(run_list)} - Tài khoản #{actual_num}]", flush=True)
        run_account(win, acc, banner_ids, idx=actual_num, is_single=is_single)
        time.sleep(0.5)

    print(f"\n🎉 Đã hoàn thành toàn bộ {len(run_list)} tài khoản!", flush=True)


if __name__ == '__main__':
    main()
