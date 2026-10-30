#!/usr/bin/env python3
"""
Mô-đun AI Gemini Solver cho tool TNVN.
- Hỗ trợ đa Key (Pool keys): tự động xoay vòng và đổi key khi bị quá tải / rate-limit (429, 503...)
- Khi bộ câu hỏi ngân hàng chưa có hoặc độ khớp < 0.6:
  + Tự động gọi Gemini AI với pool API key để giải đề thông minh
  + Chọn đáp án chính xác nhất (A, B, C, D)
  + Tự động lưu/học vào bộ nhớ cache để tái sử dụng ngay lập tức cho các lượt sau
"""
import os
import re
import json
import time
import urllib.request
import urllib.error
import unicodedata
import difflib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, 'data', 'gemini_config.json')
CACHE_PATH = os.path.join(ROOT, 'data', 'gemini_cache.json')

DEFAULT_KEYS = [
    'AQ.Ab8RN6IhnMuMunQqw_-TEUDoPdFhJmePvYKgf4OYlm6jOS9LHg',
    'AQ.Ab8RN6KVxSM1M8SB8KTSnl2A2knUleGm3C3_VaDo9iYkYJVBxQ',
    'AQ.Ab8RN6Ke2HfcpvI2B-mp-Hh2vHqdctAyEcJxZ8aMgAt05Gk7_w'
]
DEFAULT_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']

# Con trỏ lưu index của key đang hoạt động tốt
ACTIVE_KEY_INDEX = 0


def norm(s):
    s = unicodedata.normalize('NFC', s or '').lower()
    s = re.sub(r'^\s*(câu|cau)\s*\d+\s*[:.]\s*', '', s)
    s = re.sub(r'^[a-d]\s*[.)]\s+', '', s)
    return ' '.join(re.sub(r'[^\w\s]', ' ', s).split())


def clean_text(s):
    if not s:
        return ''
    s = re.sub(r'^[)\]\-_:.\s]+', '', s)
    s = re.sub(r'[|]+$', '', s)
    s = re.sub(r'^[a-dA-D][.)\s]+', '', s)
    return s.strip()


def get_config():
    cfg = {
        'enabled': True,
        'api_keys': DEFAULT_KEYS,
        'api_key': DEFAULT_KEYS[0],
        'models': DEFAULT_MODELS,
        'auto_learn': True,
        'temperature': 0.0
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                cfg.update(loaded)
        except Exception:
            pass

    # Thu thập toàn bộ keys
    all_keys = []
    if isinstance(cfg.get('api_keys'), list):
        for k in cfg['api_keys']:
            k_clean = str(k).strip()
            if k_clean and k_clean not in all_keys:
                all_keys.append(k_clean)

    single_key = str(cfg.get('api_key', '')).strip()
    if single_key and single_key not in all_keys:
        all_keys.insert(0, single_key)

    env_key = os.environ.get('GEMINI_API_KEY')
    if env_key and env_key.strip() not in all_keys:
        all_keys.insert(0, env_key.strip())

    if not all_keys:
        all_keys = list(DEFAULT_KEYS)

    cfg['api_keys'] = all_keys
    cfg['api_key'] = all_keys[0]

    return cfg


def load_cache():
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_to_cache(qtext, opts, chosen_idx, answer_text):
    try:
        cache = load_cache()
        key = norm(qtext)
        cache[key] = {
            'question': qtext,
            'options': [o.get('text', '') if isinstance(o, dict) else str(o) for o in opts],
            'answer_index': chosen_idx,
            'answer_letter': 'ABCD'[chosen_idx] if 0 <= chosen_idx < 4 else 'A',
            'answer_text': answer_text,
            'updated_at': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        with open(CACHE_PATH, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f'⚠️ [Gemini Cache] Lỗi lưu cache: {e}')


def check_cache(qtext, opts):
    """Kiểm tra xem câu hỏi đã từng được Gemini giải trước đó chưa"""
    cache = load_cache()
    clean_q = norm(qtext)
    if not clean_q:
        return None

    # Tìm chính xác hoặc độ tương đồng cao
    if clean_q in cache:
        item = cache[clean_q]
        return item.get('answer_index'), item.get('answer_text')

    for k, item in cache.items():
        if difflib.SequenceMatcher(None, clean_q, k).ratio() > 0.85:
            # So khớp lại với các phương án hiện tại
            ans_text = item.get('answer_text', '')
            if opts and ans_text:
                best_idx = max(range(len(opts)), key=lambda i: difflib.SequenceMatcher(
                    None,
                    norm(opts[i].get('text', '') if isinstance(opts[i], dict) else str(opts[i])),
                    norm(ans_text)
                ).ratio())
                return best_idx, ans_text
            return item.get('answer_index'), ans_text

    return None


def solve_with_gemini(qtext, opts):
    """
    Nhận vào qtext và danh sách opts [{'text': '...'}, ...]
    Trả về: (chosen_index, reason_string)
    Nếu không giải được, trả về: (None, error_string)
    Tự động xoay vòng qua danh sách API Key nếu gặp lỗi hoặc quá tải (429, 503).
    """
    global ACTIVE_KEY_INDEX

    if not opts:
        return None, 'Danh sách lựa chọn rỗng'

    # 1. Kiểm tra cache câu hỏi AI đã giải trước đó (phản hồi tức thì 0.001s)
    cached = check_cache(qtext, opts)
    if cached and cached[0] is not None:
        idx, ans_txt = cached
        if 0 <= idx < len(opts):
            letter = 'ABCD'[idx]
            return idx, f'Lấy từ bộ nhớ Cache AI (Đáp án {letter})'

    cfg = get_config()
    if not cfg.get('enabled', True):
        return None, 'Tính năng Gemini AI đang tắt trong cấu hình'

    api_keys = cfg.get('api_keys', [])
    if not api_keys:
        return None, 'Chưa có Gemini API Key nào được cấu hình'

    # Chuẩn hoá danh sách lựa chọn
    clean_opts = []
    for i, o in enumerate(opts):
        t = o.get('text', '') if isinstance(o, dict) else str(o)
        clean_opts.append(clean_text(t))

    prompt_opts = []
    for i, t in enumerate(clean_opts):
        letter = 'ABCD'[i] if i < 4 else f'Opt{i+1}'
        prompt_opts.append(f'{letter}. {t}')

    prompt_content = f"""Bạn là chuyên gia trắc nghiệm kiến thức Đoàn TNCS Hồ Chí Minh, Lịch sử, Chính trị, Kinh tế, Văn hóa - Xã hội Việt Nam.
Hãy phân tích và chọn đáp án CHÍNH XÁC NHẤT cho câu hỏi sau.

Câu hỏi: {qtext}

Các phương án:
{chr(10).join(prompt_opts)}

YÊU CẦU BẮT BUỘC:
- Chỉ trả lời DUY NHẤT một ký tự chữ cái viết hoa đại diện cho đáp án đúng (A, B, C hoặc D).
- Không viết thêm bất kỳ từ ngữ hay dấu câu nào khác."""

    models = cfg.get('models', DEFAULT_MODELS)
    payload = {
        'contents': [{'parts': [{'text': prompt_content}]}],
        'generationConfig': {
            'temperature': cfg.get('temperature', 0.0),
            'maxOutputTokens': 15
        }
    }
    payload_bytes = json.dumps(payload).encode('utf-8')

    total_keys = len(api_keys)
    last_err = ''

    # Thử qua từng key bắt đầu từ ACTIVE_KEY_INDEX
    for attempt in range(total_keys):
        key_idx = (ACTIVE_KEY_INDEX + attempt) % total_keys
        current_key = api_keys[key_idx]
        key_short = f'{current_key[:10]}...{current_key[-4:]}'

        key_failed = False
        for model_name in models:
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={current_key}'
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={'Content-Type': 'application/json'}
            )
            try:
                t0 = time.time()
                with urllib.request.urlopen(req, timeout=6.0) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    raw_ans = data['candidates'][0]['content']['parts'][0]['text'].strip()
                    duration = time.time() - t0

                    # Cập nhật con trỏ key tốt hiện tại
                    ACTIVE_KEY_INDEX = key_idx

                    # Phân tích kết quả trả về từ Gemini
                    chosen_idx = None
                    m = re.search(r'\b([A-Da-d])\b', raw_ans)
                    if m:
                        chosen_idx = 'ABCD'.index(m.group(1).upper())
                    else:
                        scores = [
                            difflib.SequenceMatcher(None, norm(raw_ans), norm(opt)).ratio()
                            for opt in clean_opts
                        ]
                        max_score = max(scores)
                        if max_score > 0.4:
                            chosen_idx = scores.index(max_score)

                    if chosen_idx is not None and 0 <= chosen_idx < len(opts):
                        chosen_letter = 'ABCD'[chosen_idx]
                        opt_text = clean_opts[chosen_idx]

                        # Lưu vào cache để các lượt thi sau lấy ngay
                        if cfg.get('auto_learn', True):
                            save_to_cache(qtext, opts, chosen_idx, opt_text)

                        tag_key = f'Key #{key_idx+1}' if total_keys > 1 else ''
                        return chosen_idx, f'Gemini {tag_key} ({model_name}, {duration:.2f}s) chọn {chosen_letter}: "{opt_text[:45]}"'
            except urllib.error.HTTPError as e:
                err_code = e.code
                try:
                    err_body = e.read().decode('utf-8', errors='ignore')
                except Exception:
                    err_body = ''
                last_err = f'Key #{key_idx+1} lỗi HTTP {err_code}: {err_body[:80]}'

                # Nếu bị Rate Limit 429 hoặc Quá tải 503 hoặc Lỗi server 500, 502
                if err_code in (429, 503, 500, 502, 504) and total_keys > 1:
                    next_idx = (key_idx + 1) % total_keys
                    print(f'   ⚠️ [Gemini AI] Key #{key_idx+1} ({key_short}) bị quá tải/rate-limit ({err_code}) -> Tự động chuyển sang Key dự phòng #{next_idx+1}!')
                    key_failed = True
                    break  # chuyển sang key tiếp theo ngay lập tức
            except Exception as e:
                last_err = f'Key #{key_idx+1} lỗi ({e})'
                if total_keys > 1:
                    next_idx = (key_idx + 1) % total_keys
                    print(f'   ⚠️ [Gemini AI] Key #{key_idx+1} ({key_short}) gặp lỗi kết nối -> Tự động chuyển sang Key dự phòng #{next_idx+1}!')
                    key_failed = True
                    break

        if not key_failed:
            # Nếu key này đã thử hết các model mà vẫn không thành công
            pass

    return None, f'Gemini toàn bộ keys đều lỗi ({last_err})'


def test_all_keys():
    """Kiểm tra tình trạng toàn bộ các API Key trong cấu hình"""
    cfg = get_config()
    keys = cfg.get('api_keys', [])
    models = cfg.get('models', DEFAULT_MODELS)
    test_model = models[0] if models else 'gemini-flash-lite-latest'

    results = []
    print(f'=== KIỂM TRA {len(keys)} GEMINI API KEYS VỚI MODEL [{test_model}] ===')

    payload = {
        'contents': [{'parts': [{'text': 'Trả lời đúng 1 chữ C: A. 1  B. 2  C. 3  D. 4'}]}],
        'generationConfig': {'temperature': 0, 'maxOutputTokens': 5}
    }
    payload_bytes = json.dumps(payload).encode('utf-8')

    for i, k in enumerate(keys):
        k_short = f'{k[:12]}...{k[-4:]}'
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{test_model}:generateContent?key={k}'
        req = urllib.request.Request(url, data=payload_bytes, headers={'Content-Type': 'application/json'})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                ans = data['candidates'][0]['content']['parts'][0]['text'].strip()
                dur = time.time() - t0
                status = f'✅ Hoạt động tốt ({dur:.2f}s)'
                results.append({'key_index': i + 1, 'key': k_short, 'ok': True, 'duration': round(dur, 2), 'answer': ans})
                print(f'  Key #{i+1} ({k_short}): {status}')
        except Exception as e:
            status = f'❌ Lỗi: {e}'
            results.append({'key_index': i + 1, 'key': k_short, 'ok': False, 'error': str(e)})
            print(f'  Key #{i+1} ({k_short}): {status}')

    return results


if __name__ == '__main__':
    test_all_keys()
    print('\nTesting solve_with_gemini sample question:')
    test_q = 'Trong chuyên đề, thanh niên Việt Nam ở nước ngoài có vai trò gì?'
    test_opts = [
        {'text': ') Không thuộc lực lượng cản tập hợp trong công tác Đoản.|'},
        {'text': ') Chi có vai trò giao lưu ván hóa cá nhân.'},
        {'text': ') Là cánh tay nối dài, góp phần kết nối nguồn lực tri thức trẻ toản cầu.'},
        {'text': 'Là lực lượng tách biệt với thanh niên trong nước.|'}
    ]
    idx, reason = solve_with_gemini(test_q, test_opts)
    print(f'Result: Index={idx} -> Reason: {reason}')
