#!/usr/bin/env python3
"""
Kiểm tra hàng loạt tài khoản trên app Thanh niên Việt Nam (macOS).
  - Đăng nhập từng tài khoản
  - Nếu thành công -> đăng xuất, chuyển sang tài khoản tiếp theo
  - Nếu thất bại   -> ghi nhận lỗi, chuyển sang tài khoản tiếp theo
  - Kết quả được lưu vào logs/check_accounts_result.json

Usage:
  python3 scripts/mac_check_accounts.py [--start N] [--limit N] [--lot LOT_ID] [--recheck-failed]
"""
import argparse, json, os, subprocess, sys, time, urllib.request, datetime

_saved_argv = list(sys.argv)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import mac_exam_loop as m
import mac_full_flow as flow
sys.argv = _saved_argv

RESULT_FILE = os.path.join(ROOT, 'logs', 'check_accounts_result.json')
os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def emit_event(data):
    print('CHECK_EVENT:' + json.dumps(data, ensure_ascii=False), flush=True)


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
        print('⚠️  Không lấy được danh sách từ API:', e, flush=True)

    local_path = os.path.join(ROOT, 'accounts.json')
    if os.path.exists(local_path):
        try:
            with open(local_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            accs = data if isinstance(data, list) else (data.get('accounts') or [])
            print(f'📁 Đọc được {len(accs)} tài khoản từ accounts.json cục bộ', flush=True)
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
    print(f'   🔑 Đăng nhập: {username} ...')

    # Đảm bảo app ở phía trước
    m.activate(win)

    # Đảm bảo đang ở màn đăng nhập
    login_lines = None
    for _ in range(3):
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
            print(f'   ⏳ Thử lại đăng nhập lần {retry + 1} cho {username} do server nghẽn/504...')
            time.sleep(2.5)
            _, _, (b_rx, b_ry) = flow.locate_login_controls(win)

        m.click(win, b_rx, b_ry, 'Bấm ĐĂNG NHẬP')
        time.sleep(1.0)

        server_overloaded = False
        for attempt in range(15):
            lines = flow.screen(win)

            # Thành công: vào được trang chủ
            if flow.find(lines, 'Công tác đoàn') or flow.find(lines, 'Bảng tin'):
                return 'OK', ''

            # Bắt toast thông báo lỗi ở đáy màn hình
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
                    print(f'   ❌ [Sai thông tin] {toast_err}')
                    return 'FAIL', f'Sai tài khoản hoặc mật khẩu ({toast_err.strip()})'

                # 2. Ngược lại: "Có lỗi xảy ra", 504, thử lại -> do app/server quá tải
                server_overloaded = True
                print(f'   ⏳ [App quá tải] {toast_err}')
                break

            # Thất bại: xuất hiện popup lỗi (có nút ĐÓNG/ĐỒNG Ý/XÁC NHẬN)
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
                    print(f'   ❌ [Sai thông tin] {err_text}')
                    return 'FAIL', f'Sai tài khoản hoặc mật khẩu ({err_text.strip()})'
                else:
                    server_overloaded = True
                    print(f'   ⏳ [App quá tải] {err_text}')
                    break

            time.sleep(0.6)

        if not server_overloaded:
            return 'OVERLOAD', 'Server phản hồi quá lâu (>10s) do nghẽn mạng (Tài khoản chuẩn)'

    return 'OVERLOAD', 'App quá tải / Mã 504 Gateway Timeout (Tài khoản chuẩn)'


def do_logout(win):
    """Đăng xuất nhanh về màn đăng nhập."""
    print('   🚪 Đăng xuất...')
    for _ in range(6):
        lines = flow.screen(win)
        if flow.find(lines, 'Đăng nhập') and not flow.find(lines, 'Công tác đoàn'):
            return True
        # Back nếu có nút < (đang trong màn phụ)
        close_btn = flow.find(lines, '<', ymax=0.12) or flow.find(lines, 'x', ymax=0.12)
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
        # Fallback toạ độ
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
        return json.load(open(RESULT_FILE, encoding='utf-8'))
    except Exception:
        return {}


def save_results(results):
    json.dump(results, open(RESULT_FILE, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Kiểm tra hàng loạt tài khoản TNVN')
    parser.add_argument('--start', type=int, default=1, help='Bắt đầu từ tài khoản thứ N (1-indexed)')
    parser.add_argument('--limit', type=int, default=None, help='Số tài khoản tối đa cần check')
    parser.add_argument('--lot', type=str, default=None, help='Chỉ check tài khoản trong lô cụ thể')
    parser.add_argument('--recheck-failed', action='store_true',
                        help='Chỉ check lại các tài khoản đã FAIL trước đó')
    args = parser.parse_args()

    accounts = fetch_accounts(args.lot)
    if args.lot and not accounts:
        all_accs = fetch_accounts()
        accounts = [a for a in all_accs if a.get('lotId') == args.lot]
    print(f'📋 Tổng số tài khoản: {len(accounts)}', flush=True)
    if not accounts:
        print('❌ Không có tài khoản nào.', flush=True); return

    start_pos = max(0, args.start - 1)
    run_list = accounts[start_pos:]
    if args.limit:
        run_list = run_list[:args.limit]

    existing = load_existing_results()
    if args.recheck_failed:
        run_list = [a for a in run_list
                    if existing.get(a['username'], {}).get('status') == 'FAIL']
        print(f'🔁 Recheck {len(run_list)} tài khoản đã FAIL trước đó', flush=True)

    print(f'▶️  Sẽ check {len(run_list)} tài khoản (bắt đầu từ #{args.start})', flush=True)
    print(f'📄 Kết quả lưu tại: {RESULT_FILE}\n', flush=True)

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

    ok_list, fail_list = [], []

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
            print(f'   ✅ OK', flush=True)
            ok_list.append(u)
            existing[u] = {
                'status': 'OK',
                'checked_at': now,
                'index': actual_num,
                'lotId': lot_id,
                'password': acc.get('password', '')
            }
            emit_event({
                'type': 'account_done',
                'current': idx,
                'total': len(run_list),
                'index': actual_num,
                'username': u,
                'status': 'OK',
                'error': '',
                'checked_at': now,
                'lotId': lot_id,
                'okCount': len(ok_list),
                'failCount': len(fail_list),
            })
            do_logout(win)
        elif login_status == 'OVERLOAD':
            print(f'   ⏳ QUÁ TẢI (Tài khoản chuẩn): {err_msg}', flush=True)
            fail_list.append({'username': u, 'error': err_msg, 'index': actual_num, 'lotId': lot_id})
            existing[u] = {
                'status': 'OVERLOAD',
                'error': err_msg,
                'checked_at': now,
                'index': actual_num,
                'lotId': lot_id,
                'password': acc.get('password', '')
            }
            emit_event({
                'type': 'account_done',
                'current': idx,
                'total': len(run_list),
                'index': actual_num,
                'username': u,
                'status': 'OVERLOAD',
                'error': err_msg,
                'checked_at': now,
                'lotId': lot_id,
                'okCount': len(ok_list),
                'failCount': len(fail_list),
            })
        else:
            print(f'   ❌ SAI THÔNG TIN: {err_msg}', flush=True)
            fail_list.append({'username': u, 'error': err_msg, 'index': actual_num, 'lotId': lot_id})
            existing[u] = {
                'status': 'FAIL',
                'error': err_msg,
                'checked_at': now,
                'index': actual_num,
                'lotId': lot_id,
                'password': acc.get('password', '')
            }
            emit_event({
                'type': 'account_done',
                'current': idx,
                'total': len(run_list),
                'index': actual_num,
                'username': u,
                'status': 'FAIL',
                'error': err_msg,
                'checked_at': now,
                'lotId': lot_id,
                'okCount': len(ok_list),
                'failCount': len(fail_list),
            })

        # Lưu sau mỗi tài khoản để không mất dữ liệu nếu bị dừng giữa chừng
        save_results(existing)
        time.sleep(0.3)

    # ─── Tổng kết ─────────────────────────────────────────────────────────────
    print(f"\n{'='*58}", flush=True)
    print(f"📊 KẾT QUẢ: {len(ok_list)} OK  |  {len(fail_list)} FAIL  |  {len(run_list)} tổng", flush=True)
    print(f"{'='*58}", flush=True)

    emit_event({
        'type': 'finish',
        'total': len(run_list),
        'ok': len(ok_list),
        'fail': len(fail_list),
    })

    if fail_list:
        print(f'\n❌ Tài khoản THẤT BẠI ({len(fail_list)}):', flush=True)
        for f in fail_list:
            print(f'  #{f["index"]:>4} | {f["username"]:<30} | {f["error"]}', flush=True)

    print(f'\n✅ Tài khoản THÀNH CÔNG ({len(ok_list)}):', flush=True)
    for u in ok_list:
        info = existing.get(u, {})
        print(f'  #{info.get("index","?"):>4} | {u}', flush=True)

    print(f'\n📄 Kết quả đầy đủ: {RESULT_FILE}', flush=True)


if __name__ == '__main__':
    main()
