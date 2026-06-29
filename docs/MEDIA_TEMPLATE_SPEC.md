# Đặc tả Media Template — Excel Import → SCORM iSpring

> **Mục đích:** Chuẩn hóa cách chèn **ảnh, audio, video** trên **câu hỏi**, **đáp án**, và **phản hồi (feedback)** khi xây template Excel hoặc triển khai import.  
> **Nguyên tắc:** Media **local** → copy vào package → export SCORM (không dùng direct URL).

| Meta | Giá trị |
|------|---------|
| **Phiên bản** | 1.0 |
| **Cập nhật** | 2026-06-29 |
| **Liên quan** | [EXCEL_IMPORT_PLAN.md](./EXCEL_IMPORT_PLAN.md) |
| **iSpring tham chiếu** | https://ispringhelpdocs.com/quizmaker9/importing-questions-from-excel-6128674.html |

---

## 1. File mẫu & thư mục template

| File | Vai trò |
|------|---------|
| `../ImportTemplate/Sample_import_template.xls` | Mẫu iSpring gốc (ảnh câu hỏi, chưa audio/video đầy đủ) |
| `../ImportTemplate/Media_import_sample.xlsx` | **Mẫu chuẩn** — audio/video câu hỏi + đáp án + feedback |
| `../ImportTemplate/media/` | Thư mục media (đường dẫn tương đối trong Excel) |

### Media có sẵn trong `media/`

| File | Loại | Gợi ý dùng |
|------|------|------------|
| `voice_question.mp3` | Audio | Giọng đọc câu hỏi / đáp án |
| `voice_feedback.mp3` | Audio | Giọng khen / gợi ý khi đúng-sai |
| `sample_lesson.mp4` | Video | Video bài học (Info Slide / câu hỏi) |
| `*.jpg`, `*.png` | Ảnh | Minh họa câu hỏi, đáp án, poster video |

### Import trong app

| Cách | Mô tả |
|------|--------|
| UI | **Import mẫu Audio/Video (mầm non)** |
| API | `POST /api/import/excel/media-sample` |
| Zip | `.zip` chứa `.xlsx` + thư mục `media/` cùng cấp |

### Test tự động

```bash
cd scorm-editor/backend
.venv/bin/pytest tests/test_media_import.py tests/test_answer_feedback_media.py -v
```

---

## 2. Cột Excel (hàng 1 = header)

| Cột | Áp dụng | Media |
|-----|---------|-------|
| Question Type | Bắt buộc | — |
| Question Text | Câu hỏi | — |
| **Image** | **Câu hỏi** | Ảnh slide (`slidePicture`) |
| **Video** | **Câu hỏi** | Video slide (`slide.at.v`) |
| **Audio** | **Câu hỏi** | Audio slide (`slide.at.a`) |
| Answer 1 … Answer 10 | Đáp án | Brackets — xem §3 |
| **Correct Feedback** | Phản hồi đúng | Brackets — xem §3 |
| **Incorrect Feedback** | Phản hồi sai | Brackets — xem §3 |
| Points | Tùy chọn | — |

**Đường dẫn media:** tương đối file Excel, ví dụ `media\voice_question.mp3` hoặc `media/voice_question.mp3`.

---

## 3. Cú pháp brackets (đáp án & feedback)

Parser: `parse_media_brackets()` trong `backend/app/excel_import.py`.

### 3.1 Cú pháp rõ ràng (khuyến nghị)

```
[image=media\ten_anh.jpg]
[audio=media\ten_audio.mp3]
[video=media\ten_video.mp4]
[sound=media\ten_audio.mp3]    ← alias của audio
```

### 3.2 Cú pháp ngắn (theo đuôi file)

```
[media\anh.png]      → image
[media\voice.mp3]    → audio
[media\clip.mp4]     → video
```

### 3.3 Đáp án đúng (prefix `*`)

```
*Con heo [audio=media\voice_heo.mp3]
*Đáp án A [image=media\icon_a.png]
```

### 3.4 Nhiều media trong một ô

```
Giỏi lắm! [audio=media\voice_chuc.mp3] [image=media\star.png]
Thử lại nhé [audio=media\voice_goi_y.mp3] [image=media\goi_y.jpg]
```

Thứ tự parse: tag rõ `[type=path]` trước, sau đó bracket theo đuôi file. Phần text còn lại là nội dung hiển thị.

### 3.5 Định dạng file hỗ trợ

| Loại | Đuôi file |
|------|-----------|
| Ảnh | `.jpg` `.jpeg` `.png` `.gif` `.bmp` `.webp` |
| Audio | `.mp3` `.wav` `.m4a` `.ogg` |
| Video | `.mp4` `.webm` `.mov` |

---

## 4. Ma trận media theo vị trí

| Vị trí | Ảnh | Audio | Video | Cách khai báo Excel |
|--------|-----|-------|-------|---------------------|
| **Câu hỏi** | ✅ | ✅ | ✅ | Cột `Image` / `Audio` / `Video` |
| **Đáp án** | ✅ | ✅ | ✅ | Brackets trong `Answer N` |
| **Feedback đúng** | ✅ | ✅ | ✅ | Brackets trong `Correct Feedback` |
| **Feedback sai** | ✅ | ✅ | ✅ | Brackets trong `Incorrect Feedback` |

### Ràng buộc quan trọng

| Tình huống | Quy tắc |
|------------|---------|
| Video câu hỏi | Cần **ảnh poster** (cột `Image` hoặc file ảnh trong media) |
| Video đáp án / feedback | Cần **`[image=...]`** trong cùng ô (poster) |
| Video không có poster | Import vẫn chạy nhưng **warning**, bỏ gắn video |
| Media thiếu file | **Warning** trong báo cáo import, không fail cả dòng |
| TF chỉ ảnh | Được phép **không có** Question Text nếu có cột Image |

---

## 5. Ánh xạ SCORM / iSpring (sau import)

### 5.1 Câu hỏi (slide level)

| Media | JSON / object | File package |
|-------|---------------|--------------|
| Ảnh | `slide.at.i` + object `slidePicture` trong `a.o` | `res/data/images/img-import-*.ext` |
| Audio | `slide.at.a` + object `slideAudio` | `res/data/audios/snd-import-*.ext` |
| Video | `slide.at.v` (+ `pi` = poster ảnh) + `slideVideo` | `res/data/videos/vid-import-*.ext` |

**Storage URI:**

```
storage://images/{filename}
storage://sounds/{filename}
storage://videos/{filename}
```

**Registry** (`ensure_media_registry()`):

```
rs.i  → ảnh
rs.a  → audio  (mảng {m, s})
rs.v  → video  (mảng {m, s})
```

### 5.2 Đáp án (choice)

| Media | JSON | Ghi chú |
|-------|------|---------|
| Ảnh | `choice.ia.i` | Icon / ảnh đáp án |
| Audio | `choice.f.a` | **Voice từng đáp án** — quan trọng mầm non |
| Video | `choice.t.r[]` type `video` | Inline rich text; cần poster = ảnh đáp án |

### 5.3 Feedback (đúng / sai)

| Media | JSON path | Ghi chú |
|-------|-----------|---------|
| Text | `slide.s.F.c.v` / `slide.s.F.i.v` | `h`, `d`, `t` |
| Audio | `slide.s.F.c.a` / `slide.s.F.i.a` | Phát khi hiện feedback |
| Ảnh inline | `slide.s.F.c.v.r[]` type `image` | Kèm `<span id="image…">` trong `h` |
| Video inline | `slide.s.F.c.v.r[]` type `video` | Cần `posterAssetId` + `assetId` |

Code tham chiếu: `backend/app/media_rich.py`, `quiz_builder._apply_feedback_block()`, `_apply_choice_media()`.

---

## 6. Ví dụ template Excel (copy vào file mới)

### 6.1 Mầm non — MC + voice đáp án + voice feedback

| Question Type | Question Text | Image | Video | Audio | Answer 1 | Answer 2 | Correct Feedback | Incorrect Feedback |
|---------------|---------------|-------|-------|-------|----------|----------|------------------|-------------------|
| MC | Con gì kêu "ụt ụt"? | media\monument.png | | media\voice_question.mp3 | *Heo [audio=media\voice_question.mp3] | Mèo [image=media\Yellowstone.jpg] | Giỏi lắm! [audio=media\voice_feedback.mp3] | Thử lại [audio=media\voice_question.mp3] [image=media\Columbus_ship.jpg] |

### 6.2 TF + audio câu hỏi

| Question Type | Question Text | Audio | Answer 1 | Answer 2 |
|---------------|---------------|-------|----------|----------|
| TF | Nghe và chọn đúng hay sai | media\voice_feedback.mp3 | *True | False |

### 6.3 Info Slide + video bài học

| Question Type | Question Text | Image | Video | Answer 1 |
|---------------|---------------|-------|-------|----------|
| IS | Xem video bài học | media\Columbus_ship.jpg | media\sample_lesson.mp4 | Bé hãy xem và lắng nghe cô giáo nhé! |

### 6.4 Câu hỏi đầy đủ (ảnh + voice + video)

| Question Type | Question Text | Image | Video | Audio | Answer 1 |
|---------------|---------------|-------|-------|-------|----------|
| MC | Bé chọn hình trong video | media\Yellowstone.jpg | media\sample_lesson.mp4 | media\voice_question.mp3 | *Thỏ |

---

## 7. Mẫu thiết kế cho mầm non (voice-first)

```
┌─────────────────────────────────────────────────────────┐
│  Câu hỏi                                                 │
│  • Audio cột Audio        → giọng đọc đề                │
│  • Image cột Image        → minh họa (tùy chọn)         │
│  • Video cột Video        → clip ngắn (tùy chọn)       │
├─────────────────────────────────────────────────────────┤
│  Đáp án 1..N                                             │
│  • Mỗi đáp án: text ngắn + [audio=...] riêng           │
│  • Hoặc [image=...] cho trẻ chưa đọc được chữ           │
├─────────────────────────────────────────────────────────┤
│  Feedback                                                │
│  • Đúng: [audio=voice_chuc.mp3] + text ngắn            │
│  • Sai:  [audio=voice_goi_y.mp3] + [image=goi_y.png]   │
└─────────────────────────────────────────────────────────┘
```

**Gợi ý đặt tên file:**

```
media/
  voice_de_cau_01.mp3      # đọc đề
  voice_dap_an_a.mp3       # đọc đáp án A
  voice_dap_an_b.mp3
  voice_dung.mp3           # feedback đúng
  voice_sai_goi_y.mp3      # feedback sai
  hinh_cau_01.jpg
  clip_gioi_thieu.mp4
```

---

## 8. Editor (sau import) — field API

Khi save từ UI, backend đọc/ghi qua `scorm_parser.py`:

### Feedback (`question.feedback`)

| Field | Ý nghĩa |
|-------|---------|
| `correct` / `incorrect` | Text |
| `correctAudio` / `incorrectAudio` | Tên file trong `res/data/audios/` |
| `correctImage` / `incorrectImage` | Ảnh inline feedback |
| `correctVideo` / `incorrectVideo` | Video inline feedback |

### Đáp án (`question.choices[]`)

| Field | Ý nghĩa |
|-------|---------|
| `text` | Nội dung |
| `image` | `choice.ia` |
| `audio` | `choice.f.a` |
| `video` | Inline trong `choice.t.r` |
| `isCorrect` | Đáp án đúng |

Asset URL editor: `GET /api/session/{id}/asset/{filename}` (images + audios + videos).

---

## 9. Checklist khi tạo template Excel mới

- [ ] Sheet đầu tiên, hàng 1 đúng tên cột iSpring
- [ ] Thư mục `media/` cùng cấp file Excel (hoặc nằm trong zip)
- [ ] Đường dẫn `media\...` khớp tên file thật (phân biệt hoa thường trên Linux)
- [ ] Video luôn kèm ảnh poster (cột Image hoặc `[image=...]`)
- [ ] Audio đáp án: bracket trong từng `Answer N` cần voice riêng
- [ ] Feedback: tách voice đúng / sai bằng file mp3 khác nhau
- [ ] Chạy import mẫu → kiểm tra `ImportReport` (0 error, xem warnings)
- [ ] Chạy `pytest tests/test_media_import.py tests/test_answer_feedback_media.py`
- [ ] Preview Slide View: nghe được audio câu hỏi + feedback

---

## 10. Giới hạn hiện tại (v1.0)

| Hạng mục | Trạng thái |
|----------|------------|
| Direct URL (YouTube, Drive, S3…) | ❌ Chưa hỗ trợ — chỉ local file |
| Upload audio/video từ UI editor | ❌ Chỉ xem/phát; thay file qua upload ảnh hoặc re-import Excel |
| Matching / Sequence media từng cặp | ❌ Chưa — chỉ MC/MR/TF/IS đã test |
| Numeric (NUMG) | Skip |
| Layout canvas reflow sau import | Phase 4 — chưa |

---

## 11. Changelog đặc tả

| Ngày | Thay đổi |
|------|----------|
| 2026-06-29 | v1.0 — Đặc tả media câu hỏi / đáp án / feedback; mẫu Media_import_sample.xlsx |