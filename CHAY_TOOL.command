#!/bin/bash
cd "$(dirname "$0")"

# Load Homebrew environment if installed
if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -f "/usr/local/bin/brew" ]; then
    eval "$(/usr/local/bin/brew shellenv)"
fi

# Load nvm if installed
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "===================================================================="
echo "  TNVN AUTO EXAM PRO - HE THONG TU DONG THI THANH NIEN VIET NAM"
echo "  Phien ban macOS / Mac Mini"
echo "===================================================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[LOI] Khong tim thay Node.js tren may!"
    echo "Vui long cai dat Node.js: https://nodejs.org hoac chay: brew install node"
    echo ""
    read -p "Nhan Enter de thoat..."
    exit 1
fi

# Check ADB
if ! command -v adb &> /dev/null; then
    echo "[CANH BAO] Khong tim thay adb tren may!"
    echo "Dang tu dong cai dat adb qua Homebrew..."
    brew install --cask android-platform-tools
fi

echo "[*] Node.js version: $(node -v)"
echo "[*] ADB version: $(adb --version | head -n 1)"
echo ""
echo "[*] Dang khoi dong Web Server tai http://localhost:3000 ..."
echo "[*] Trinh duyet se tu dong mo sau 2 giay..."
echo "[*] Khong tat cua so Terminal nay trong khi dang thi."
echo "--------------------------------------------------------------------"
echo ""

(sleep 2 && open "http://localhost:3000") &

if [ -f "./dist/server.js" ]; then
    node dist/server.js
else
    npx tsx src/server.ts
fi
