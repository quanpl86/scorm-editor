# Excel Import + Media — Kế hoạch & Tracking tiến độ

> **Mục đích:** Import câu hỏi từ Excel (định dạng iSpring Quiz Maker) kèm media → chỉnh sửa trong SCORM Editor → export SCORM cho LMS.

| Meta | Giá trị |
|------|---------|
| **Last updated** | 2026-06-29 |
| **Current phase** | — (tất cả phase hoàn tất) |
| **Media mở rộng** | Đáp án + feedback: ảnh/audio/video (brackets) ✅ |
| **Thứ tự thực hiện tiếp theo** | — |

---

## Cách dùng file này (bắt buộc khi làm task)

Khi **bắt đầu** một task thuộc plan:

1. Đọc file này để biết phase hiện tại và checklist còn lại.
2. Cập nhật **Current phase** nếu chuyển sang phase mới.

Khi **hoàn thành** một task hoặc phase:

1. Đánh dấu checkbox `[x]` trong checklist tương ứng.
2. Cập nhật **Trạng thái** trong bảng Phase Overview (✅ / 🟡 / ⬜).
3. Cập nhật **% hoàn thành** phase nếu cần.
4. Ghi một dòng vào **Changelog** (ngày, phase, việc đã làm).
5. Cập nhật **Last updated** = ngày hôm nay.
6. Nếu phase xong 100%: đổi **Current phase** sang phase kế tiếp trong thứ tự đề xuất.

**Không** đóng phase khi còn mục bắt buộc (🔴) chưa xong.

---

## Tham chiếu

| Tài nguyên | Đường dẫn |
|------------|-----------|
| Template mẫu Excel | `../ImportTemplate/Sample_import_template.xls` |
| Template audio/video (mầm non) | `../ImportTemplate/Media_import_sample.xlsx` |
| Template FIB / WB / Numeric | `../ImportTemplate/FIB_WB_import_sample.xlsx` |
| Media mẫu | `../ImportTemplate/media/` (`voice_*.mp3`, `sample_lesson.mp4`) |
| MASTER SCORM (slide templates) | `../DGSA_Level5_Bài 1_Thế giới 3D diệu kỳ - Huyền Diệu` |
| Parser | `backend/app/excel_import.py` |
| Builder | `backend/app/quiz_builder.py` |
| API | `backend/app/main.py` — `POST /api/import/excel`, `/api/import/excel/sample` |
| Frontend | `frontend/src/App.jsx` (`ImportPage`), `frontend/src/api.js` |
| iSpring Excel format | https://ispringhelpdocs.com/quizmaker9/importing-questions-from-excel-6128674.html |
| **Đặc tả media template** | [MEDIA_TEMPLATE_SPEC.md](./MEDIA_TEMPLATE_SPEC.md) — câu hỏi / đáp án / feedback |

---

## Phase Overview

| Phase | Tên | Trạng thái | % | Ghi chú |
|-------|-----|------------|---|---------|
| 0 | SCORM Editor core (import/edit/export) | ✅ Done | 100% | Editor, preview, save, export |
| 1 | Excel MVP (parser, API, UI, sample) | ✅ Done | 100% | 7/8 dòng mẫu import OK |
| 2 | Media hoàn chỉnh | ✅ Done | 100% | E2E audio/video mẫu mầm non OK |
| 3 | Loại câu hỏi mở rộng | ✅ Done | 100% | FIB/WB/NUMG E2E; DND skip rõ ràng |
| 4 | Layout & canvas sau import | ✅ Done | 100% | Reflow sau import, 0 overlap error |
| 5 | UX import | ✅ Done | 100% | Form, tải template, báo cáo + link slide |
| 6 | QA & export LMS | ✅ Done | 100% | pytest matrix + SCORM 1.2 export validate |

**Thứ tự đề xuất:** Phase 2 → 4 → 3 → 5 → 6

---

## Baseline test (Sample_import_template.xls)

Chạy lần cuối: **2026-06-29**

| Metric | Kết quả |
|--------|---------|
| Tổng dòng | 8 |
| Imported | 7 |
| Skipped | 0 (NUMG giờ import được) |
| Errors | 0 |
| Ảnh | Copy vào `res/data/images/`, gắn `slide.at.i` (`storage://images/img-import-...`) |

## Baseline test media (Media_import_sample.xlsx — mầm non)

Chạy lần cuối: **2026-06-29** — `pytest tests/test_media_import.py`

| Metric | Kết quả |
|--------|---------|
| Tổng dòng | 4 |
| Imported | 4 (MC+voice, TF+voice, IS+video, MC+voice+video) |
| Errors | 0 |
| Warnings | 0 |
| Audio | 3 file `snd-import-*.mp3` → `slide.at.a` + `rs.a` |
| Video | 2 file `vid-import-*.mp4` → `slide.at.v` + poster + `rs.v` |
| API/UI | `POST /api/import/excel/media-sample`, nút *Import mẫu Audio/Video* |

---

## Phase 0 — SCORM Editor core ✅

- [x] Mở / chỉnh sửa package SCORM iSpring
- [x] Preview Slide View
- [x] Save thay đổi (quiz JSON + assets)
- [x] Export SCORM zip
- [x] Điểm từng câu (`slide.s.e.pt`, `t: byQuestion`)
- [x] Reporting / email (proxy CORS, `apply_reporting_settings`)
- [x] Light theme + contrast chữ

---

## Phase 1 — Excel MVP ✅

### Đã có

- [x] Parser `.xls` / `.xlsx` — cột Question Type, Text, Answers 1–10, Image/Video/Audio, Feedback, Points
- [x] Map loại: MC, MR, TF, TI/SA, SEQ, MG/MA, FIB/FITB, WB, IS; NUMG parse nhưng skip
- [x] Validate cơ bản theo loại câu
- [x] `resolve_media_path()` — tìm file theo đường dẫn tương đối / tên file / `media/`
- [x] Builder: MC, MR, TF, Sequence, Matching, TypeIn, WordBank, FillInTheBlank, InfoSlide
- [x] API `POST /api/import/excel` (file + zip Excel+media)
- [x] API `POST /api/import/excel/sample`
- [x] UI: dropzone, nút import mẫu, `ImportReport` theo dòng
- [x] Copy ảnh vào package, gắn vào choice đầu tiên

### Ghi chú

- UI tải template / zip re-test → chuyển **Phase 5** và **Phase 6**

---

## Phase 2 — Media hoàn chỉnh ✅

- [x] 🔴 `ensure_media_registry()` ngay sau import (image + audio + video)
- [x] 🔴 Warning trong import report khi media thiếu (image/video/audio không tìm thấy)
- [x] Gắn ảnh câu hỏi qua `slide.at` + `slidePicture` (không gắn choice đầu)
- [x] Ảnh per-answer — parse `[media\file.jpg]` trong ô Answer
- [x] TF image-only — cho phép thiếu text khi có cột Image
- [x] Audio: copy → `res/data/audios/` → `slide.at.a` + `slideAudio` object
- [x] Video: copy → `res/data/videos/` → `slide.at.v` (cần poster = ảnh câu hỏi)
- [x] Test E2E audio/video — `Media_import_sample.xlsx` + `pytest tests/test_media_import.py`
- [x] Ảnh/audio/video **đáp án** — `[image=]`, `[audio=]`, `[video=]` trong ô Answer
- [x] Ảnh/audio/video **feedback** đúng/sai — `slide.s.F.c/i` + rich `v.r`
- [x] Editor hiển thị audio/video đáp án và feedback (`extract_choices`, `get_feedback`)

---

## Phase 3 — Loại câu hỏi mở rộng ✅

- [x] 🔴 FIB — test E2E `FIB_WB_import_sample.xlsx` + `rt.r` đáp án
- [x] 🔴 WB — test E2E + `ew` từ từ nhiễu, `rt.r` từ đáp án *
- [x] Numeric (NUMG/NUM): clone TypeIn template, builder + validate
- [x] DND/DIB/HS/Essay — skip có lý do (không import Excel)
- [x] `SUPPORTED_TYPES` + `SKIP_IMPORT_TYPES` + báo cáo skip/error rõ ràng

### Baseline test FIB/WB/NUMG (FIB_WB_import_sample.xlsx)

Chạy lần cuối: **2026-06-29** — `pytest tests/test_phase3_types.py`

| Metric | Kết quả |
|--------|---------|
| Tổng dòng | 3 |
| Imported | 3 (FIB, WB, NUMG) |
| Errors | 0 |
| API/UI | `POST /api/import/excel/fib-wb-sample` |

---

## Phase 4 — Layout & canvas sau import ✅

- [x] Reflow layout slide sau khi inject nội dung dài / nhiều đáp án (`reflow_imported_slide`)
- [x] TF + ảnh hiển thị đúng trên `LayoutCanvas` (cc=2, ảnh không chồng content)
- [x] Matching / Sequence — căn chỉnh cặp / thứ tự trên canvas
- [x] WordBank / FIB — blank span `rt.h` + `rt.d` khớp preview

---

## Phase 5 — UX import ✅

- [x] Form UI: `quiz_title`, `group_title` — truyền vào mọi import Excel
- [x] Tải template: `GET /api/import/excel/templates`, link 3 file mẫu + hướng dẫn cột
- [x] Báo cáo: banner trong editor, link Mở slide #N, nhóm cảnh báo media
- [x] Loading: spinner trên dropzone theo loại Excel/SCORM; error banner rõ ràng

---

## Phase 6 — QA & export LMS ✅

- [x] Ma trận test: 3 template × import → save → export (`tests/test_qa_e2e.py`)
- [x] Export zip SCORM 1.2 — validate `imsmanifest.xml`, index quiz, re-open session
- [x] Slide View: preview player mock SCORM API + reporting proxy smoke test
- [x] Regression: sửa câu/điểm sau import → save → export → dữ liệu khớp

### Baseline QA (pytest tests/test_qa_e2e.py)

Chạy lần cuối: **2026-06-29**

| Metric | Kết quả |
|--------|---------|
| Ma trận template | 3/3 pass (sample 8 loại, media 4, FIB/WB 3) |
| Save + export roundtrip | OK |
| SCORM version | 1.2 (iSpring MASTER) |
| Regression edit | OK |
| API save/export/preview | OK |
| LMS upload thủ công | Xem checklist bên dưới |

### Checklist upload LMS (thủ công)

1. Export zip từ editor → upload LMS hỗ trợ SCORM 1.2
2. Làm bài: MC, TF, NUMG, media (audio/video)
3. Kiểm tra điểm từng câu + màn hình kết quả
4. Bật reporting email → thử gửi (cần LMS hoặc preview proxy)

---

## Changelog

| Ngày | Phase | Thay đổi |
|------|-------|----------|
| 2026-06-29 | — | Tạo file plan tracking; baseline 7/8 imported từ sample |
| 2026-06-29 | 0 | Hoàn thành: điểm từng câu, reporting proxy, light theme |
| 2026-06-29 | 1 | MVP parser + builder + API + UI; ảnh choice đầu |
| 2026-06-29 | 2 | Media registry sau import; slide.at ảnh/audio/video; warnings; per-answer image |
| 2026-06-29 | 1 | Đóng Phase 1 — MVP hoàn tất |
| 2026-06-29 | 2 | E2E mầm non: voice_question/feedback.mp3, sample_lesson.mp4; media-sample API |
| 2026-06-29 | 2 | Đóng Phase 2 — media local hoàn tất |
| 2026-06-29 | 2+ | Media đáp án + feedback (ảnh/audio/video); tests/test_answer_feedback_media.py |
| 2026-06-29 | — | Tạo MEDIA_TEMPLATE_SPEC.md — đặc tả template + ví dụ mầm non |
| 2026-06-29 | 4 | `reflow_imported_slide` sau import; auto_layout TF/SEQ/MG/WB/FIB; tests/test_layout_import.py |
| 2026-06-29 | 4 | Đóng Phase 4 — 0 overlap error trên sample 7 slides |
| 2026-06-29 | 3 | FIB/WB rt.r + Numeric import; FIB_WB_import_sample.xlsx; tests/test_phase3_types.py |
| 2026-06-29 | 3 | Đóng Phase 3 — NUMG 8/8 imported từ Sample_import_template.xls |
| 2026-06-29 | 5 | Form quiz/group title; tải template API; ImportReport + banner editor |
| 2026-06-29 | 5 | Đóng Phase 5 — tests/test_import_ux.py |
| 2026-06-29 | 6 | QA matrix + export validate + regression; tests/test_qa_e2e.py |
| 2026-06-29 | 6 | Đóng Phase 6 — 29 pytest pass, SCORM 1.2 export OK |

---

## Ghi chú kỹ thuật

- **Points import:** `quiz_builder._set_points()` — `s.e.pt`, `t: "byQuestion"`, `p/atp: 0`
- **Ảnh câu hỏi:** `slide.at.i` + object `slidePicture` trong `a.o`
- **Ảnh đáp án:** `choice.ia.i` — parse `[path\to\img.jpg]` trong ô Answer
- **Audio:** `slide.at.a` → `storage://sounds/snd-import-{uuid}.ext` → `rs.a`
- **Video:** `slide.at.v` → `storage://videos/vid-import-{uuid}.ext` + poster `pi` từ ảnh câu hỏi
- **Registry:** `ensure_media_registry()` gọi sau import và khi Save
- **NUMG:** đáp án `=5` hoặc `5` → `C.chs[].t`; template clone từ TypeIn
- **SKIP_IMPORT_TYPES:** DND, DIB, Hotspot, Essay, LikertScale → `status: skipped` + lý do
- **FIB/WB:** `rt.r` gắn đáp án blank; WB `ew` = từ nhiễu (không gồm đáp án *)
- **TrueFalse template:** lấy từ session hoặc clone từ MC nếu MASTER không có
- **Layout sau import:** `quiz_builder._apply_row_to_slide` → `layout.reflow_imported_slide()` (typography + media overlap)
- **WB/FIB import:** `rt.h` giữ `<span id="qmWordBank\d+">` / `qmFillInTheBlank\d+`; `rt.d` sync blank id
- **Reporting iSpring:** `d.s.r` — `ss`, `ads`, `sts`; email qua `https://s4.ispringsolutions.com/quiz_results`