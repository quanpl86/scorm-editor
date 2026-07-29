# AI Agent — Quiz Teky LMS TSV (schema v2)

## Template chuẩn

```text
ImportTemplate/SNLT-HP01-B01/
├── SNLT-HP01-B01.xlsx
└── media/                 # chỉ ảnh
```

## Thay đổi chính so với schema cũ

| Hạng mục | v1 (Full_quiz_9_types…) | v2 (SNLT-HP01-B01) |
|----------|-------------------------|---------------------|
| Bố cục cột | Text/image xen kẽ | **Text group → Media group** |
| Đáp án | Có thể tới 10 | **Tối đa 6** (MG: 6 cặp) |
| Feedback | Correct + Incorrect | **Chỉ Explanation** |
| Cột mới | — | **Required**, **Use Regex** |
| Video | file trong media/ | **URL YouTube/Vimeo only** |
| Audio | file trong media/ | **URL HTTPS trực tiếp only** |
| media/ | ảnh + mp3 + mp4 | **Chỉ ảnh** |

## Workflow sản xuất

```text
1. Agent gen TSV (media_policy=text_first → cột ảnh trống)
2. Import TSV vào copy SNLT-HP01-B01.xlsx (đúng dòng/cột)
3. Human gắn path ảnh media/* + URL Video/Audio nếu cần
4. Zip Excel + media/ → SCORM Editor → Save → Viewer → Export JSON
```

## Files

| File | Mục đích |
|------|----------|
| `SYSTEM_PROMPT.txt` | System prompt Agent |
| `USER_PROMPT_TEMPLATE.md` | User prompt mỗi lần gen |
| `input_schema.example.yaml` | Ví dụ input LO/Lesson/Project |
| `templates/quiz_settings.header.tsv` | Khung Settings |
| `templates/quiz_questions.header.tsv` | **35 cột** Questions v2 |
| `templates/media_manifest.header.tsv` | Manifest ảnh |
| `../AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md` | Spec đầy đủ |
| `../TEKY_EXCEL_SCHEMA.md` | Schema Excel chính thức |

## Header Questions (copy nhanh)

```text
Question Type, Question Text, Answer 1..6, Explanation, Difficulty, Topic, Points, Required, Use Regex,
Image, Video, Audio, Answer 1..6 Image, Answer 1..6 Left Image, Answer 1..6 Right Image
```
