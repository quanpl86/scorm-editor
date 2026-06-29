#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"

die() { echo "❌ $1"; exit 1; }

command -v python3 >/dev/null || die "Chưa có Python 3. Cài từ https://python.org"
command -v npm >/dev/null || die "Chưa có Node.js/npm. Cài từ https://nodejs.org"

echo "▶ Cài đặt backend..."
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv || die "Không tạo được virtualenv"
fi
.venv/bin/pip install -q -r requirements.txt || die "Cài Python packages thất bại"

echo "▶ Build frontend..."
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  npm install || die "npm install thất bại"
fi
npm run build || die "Build frontend thất bại"

# Giải phóng port nếu đang bị chiếm
if lsof -ti :"$PORT" >/dev/null 2>&1; then
  echo "▶ Port $PORT đang dùng — đang giải phóng..."
  lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo ""
echo "  ✅ SCORM Editor sẵn sàng!"
echo "  → Mở trình duyệt: http://localhost:$PORT"
echo "  → Dừng server: Ctrl+C"
echo ""

cd "$ROOT/backend"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT"