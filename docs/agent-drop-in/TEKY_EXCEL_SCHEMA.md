# Teky LMS — Excel Import Standard (v2)

**Template chuẩn hiện hành:**  
`ImportTemplate/SNLT-HP01-B01/SNLT-HP01-B01.xlsx`  
kèm thư mục `ImportTemplate/SNLT-HP01-B01/media/` (chỉ ảnh).

Excel là nguồn dữ liệu chuẩn cho nội dung câu hỏi và cấu hình quiz trước khi export JSON CMS.

## Gói import chính thức

```text
SNLT-HP01-B01/
├── SNLT-HP01-B01.xlsx
└── media/                    # chỉ ảnh (.jpg .jpeg .png .gif .webp .bmp)
    ├── quiz_cover.jpg
    └── ...
```

- **Import local:** chọn Excel khi thư mục bài nằm trong `ImportTemplate` (path media dạng `media/tên_file.ext`).
- **Import deploy:** nén Excel + `media/` thành ZIP (cùng cấp), không dùng path tuyệt đối.
- **Quiz ID / Question ID:** hệ thống tự sinh; không tạo cột ID trong Excel.

## Nguyên tắc bố cục cột (v2)

1. **Nhóm văn bản trước** — stem, đáp án, metadata text (phù hợp AI gen TSV).
2. **Nhóm media sau** — Image path, Video/Audio URL, ảnh đáp án, ảnh matching.
3. Importer **ánh xạ theo tên header**, có thể đổi thứ tự cột; **không đổi tên** / không trùng tên cột.
4. **Tối đa Answer 1…Answer 6** (kể cả matching: tối đa 6 cặp). **Không** dùng Answer 7…10.
5. **Không** còn cột `Correct Feedback` / `Incorrect Feedback` — chỉ dùng `Explanation`.
6. Thêm `Required`, `Use Regex`.

## Sheet `Quiz Questions`

### Thứ tự cột chuẩn (35 cột)

| # | Cột | Nhóm | Mô tả |
|---|-----|------|--------|
| 1 | `Question Type` | Text | MC, MR, TF, MG, SEQ, FIB, TI, NUM, MNUM |
| 2 | `Question Text` | Text | Nội dung câu hỏi (bắt buộc) |
| 3–8 | `Answer 1` … `Answer 6` | Text | Đáp án; `*` = đúng (MC/MR/TF); MG: `trái\|phải` |
| 9 | `Explanation` | Text | Giải thích chung sau nộp / xem lại |
| 10 | `Difficulty` | Text | `easy` \| `medium` \| `hard` |
| 11 | `Topic` | Text | Chủ đề / mã LO |
| 12 | `Points` | Text | Điểm câu (≥ 1) |
| 13 | `Required` | Text | `True` / `False` — bắt buộc trả lời |
| 14 | `Use Regex` | Text | `True` / `False` — chỉ FIB/TI khi Answer là RegEx đã kiểm thử |
| 15 | `Image` | Media | Ảnh câu hỏi: `media/file.ext` |
| 16 | `Video` | Media | **Chỉ URL YouTube hoặc Vimeo** (không file trong media/) |
| 17 | `Audio` | Media | **Chỉ URL HTTPS trực tiếp** tới file audio |
| 18–23 | `Answer 1 Image` … `Answer 6 Image` | Media | Ảnh đáp án: `media/...` |
| 24–29 | `Answer 1 Left Image` … `Answer 6 Left Image` | Media | Matching — ảnh vế trái |
| 30–35 | `Answer 1 Right Image` … `Answer 6 Right Image` | Media | Matching — ảnh vế phải |

### Map loại câu hỏi

| Excel | JSON Teky LMS | Ghi chú |
|-------|---------------|---------|
| MC | multiple_choice | `*` đúng **một** đáp án |
| MR | multiple_select | `*` mọi đáp án đúng |
| TF | true_false | `*` trước Đúng hoặc Sai |
| MG | matching | `Vế trái\|Vế phải`; tối đa **6 cặp** |
| SEQ | ordering | Answer 1…N = thứ tự đúng; tối đa 6 |
| FIB | fill_blank | `___` trong stem; Answer = biến thể chấp nhận |
| TI | short_answer | Text hoặc 1 RegEx nếu `Use Regex=True` |
| NUM | numeric | Một số ở Answer 1 |
| MNUM | multiple_numeric | Nhiều số Answer 1…6 theo thứ tự |

> Mã `WB` (Word Bank) không có trong template SNLT mẫu; ưu tiên FIB/TI. Nếu hệ thống còn hỗ trợ WB, vẫn giới hạn 6 entry.

### Quy tắc media

| Loại | Nguồn | Ví dụ hợp lệ | Cấm |
|------|--------|--------------|-----|
| Ảnh (cover, Image, Answer images, L/R) | File trong `media/` | `media/quiz_cover.jpg` | Path tuyệt đối, URL ảnh tùy ý (trừ khi pipeline cho phép) |
| Video | URL nhúng | `https://www.youtube.com/watch?v=…` · Vimeo | File `.mp4` trong media/ |
| Audio | URL HTTPS trực tiếp | `https://cdn.example.com/a.mp3` | File `.mp3` trong media/, URL không HTTPS |

`coverImage` (Quiz Settings) = ảnh đại diện **cả quiz**.  
Cột `Image` = ảnh nội dung **từng câu**.

## Sheet `Quiz Settings`

| Field | JSON | Ghi chú |
|-------|------|---------|
| title | quiz.title | |
| description | quiz.description | |
| coverImage | quiz.coverImageUrl | `media/quiz_cover.jpg` |
| subject | quiz.subject | Related Subject = **tên học phần** |
| targetLesson | quiz.targetLesson | Target Lesson = **tên bài học** |
| difficultyLevel | quiz.difficultyLevel | easy \| medium \| hard |
| tags | quiz.tags | CSV |
| createdBy | quiz.createdBy | Không phải Quiz ID |
| createdByName | quiz.createdByName | |
| isPublic | quiz.isPublic | True / False |
| duration | quiz.duration | giây |
| shuffleQuestions | quiz.settings.shuffleQuestions | |
| shuffleAnswers | quiz.settings.shuffleAnswers | |
| attemptLimit | quiz.settings.attemptLimit | 0 = không giới hạn |
| showResults | quiz.settings.showResults | after_submit \| immediately \| never |
| allowReview | quiz.settings.allowReview | |
| createdAt | quiz.createdAt | Để trống → hệ thống sinh |
| updatedAt | quiz.updatedAt | Để trống → hệ thống sinh |

## Luồng biên soạn khuyến nghị (AI + human)

```text
1. AI gen TSV — ưu tiên nhóm TEXT (Type → Use Regex); media ảnh có thể để trống hoặc placeholder media/qNN_*.jpg
2. Import TSV → copy của SNLT-HP01-B01.xlsx (đảm bảo đúng dòng/cột)
3. Người soạn gắn / kiểm tra path ảnh trong media/
4. Video/Audio: dán URL YouTube·Vimeo / HTTPS audio (nếu có)
5. Zip Excel + media/ → Import Editor → Save → Viewer → Export CMS JSON
```

## Luồng dữ liệu hệ thống

```text
Excel + media (ảnh)
  → Import Teky LMS Editor
  → chỉnh nội dung/cấu hình
  → Teky Viewer
  → Export CMS JSON (ảnh → S3/FPT khi cấu hình)
  → Import vào Teky LMS
```

## Template cũ (tham chiếu)

`ImportTemplate/Full_quiz_9_types_sample/` — schema cột cũ (interleaved text/image, Feedback đúng/sai, local audio/video file). **Không dùng cho pipeline mới**; chuẩn hiện hành là `SNLT-HP01-B01`.
