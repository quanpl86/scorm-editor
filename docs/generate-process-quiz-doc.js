/**
 * Sinh tài liệu Word: Quy trình xây dựng nội dung & xuất bản câu hỏi ôn tập
 * Phiên bản 2.0 — schema SNLT-HP01-B01, TSV UI, targetLesson, Export CMS JSON
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, LevelFormat, PageBreak,
} = require("../node_modules/docx");
const fs = require("fs");
const path = require("path");

const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1008;
const CONTENT_W = PAGE_W - MARGIN * 2;

const blue = "1F4E79";
const blueLt = "D6E3F0";
const gray = "666666";
const grayBd = "CCCCCC";
const green = "2E7D32";
const greenLt = "E8F5E9";
const orange = "E65100";
const orangeLt = "FFF3E0";

const border = { style: BorderStyle.SINGLE, size: 4, color: grayBd };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  const {
    bold = false, size = 22, color = "222222", italics = false,
    align = AlignmentType.LEFT, spacingAfter = 120, spacingBefore = 0,
  } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter, before: spacingBefore, line: 276 },
    children: [new TextRun({ text, bold, size, color, italics, font: "Arial" })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, font: "Arial", color: blue })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text, bold: true, size: 26, font: "Arial", color: blue })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: "Arial", color: "2E5090" })],
  });
}

function bullet(text, ref = "bullets") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, size: 22, font: "Arial", color: "222222" })],
  });
}

function num(text, ref = "numbers") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, size: 22, font: "Arial", color: "222222" })],
  });
}

function codeBlock(lines) {
  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 40, line: 260 },
        shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
        children: [
          new TextRun({ text: line || " ", size: 18, font: "Consolas", color: "333333" }),
        ],
      })
  );
}

function cell(text, opts = {}) {
  const { width, bold = false, fill = null, color = "222222", size = 18 } = opts;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text, bold, size, font: "Arial", color })],
      }),
    ],
  });
}

function table(headers, rows, colWidths) {
  const total = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        children: headers.map((h, i) =>
          cell(h, { width: colWidths[i], bold: true, fill: blueLt, color: blue, size: 18 })
        ),
      }),
      ...rows.map(
        (row, ri) =>
          new TableRow({
            children: row.map((c, i) =>
              cell(String(c), {
                width: colWidths[i],
                fill: ri % 2 === 1 ? "FAFAFA" : null,
                size: 18,
              })
            ),
          })
      ),
    ],
  });
}

function callout(title, body, fill = orangeLt, titleColor = orange) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top: { style: BorderStyle.SINGLE, size: 8, color: titleColor },
              bottom: { style: BorderStyle.SINGLE, size: 8, color: titleColor },
              left: { style: BorderStyle.SINGLE, size: 24, color: titleColor },
              right: { style: BorderStyle.SINGLE, size: 8, color: titleColor },
            },
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  new TextRun({ text: title, bold: true, size: 20, font: "Arial", color: titleColor }),
                ],
              }),
              ...body.map(
                (t) =>
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [
                      new TextRun({ text: t, size: 20, font: "Arial", color: "333333" }),
                    ],
                  })
              ),
            ],
          }),
        ],
      }),
    ],
  });
}

function spacer(after = 160) {
  return new Paragraph({ spacing: { after }, children: [] });
}

function bulletConfig(ref) {
  return {
    reference: ref,
    levels: [
      {
        level: 0,
        format: LevelFormat.BULLET,
        text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      },
    ],
  };
}

function numConfig(ref) {
  return {
    reference: ref,
    levels: [
      {
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      },
    ],
  };
}

async function main() {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: true, font: "Arial", color: blue },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 26, bold: true, font: "Arial", color: blue },
          paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "2E5090" },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        bulletConfig("b1"),
        bulletConfig("b2"),
        bulletConfig("b3"),
        bulletConfig("b4"),
        bulletConfig("b5"),
        numConfig("n1"),
        numConfig("n2"),
        numConfig("n3"),
        numConfig("n4"),
        numConfig("n5"),
        numConfig("n6"),
        numConfig("check"),
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
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 12, color: blue, space: 4 },
                },
                spacing: { after: 120 },
                children: [
                  new TextRun({
                    text: "TEKY LMS  ·  Quy trình xây dựng & xuất bản câu hỏi ôn tập  ·  v2.0",
                    size: 16,
                    font: "Arial",
                    color: gray,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: {
                  top: { style: BorderStyle.SINGLE, size: 6, color: grayBd, space: 4 },
                },
                alignment: AlignmentType.RIGHT,
                spacing: { before: 80 },
                children: [
                  new TextRun({ text: "Trang ", size: 16, font: "Arial", color: gray }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    font: "Arial",
                    color: gray,
                  }),
                  new TextRun({ text: " / ", size: 16, font: "Arial", color: gray }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    font: "Arial",
                    color: gray,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          spacer(400),
          p("TÀI LIỆU QUY TRÌNH", {
            bold: true,
            size: 22,
            color: blue,
            align: AlignmentType.CENTER,
            spacingAfter: 160,
          }),
          p("XÂY DỰNG NỘI DUNG & XUẤT BẢN", {
            bold: true,
            size: 34,
            color: blue,
            align: AlignmentType.CENTER,
            spacingAfter: 60,
          }),
          p("CÂU HỎI ÔN TẬP BÀI HỌC / HỌC PHẦN", {
            bold: true,
            size: 34,
            color: blue,
            align: AlignmentType.CENTER,
            spacingAfter: 240,
          }),
          p("Phiên bản 2.0  ·  Schema SNLT-HP01-B01  ·  TSV → Excel  ·  CMS JSON", {
            size: 20,
            color: gray,
            align: AlignmentType.CENTER,
            spacingAfter: 320,
          }),
          table(
            ["Mục", "Thông tin"],
            [
              ["Đối tượng", "Biên soạn nội dung, QA, vận hành LMS, AI Agent"],
              ["Phạm vi", "Quiz ôn tập gắn Bài học / Học phần trên Teky LMS"],
              ["Template Excel", "ImportTemplate/SNLT-HP01-B01/SNLT-HP01-B01.xlsx"],
              ["Công cụ", "SCORM Editor (tab TSV → Excel / Excel / SCORM)"],
              ["Đầu ra", "*_teky.json (CMS) + media URL S3 khi cấu hình"],
              ["Ngày cập nhật", "2026-07-29"],
            ],
            [2600, CONTENT_W - 2600]
          ),
          spacer(280),
          callout(
            "Thay đổi chính so với v1",
            [
              "Template chuẩn: SNLT-HP01-B01 (cột TEXT trước, MEDIA sau; tối đa 6 đáp án).",
              "Media: thư mục media/ chỉ ảnh; Video = YouTube/Vimeo URL; Audio = HTTPS trực tiếp.",
              "UI: 3 tab Import — TSV→Excel (form Settings + dán questions), Excel file, SCORM Zip.",
              "Context LMS: subject = Tên học phần (Related Subject); targetLesson = Tên bài học (Target Lesson).",
              "Luồng chính: Agent/TSV → tạo ImportTemplate/{MãBài}/ → Editor → Save → Viewer → Export CMS JSON → LMS.",
            ],
            greenLt,
            green
          ),

          new Paragraph({ children: [new PageBreak()] }),

          // ===== 1 =====
          h1("1. Tổng quan quy trình"),
          h2("1.1. Mục tiêu"),
          p(
            "Chuẩn hóa cách biên soạn câu hỏi ôn tập từ Learning Objectives / Lesson / Project, đóng gói theo template Excel Teky LMS, rà soát trên SCORM Editor và xuất bản JSON CMS để import vào Teky LMS, gắn với Học phần và Bài học."
          ),

          h2("1.2. Luồng end-to-end (v2)"),
          ...codeBlock([
            "  [1] SOẠN NỘI DUNG",
            "      LO ± Lesson Info ± Project Instruction",
            "           │  AI Agent (docs/agent-drop-in) hoặc soạn thủ công",
            "           ▼",
            "      quiz_questions.tsv  (+ quiz_settings.tsv hoặc nhập form)",
            "",
            "  [2] ĐÓNG GÓI BÀI HỌC  — SCORM Editor → tab «TSV → Excel»",
            "      Tên Bài học: SNLT-HP01-B02",
            "      Settings: Nhập tay (form) hoặc Dán TSV",
            "      Questions: dán quiz_questions.tsv",
            "           │",
            "           ▼",
            "      ImportTemplate/SNLT-HP01-B02/",
            "        ├── SNLT-HP01-B02.xlsx",
            "        └── media/",
            "           │  + mở Editor session",
            "           ▼",
            "  [3] BIÊN TẬP & KIỂM DUYỆT",
            "      Quiz Details · Context · Questions · Settings",
            "      Gắn ảnh media/  →  Save Quiz  →  Viewer",
            "           ▼",
            "  [4] XUẤT BẢN",
            "      Export CMS JSON  (*_teky.json)",
            "           │  subject, targetLesson, questions[], settings, coverImageUrl…",
            "           ▼",
            "      Import Teky LMS  →  gắn Học phần / Bài học  →  smoke test",
          ]),
          spacer(120),

          h2("1.3. Ba tab Import trên Editor"),
          table(
            ["Tab", "Khi nào dùng", "Đầu vào"],
            [
              [
                "TSV → Excel",
                "Luồng chính (khuyến nghị)",
                "Form/TSV settings + questions.tsv + tên bài học",
              ],
              [
                "Tạo quiz từ Excel",
                "Đã có file .xlsx / zip Excel+media",
                "File Excel hoặc ZIP",
              ],
              [
                "Chỉnh sửa SCORM Zip",
                "Sửa package iSpring có sẵn",
                "SCORM 1.2 .zip",
              ],
            ],
            [2200, 3200, CONTENT_W - 5400]
          ),
          spacer(120),

          h2("1.4. Cấu trúc gắn nội dung LMS"),
          table(
            ["Khái niệm", "Trên form / Excel", "JSON CMS", "UI Teky Context"],
            [
              ["Học phần", "Tên học phần → field subject", "subject", "RELATED SUBJECT"],
              ["Bài học", "Tên bài học → field targetLesson", "targetLesson", "TARGET LESSON"],
              ["Mã package", "Tên Bài học (vd SNLT-HP01-B02)", "— (thư mục)", "—"],
              ["Quiz title", "title / Tên quiz", "title", "Tiêu đề quiz"],
            ],
            [2000, 2800, 2200, CONTENT_W - 7000]
          ),

          // ===== 2 =====
          h1("2. Bước 1 — Soạn nội dung câu hỏi"),
          h2("2.1. Đầu vào"),
          bullet("Learning Objectives (ưu tiên cao nhất).", "b1"),
          bullet("Lesson Info (tùy chọn): mã HP/BH, subject, level, concepts.", "b1"),
          bullet("Project Instruction (tùy chọn): brief, rubric, deliverable.", "b1"),
          spacer(80),
          p(
            "Có thể chỉ một phần đầu vào. Agent/biên soạn suy luận phần thiếu và ghi giả định trong blueprint."
          ),

          h2("2.2. AI Agent (khuyến nghị)"),
          p("Gói drop-in: scorm-editor/docs/agent-drop-in/"),
          bullet("SYSTEM_PROMPT.txt — system instruction.", "b2"),
          bullet("AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md — spec đầy đủ.", "b2"),
          bullet("TEKY_EXCEL_SCHEMA.md — schema Excel v2.", "b2"),
          bullet("quiz_settings.header.tsv / quiz_questions.header.tsv — đúng cột.", "b2"),
          spacer(80),
          p("Đầu ra Agent: quiz_settings.tsv (hoặc để form UI), quiz_questions.tsv, media_manifest (ảnh), Validation Report."),

          h2("2.3. Quy tắc câu hỏi (schema v2)"),
          table(
            ["Hạng mục", "Chuẩn"],
            [
              ["Cột Questions", "35 cột: TEXT (Type→Use Regex) rồi MEDIA (Image…Right Image)"],
              ["Đáp án", "Tối đa Answer 1…6; Matching tối đa 6 cặp"],
              ["Đáp án đúng", "* trước option (MC/MR/TF); MG: trái|phải; SEQ: thứ tự Answer"],
              ["Ảnh", "media/file.ext — thư mục media chỉ ảnh"],
              ["Video", "Chỉ URL YouTube / Vimeo"],
              ["Audio", "Chỉ URL HTTPS trực tiếp"],
              ["ID", "Không nhập Quiz/Question ID — hệ thống tự sinh"],
            ],
            [2400, CONTENT_W - 2400]
          ),
          spacer(100),
          table(
            ["Excel", "JSON Teky", "Ghi chú"],
            [
              ["MC", "multiple_choice", "* đúng 1"],
              ["MR", "multiple_select", "* mọi đáp án đúng"],
              ["TF", "true_false", "* Đúng hoặc Sai"],
              ["MG", "matching", "trái|phải ≤6 cặp"],
              ["SEQ", "ordering", "thứ tự đúng ≤6"],
              ["FIB", "fill_blank", "___ trong stem"],
              ["TI", "short_answer", "Use Regex nếu cần"],
              ["NUM / MNUM", "numeric / multiple_numeric", "số"],
            ],
            [1600, 2800, CONTENT_W - 4400]
          ),

          // ===== 3 =====
          h1("3. Bước 2 — Đóng gói bài học (TSV → Excel)"),
          h2("3.1. Thao tác trên UI"),
          num("Mở SCORM Editor (http://localhost:8000), Mode Teky LMS.", "n1"),
          num("Chọn tab «TSV → Excel».", "n1"),
          num("Nhập Tên Bài học (mã package), ví dụ SNLT-HP01-B02.", "n1"),
          num(
            "Quiz Settings: chọn «Nhập tay» (form) hoặc «Dán TSV».",
            "n1"
          ),
          num("Dán quiz_questions.tsv.", "n1"),
          num("Tùy chọn: ghi đè nếu thư mục đã có; copy media mẫu từ SNLT-HP01-B01.", "n1"),
          num("Bấm «Import → Excel & mở Editor».", "n1"),

          h2("3.2. Form Quiz Settings (nhập tay)"),
          table(
            ["Ô form", "Field Excel/JSON", "Ghi chú"],
            [
              ["Tên quiz *", "title", "Bắt buộc khi nhập tay"],
              ["Mô tả", "description", ""],
              ["Ảnh bìa", "coverImage", "media/quiz_cover.jpg"],
              ["Tên học phần (Related Subject)", "subject", "Context RELATED SUBJECT"],
              ["Tên bài học (Target Lesson)", "targetLesson", "Mặc định = Tên Bài học nếu trống"],
              ["Độ khó", "difficultyLevel", "easy | medium | hard"],
              ["Tags", "tags", "CSV"],
              ["Thời lượng (phút)", "duration", "UI phút → Excel giây"],
              ["Số lần làm", "attemptLimit", "0 = không giới hạn"],
              ["Hiện kết quả", "showResults", "after_submit | immediately | never"],
              ["Người tạo / Tên", "createdBy / createdByName", "Mặc định Teky Academy"],
              ["Checkbox shuffle / review / public", "settings.* / isPublic", ""],
            ],
            [3200, 2600, CONTENT_W - 5800]
          ),
          spacer(100),

          h2("3.3. Kết quả trên đĩa"),
          ...codeBlock([
            "ImportTemplate/SNLT-HP01-B02/",
            "├── SNLT-HP01-B02.xlsx   # copy template SNLT-HP01-B01 + dữ liệu TSV/form",
            "└── media/              # trống hoặc seed ảnh mẫu",
          ]),
          spacer(80),
          callout(
            "API tương ứng",
            [
              "POST /api/import/tsv-to-lesson — body: lessonCode, settingsTsv, questionsTsv, overwrite, seedMediaFromTemplate, openInEditor.",
              "Module: backend/app/tsv_snlt_publish.py · CLI: scripts/tsv_to_snlt_xlsx.py",
            ],
            blueLt,
            blue
          ),

          // ===== 4 =====
          h1("4. Bước 3 — Biên tập & kiểm duyệt trên Editor"),
          num("Quiz Details: title, description, cover.", "n2"),
          num(
            "Context Information: sửa Tên học phần (subject) và Tên bài học (targetLesson).",
            "n2"
          ),
          num("Questions: nội dung, đáp án, điểm, media path, Required / Use Regex.", "n2"),
          num("Settings: attemptLimit, shuffle, showResults, allowReview.", "n2"),
          num("Đặt file ảnh vào media/ khớp path trong Excel (nếu chưa có).", "n2"),
          num("Save Quiz — bắt buộc trước Preview/Export.", "n2"),
          num("Viewer «Xem & Làm bài» — kiểm tra đủ dạng câu đã dùng.", "n2"),
          num("Sửa nếu cần → Save lại.", "n2"),
          spacer(80),
          callout(
            "Lưu ý Save Quiz",
            [
              "Đây là nút lưu chính thức session. Không coi auto-sync là đã xuất bản.",
              "Thêm/xóa câu hoặc đáp án chỉ chắc chắn sau khi Save thành công.",
            ]
          ),

          // ===== 5 =====
          h1("5. Bước 4 — Xuất bản CMS JSON & LMS"),
          h2("5.1. Export"),
          num("Bấm Export CMS JSON trên Editor.", "n3"),
          num("Backend map 9 type Teky; upload media S3 nếu cấu hình; gắn URL.", "n3"),
          num("File lưu dạng mảng [ quiz_object ], thường thư mục JSON-EXPORT.", "n3"),
          spacer(80),
          p("Các field quan trọng trong JSON:", { bold: true, spacingAfter: 80 }),
          ...codeBlock([
            "{",
            '  "id": "quiz_...",',
            '  "title": "...",',
            '  "subject": "Tên học phần",',
            '  "targetLesson": "Tên bài học",',
            '  "coverImageUrl": "https://s3-.../...",',
            '  "duration": 1200,',
            '  "settings": { "attemptLimit": 3, "shuffleQuestions": true, ... },',
            '  "questions": [ /* multiple_choice | ... | multiple_numeric */ ],',
            '  "createdBy": "Teky Academy",',
            '  "createdByName": "Teky Academy"',
            "}",
          ]),
          spacer(100),

          h2("5.2. Import Teky LMS"),
          num("Import file *_teky.json vào CMS/LMS.", "n4"),
          num("Kiểm tra URL media public (nếu dùng S3).", "n4"),
          num("Gắn quiz vào đúng Học phần (subject) và Bài học (targetLesson).", "n4"),
          num("Cấu hình điều kiện mở / hiển thị theo thiết kế khóa học.", "n4"),
          num("Smoke test trên môi trường thật: làm 1–2 câu mỗi dạng đã dùng.", "n4"),
          num("Publish production.", "n4"),

          // ===== 6 =====
          h1("6. Checklist xuất bản"),
          num("Có LO / Lesson / Project (hoặc blueprint suy diễn).", "check"),
          num("quiz_questions.tsv đúng 35 cột schema v2.", "check"),
          num("Settings: title, subject (học phần), targetLesson (bài học), duration…", "check"),
          num("Tên Bài học mã package hợp lệ (SNLT-HPxx-Byy).", "check"),
          num("Import TSV → tạo xlsx + media/ trong ImportTemplate/.", "check"),
          num("Gắn ảnh media/; Video/Audio đúng loại URL (nếu có).", "check"),
          num("Save Quiz.", "check"),
          num("Viewer review.", "check"),
          num("Export CMS JSON; có subject + targetLesson.", "check"),
          num("Import LMS + gắn BH/HP + smoke test.", "check"),

          // ===== 7 =====
          h1("7. Vai trò & tài nguyên"),
          table(
            ["Vai trò", "Việc chính"],
            [
              ["AI Agent / soạn thảo", "Gen questions TSV (+ settings) bám LO, Bloom"],
              ["Biên soạn nội dung", "Form settings, dán questions, tạo package, gắn ảnh"],
              ["QA", "Viewer, đối chiếu JSON, media URL"],
              ["Vận hành LMS", "Import JSON, gắn HP/BH, publish"],
            ],
            [2800, CONTENT_W - 2800]
          ),
          spacer(120),
          table(
            ["Tài nguyên", "Đường dẫn"],
            [
              ["Template Excel + media", "ImportTemplate/SNLT-HP01-B01/"],
              ["Agent drop-in", "scorm-editor/docs/agent-drop-in/"],
              ["Schema Excel", "docs/TEKY_EXCEL_SCHEMA.md"],
              ["Prompt Agent", "docs/AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md"],
              ["Hướng dẫn Editor", "docs/SCORM_Editor_Huong_Dan_Chi_Tiet.docx"],
              ["JSON mẫu", "docs/cms_json_full_sample.json"],
              ["Script TSV→xlsx", "scripts/tsv_to_snlt_xlsx.py"],
            ],
            [2800, CONTENT_W - 2800]
          ),

          // ===== 8 =====
          h1("8. Xử lý lỗi thường gặp"),
          table(
            ["Hiện tượng", "Cách xử lý"],
            [
              ["Thư mục bài học đã tồn tại", "Tick ghi đè hoặc đổi tên Bài học"],
              ["Thiếu title khi nhập tay", "Điền Tên quiz (bắt buộc)"],
              ["Không tìm thấy media/…", "File thiếu trong media/; path khớp hoa/thường"],
              ["Video/Audio không hợp lệ", "YT/Vimeo hoặc HTTPS; không file .mp4/.mp3 trong media"],
              ["JSON thiếu targetLesson", "Điền Target Lesson trên form/Editor; Save rồi export lại"],
              ["Thiếu câu sau export", "Chưa Save Quiz; hoặc type không map"],
            ],
            [3200, CONTENT_W - 3200]
          ),
          spacer(200),
          callout(
            "Kết luận",
            [
              "Quy trình chuẩn v2: Soạn TSV câu hỏi (Agent) → Tab TSV→Excel (settings form + questions) → package ImportTemplate/{MãBài}/ → Editor Save & Viewer → Export CMS JSON (subject + targetLesson) → Import Teky LMS.",
              "Bám template SNLT-HP01-B01 và checklist mục 6 để giảm lỗi media, lệch cột và thiếu context học phần/bài học.",
            ],
            greenLt,
            green
          ),
        ],
      },
    ],
  });

  const outDir = __dirname;
  const outPath = path.join(outDir, "Quy_Trinh_Xay_Dung_Xuat_Ban_Cau_Hoi_On_Tap.docx");
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  console.log("Wrote", outPath, buf.length, "bytes");

  const rootCopy = path.join(__dirname, "..", "..", "Quy_Trinh_Xay_Dung_Xuat_Ban_Cau_Hoi_On_Tap.docx");
  fs.writeFileSync(rootCopy, buf);
  console.log("Wrote", rootCopy);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
