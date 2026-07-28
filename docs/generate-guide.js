/**
 * Generate SCORM Editor detailed user guide (Word .docx)
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TableOfContents,
} = require('docx');
const fs = require('fs');
const path = require('path');

// ── Layout (A4) ────────────────────────────────────────────────────────────
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1008; // 0.7"
const CONTENT_W = PAGE_W - MARGIN * 2; // 9890

const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const headerBorder = { style: BorderStyle.SINGLE, size: 4, color: "1F4E79" };
const headerBorders = { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder };

const BLUE = "1F4E79";
const BLUE_LIGHT = "D6E3F0";
const GRAY = "F5F5F5";
const GREEN = "E2EFDA";
const YELLOW = "FFF2CC";
const ORANGE = "FCE4D6";

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: opts.line },
    alignment: opts.align,
    ...opts.para,
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: opts.size || 22, // 11pt
        font: "Arial",
        color: opts.color,
      }),
    ],
  });
}

function runs(parts, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0 },
    alignment: opts.align,
    children: parts.map((part) =>
      typeof part === "string"
        ? new TextRun({ text: part, size: opts.size || 22, font: "Arial" })
        : new TextRun({ size: opts.size || 22, font: "Arial", ...part })
    ),
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, font: "Arial", color: BLUE })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text, bold: true, size: 26, font: "Arial", color: BLUE })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: "Arial", color: "2E75B6" })],
  });
}

function bullet(text, ref = "bullets") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, font: "Arial" })],
  });
}

function bulletBold(label, rest, ref = "bullets") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [
      new TextRun({ text: label, bold: true, size: 22, font: "Arial" }),
      new TextRun({ text: rest, size: 22, font: "Arial" }),
    ],
  });
}

function num(text, ref = "numbers") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, font: "Arial" })],
  });
}

function codeBlock(lines) {
  const items = (Array.isArray(lines) ? lines : String(lines).split("\n")).map(
    (line) =>
      new Paragraph({
        spacing: { after: 40 },
        shading: { fill: GRAY, type: ShadingType.CLEAR },
        children: [
          new TextRun({
            text: line || " ",
            font: "Consolas",
            size: 18,
            color: "333333",
          }),
        ],
      })
  );
  return items;
}

function note(text) {
  return new Paragraph({
    spacing: { before: 100, after: 140 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: "2E75B6", space: 8 },
    },
    indent: { left: 200 },
    children: [
      new TextRun({ text: "Lưu ý: ", bold: true, size: 20, font: "Arial", color: "2E75B6" }),
      new TextRun({ text, size: 20, font: "Arial", italics: true }),
    ],
  });
}

function cell(text, opts = {}) {
  const w = opts.w || 2000;
  const fill = opts.fill;
  const isHeader = opts.header;
  return new TableCell({
    borders: isHeader ? headerBorders : borders,
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: String(text ?? ""),
            bold: isHeader || opts.bold,
            size: opts.size || 18,
            font: "Arial",
            color: isHeader ? "FFFFFF" : opts.color,
          }),
        ],
      }),
    ],
  });
}

function table(headers, rows, colWidths) {
  const widths = colWidths || headers.map(() => Math.floor(CONTENT_W / headers.length));
  // Fix last col to sum exactly
  let sum = widths.reduce((a, b) => a + b, 0);
  if (sum !== CONTENT_W) widths[widths.length - 1] += CONTENT_W - sum;

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: headers.map((h, i) => cell(h, { w: widths[i], header: true, fill: BLUE })),
      }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((c, i) =>
            cell(c, {
              w: widths[i],
              fill: ri % 2 === 0 ? GRAY : undefined,
            })
          ),
        })
      ),
    ],
  });
}

function spacer(after = 120) {
  return new Paragraph({ spacing: { after }, children: [] });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ── Document body ──────────────────────────────────────────────────────────

const children = [
  // COVER
  spacer(1200),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "TÀI LIỆU HƯỚNG DẪN", bold: true, size: 28, font: "Arial", color: "666666" })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: BLUE, space: 8 } },
    children: [new TextRun({ text: "SCORM EDITOR", bold: true, size: 56, font: "Arial", color: BLUE })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text: "Hướng dẫn chi tiết toàn bộ tính năng", size: 28, font: "Arial", color: "333333" })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: "Import · Chỉnh sửa · Preview · Export SCORM & Teky JSON", size: 22, font: "Arial", color: "666666" })],
  }),
  spacer(600),
  table(
    ["Thông tin", "Giá trị"],
    [
      ["Phiên bản tài liệu", "1.0"],
      ["Ứng dụng", "SCORM Editor (Full-stack)"],
      ["Backend", "Python FastAPI"],
      ["Frontend", "React + Vite"],
      ["Chuẩn SCORM", "SCORM 1.2 (iSpring Quiz Maker)"],
      ["JSON CMS", "Teky-school schema (scorm-cvt compatible)"],
      ["Cập nhật", "2026-07-28"],
    ],
    [3500, CONTENT_W - 3500]
  ),
  spacer(400),
  p("Tài liệu này mô tả đầy đủ quy trình làm việc, đầu vào / đầu ra, các loại câu hỏi, media, canvas layout, API và quy ước export — dùng cho người biên soạn nội dung, QA và kỹ thuật tích hợp LMS.", { italics: true, size: 20, color: "555555" }),

  pageBreak(),

  // TOC
  h1("Mục lục"),
  new TableOfContents("Mục lục", { hyperlink: true, headingStyleRange: "1-3" }),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("1. Giới thiệu tổng quan"),
  h2("1.1. SCORM Editor là gì?"),
  p("SCORM Editor là ứng dụng web full-stack giúp mở, chỉnh sửa và xuất gói bài kiểm tra SCORM 1.2 được tạo từ iSpring Quiz Maker. Ứng dụng hỗ trợ hai luồng nhập liệu chính: import gói SCORM có sẵn, hoặc tạo quiz mới từ file Excel theo chuẩn iSpring, sau đó chỉnh sửa trên canvas, xem preview và export ra LMS hoặc JSON Teky-school."),

  h2("1.2. Luồng làm việc tổng quát"),
  ...codeBlock([
    "  [INPUT]  SCORM .zip  ─────────────────┐",
    "           Excel .xls/.xlsx ────────────┼──► Editor (session) ──► [OUTPUT]",
    "           Excel.zip + media/ ──────────┘",
    "                                              ├─ SCORM 1.2 .zip  (LMS)",
    "                                              ├─ Teky JSON       (*_teky.json)",
    "                                              └─ Media zip/local",
  ]),

  h2("1.3. Kiến trúc kỹ thuật"),
  table(
    ["Thành phần", "Công nghệ", "Vai trò"],
    [
      ["Backend", "Python FastAPI", "Parse SCORM/Excel, session, save, export, preview player"],
      ["Frontend", "React + Vite", "UI import, editor, canvas, preview, toolbar"],
      ["Session storage", "backend/data/sessions/", "Mỗi lần import tạo session riêng (package + quiz JSON)"],
      ["MASTER SCORM", "DGSA_Level5_Bài 1_...", "Template slide khi tạo quiz từ Excel"],
      ["Import templates", "ImportTemplate/", "File Excel mẫu + thư mục media"],
    ],
    [2200, 2800, CONTENT_W - 5000]
  ),
  spacer(),

  h2("1.4. Cấu trúc thư mục dự án"),
  ...codeBlock([
    "scorm-editor/",
    "├── backend/",
    "│   ├── app/",
    "│   │   ├── main.py           # API endpoints",
    "│   │   ├── scorm_parser.py   # Decode/encode iSpring, view, save, export zip",
    "│   │   ├── excel_import.py  # Parse Excel iSpring + media brackets",
    "│   │   ├── quiz_builder.py  # Inject Excel → quiz JSON + layout reflow",
    "│   │   ├── cms_export.py    # Export Teky-school JSON",
    "│   │   ├── media_rich.py    # Audio/video/image rich text",
    "│   │   ├── layout.py        # Canvas layout / reflow",
    "│   │   ├── typography.py    # Typography auto-layout",
    "│   │   ├── preview.py       # Preview player + report proxy",
    "│   │   └── fonts.py         # Fonts iSpring embedded",
    "│   ├── tests/               # pytest E2E",
    "│   └── data/sessions/       # Runtime sessions",
    "├── frontend/src/            # React UI",
    "├── docs/                    # Đặc tả + plan",
    "├── README.md",
    "└── start.sh                 # Chạy nhanh local",
  ]),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("2. Cài đặt và khởi chạy"),
  h2("2.1. Yêu cầu hệ thống"),
  bullet("Python 3+ (backend)"),
  bullet("Node.js & npm (frontend build)"),
  bullet("Trình duyệt hiện đại (Chrome / Edge / Firefox / Safari)"),

  h2("2.2. Chạy nhanh bằng start.sh"),
  num("Mở Terminal, vào thư mục scorm-editor."),
  num("Cấp quyền thực thi: chmod +x start.sh"),
  num("Chạy: ./start.sh"),
  p("Script sẽ: tạo venv Python → cài requirements → npm install frontend → npm run build → khởi động uvicorn port 8000."),
  p("Truy cập: http://localhost:8000", { bold: true }),

  h2("2.3. Chạy thủ công"),
  h3("Frontend"),
  ...codeBlock([
    "cd frontend",
    "npm install",
    "npm run build",
    "cd ..",
  ]),
  h3("Backend"),
  ...codeBlock([
    "cd backend",
    "python3 -m venv .venv",
    "source .venv/bin/activate   # Windows: .venv\\Scripts\\activate",
    "pip install -r requirements.txt",
    "uvicorn app.main:app --host 0.0.0.0 --port 8000",
  ]),

  h2("2.4. Chạy test tự động"),
  ...codeBlock([
    "cd scorm-editor/backend",
    ".venv/bin/pytest tests/ -v",
  ]),
  p("Bao gồm: media import, answer/feedback media, layout import, phase3 types, import UX, QA E2E export SCORM."),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("3. Đầu vào (Input)"),
  h2("3.1. Gói SCORM iSpring (.zip)"),
  p("Import package SCORM 1.2 đã xuất từ iSpring Quiz Maker để chỉnh sửa nội dung, layout và media."),
  table(
    ["Mục", "Chi tiết"],
    [
      ["API", "POST /api/import"],
      ["File", ".zip (hỗ trợ zip lồng zip)"],
      ["Yêu cầu bên trong", "imsmanifest.xml + res/index.html"],
      ["Dữ liệu quiz", "Base64 trong HTML (var data = base64) decode UTF-8 JSON iSpring"],
      ["UI", "Dropzone «Chỉnh sửa SCORM có sẵn» hoặc Load mẫu ZIP/thư mục"],
    ],
    [2800, CONTENT_W - 2800]
  ),
  spacer(),
  note("Nội dung quiz iSpring dùng key ngắn (d, sl, tp, C, rs…). Editor không yêu cầu người dùng chỉnh trực tiếp JSON thô này."),

  h2("3.2. Excel iSpring QuizMaker"),
  p("Tạo quiz mới dựa trên MASTER SCORM (slide templates), inject từng dòng Excel thành slide."),
  table(
    ["Mục", "Chi tiết"],
    [
      ["API", "POST /api/import/excel"],
      ["File", ".xls / .xlsx hoặc .zip"],
      ["Zip", "Chứa file Excel + thư mục media/ cùng cấp"],
      ["Form options", "quiz_title, group_title"],
      ["UI", "Dropzone Excel + form tên quiz/nhóm + nút import mẫu"],
    ],
    [2800, CONTENT_W - 2800]
  ),
  spacer(),

  h3("3.2.1. Cột Excel (hàng 1 = header)"),
  table(
    ["Cột", "Bắt buộc", "Mô tả"],
    [
      ["Question Type", "Có", "MC, MR, TF, TI, SEQ, MG, FIB, WB, IS, NUMG…"],
      ["Question Text", "Có*", "Nội dung câu hỏi (*TF có thể chỉ có Image)"],
      ["Image", "Không", "Ảnh câu hỏi (slide) — đường dẫn tương đối"],
      ["Audio", "Không", "Audio đọc đề"],
      ["Video", "Không", "Video bài học; cần poster (cột Image)"],
      ["Answer 1 … Answer 10", "Theo loại", "Đáp án; * = đúng; brackets media"],
      ["Correct Feedback", "Không", "Phản hồi khi đúng + media"],
      ["Incorrect Feedback", "Không", "Phản hồi khi sai + media"],
      ["Points", "Không", "Điểm câu hỏi"],
    ],
    [2600, 1200, CONTENT_W - 3800]
  ),
  spacer(),

  h3("3.2.2. Map loại câu hỏi Excel → iSpring"),
  table(
    ["Mã Excel", "Loại iSpring", "Ghi chú"],
    [
      ["MC", "MultipleChoice", "Trắc nghiệm 1 đáp án đúng"],
      ["MR", "MultipleResponse", "Chọn nhiều"],
      ["TF", "TrueFalse", "Đúng / Sai"],
      ["TI / SA", "TypeIn", "Nhập câu trả lời ngắn"],
      ["NUM / NUMG", "Numeric", "Số (clone template TypeIn)"],
      ["SEQ", "Sequence", "Sắp xếp thứ tự"],
      ["MG / MA", "Matching", "Nối cặp"],
      ["FIB / FITB", "FillInTheBlank", "Điền khuyết"],
      ["WB", "WordBank", "Kéo từ vào chỗ trống"],
      ["IS", "InfoSlide", "Slide thông tin (không chấm điểm)"],
      ["DND, DIB, HS, ESSAY, LIKERT", "—", "Parse nhưng SKIP (không import Excel)"],
    ],
    [2200, 2600, CONTENT_W - 4800]
  ),
  spacer(),

  h3("3.2.3. Cú pháp media trong ô Excel (brackets)"),
  p("Parser: parse_media_brackets() trong excel_import.py."),
  p("Cú pháp rõ ràng (khuyến nghị):", { bold: true }),
  ...codeBlock([
    "[image=media\\ten_anh.jpg]",
    "[audio=media\\ten_audio.mp3]",
    "[video=media\\ten_video.mp4]",
    "[sound=media\\ten_audio.mp3]    ← alias của audio",
  ]),
  p("Cú pháp ngắn theo đuôi file:", { bold: true }),
  ...codeBlock([
    "[media\\anh.png]      → image",
    "[media\\voice.mp3]    → audio",
    "[media\\clip.mp4]     → video",
  ]),
  p("Đáp án đúng + media:", { bold: true }),
  ...codeBlock([
    "*Con heo [audio=media\\voice_heo.mp3]",
    "*Đáp án A [image=media\\icon_a.png]",
  ]),
  p("Nhiều media trong một ô (feedback):", { bold: true }),
  ...codeBlock([
    "Giỏi lắm! [audio=media\\voice_chuc.mp3] [image=media\\star.png]",
    "Thử lại nhé [audio=media\\voice_goi_y.mp3] [image=media\\goi_y.jpg]",
  ]),

  h3("3.2.4. Định dạng file media hỗ trợ"),
  table(
    ["Loại", "Đuôi file"],
    [
      ["Ảnh", ".jpg .jpeg .png .gif .bmp .webp"],
      ["Audio", ".mp3 .wav .m4a .ogg"],
      ["Video", ".mp4 .webm .mov"],
    ],
    [2500, CONTENT_W - 2500]
  ),
  spacer(),

  h3("3.2.5. File mẫu có sẵn"),
  table(
    ["File", "Vai trò", "API / nút UI"],
    [
      ["Sample_import_template.xls", "Đầy đủ MC/MR/TF/TI/MG/SEQ/IS/NUMG", "Import mẫu Excel"],
      ["Media_import_sample.xlsx", "Audio/video mầm non", "Import mẫu Audio/Video"],
      ["FIB_WB_import_sample.xlsx", "FIB, Word Bank, Numeric", "Import mẫu FIB / WB / Numeric"],
      ["media/", "Ảnh, voice_*.mp3, sample_lesson.mp4", "Cùng cấp Excel trong zip"],
    ],
    [3200, 3400, CONTENT_W - 6600]
  ),
  spacer(),

  h2("3.3. Nguyên tắc media"),
  bullet("Media local only — copy vào package SCORM; không dùng direct URL (YouTube, Drive…)."),
  bullet("Video luôn cần ảnh poster (cột Image hoặc [image=...] trong cùng ô)."),
  bullet("Media thiếu file → warning trong ImportReport, không fail cả dòng."),
  bullet("Sau import: ensure_media_registry() đăng ký rs.i / rs.a / rs.v."),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("4. Giao diện và tính năng Editor"),
  h2("4.1. Trang Import"),
  p("Hai khu vực chính:"),
  bulletBold("Tạo quiz từ Excel: ", "form tên quiz / nhóm; hướng dẫn cột; tải template; dropzone; 3 nút import mẫu."),
  bulletBold("Chỉnh sửa SCORM có sẵn: ", "dropzone .zip; Load mẫu ZIP / thư mục."),
  p("ImportReport sau Excel: số imported / errors / skipped / media warnings; link «Mở slide #N»."),

  h2("4.2. Meta quiz"),
  table(
    ["Trường", "Mô tả"],
    [
      ["Tên quiz", "Ghi vào d.T của iSpring"],
      ["Điểm đạt (%)", "passingScore — Result slide threshold"],
      ["Reporting — Gửi server", "Bật + URL nhận kết quả"],
      ["Reporting — Email admin", "Bật + danh sách email + filter (passed/failed/both)"],
      ["Reporting — Email học viên", "Bật + filter"],
    ],
    [3200, CONTENT_W - 3200]
  ),
  spacer(),

  h2("4.3. Danh sách câu hỏi"),
  bullet("Hiển thị theo nhóm (groups) và thứ tự slide."),
  bullet("Chọn slide để chỉnh trên panel Nội dung / Canvas / Preview."),
  bullet("Xóa câu hỏi (nếu editable)."),
  bullet("Hiển thị loại câu (type), điểm, preview ngắn nội dung."),

  h2("4.4. Tab Nội dung (Question Editor)"),
  h3("Câu hỏi"),
  bullet("Sửa questionText (textarea / rich text tùy loại)."),
  bullet("Định dạng chữ qua TextFormatToolbar (font, cỡ, đậm, nghiêng, màu…)."),
  bullet("Điểm (points), giới hạn thời gian, xáo đáp án (shuffle)."),

  h3("Đáp án theo loại"),
  table(
    ["Loại", "Chỉnh sửa trên tab Nội dung"],
    [
      ["MultipleChoice / MR / TF", "choices[]: text, isCorrect, image, audio, video"],
      ["Sequence", "choices / sequenceItems + thứ tự"],
      ["Matching", "matchingPairs (left/right text + image)"],
      ["TypeIn / Numeric", "typeInAnswers[]"],
      ["FIB / WordBank", "blankAnswers, richHtml, wordBankWords (từ nhiễu)"],
      ["InfoSlide", "Nội dung thông tin / media"],
      ["Hotspot / DND…", "Hạn chế — ưu tiên Canvas; notice readonly/partial"],
    ],
    [3200, CONTENT_W - 3200]
  ),
  spacer(),

  h3("Feedback đúng / sai"),
  table(
    ["Field view", "Ý nghĩa"],
    [
      ["correct / incorrect", "Text phản hồi"],
      ["correctAudio / incorrectAudio", "File trong res/data/audios/"],
      ["correctImage / incorrectImage", "Ảnh inline feedback"],
      ["correctVideo / incorrectVideo", "Video inline feedback"],
    ],
    [3600, CONTENT_W - 3600]
  ),
  spacer(),

  h2("4.5. Tab Canvas (LayoutCanvas)"),
  p("Chỉnh layout trực quan theo tọa độ object iSpring (hình, text, đáp án, media)."),
  bullet("Kéo thả / resize object trên canvas."),
  bullet("Sửa text inline (CanvasEditableText / CanvasRichText)."),
  bullet("Icon, shape, typography; font nhúng từ package."),
  bullet("Choice layout: reflow hàng đáp án MC/MR/TF/Sequence theo mô hình SCORM Slide View."),
  bullet("Matching preview; blank HTML cho FIB/WB."),
  bullet("Hotspot / kéo thả: chỉnh layout trên Canvas (nội dung đáp án hạn chế)."),
  note("Sau import Excel, backend gọi reflow_imported_slide() để giảm overlap text/media."),

  h2("4.6. Tab / vùng Preview"),
  bullet("QuizPreview + preview player: GET /api/session/{id}/preview/player"),
  bullet("Mock SCORM API trong player để làm thử bài."),
  bullet("Report proxy: POST .../preview/report-proxy (CORS) — host cho phép ispringsolutions.com, teky.vn."),
  bullet("Điều hướng slideId / qIndex / result slides."),

  h2("4.7. Auto-save & lịch sử"),
  bulletBold("useAutoSync: ", "đồng bộ thay đổi dirty fields lên server (PUT session)."),
  bulletBold("useQuizHistory: ", "undo/redo các thao tác chỉnh sửa trên editor."),
  bullet("Save ghi quiz JSON vào package (quiz_data.json) và encode lại base64 trong index.html."),
  bullet("ensure_media_registry() chạy khi Save."),

  h2("4.8. Upload / thay ảnh"),
  bullet("POST /api/session/{id}/asset/{filename} — thay thế file ảnh trong package."),
  bullet("uploadNewImage tạo tên img-{uuid}.ext."),
  bullet("Asset URL editor: GET /api/session/{id}/asset/{filename}."),
  note("Upload audio/video trực tiếp từ UI editor hiện hạn chế — ưu tiên re-import Excel hoặc gán file local trong package."),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("5. Media — ánh xạ SCORM / iSpring"),
  h2("5.1. Ma trận media theo vị trí"),
  table(
    ["Vị trí", "Ảnh", "Audio", "Video", "Khai báo Excel"],
    [
      ["Câu hỏi", "Có", "Có", "Có", "Cột Image / Audio / Video"],
      ["Đáp án", "Có", "Có", "Có", "Brackets trong Answer N"],
      ["Feedback đúng", "Có", "Có", "Có", "Correct Feedback"],
      ["Feedback sai", "Có", "Có", "Có", "Incorrect Feedback"],
    ],
    [2000, 1000, 1000, 1000, CONTENT_W - 5000]
  ),
  spacer(),

  h2("5.2. Storage & registry"),
  ...codeBlock([
    "storage://images/{filename}",
    "storage://sounds/{filename}",
    "storage://videos/{filename}",
    "",
    "rs.i  → registry ảnh",
    "rs.a  → registry audio  (mảng {m, s})",
    "rs.v  → registry video  (mảng {m, s})",
  ]),
  p("File copy vào package:", { bold: true }),
  bullet("Ảnh: res/data/images/img-import-*.ext"),
  bullet("Audio: res/data/audios/snd-import-*.ext"),
  bullet("Video: res/data/videos/vid-import-*.ext"),

  h2("5.3. JSON object iSpring (tóm tắt)"),
  table(
    ["Media", "JSON / object", "Ghi chú"],
    [
      ["Ảnh câu hỏi", "slide.at.i + slidePicture trong a.o", "Không gắn vào choice đầu"],
      ["Audio câu hỏi", "slide.at.a + slideAudio", ""],
      ["Video câu hỏi", "slide.at.v (+ pi poster) + slideVideo", "Bắt buộc poster"],
      ["Ảnh đáp án", "choice.ia.i", "Icon / ảnh lựa chọn"],
      ["Audio đáp án", "choice.f.a", "Voice từng đáp án (mầm non)"],
      ["Video đáp án", "choice.t.r[] type video", "Cần poster = ảnh đáp án"],
      ["Feedback text", "slide.s.F.c.v / slide.s.F.i.v", "h, d, t"],
      ["Feedback audio", "slide.s.F.c.a / slide.s.F.i.a", ""],
      ["Feedback inline media", "slide.s.F.c.v.r[]", "image / video rich"],
    ],
    [2400, 3800, CONTENT_W - 6200]
  ),
  spacer(),

  h2("5.4. Mẫu thiết kế mầm non (voice-first)"),
  ...codeBlock([
    "Câu hỏi:  Audio (đọc đề) + Image (minh họa) + Video (tùy chọn)",
    "Đáp án:   text ngắn + [audio=...] riêng  hoặc [image=...]",
    "Feedback: Đúng → voice chúc mừng; Sai → voice gợi ý + ảnh",
  ]),
  p("Gợi ý đặt tên file media:", { bold: true }),
  ...codeBlock([
    "media/",
    "  voice_de_cau_01.mp3",
    "  voice_dap_an_a.mp3",
    "  voice_dung.mp3",
    "  voice_sai_goi_y.mp3",
    "  hinh_cau_01.jpg",
    "  clip_gioi_thieu.mp4",
  ]),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("6. JSON trung gian (Editor View)"),
  p("Sau import, API trả view phẳng cho UI (không phải raw iSpring). Dùng cho hiển thị, chỉnh sửa và SavePayload."),
  h2("6.1. Cấu trúc quiz view"),
  ...codeBlock([
    "{",
    '  "sessionId": "...",',
    '  "title": "Tên quiz",',
    '  "passingScore": 80,',
    '  "reporting": {',
    '    "sendToServer": { "enabled": false, "url": "" },',
    '    "adminEmail": { "enabled": false, "emails": "", "filter": "passedAndFailed" },',
    '    "studentEmail": { "enabled": false, "filter": "passedAndFailed" }',
    "  },",
    '  "groups": [{ "title": "...", "questionCount": N }],',
    '  "introSlide": { ... },',
    '  "resultSlides": [ ... ],',
    '  "questions": [ /* slide_to_view */ ],',
    '  "questionCount": N',
    "}",
  ]),

  h2("6.2. Cấu trúc một câu hỏi (slide view)"),
  ...codeBlock([
    "{",
    '  "id": "slide-id",',
    '  "type": "MultipleChoice",',
    '  "slideRole": "question",',
    '  "groupIndex": 0,',
    '  "questionIndex": 0,',
    '  "groupTitle": "Imported Questions",',
    '  "questionText": "...",',
    '  "questionFormat": { ... },',
    '  "feedback": { "correct": "...", "incorrect": "...", ... },',
    '  "choices": [{ "id", "text", "isCorrect", "image", "audio", "video" }],',
    '  "matchingPairs": [],',
    '  "sequenceItems": [],',
    '  "typeInAnswers": [],',
    '  "blankAnswers": [],',
    '  "wordBankWords": [],',
    '  "slideImages": ["img-....jpg"],',
    '  "editableLevel": "full|partial|readonly",',
    '  "points": 1,',
    '  "timeLimit": 0,',
    '  "timeLimitEnabled": false,',
    '  "shuffleAnswers": false,',
    '  "layout": { ... }',
    "}",
  ]),

  h2("6.3. SavePayload (PUT session)"),
  ...codeBlock([
    "{",
    '  "title": "...",',
    '  "passingScore": 80,',
    '  "reporting": { ... },',
    '  "introSlide": { ... },',
    '  "resultSlides": [ ... ],',
    '  "questions": [ /* chỉnh từ view */ ]',
    "}",
  ]),
  p("Backend apply_question_edit + apply_quiz_meta + apply_reporting_settings → ghi lại iSpring quiz JSON."),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("7. Đầu ra (Export)"),
  h2("7.1. Export SCORM 1.2 (.zip) — LMS"),
  table(
    ["Mục", "Chi tiết"],
    [
      ["API", "POST /api/session/{id}/export"],
      ["Body", '{ "title": "tùy chọn" }'],
      ["Kết quả", "application/zip — gói SCORM 1.2"],
      ["Nội dung", "imsmanifest.xml + res/ + index.html (quiz base64 đã cập nhật)"],
      ["Validate", "pytest QA: re-open session, imsmanifest OK"],
    ],
    [2400, CONTENT_W - 2400]
  ),
  spacer(),
  p("Checklist upload LMS:", { bold: true }),
  num("Export zip từ editor → upload LMS hỗ trợ SCORM 1.2."),
  num("Làm thử: MC, TF, NUMG, media audio/video."),
  num("Kiểm tra điểm từng câu + màn hình kết quả."),
  num("Bật reporting email → thử gửi (LMS hoặc preview proxy)."),

  h2("7.2. Export Teky-school JSON (CMS)"),
  table(
    ["Mục", "Chi tiết"],
    [
      ["API", "POST /api/session/{id}/export-cms-json-local"],
      ["File", "~/Downloads/SNLT-CHECKQUIZ/JSON-EXPORT/{title}_teky.json"],
      ["Schema", "Giống scorm-cvt parseScormToTekyJson"],
      ["Format file", "Mảng bọc: [ quiz_object ]"],
      ["Ảnh", "Path tương đối images/<filename> (không base64)"],
      ["Code", "backend/app/cms_export.py → quiz_to_cms_json()"],
    ],
    [2400, CONTENT_W - 2400]
  ),
  spacer(),

  h3("7.2.1. Object quiz Teky"),
  ...codeBlock([
    "[",
    "  {",
    '    "id": "quiz_1780130018131",',
    '    "title": "Untitled Quiz",',
    '    "description": "Được chuyển đổi từ SCORM Editor.",',
    '    "subject": "Lập trình",',
    '    "difficultyLevel": "medium",',
    '    "tags": ["SCORM", "Imported"],',
    '    "createdBy": "admin",',
    '    "createdByName": "Hệ thống",',
    '    "isPublic": false,',
    '    "duration": 1800,',
    '    "questions": [ ... ],',
    '    "settings": {',
    '      "shuffleQuestions": false,',
    '      "shuffleAnswers": false,',
    '      "attemptLimit": 1,',
    '      "showResults": "after_submit",',
    '      "allowReview": true',
    "    },",
    '    "createdAt": "...Z",',
    '    "updatedAt": "...Z"',
    "  }",
    "]",
  ]),

  h3("7.2.2. Map loại iSpring → Teky"),
  table(
    ["iSpring type", "Teky type", "Fields chính"],
    [
      ["MultipleChoice / MultipleChoiceText", "multiple_choice", "options[], correctAnswer: [id]"],
      ["MultipleResponse", "multiple_select", "options[], correctAnswer: [id,…]"],
      ["TrueFalse", "true_false", 'options[], correctAnswer: ["true"|"false"]'],
      ["TypeIn / Numeric / FIB / WordBank", "fill_blank", "correctAnswer: [text,…]"],
      ["Matching", "matching", 'pairs[], correctAnswer: ["pair-0:right",…]'],
      ["Sequence", "ordering", "orderingItems[], correctAnswer: [id theo thứ tự]"],
      ["InfoSlide / Intro / Result", "(bỏ qua)", "Không đưa vào questions[]"],
    ],
    [3200, 2200, CONTENT_W - 5400]
  ),
  spacer(),

  h3("7.2.3. Ví dụ question multiple_choice"),
  ...codeBlock([
    "{",
    '  "id": "ts66r2idjy78-8i8vwdbex6r1",',
    '  "type": "multiple_choice",',
    '  "question": "Để bắt đầu chạy một chương trình...?",',
    '  "points": 1,',
    '  "metadata": { "difficulty": "medium", "topic": "Imported Questions" },',
    '  "imageUrl": "images/img-....jpg",',
    '  "options": [',
    '    { "id": "2j16y7h...", "text": "Một lá cờ xanh", "imageUrl": "images/img-....jpg" },',
    '    { "id": "2aejpty...", "text": "Một ngôi sao vàng", "imageUrl": "images/img-....jpg" }',
    "  ],",
    '  "correctAnswer": ["2j16y7h..."]',
    "}",
  ]),

  h3("7.2.4. Matching & Ordering"),
  p("Matching pairs:", { bold: true }),
  ...codeBlock([
    '"pairs": [{ "id": "pair-0", "left": "...", "right": "...", "leftImageUrl": "...", "rightImageUrl": "..." }],',
    '"correctAnswer": ["pair-0:right text", "pair-1:..."]',
  ]),
  p("Ordering:", { bold: true }),
  ...codeBlock([
    '"orderingItems": [{ "id": "...", "text": "..." }],',
    '"correctAnswer": ["id1", "id2", "id3"]  // đúng thứ tự',
  ]),

  h2("7.3. Export Media"),
  table(
    ["API", "Kết quả"],
    [
      ["POST .../export-media", "Zip toàn bộ media của package"],
      ["POST .../export-media-local", "Copy media ra thư mục local máy server"],
      ["POST .../export-single-media-local", "Xuất 1 file media với tên đích (quy ước đặt tên)"],
    ],
    [4200, CONTENT_W - 4200]
  ),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("8. Quy ước đặt tên khi Export Ảnh"),
  p("Hệ thống hỗ trợ 8 dạng câu hỏi/slide chính. Khi export ảnh, thuật toán gán hậu tố theo vai trò hình ảnh để tránh trùng lặp."),

  h2("8.1. Nội dung câu hỏi & ảnh nền/minh họa"),
  p("Áp dụng mọi loại: Background, Picture/Image, minh họa thân câu hỏi → nhóm Nội dung (ND)."),
  bullet("Hậu tố: _IMG-ND hoặc _IMG-ND-[số thứ tự]"),

  h2("8.2. Feedback & slide Intro / Result"),
  bullet("Hậu tố: _IMG-ND-[số thứ tự] (gom chung ảnh minh họa)"),

  h2("8.3. Ảnh trong từng dạng đáp án"),
  table(
    ["Loại câu hỏi", "Hậu tố"],
    [
      ["Matching — vế trái", "_IMG-VT1, _IMG-VT2, …"],
      ["Matching — vế phải", "_IMG-VP1, _IMG-VP2, …"],
      ["Multiple Choice / TrueFalse", "_IMG-DA1, _IMG-DA2, _IMG-DA3, …"],
      ["Multiple Response", "_IMG-DA1, _IMG-DA2, …"],
      ["Sequence", "_IMG-DA1, _IMG-DA2, … (trên xuống)"],
      ["Hotspot", "_IMG-content (ảnh vùng tương tác)"],
      ["FIB / TypeIn / WordBank", "Không ảnh trong đáp án text; ảnh khác → _IMG-ND"],
    ],
    [4000, CONTENT_W - 4000]
  ),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("9. Tham chiếu API đầy đủ"),
  h2("9.1. Health & Import"),
  table(
    ["Method", "Path", "Mô tả"],
    [
      ["GET", "/api/health", "Health check"],
      ["POST", "/api/import", "Upload SCORM .zip"],
      ["POST", "/api/import/sample?source=zip|dir", "Load mẫu"],
      ["POST", "/api/import/excel", "Upload Excel hoặc zip Excel+media"],
      ["GET", "/api/import/excel/templates", "Danh sách template"],
      ["GET", "/api/import/excel/templates/{id}", "Download template"],
      ["POST", "/api/import/excel/sample", "Import Sample_import_template"],
      ["POST", "/api/import/excel/media-sample", "Import Media_import_sample"],
      ["POST", "/api/import/excel/fib-wb-sample", "Import FIB_WB sample"],
    ],
    [1400, 4200, CONTENT_W - 5600]
  ),
  spacer(),

  h2("9.2. Session"),
  table(
    ["Method", "Path", "Mô tả"],
    [
      ["GET", "/api/session/{id}", "Lấy view hiện tại"],
      ["PUT", "/api/session/{id}", "Save (SavePayload JSON)"],
      ["GET", "/api/session/{id}/asset/{filename}", "Lấy asset media"],
      ["POST", "/api/session/{id}/asset/{filename}", "Upload/thay asset"],
      ["GET", "/api/session/{id}/fonts", "Font manifest"],
      ["GET", "/api/session/{id}/res/{path}", "File trong package res/"],
    ],
    [1400, 4200, CONTENT_W - 5600]
  ),
  spacer(),

  h2("9.3. Export & Preview"),
  table(
    ["Method", "Path", "Mô tả"],
    [
      ["POST", "/api/session/{id}/export", "SCORM zip"],
      ["POST", "/api/session/{id}/export-cms-json-local", "Teky JSON → Downloads"],
      ["POST", "/api/session/{id}/export-media", "Media zip download"],
      ["POST", "/api/session/{id}/export-media-local", "Media local path"],
      ["POST", "/api/session/{id}/export-single-media-local", "1 file media local"],
      ["GET", "/api/session/{id}/preview/player", "HTML player preview"],
      ["POST", "/api/session/{id}/preview/report-proxy", "Proxy báo cáo CORS"],
      ["GET", "/api/session/{id}/preview/res/{path}", "Res cho player"],
    ],
    [1400, 4800, CONTENT_W - 6200]
  ),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("10. Checklist thực hành"),
  h2("10.1. Tạo template Excel mới"),
  bullet("Sheet đầu tiên; hàng 1 đúng tên cột iSpring."),
  bullet("Thư mục media/ cùng cấp file Excel (hoặc trong zip)."),
  bullet("Đường dẫn media\\... khớp tên file (phân biệt hoa thường trên Linux)."),
  bullet("Video luôn kèm ảnh poster."),
  bullet("Audio đáp án: bracket trong từng Answer N cần voice riêng."),
  bullet("Feedback: tách voice đúng/sai bằng file mp3 khác nhau."),
  bullet("Import → kiểm tra ImportReport (0 error, xem warnings)."),
  bullet("pytest tests/test_media_import.py tests/test_answer_feedback_media.py"),
  bullet("Preview Slide View: nghe audio câu hỏi + feedback."),

  h2("10.2. Quy trình biên soạn đầy đủ"),
  num("Import SCORM hoặc Excel (+ media zip)."),
  num("Xem ImportReport; sửa các dòng error (nếu Excel)."),
  num("Chỉnh meta quiz: tên, điểm đạt, reporting."),
  num("Sửa nội dung từng câu (text, đáp án, điểm, feedback)."),
  num("Chỉnh layout trên Canvas nếu cần."),
  num("Preview player — làm thử bài."),
  num("Save (auto-sync)."),
  num("Export SCORM zip cho LMS và/hoặc Teky JSON + media."),

  h2("10.3. QA regression gợi ý"),
  bullet("3 template × import → save → export (test_qa_e2e.py)."),
  bullet("Re-open zip export → session view khớp."),
  bullet("Sửa điểm / text sau import → save → export → dữ liệu khớp."),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("11. Giới hạn và lưu ý kỹ thuật"),
  table(
    ["Hạng mục", "Trạng thái / ghi chú"],
    [
      ["Direct URL media (YouTube, Drive…)", "Chưa hỗ trợ — chỉ file local"],
      ["Upload audio/video từ UI editor", "Hạn chế; ưu tiên Excel re-import / file package"],
      ["DND / DIB / Hotspot / Essay / Likert từ Excel", "Skip có lý do trong ImportReport"],
      ["Hotspot / DND trên SCORM gốc", "Chỉnh layout Canvas; nội dung partial/readonly"],
      ["SCORM version export", "1.2 (iSpring MASTER)"],
      ["Points", "slide.s.e.pt, t: byQuestion"],
      ["Reporting iSpring", "d.s.r — ss, ads, sts"],
      ["FIB/WB blank IDs", "Giữ span id qmFillInTheBlank / qmWordBank trong rt.h"],
      ["CORS frontend dev", "localhost:5173 và :8000"],
    ],
    [4200, CONTENT_W - 4200]
  ),
  spacer(),

  h2("11.1. Module backend quan trọng"),
  table(
    ["Module", "Trách nhiệm"],
    [
      ["scorm_parser.py", "Decode/encode quiz, quiz_to_view, save_view, export_scorm_zip, media registry"],
      ["excel_import.py", "Parse Excel + media brackets + validate loại"],
      ["quiz_builder.py", "Inject rows → slides từ MASTER; reflow; points"],
      ["cms_export.py", "iSpring view → Teky JSON"],
      ["media_rich.py", "Embed audio/video/image rich text"],
      ["layout.py / typography.py", "Canvas layout, reflow import, typography"],
      ["preview.py", "Player HTML, report proxy allowlist"],
    ],
    [2800, CONTENT_W - 2800]
  ),

  pageBreak(),

  // ═══════════════════════════════════════════════════════════════════════
  h1("12. Phụ lục — Tóm tắt nhanh"),
  h2("12.1. Input vs Output"),
  table(
    ["", "Nội dung"],
    [
      ["Input chính", "SCORM zip iSpring HOẶC Excel (template iSpring) ± media local"],
      ["JSON editor", "View phẳng: title, questions[], choices, layout, feedback…"],
      ["JSON CMS (Teky)", "[quiz] với type multiple_choice | multiple_select | true_false | fill_blank | matching | ordering"],
      ["Export LMS", "SCORM 1.2 .zip (raw iSpring JSON trong package)"],
    ],
    [2800, CONTENT_W - 2800]
  ),
  spacer(),

  h2("12.2. Tài liệu & mẫu liên quan"),
  table(
    ["Tài nguyên", "Đường dẫn"],
    [
      ["Plan import Excel", "scorm-editor/docs/EXCEL_IMPORT_PLAN.md"],
      ["Đặc tả media", "scorm-editor/docs/MEDIA_TEMPLATE_SPEC.md"],
      ["README chạy app", "scorm-editor/README.md"],
      ["Template Excel", "ImportTemplate/"],
      ["Output mẫu Teky (scorm-cvt)", "scorm-cvt/scorm-cvt/output/*_teky.json"],
      ["iSpring Excel docs", "ispringhelpdocs.com — importing questions from excel"],
    ],
    [3200, CONTENT_W - 3200]
  ),
  spacer(300),

  p("— Hết tài liệu —", { align: AlignmentType.CENTER, bold: true, color: "666666" }),
  p("SCORM Editor · Tài liệu hướng dẫn chi tiết v1.0", { align: AlignmentType.CENTER, size: 18, color: "999999" }),
];

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 22 },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: BLUE },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: BLUE },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
      {
        reference: "numbers",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
              spacing: { after: 120 },
              children: [
                new TextRun({ text: "SCORM Editor — Tài liệu hướng dẫn chi tiết", size: 16, font: "Arial", color: "666666" }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: { top: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 4 } },
              spacing: { before: 80 },
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Trang ", size: 16, font: "Arial", color: "888888" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "888888" }),
                new TextRun({ text: " / ", size: 16, font: "Arial", color: "888888" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: "Arial", color: "888888" }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const outPath = path.join(__dirname, "SCORM_Editor_Huong_Dan_Chi_Tiet.docx");
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log("Wrote:", outPath);
  console.log("Size:", (buffer.length / 1024).toFixed(1), "KB");
});
