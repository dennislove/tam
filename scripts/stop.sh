#!/bin/bash
# Script dừng khẩn cấp tool TNVN ngay lập tức
pkill -f "mac_multi_account_flow.py" 2>/dev/null
pkill -f "mac_full_flow.py" 2>/dev/null
pkill -f "mac_exam_loop.py" 2>/dev/null
pkill -f "cliclick" 2>/dev/null
touch "$(dirname "$0")/../logs/STOP" 2>/dev/null
echo "🛑 ĐÃ DỪNG TOÀN BỘ TIẾN TRÌNH TOOL TỰ ĐỘNG THÀNH CÔNG!"
