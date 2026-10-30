#!/usr/bin/env python3
"""
Vòng lặp làm bài trên app TNVN (macOS native, Flutter).
- OCR câu hỏi + đáp án bằng Apple Vision (bin/mac_ocr)
- Đối chiếu với file đáp án JSON ([{question, options, answer}])
- Click đáp án -> bấm ">" -> nếu không sang câu mới được nữa thì bấm NỘP BÀI
Usage: python3 scripts/mac_exam_loop.py [answers.json]
"""
import json, os, re, subprocess, sys, time, difflib, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OCR_BIN = os.path.join(ROOT, 'bin', 'mac_ocr')
SHOTS = os.path.join(ROOT, 'logs', 'screenshots')
COORDS_FILE = os.path.join(ROOT, 'data', 'mac_coordinates.json')
COORDS = json.load(open(COORDS_FILE, encoding='utf-8'))
_COORDS_MTIME = os.path.getmtime(COORDS_FILE) if os.path.exists(COORDS_FILE) else 0.0
ANS_FILE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'answers.json')
os.makedirs(SHOTS, exist_ok=True)

# Kích thước cửa sổ chuẩn khi hiệu chỉnh toạ độ gốc (515x796)
CALIBRATED_W = 515.0
CALIBRATED_H = 796.0

_COORD_ANCHOR_Y = {
    'tab_cong_tac_doan': 'bottom',
    'tab_ca_nhan': 'bottom',
    'next_question': 'bottom',
    'confirm_nop': 'center',
}
_COORD_ANCHOR_X = {
    'back_arrow': 'left',
    'back_home': 'left',
    'answer_radio_x': 'left',
    'close_x': 'right',
    'nop_bai': 'right',
    'next_question': 'right',
}


def norm(s):
    s = unicodedata.normalize('NFC', s or '').lower()
    s = re.sub(r'^\s*(câu|cau)\s*\d+\s*[:.]\s*', '', s)
    s = re.sub(r'^[a-d]\s*[.)]\s+', '', s)
    return ' '.join(re.sub(r'[^\w\s]', ' ', s).split())


def sim(a, b):
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def load_answers():
    try:
        data = json.load(open(ANS_FILE, encoding='utf-8'))
        return data if isinstance(data, list) else data.get('answers', [])
    except Exception as e:
        print('⚠️  Không đọc được file đáp án:', e)
        return []


def open_or_restart_app():
    # Mở hoặc đưa app lên trước mặt
    print('📱 [Khởi động] Đang kích hoạt app "Thanh niên Việt Nam"...')
    subprocess.run(['open', '-a', '/Applications/Thanh niên Việt Nam.app'], capture_output=True)
    time.sleep(1.5)


def _reload_coords_if_changed():
    global COORDS, _COORDS_MTIME
    try:
        mt = os.path.getmtime(COORDS_FILE)
        if mt != _COORDS_MTIME:
            COORDS = json.load(open(COORDS_FILE, encoding='utf-8'))
            _COORDS_MTIME = mt
    except Exception:
        pass


def _cal_size():
    w = float(COORDS.get('calibrated_w') or CALIBRATED_W)
    h = float(COORDS.get('calibrated_h') or CALIBRATED_H)
    return w, h


def _query_tnvn_window():
    try:
        out = subprocess.run([os.path.join(ROOT, 'bin', 'mac_window_info')], capture_output=True, text=True, timeout=2.0).stdout
    except Exception:
        return None
    candidates = []
    for line in out.strip().split('\n'):
        p = line.split('\t')
        if len(p) >= 7:
            owner = unicodedata.normalize('NFC', p[2] or '').lower()
            if 'thanh' in owner or 'tnvn' in owner:
                try:
                    candidates.append(dict(
                        wid=int(p[0]),
                        pid=int(p[1]),
                        x=float(p[3]),
                        y=float(p[4]),
                        w=float(p[5]),
                        h=float(p[6]),
                    ))
                except ValueError:
                    pass
    if not candidates:
        return None
    return max(candidates, key=lambda c: c['w'] * c['h'])


def normalize_window_size(win):
    """Đưa cửa sổ TNVN về kích thước chuẩn đã hiệu chỉnh (515x796) và tránh bị che bởi thanh Dock."""
    if not isinstance(win, dict):
        return win
    cal_w, cal_h = _cal_size()
    tw, th = int(round(cal_w)), int(round(cal_h))
    cur_sz = (int(round(win['w'])), int(round(win['h'])))
    need_resize = abs(win['w'] - cal_w) > 3 or abs(win['h'] - cal_h) > 3
    need_move = win['y'] < 25 or (win['y'] + min(win['h'], cal_h)) > 990

    if not need_resize and not need_move:
        return win
    if win.get('_resize_tried') == cur_sz and not need_move:
        return win

    win['_resize_tried'] = cur_sz
    tx = max(0, int(round(win['x'])))
    ty = max(28, min(int(round(win['y'])), 990 - th))
    script_lines = [
        'tell application "System Events"',
        f'  tell (first process whose unix id is {win["pid"]})',
        '    if (count of windows) > 0 then',
    ]
    if need_move:
        script_lines.append(f'      set position of window 1 to {{{tx}, {ty}}}')
    if need_resize:
        script_lines.append(f'      set size of window 1 to {{{tw}, {th}}}')
    script_lines += [
        '    end if',
        '  end tell',
        'end tell',
    ]
    try:
        subprocess.run(['osascript', '-e', '\n'.join(script_lines)], capture_output=True, timeout=1.5)
        time.sleep(0.25)
    except Exception:
        pass

    fresh = _query_tnvn_window()
    if fresh:
        # Nếu hệ điều hành giữ nguyên chiều cao lớn (iPad wrapper) làm đáy cửa sổ chạm Dock -> đẩy cửa sổ lên trên Dock
        if fresh['y'] + fresh['h'] > 995:
            safe_y = max(25, int(990 - fresh['h']))
            try:
                subprocess.run([
                    'osascript', '-e',
                    f'tell application "System Events" to tell (first process whose unix id is {fresh["pid"]}) '
                    f'to set position of window 1 to {{{max(0, int(fresh["x"]))}, {safe_y}}}'
                ], capture_output=True, timeout=1.5)
                time.sleep(0.2)
                fresh = _query_tnvn_window() or fresh
            except Exception:
                pass

        old_w, old_h = int(round(win['w'])), int(round(win['h']))
        win.update(fresh)
        win['_resize_tried'] = (int(round(win['w'])), int(round(win['h'])))
        win['_ts'] = time.monotonic()
        nw, nh = int(round(win['w'])), int(round(win['h']))
        if (nw, nh) != (old_w, old_h):
            print(f'📐 [Chuẩn hoá cửa sổ] Đã đưa cửa sổ TNVN từ {old_w}x{old_h} về chuẩn {nw}x{nh} @ ({int(win["x"])},{int(win["y"])})')
        elif abs(win['h'] - cal_h) > 3:
            print(f'📐 [Cửa sổ TNVN] Kích thước hiện tại {nw}x{nh} @ ({int(win["x"])},{int(win["y"])}) -> Tự động co giãn toạ độ theo chiều cao thực tế')
    return win


def refresh_window(win, force=False):
    """Cập nhật toạ độ & kích thước thực tế của cửa sổ TNVN ngay trước khi chụp màn hình hoặc click."""
    if not isinstance(win, dict):
        return win
    _reload_coords_if_changed()
    now = time.monotonic()
    if not force and (now - win.get('_ts', 0.0)) < 0.15:
        return win
    fresh = _query_tnvn_window()
    if fresh:
        moved = abs(fresh['x'] - win.get('x', 0)) > 2 or abs(fresh['y'] - win.get('y', 0)) > 2
        resized = abs(fresh['w'] - win.get('w', 0)) > 2 or abs(fresh['h'] - win.get('h', 0)) > 2
        win.update(fresh)
        win['_ts'] = now
        if resized:
            normalize_window_size(win)
        elif moved:
            print(f'📍 [Cập nhật toạ độ] Cửa sổ TNVN di chuyển tới ({int(win["x"])},{int(win["y"])}) [{int(win["w"])}x{int(win["h"])}]')
    return win


def window():
    _reload_coords_if_changed()
    for retry in range(5):
        found = _query_tnvn_window()
        if found:
            found['_ts'] = time.monotonic()
            normalize_window_size(found)
            print(f'🪟 [Cửa sổ TNVN] Sẵn sàng: {int(found["w"])}x{int(found["h"])} @ ({int(found["x"])},{int(found["y"])})')
            return found
        open_or_restart_app()
        time.sleep(1.5)
    raise SystemExit('❌ Không tìm thấy cửa sổ Thanh niên Việt Nam sau khi đã mở app.')


def scale_rx(win, rx, anchor='center'):
    cal_w, _ = _cal_size()
    w = float(win.get('w') or cal_w)
    if w <= 0 or abs(w - cal_w) <= 2:
        return rx
    if anchor == 'left':
        return max(0.01, min(0.99, (rx * cal_w) / w))
    if anchor == 'right':
        return max(0.01, min(0.99, 1.0 - ((1.0 - rx) * cal_w) / w))
    if anchor == 'center':
        return max(0.01, min(0.99, 0.5 + ((rx - 0.5) * cal_w) / w))
    return rx


def scale_ry(win, ry, anchor='top'):
    """Quy đổi toạ độ ry (chuẩn hoá ở chiều cao 796) sang chiều cao thực tế hiện tại của cửa sổ."""
    _, cal_h = _cal_size()
    h = float(win.get('h') or cal_h)
    if h <= 0 or abs(h - cal_h) <= 2:
        return ry
    if anchor == 'top':
        return max(0.01, min(0.99, (ry * cal_h) / h))
    if anchor == 'bottom':
        return max(0.01, min(0.99, 1.0 - ((1.0 - ry) * cal_h) / h))
    if anchor == 'center':
        return max(0.01, min(0.99, 0.5 + ((ry - 0.5) * cal_h) / h))
    return ry


def get_coord(win, key, default_rx=0.5, default_ry=0.5, anchor_y=None, anchor_x=None):
    refresh_window(win)
    c = COORDS.get(key) if isinstance(COORDS.get(key), dict) else None
    rx = float(c.get('rx', default_rx)) if c else default_rx
    ry = float(c.get('ry', default_ry)) if c else default_ry
    ay_mode = anchor_y or _COORD_ANCHOR_Y.get(key, 'top')
    ax_mode = anchor_x or _COORD_ANCHOR_X.get(key, 'prop')
    return scale_rx(win, rx, ax_mode), scale_ry(win, ry, ay_mode)


def click_coord(win, key, label=''):
    if key not in COORDS or not isinstance(COORDS.get(key), dict):
        return False
    rx, ry = get_coord(win, key)
    click(win, rx, ry, label or key)
    return True


def click_header_back(win, label='Quay lại (<)'):
    """Click chính xác tâm nút mũi tên quay lại (←) trên thanh header xanh ở mọi chiều cao cửa sổ."""
    refresh_window(win)
    rx = scale_rx(win, 0.042, 'left')
    ry = scale_ry(win, 0.080, 'top')
    click(win, rx, ry, label)


def click_header_close(win, label='Đóng (✕)'):
    """Click chính xác tâm nút đóng (✕) góc trên phải thanh header xanh ở mọi chiều cao cửa sổ."""
    refresh_window(win)
    rx = scale_rx(win, 0.960, 'right')
    ry = scale_ry(win, 0.080, 'top')
    click(win, rx, ry, label)


def activate(win):
    refresh_window(win)
    subprocess.run(['osascript', '-e',
                    f'tell application "System Events" to set frontmost of (every process whose unix id is {win["pid"]}) to true'],
                   capture_output=True)


def check_emergency_stop():
    # 1. Dừng khẩn cấp bằng file cờ
    stop_file = os.path.join(ROOT, 'logs', 'STOP')
    if os.path.exists(stop_file):
        try: os.remove(stop_file)
        except Exception: pass
        print('\n🛑 [DỪNG KHẨN CẤP] Nhận được tín hiệu dừng từ file logs/STOP!')
        sys.exit(0)

    # 2. Dừng khẩn cấp bằng Fail-Safe (di chuột vào 1 trong 4 góc màn hình x < 20 & y < 20)
    try:
        out = subprocess.run(['cliclick', 'p'], capture_output=True, text=True, timeout=0.3).stdout.strip()
        mx, my = [int(v.strip()) for v in out.split(',')]
        if mx <= 20 and my <= 20:
            print('\n🛑 [DỪNG KHẨN CẤP] Phát hiện chuột ở góc trên bên trái màn hình (Fail-Safe)! Đã dừng tool.')
            sys.exit(0)
    except Exception:
        pass


def click(win, rx, ry, label=''):
    check_emergency_stop()
    refresh_window(win)
    ax, ay = round(win['x'] + rx * win['w']), round(win['y'] + ry * win['h'])
    print(f'   🖱  {label} rel({rx:.3f},{ry:.3f}) -> abs({ax},{ay})')
    subprocess.run(['cliclick', f'c:{ax},{ay}'])


def capture(win, name):
    refresh_window(win)
    path = os.path.join(SHOTS, name)
    subprocess.run(['screencapture', '-x', f'-R{int(win["x"])},{int(win["y"])},{int(win["w"])},{int(win["h"])}', path])
    return path


def ocr(path):
    out = subprocess.run([OCR_BIN, path], capture_output=True, text=True).stdout
    lines = []
    for l in out.strip().split('\n'):
        p = l.split('\t')
        if len(p) == 5:
            lines.append(dict(t=p[0], x=float(p[1]), y=float(p[2]), w=float(p[3]), h=float(p[4])))
    return sorted(lines, key=lambda d: d['y'])


def parse_screen(lines):
    """Trả về (số câu, text câu hỏi, [ {text, y} ...4 đáp án ])"""
    qi = next((i for i, l in enumerate(lines) if re.match(r'^\s*(c[âa]u|u)\s*\d+', l['t'], re.I) and l['y'] > 0.12), None)
    if qi is None:
        return None, '', []
    qnum = int(re.search(r'\d+', lines[qi]['t']).group())
    # câu hỏi có thể nhiều dòng; đáp án bắt đầu ở dòng thụt vào (x lớn hơn) hoặc sau khoảng trống
    body = [l for l in lines[qi:] if l['y'] < 0.94 and 'DANH S' not in l['t'].upper()]
    q_parts, rest = [body[0]], body[1:]
    while rest and rest[0]['x'] < body[0]['x'] + 0.02 and rest[0]['y'] - q_parts[-1]['y'] < 0.025:
        q_parts.append(rest.pop(0))
    qtext = ' '.join(p['t'] for p in q_parts)
    # gom đáp án: dòng cách nhau < ~1.5 lần chiều cao dòng -> cùng 1 đáp án
    opts = []
    for l in rest:
        if opts and l['y'] - opts[-1]['last_y'] < max(0.019, l['h'] * 1.35):
            opts[-1]['text'] += ' ' + l['t']
            opts[-1]['last_y'] = l['y']
        else:
            opts.append(dict(text=l['t'], y=l['y'] + l['h'] / 2, last_y=l['y']))
    return qnum, qtext, opts[:4]


def append_to_answers_file(item):
    if not ANS_FILE or not os.path.exists(ANS_FILE):
        return
    try:
        with open(ANS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list):
            # Kiểm tra xem câu hỏi đã tồn tại chưa để tránh trùng lặp
            clean_q = norm(item.get('question', ''))
            if not any(norm(a.get('question', '')) == clean_q for a in data):
                data.append(item)
                with open(ANS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def record_unmatched_question(qtext, opts, score, resolved_ai=None):
    try:
        path = os.path.join(ROOT, 'data', 'unmatched_questions.json')
        existing = []
        if os.path.exists(path):
            try:
                existing = json.load(open(path, encoding='utf-8'))
            except:
                existing = []
        clean_q = norm(qtext)
        found = next((item for item in existing if norm(item.get('question', '')) == clean_q), None)
        if found:
            if resolved_ai:
                found['resolved_by_ai'] = True
                found['ai_answer'] = resolved_ai
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
        else:
            new_item = {
                'question': qtext,
                'options': [o.get('text', '') for o in opts],
                'best_score': round(score, 2),
                'seen_at': time.strftime('%Y-%m-%d %H:%M:%S')
            }
            if resolved_ai:
                new_item['resolved_by_ai'] = True
                new_item['ai_answer'] = resolved_ai
            existing.append(new_item)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def choose(qtext, opts, answers):
    if not opts:
        return 0, 'không có lựa chọn'

    # 1. Thử so khớp với ngân hàng đáp án đã nạp
    best_score = 0.0
    best_item = None
    if answers:
        def opt_score(a):
            ao = a.get('options') or []
            if not ao:
                return 0.0
            return sum(max(sim(o['text'], x) for x in ao) for o in opts) / len(opts)

        scored = [(0.5 * sim(a.get('question', ''), qtext) + 0.5 * opt_score(a), a) for a in answers]
        best_score, best_item = max(scored, key=lambda t: t[0])

    if best_score >= 0.6 and best_item:
        ans = best_item.get('answer', '')
        if re.fullmatch(r'[A-Da-d]', ans.strip()):
            ans = (best_item.get('options') or ['', '', '', ''])['ABCD'.index(ans.strip().upper())]
        idx = max(range(len(opts)), key=lambda i: sim(opts[i]['text'], ans))
        return idx, f'khớp {best_score:.2f} -> "{ans[:50]}"'

    # 2. Ngân hàng câu hỏi trong banner không đủ / không khớp (< 0.6)
    # -> KHÔNG CLICK BỪA A! DÙNG GEMINI AI ĐỂ TRUY VẤN ĐÁP ÁN CHÍNH XÁC NHẤT
    print(f'   🔍 Bộ câu hỏi chưa khớp ({best_score:.2f} < 0.6) -> Đang gửi câu hỏi lên Gemini AI...')
    try:
        from gemini_solver import solve_with_gemini
        ai_idx, ai_reason = solve_with_gemini(qtext, opts)
        if ai_idx is not None and 0 <= ai_idx < len(opts):
            chosen_opt = opts[ai_idx].get('text', '')
            chosen_letter = 'ABCD'[ai_idx]
            # Tự động nạp vào bộ answers đang thi để các câu lặp lại giải ngay lập tức
            learned = {
                'question': qtext,
                'options': [o.get('text', '') for o in opts],
                'answer': chosen_opt,
                'source': 'gemini_ai'
            }
            if isinstance(answers, list):
                answers.append(learned)
            append_to_answers_file(learned)
            record_unmatched_question(qtext, opts, best_score, resolved_ai=f'{chosen_letter}: {chosen_opt[:60]}')
            return ai_idx, f'🤖 {ai_reason}'
        else:
            print(f'   ⚠️ AI chưa đưa ra đáp án: {ai_reason}')
    except Exception as e:
        print(f'   ⚠️ Lỗi kết nối Gemini AI: {e}')

    record_unmatched_question(qtext, opts, best_score)
    return 0, f'không khớp câu hỏi ({best_score:.2f}) & AI không khả dụng -> A'


def main():
    answers = load_answers()
    print(f'📚 Đã nạp {len(answers)} câu đáp án từ {ANS_FILE}')
    win = window()
    activate(win); time.sleep(0.4)
    run_exam(win, answers)


def _click_next_q(win, label='Next >'):
    rx, ry = get_coord(win, 'next_question', 0.934, 0.964, anchor_y='bottom', anchor_x='right')
    click(win, rx, ry, label)


def _click_prev_q(win, label='Back <'):
    refresh_window(win)
    rx = scale_rx(win, 0.065, 'left')
    ry = scale_ry(win, 0.964, 'bottom')
    click(win, rx, ry, label)


def _radio_rx(win):
    raw_rx = COORDS.get('answer_radio_x', {}).get('rx', 0.038)
    return scale_rx(win, raw_rx, 'left')


def run_exam(win, answers):
    nop = COORDS['nop_bai']
    last_q, stuck = None, 0
    answered_qnums = set()

    for step in range(250):
        activate(win)
        img = capture(win, 'exam_cur.png')
        qnum, qtext, opts = parse_screen(ocr(img))
        if qnum is None:
            print('⚠️  Không đọc được câu hỏi, thử lại...'); time.sleep(0.4); stuck += 1
            if stuck > 6: break
            continue

        if qnum == last_q:
            stuck += 1
            if stuck >= 5:
                print(f'⛔ Đã hết câu hỏi hoặc không sang được câu sau câu {qnum} sau {stuck} lần -> NỘP BÀI')
                break

            # CHỐNG NHẢY CÓC CÂU (ANTI DOUBLE-NEXT):
            # Lần 1 (stuck == 1): Tuyệt đối KHÔNG click Next lại ngay!
            # Vì Flutter trên macOS mất ~300-400ms để chạy animation chuyển câu.
            # Nếu click Next ngay lần 1 sẽ làm nhảy cóc bỏ qua luôn câu tiếp theo!
            if stuck == 1:
                time.sleep(0.35)
                continue

            # Chỉ khi stuck >= 2 (đã chờ hơn 0.7s mà câu hỏi thực sự chưa đổi), mới bấm Next lại
            print(f'🔄 Vẫn ở câu {qnum}, bấm Next lại (lần {stuck})...')
            _click_next_q(win, 'Next > (retry)')
            time.sleep(0.45 + stuck * 0.15)
            continue
        else:
            stuck = 0
            # PHÁT HIỆN BỊ NHẢY CÓC CÂU (VÍ DỤ TỪ CÂU 5 NHẢY THẲNG SANG CÂU 7):
            if last_q is not None and qnum > last_q + 1:
                skipped = list(range(last_q + 1, qnum))
                print(f'⚠️ [CẢNH BÁO] Phát hiện nhảy cóc từ câu {last_q} sang câu {qnum}! Bị sót câu: {skipped}')
                # Bấm Back (<) để lùi lại đúng câu bị sót
                for _ in range(len(skipped)):
                    _click_prev_q(win, 'Back < (lùi lại câu bị sót)')
                    time.sleep(0.40)
                continue

            idx, why = choose(qtext, opts, answers)
            print(f'❓ Câu {qnum}: {qtext[:80]}')
            for i, o in enumerate(opts):
                print(f'     {"ABCD"[i]}{"✅" if i == idx else " "} {o["text"][:70]}')
            print(f'   → {why}')
            if opts:
                click(win, _radio_rx(win), opts[idx]['y'], f'Đáp án {"ABCD"[idx]}')
                # Tăng thời gian chờ lên 0.20s để Flutter chắc chắn nhận diện và lưu trạng thái đáp án
                time.sleep(0.20)
                answered_qnums.add(qnum)
            last_q = qnum

        _click_next_q(win, 'Next >')
        # Tăng lên 0.38s để Flutter hoàn tất animation chuyển câu
        time.sleep(0.38)

    activate(win)

    # VÒNG LẶP NỘP BÀI KÈM CƠ CHẾ KIỂM TRA ĐỦ 100% CÂU (KHÔNG CHO PHÉP NỘP THIẾU)
    for submit_round in range(5):
        result = submit_exam(win, nop, allow_incomplete=(submit_round >= 4))
        if result == 'INCOMPLETE':
            print('🔄 [SỬA LỖI SÓT CÂU] Đang lùi lại kiểm tra và làm nốt câu chưa trả lời...')
            for _ in range(10):
                _click_prev_q(win, 'Back < (tìm câu chưa làm)')
                time.sleep(0.35)
                img = capture(win, 'exam_cur.png')
                qnum, qtext, opts = parse_screen(ocr(img))
                if qnum and qnum not in answered_qnums:
                    print(f'🎯 Đã quay về câu chưa làm: Câu {qnum}')
                    idx, why = choose(qtext, opts, answers)
                    if opts:
                        click(win, _radio_rx(win), opts[idx]['y'], f'Đáp án bổ sung {"ABCD"[idx]}')
                        time.sleep(0.25)
                        answered_qnums.add(qnum)
                    break
            # Tiến lại cuối bài để nộp
            for _ in range(12):
                _click_next_q(win, 'Next >')
                time.sleep(0.35)
            continue
        elif result is True:
            return True
        else:
            time.sleep(1.0)

    return False


def _plain(s):
    s = unicodedata.normalize('NFD', s or '').replace('đ', 'd').replace('Đ', 'D')
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()


def submit_exam(win, nop, allow_incomplete=False):
    """Bấm NỘP BÀI phía trên -> BẮT BUỘC bấm NỘP BÀI trong modal "XÁC NHẬN NỘP BÀI".
    Chỉ trả về True khi đã bấm nút trong modal và modal đã đóng (bài thi được tính)."""
    confirmed = False   # đã bấm NỘP BÀI trong modal ít nhất 1 lần
    waits_after_confirm = 0
    for attempt in range(12):
        lines = ocr(capture(win, 'exam_cf_ocr.png'))
        P = [(_plain(l['t']), l) for l in lines]

        # Popup "Nộp bài thành công" + nút "XEM KẾT QUẢ" -> đã hoàn thành
        xem_kq = next((l for t, l in P if 'XEM KET QUA' in t), None)
        if xem_kq or any('NOP BAI THANH CONG' in t for t, _ in P):
            print('🎉 Nộp bài thành công (thấy "XEM KẾT QUẢ") -> bài thi đã được tính!')
            if xem_kq:
                click(win, xem_kq['x'] + xem_kq['w'] / 2, xem_kq['y'] + xem_kq['h'] / 2, 'XEM KẾT QUẢ')
                time.sleep(0.8)
            print('📷 Màn hình kết quả:', capture(win, 'exam_result.png'))
            return True

        modal_title = next((l for t, l in P if 'XAC NHAN NOP' in t or 'MUON NOP BAI' in t or 'BAN MOI HOAN THANH' in t), None)
        has_back_btn = any(t.strip() == 'QUAY LAI' for t, _ in P)
        modal_open = modal_title is not None or has_back_btn

        if modal_open:
            min_y = (modal_title['y'] + 0.02) if modal_title else 0.3
            full_modal_text = ' '.join(t for t, _ in P)

            # KIỂM TRA SÓT CÂU: nếu modal báo "BẠN MỚI HOÀN THÀNH X/Y CÂU HỎI"
            m_ht = re.search(r'HOAN THANH\s*(\d+)\s*/\s*(\d+)', full_modal_text)
            if m_ht and not allow_incomplete:
                done_cnt, total_cnt = int(m_ht.group(1)), int(m_ht.group(2))
                if done_cnt < total_cnt:
                    print(f'⚠️ [CHƯA LÀM HẾT] Modal cảnh báo: Mới hoàn thành {done_cnt}/{total_cnt} câu!')
                    btn_quaylai = next((l for t, l in P if 'QUAY LAI' in t and l['y'] > min_y), None)
                    if btn_quaylai:
                        click(win, btn_quaylai['x'] + btn_quaylai['w'] / 2, btn_quaylai['y'] + btn_quaylai['h'] / 2, 'QUAY LẠI')
                    else:
                        click(win, scale_rx(win, 0.30, 'center'), scale_ry(win, 0.60, 'center'), 'QUAY LẠI (toạ độ)')
                    time.sleep(0.8)
                    return 'INCOMPLETE'

            # Nút NỘP BÀI trong modal: nằm dưới tiêu đề modal, nửa bên phải, không phải dòng tiêu đề
            btn = next((l for t, l in P
                        if 'NOP BAI' in t and 'XAC NHAN' not in t and l['y'] > min_y and l['x'] + l['w'] / 2 > 0.5), None)
            if btn:
                click(win, btn['x'] + btn['w'] / 2, btn['y'] + btn['h'] / 2, f'✅ Modal: NỘP BÀI (lần {attempt+1})')
            else:
                cf_rx, cf_ry = get_coord(win, 'confirm_nop', 0.705, 0.599, anchor_y='center', anchor_x='center')
                click(win, cf_rx, cf_ry, f'✅ Modal: NỘP BÀI - toạ độ (lần {attempt+1})')
            confirmed = True
            time.sleep(1.2)
            continue

        # Không có modal: còn ở màn làm bài (nút NỘP BÀI phía trên) -> bấm lại để mở modal
        top_nop = next((l for t, l in P if 'NOP BAI' in t and l['y'] < 0.22), None)
        if top_nop:
            if confirmed and waits_after_confirm < 2:
                # Vừa bấm NỘP BÀI trong modal, app có thể đang xử lý -> chờ thêm, tránh nộp 2 lần
                waits_after_confirm += 1
                print('⏳ Đã bấm xác nhận, chờ app xử lý nộp bài...')
                time.sleep(0.8)
                continue
            print(f'📝 Chưa thấy modal xác nhận -> bấm NỘP BÀI phía trên (lần {attempt+1})')
            click(win, top_nop['x'] + top_nop['w'] / 2, top_nop['y'] + top_nop['h'] / 2, 'NỘP BÀI (trên)')
            time.sleep(1.0)
            continue

        # Không còn modal, không còn màn làm bài
        if confirmed:
            print('🎉 Đã bấm NỘP BÀI trong modal xác nhận -> bài thi đã được nộp!')
            print('📷 Màn hình kết quả:', capture(win, 'exam_result.png'))
            return True

        # Chưa từng thấy modal & không thấy nút -> có thể đang tải, bấm toạ độ NỘP BÀI phía trên
        if attempt in (2, 5):
            nop_rx, nop_ry = get_coord(win, 'nop_bai', nop['rx'], nop['ry'], anchor_y='top', anchor_x='right')
            click(win, nop_rx, nop_ry, 'NỘP BÀI (trên - toạ độ)')
            time.sleep(1.0)
        else:
            time.sleep(0.6)

    print('❌ KHÔNG xác nhận được NỘP BÀI trong modal -> bài thi có thể CHƯA được tính!')
    print('📷 Ảnh lỗi:', capture(win, 'exam_submit_fail.png'))
    return False


if __name__ == '__main__':
    main()
