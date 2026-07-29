# Agent drop-in pack — Teky LMS Quiz TSV (schema v2)

Copy **toàn bộ thư mục này** vào AI Agent (system + knowledge / project files).

| File | Gắn vào Agent |
|------|----------------|
| `SYSTEM_PROMPT.txt` | **System / Developer** instruction |
| `AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md` | Knowledge / attach (spec đầy đủ) |
| `TEKY_EXCEL_SCHEMA.md` | Knowledge (schema Excel SNLT-HP01-B01) |
| `quiz_settings.header.tsv` | Knowledge (khung Settings) |
| `quiz_questions.header.tsv` | Knowledge (35 cột Questions) |

**User message mỗi lần gen:** Learning Objectives + Lesson Info + Project Instruction (có thể thiếu một phần) + overrides.

**Đầu ra:** `quiz_settings.tsv` + `quiz_questions.tsv` → import Excel `ImportTemplate/SNLT-HP01-B01/SNLT-HP01-B01.xlsx` → human gắn ảnh `media/`.

Nguồn gốc (đồng bộ khi cập nhật): `docs/ai-agent-quiz/`, `docs/AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md`, `docs/TEKY_EXCEL_SCHEMA.md`.

## Đổ TSV → Excel (UI Editor)

Trên trang Import SCORM Editor:

1. Dán `quiz_settings.tsv` + `quiz_questions.tsv` (hoặc combined có marker).
2. Nhập **Tên Bài học** (vd `SNLT-HP01-B02`).
3. Bấm **Import TSV → Excel & mở Editor**.

Hệ thống tạo:

```text
ImportTemplate/SNLT-HP01-B02/
├── SNLT-HP01-B02.xlsx    # template SNLT-HP01-B01 + nội dung TSV
└── media/               # trống (hoặc copy mẫu nếu tick)
```

API: `POST /api/import/tsv-to-lesson`  
Module: `backend/app/tsv_snlt_publish.py`

## CLI (tuỳ chọn)

```bash
cd scorm-editor
python3 scripts/tsv_to_snlt_xlsx.py \
  -s path/to/quiz_settings.tsv \
  -q path/to/quiz_questions.tsv \
  -o ../ImportTemplate/SNLT-HP01-B02/SNLT-HP01-B02.xlsx \
  --copy-media
```
