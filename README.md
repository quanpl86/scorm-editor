# SCORM Editor

Dự án này là một ứng dụng Web Full-stack bao gồm Backend xây dựng bằng Python (FastAPI) và Frontend sử dụng Node.js.

## 1. Yêu cầu hệ thống (Prerequisites)
Để có thể chạy dự án trên máy cá nhân (local), bạn cần phải cài đặt sẵn các công cụ sau:
- **Python 3+**: [Tải tại đây](https://python.org) (Dùng để chạy Backend).
- **Node.js & npm**: [Tải tại đây](https://nodejs.org) (Dùng để build và quản lý thư viện Frontend).

## 2. Cách chạy dự án nhanh (Tự động)
Dự án đã được tích hợp sẵn một file script `start.sh` giúp tự động hóa toàn bộ quá trình cài đặt môi trường và khởi động server. 

**Các bước thực hiện:**
1. Mở Terminal (hoặc Git Bash/Command Prompt).
2. Di chuyển vào thư mục dự án `scorm-editor`.
3. Cấp quyền thực thi cho file script (đối với hệ điều hành macOS / Linux):
   ```bash
   chmod +x start.sh
   ```
4. Chạy script:
   ```bash
   ./start.sh
   ```

**Kịch bản `start.sh` sẽ tự động thực hiện:**
- Tạo môi trường ảo `.venv` cho Python.
- Cài đặt các thư viện Python được định nghĩa trong `backend/requirements.txt`.
- Cài đặt thư viện Node.js thông qua `npm install` tại thư mục `frontend`.
- Build bản production cho Frontend qua lệnh `npm run build`.
- Khởi động server FastAPI ở port 8000.

Sau khi script chạy xong, bạn mở trình duyệt và truy cập: **http://localhost:8000**

## 3. Cách chạy thủ công (Manual)
Nếu file `start.sh` gặp lỗi ở máy bạn, bạn có thể tự tay chạy bằng các lệnh sau:

**Bước 3.1. Cài đặt & Build Frontend:**
```bash
cd frontend
npm install
npm run build
cd ..
```

**Bước 3.2. Cài đặt & Chạy Backend:**
```bash
cd backend

# 1. Tạo môi trường ảo (Virtual Environment)
python3 -m venv .venv

# 2. Kích hoạt môi trường ảo
source .venv/bin/activate    # (Trên Windows dùng lệnh: .venv\Scripts\activate)

# 3. Cài đặt thư viện Python
pip install -r requirements.txt

# 4. Khởi động Server
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
