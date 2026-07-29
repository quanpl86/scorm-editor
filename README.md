# SCORM Editor

Dự án này là một ứng dụng Web Full-stack bao gồm Backend xây dựng bằng Python (FastAPI) và Frontend sử dụng Node.js.

## Teky LMS — nguồn dữ liệu chuẩn (schema v2)

Gói import chính thức: `ImportTemplate/SNLT-HP01-B01/` gồm
`SNLT-HP01-B01.xlsx` và `media/` (**chỉ ảnh**).

- Sheet `Quiz Questions`: nhóm **TEXT** (Type → Use Regex) rồi nhóm **MEDIA** (Image, Video URL, Audio URL, ảnh đáp án / matching). Tối đa **Answer 1…6** (matching tối đa 6 cặp).
- Sheet `Quiz Settings`: cấu hình quiz (`coverImage`, duration, shuffle…).
- **Video:** chỉ URL YouTube/Vimeo. **Audio:** chỉ URL HTTPS trực tiếp — không lưu `.mp4`/`.mp3` trong `media/`.
- Quiz ID / Question ID: hệ thống tự sinh; không nhập Excel.
- Schema: `docs/TEKY_EXCEL_SCHEMA.md`. AI gen TSV: `docs/ai-agent-quiz/` + `docs/AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md`.

Template legacy: `ImportTemplate/Full_quiz_9_types_sample/` (không dùng pipeline mới).

Hướng dẫn vận hành: `docs/SCORM_EDITOR_GUIDE.md`; Word: `docs/SCORM_Editor_Huong_Dan_Chi_Tiet.docx`.

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

## 4. Quy ước đặt tên khi Export Ảnh (Image Export Naming Conventions)
Hệ thống hỗ trợ 8 dạng câu hỏi/slide chính. Khi người dùng thực hiện xuất ảnh (Export) trên ứng dụng, thuật toán sẽ tự động phân loại và gán hậu tố tên file dựa trên dạng câu hỏi và vị trí của hình ảnh để tránh trùng lặp:

### 4.1. Tên ảnh của "Nội dung câu hỏi" & "Ảnh nền/Minh họa"
Áp dụng cho mọi dạng câu hỏi. Bất kể hình ảnh đóng vai trò là **Ảnh nền (Background)**, **Khung ảnh (Picture/Image)**, hoặc **Ảnh minh họa trong thân câu hỏi**, chúng đều được quy về nhóm Nội dung (`ND`).
- **Hậu tố:** `_IMG-ND` hoặc `_IMG-ND-[số thứ tự]` (nếu có nhiều ảnh tự chèn trên Canvas).

### 4.2. Tên ảnh của "Giải thích đáp án" (Feedback) & Slide Kết quả
Nếu hình ảnh được chèn trong các khung Feedback (khi trả lời Đúng/Sai), Slide Giới thiệu (IntroSlide) hoặc Slide Kết quả (ResultSlide), chúng vẫn là đối tượng hình ảnh hiển thị độc lập.
- **Hậu tố:** `_IMG-ND-[số thứ tự]` (được gom chung hệ thống với Ảnh minh họa).

### 4.3. Tên ảnh bên trong "Từng dạng đáp án cụ thể"
Luật đặt tên thông minh dựa theo loại câu hỏi (`question.type`):

*   **Nối cặp (Matching):**
    *   Ảnh đáp án bên trái (Vế Trái): **`_IMG-VT1`**, **`_IMG-VT2`**...
    *   Ảnh đáp án bên phải (Vế Phải): **`_IMG-VP1`**, **`_IMG-VP2`**...
*   **Trắc nghiệm (Multiple Choice / TrueFalse):**
    *   Ảnh của các lựa chọn (A, B, C...): **`_IMG-DA1`**, **`_IMG-DA2`**, **`_IMG-DA3`**...
*   **Chọn nhiều (Multiple Response):**
    *   Tương tự trắc nghiệm: **`_IMG-DA1`**, **`_IMG-DA2`**...
*   **Sắp xếp (Sequence):**
    *   Tương ứng với các thẻ bài từ trên xuống: **`_IMG-DA1`**, **`_IMG-DA2`**...
*   **Xác định vị trí (Hotspot):**
    *   Bức ảnh toàn cảnh đóng vai trò vùng tương tác chính: **`_IMG-content`**.
*   **Điền khuyết (Fill-in-the-Blank), Điền từ (Type In), Kéo thả (WordBank):**
    *   Các đáp án mang bản chất là Text thuần túy nên không có ảnh bên trong bản thân đáp án. Nếu có ảnh xuất hiện, chúng sẽ thuộc về "Nội dung câu hỏi" chung (`_IMG-ND`).
