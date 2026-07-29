# Quy trình xây dựng nội dung & xuất bản câu hỏi ôn tập (Bài học / Học phần)

Tài liệu vận hành chuẩn Teky LMS: **Excel Import → SCORM Editor → CMS JSON → LMS**.

- Bản Word: `Quy_Trinh_Xay_Dung_Xuat_Ban_Cau_Hoi_On_Tap.docx`
- **Template Excel chuẩn (v2):** `ImportTemplate/SNLT-HP01-B01/SNLT-HP01-B01.xlsx` + `media/` (chỉ ảnh)
- Schema: `docs/TEKY_EXCEL_SCHEMA.md` · AI Agent TSV: `docs/AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md`
- Template cũ (tham chiếu): `Full_quiz_9_types_sample/` — không dùng pipeline mới

---

## 1. Tổng quan

Câu hỏi ôn tập (quiz) gắn **Bài học** (sau mỗi bài) hoặc **Học phần** (quiz tổng hợp). Nội dung soạn offline trên Excel, rà soát trên SCORM Editor (Mode Teky LMS), xuất JSON CMS rồi import vào Teky LMS.

### Luồng end-to-end

```text
Excel (Quiz Settings + Quiz Questions) + media/
        │  nén ZIP (Excel + media cùng cấp)
        ▼
Import  SCORM Editor — Mode Teky LMS
        │  ImportReport
        ▼
Biên tập  Quiz Details · Questions · Settings  →  Save Quiz
        ▼
Viewer «Xem & Làm bài»
        ▼
Export CMS JSON (*_teky.json) + URL media S3/FPT
        ▼
Import Teky LMS → gắn quiz vào Bài học / Học phần → smoke test
```

### Nguyên tắc

| Nguyên tắc | Chi tiết |
|---|---|
| Excel là nguồn chuẩn | Nội dung + cấu hình quiz trước khi xuất JSON |
| ID tự sinh | Quiz ID / Question ID — không nhập Excel, không hiển thị Editor |
| Ảnh local | Path `media/...` (thư mục media **chỉ ảnh**) |
| Video / Audio | Video = URL YouTube/Vimeo; Audio = URL HTTPS trực tiếp — **không** file trong media/ |
| Save Quiz bắt buộc | Trước Preview và Export |
| coverImage ≠ Image | Cover = cả quiz; Image = từng câu hỏi |
| Tối đa 6 đáp án | Answer 1…6; Matching tối đa 6 cặp trái–phải |
| Cột Excel v2 | Text group trước, Media group sau; có Required, Use Regex; không Feedback đúng/sai |

---

## 2. Chuẩn bị

### Tài nguyên mẫu

| Tài nguyên | Đường dẫn |
|---|---|
| **Template chuẩn v2** | `ImportTemplate/SNLT-HP01-B01/SNLT-HP01-B01.xlsx` |
| Media (chỉ ảnh) | `ImportTemplate/SNLT-HP01-B01/media/` |
| Schema | `docs/TEKY_EXCEL_SCHEMA.md` |
| AI Agent → TSV | `docs/ai-agent-quiz/` |
| JSON mẫu | `docs/cms_json_full_sample.json` |
| Template cũ (legacy) | `ImportTemplate/Full_quiz_9_types_sample/` |

**Giữ nguyên mẫu gốc.** Sao chép cả thư mục `SNLT-HP01-B01/` sang work folder theo mã bài (`SNLT-HPxx-Byy/`).

### Cấu trúc gói

```text
SNLT-HP01-B01/
├── SNLT-HP01-B01.xlsx
└── media/                 # chỉ ảnh — không .mp3/.mp4
    ├── quiz_cover.jpg
    └── ...
```

Import deploy: nén Excel + `media/` cùng cấp thành ZIP.

### Chạy Editor

```bash
cd scorm-editor && ./start.sh
# http://localhost:8000
```

---

## 3. Soạn Excel

Workbook: **Quiz Settings** | **Quiz Questions** | Instructions (không import).

### 3.1. Quiz Settings

| Field | Ý nghĩa |
|---|---|
| `title`, `description` | Tên / mô tả quiz |
| `coverImage` | Ảnh đại diện, ví dụ `media/quiz_cover.jpg` |
| `subject`, `difficultyLevel`, `tags` | Môn, độ khó, tag |
| `duration` | Giây (Editor hiển thị phút) |
| `shuffleQuestions`, `shuffleAnswers` | Trộn câu / đáp án |
| `attemptLimit` | Số lần làm; `0` = không giới hạn |
| `showResults` | `after_submit` \| `immediately` \| `never` |
| `allowReview` | Xem lại sau nộp |
| `createdAt` / `updatedAt` | Để trống → hệ thống tự sinh |

### 3.2. Quiz Questions (1 dòng = 1 câu) — schema v2

**Nhóm TEXT:** `Question Type`, `Question Text`, `Answer 1…6`, `Explanation`, `Difficulty`, `Topic`, `Points`, `Required`, `Use Regex`

**Nhóm MEDIA:** `Image`, `Video`, `Audio`, `Answer 1…6 Image`, `Answer 1…6 Left Image`, `Answer 1…6 Right Image`

### 3.3. Dạng chuẩn (tối đa 6 đáp án / 6 cặp MG)

| Excel | JSON Teky | Cách nhập đáp án |
|---|---|---|
| MC | `multiple_choice` | `*` trước **1** đáp án đúng |
| MR | `multiple_select` | `*` trước **mọi** đáp án đúng |
| TF | `true_false` | `*` Đúng hoặc Sai |
| MG | `matching` | `trái\|phải` (≤6 cặp) + Left/Right Image |
| SEQ | `ordering` | Answer 1…N = thứ tự đúng (≤6) |
| FIB | `fill_blank` | `___` trong đề; Answer = biến thể |
| TI | `short_answer` | Text hoặc RegEx nếu `Use Regex=True` |
| NUM | `numeric` | 1 số |
| MNUM | `multiple_numeric` | Nhiều số theo thứ tự (≤6) |

### 3.4. Media (v2)

| Loại | Chuẩn |
|------|--------|
| Ảnh | `media/file.ext` — thư mục media **chỉ ảnh** |
| Video | **Chỉ** URL YouTube hoặc Vimeo |
| Audio | **Chỉ** URL HTTPS trực tiếp |
| coverImage | `media/quiz_cover.jpg` trong Quiz Settings |

Pipeline AI: gen TSV text → import Excel → **human gắn path ảnh** (+ URL AV nếu cần).

---

## 4. Import → Edit → View

1. Mode **Teky LMS** → drop ZIP Excel+media.
2. Đọc **ImportReport** → sửa hết error / media warning.
3. Chỉnh **Quiz Details**, **Questions**, **Settings**.
4. **Save Quiz** (bắt buộc).
5. **Xem & Làm bài** — checklist:
   - Không ảnh vỡ
   - `___` đúng vị trí (FIB)
   - Đáp án đúng / Matching / Ordering chính xác
   - Points, explanation, submit OK

---

## 5. Xuất bản & gắn Bài học / Học phần

### Export

**Export CMS JSON** →  
`SCORM-PROJECT/JSON-EXPORT/{title}_teky.json`  
(`JSON-EXPORT` nằm cùng cấp với `ImportTemplate` và được hệ thống tự tạo khi export lần đầu.)  
(dạng mảng `[ quiz_object ]`, media → URL S3/FPT nếu cấu hình).

### Gắn LMS

1. Import JSON vào Teky LMS.
2. Smoke test media URL + 1–2 câu mỗi dạng.
3. Gắn quiz:
   - **Ôn tập sau bài** → component Bài học (5–15 câu, attempt ≥ 2).
   - **Cuối học phần** → quiz tổng hợp HP (shuffle, attempt 1–3).
4. Publish production.

---

## 6. Checklist xuất bản (14 bước)

1. Sao chép template → thư mục theo mã BH/HP  
2. Điền Quiz Settings  
3. Viết Questions + `*` đáp án đúng  
4. Media vào `media/`, path khớp  
5. ZIP Excel + media cùng cấp  
6. Import Mode Teky LMS  
7. Xử lý error / warning  
8. Edit Details / Questions / Settings  
9. **Save Quiz**  
10. Viewer review  
11. Sửa (nếu cần) → Save lại  
12. Export CMS JSON  
13. Đối chiếu template/sample + URL S3  
14. Import LMS → gắn BH/HP → smoke test  

---

## 7. Lỗi thường gặp

| Hiện tượng | Xử lý |
|---|---|
| Không tìm thấy `media/...` | File thiếu / sai hoa-thường; Excel và `media/` cùng cấp trong ZIP |
| Cover vỡ | `coverImage` + import ZIP đầy đủ |
| Đáp án biến mất | Nhấn **Save Quiz** |
| S3 URL trống | Cấu hình S3 / media trong session |
| JSON thiếu câu | Chưa Save hoặc loại không mapping |
| Video không preview | Thêm poster cột Image |

---

## 8. API chính

| Method | Path | Mục đích |
|---|---|---|
| POST | `/api/import/excel` | Import Excel / ZIP |
| PUT | `/api/session/{id}` | Save Quiz |
| GET | `/api/session/{id}/preview/player` | Viewer |
| POST | `/api/session/{id}/export-cms-json-local` | Export JSON Teky |
| POST | `/api/session/{id}/export` | Export SCORM 1.2 |

---

## Tài liệu liên quan

- `SCORM_Editor_Huong_Dan_Chi_Tiet.docx`
- `docs/SCORM_EDITOR_GUIDE.md`
- `docs/TEKY_EXCEL_SCHEMA.md`
- `ImportTemplate/Full_quiz_9_types_teky_lms.zip`
- `docs/cms_json_full_sample.json`
