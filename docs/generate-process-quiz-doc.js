/**
 * Sinh tài liệu: Quy trình xây dựng nội dung & xuất bản câu hỏi ôn tập
 * (bài học / học phần) — dựa trên SCORM Editor + Excel Teky LMS.
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, LevelFormat, PageBreak,
} = require("../node_modules/docx");
const fs = require("fs");
const path = require("path");

const PAGE_W = 11906; // A4
const PAGE_H = 16838;
const MARGIN = 1008; // 0.7"
const CONTENT_W = PAGE_W - MARGIN * 2; // 9890

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
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function p(text, opts = {}) {
  const {
    bold = false, size = 22, color = "222222", italics = false,
    align = AlignmentType.LEFT, spacingAfter = 120, spacingBefore = 0,
    font = "Arial",
  } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter, before: spacingBefore, line: 276 },
    children: [
      new TextRun({ text, bold, size, color, italics, font }),
    ],
  });
}

function runs(parts, opts = {}) {
  const { align = AlignmentType.LEFT, spacingAfter = 120, spacingBefore = 0 } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: spacingAfter, before: spacingBefore, line: 276 },
    children: parts.map((part) => {
      if (typeof part === "string") {
        return new TextRun({ text: part, size: 22, font: "Arial", color: "222222" });
      }
      return new TextRun({
        text: part.text,
        bold: !!part.bold,
        italics: !!part.italics,
        size: part.size || 22,
        color: part.color || "222222",
        font: "Arial",
      });
    }),
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

function bulletRich(parts, ref = "bullets") {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80, line: 276 },
    children: parts.map((part) => {
      if (typeof part === "string") {
        return new TextRun({ text: part, size: 22, font: "Arial", color: "222222" });
      }
      return new TextRun({
        text: part.text,
        bold: !!part.bold,
        italics: !!part.italics,
        size: part.size || 22,
        color: part.color || "222222",
        font: "Arial",
      });
    }),
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
  const {
    width,
    bold = false,
    fill = null,
    align = AlignmentType.LEFT,
    color = "222222",
    size = 18,
  } = opts;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: align,
        spacing: { after: 40 },
        children: [
          new TextRun({ text, bold, size, font: "Arial", color }),
        ],
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

function flowStep(n, title, desc) {
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [720, CONTENT_W - 720],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            width: { size: 720, type: WidthType.DXA },
            verticalAlign: "center",
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: String(n), bold: true, size: 28, font: "Arial", color: blue }),
                ],
              }),
            ],
          }),
          new TableCell({
            borders: {
              top: noBorder,
              bottom: { style: BorderStyle.SINGLE, size: 4, color: blueLt },
              left: noBorder,
              right: noBorder,
            },
            width: { size: CONTENT_W - 720, type: WidthType.DXA },
            margins: { top: 60, bottom: 100, left: 80, right: 80 },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({ text: title, bold: true, size: 22, font: "Arial", color: blue }),
                ],
              }),
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({ text: desc, size: 20, font: "Arial", color: "444444" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
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
          reference: "bullets2",
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
          reference: "bullets3",
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
          reference: "bullets4",
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
          reference: "bullets5",
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
        {
          reference: "numbers2",
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
        {
          reference: "numbers3",
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
        {
          reference: "numbers4",
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
        {
          reference: "numbers5",
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
        {
          reference: "qa",
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
        {
          reference: "publish",
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
                border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: blue, space: 4 } },
                spacing: { after: 120 },
                children: [
                  new TextRun({
                    text: "TEKY LMS  ·  Quy trình nội dung câu hỏi ôn tập",
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
                border: { top: { style: BorderStyle.SINGLE, size: 6, color: grayBd, space: 4 } },
                alignment: AlignmentType.RIGHT,
                spacing: { before: 80 },
                children: [
                  new TextRun({ text: "Trang ", size: 16, font: "Arial", color: gray }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: gray }),
                  new TextRun({ text: " / ", size: 16, font: "Arial", color: gray }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: "Arial", color: gray }),
                ],
              }),
            ],
          }),
        },
        children: [
          // ===== COVER =====
          spacer(600),
          p("TÀI LIỆU QUY TRÌNH", {
            bold: true,
            size: 22,
            color: blue,
            align: AlignmentType.CENTER,
            spacingAfter: 200,
          }),
          p("XÂY DỰNG NỘI DUNG & XUẤT BẢN", {
            bold: true,
            size: 36,
            color: blue,
            align: AlignmentType.CENTER,
            spacingAfter: 80,
          }),
          p("CÂU HỎI ÔN TẬP BÀI HỌC / HỌC PHẦN", {
            bold: true,
            size: 36,
            color: blue,
            align: AlignmentType.CENTER,
            spacingAfter: 320,
          }),
          p("Chuẩn Teky LMS  ·  Excel Import  ·  SCORM Editor  ·  CMS JSON", {
            size: 20,
            color: gray,
            align: AlignmentType.CENTER,
            spacingAfter: 400,
          }),
          table(
            ["Mục", "Thông tin"],
            [
              ["Đối tượng sử dụng", "Biên soạn nội dung, QA, vận hành LMS"],
              ["Phạm vi", "Câu hỏi ôn tập gắn với Bài học và Học phần"],
              ["Công cụ", "Excel chuẩn Teky LMS + SCORM Editor"],
              ["Đầu ra", "JSON CMS (*_teky.json) import vào Teky LMS"],
              [
                "Nguồn tham chiếu",
                "SCORM_Editor_Huong_Dan_Chi_Tiet.docx; Full_quiz_9_types_teky_lms_system_ids.xlsx",
              ],
              ["Phiên bản tài liệu", "1.0  ·  2026-07-28"],
            ],
            [2800, CONTENT_W - 2800]
          ),
          spacer(400),
          callout(
            "Mục tiêu tài liệu",
            [
              "Mô tả end-to-end quy trình từ soạn nội dung câu hỏi trên Excel đến xuất bản quiz ôn tập trên Teky LMS, gắn với cấu trúc Học phần → Bài học.",
              "Làm chuẩn vận hành cho đội nội dung: template, 9 dạng câu hỏi, media, import/edit/preview/export và checklist QA.",
            ],
            greenLt,
            green
          ),

          new Paragraph({ children: [new PageBreak()] }),

          // ===== 1. TỔNG QUAN =====
          h1("1. Tổng quan quy trình"),
          h2("1.1. Bối cảnh nghiệp vụ"),
          p(
            "Câu hỏi ôn tập (quiz) là gói kiểm tra ngắn gắn với từng Bài học hoặc gộp theo Học phần, giúp học viên củng cố kiến thức sau khi học. Nội dung quiz được biên soạn offline trên Excel (nguồn chuẩn), đưa vào SCORM Editor để rà soát/hiệu chỉnh, rồi xuất JSON CMS và import vào Teky LMS."
          ),
          p(
            "SCORM Editor hỗ trợ hai mode, nhưng với quiz ôn tập mới trên LMS, mode khuyến nghị là Mode Teky LMS (Excel + media → Edit → Viewer → Export CMS JSON)."
          ),

          h2("1.2. Cấu trúc gắn nội dung"),
          table(
            ["Cấp", "Vai trò với quiz ôn tập", "Gợi ý đặt tên"],
            [
              ["Học phần", "Nhóm bài học; quiz tổng hợp cuối HP (tùy thiết kế)", "HP05_Quiz_Tong_Hop"],
              ["Bài học", "Quiz ôn tập sau bài (khuyến nghị 1 quiz/bài)", "HP05_B01_On_Tap"],
              ["Quiz", "Gói câu hỏi + cấu hình (duration, shuffle…)", "title trong Quiz Settings"],
              ["Question", "Từng câu thuộc 1 trong 9 dạng chuẩn", "1 dòng = 1 câu trên Excel"],
            ],
            [1800, 4200, CONTENT_W - 6000]
          ),
          spacer(120),

          h2("1.3. Luồng end-to-end"),
          ...codeBlock([
            "  [Soạn nội dung]",
            "  Excel (Quiz Settings + Quiz Questions)  +  media/",
            "           │",
            "           ▼  nén ZIP (Excel + media cùng cấp)",
            "  [Import]  SCORM Editor — Mode Teky LMS",
            "           │  ImportReport: imported / errors / media warnings",
            "           ▼",
            "  [Biên tập]  Quiz Details · Questions · Settings  →  Save Quiz",
            "           │",
            "           ▼",
            "  [Kiểm duyệt]  Viewer «Xem & Làm bài»",
            "           │",
            "           ▼",
            "  [Xuất bản]  Export CMS JSON  (*_teky.json)  +  URL media S3/FPT",
            "           │",
            "           ▼",
            "  [LMS]  Import JSON vào Teky LMS  →  gắn quiz vào Bài học / Học phần",
            "           │",
            "           ▼",
            "  [Smoke test]  Làm thử trên LMS thật",
          ]),
          spacer(120),

          h2("1.4. Nguyên tắc quan trọng"),
          bulletRich([{ text: "Excel là nguồn chuẩn", bold: true }, { text: " cho nội dung câu hỏi và cấu hình quiz trước khi xuất JSON CMS." }]),
          bulletRich([{ text: "Quiz ID / Question ID", bold: true }, { text: " do hệ thống tự sinh khi import — không nhập trong Excel, không hiển thị trên Editor." }]),
          bulletRich([{ text: "Media local only", bold: true }, { text: " — đường dẫn tương đối media/...; không dùng URL YouTube/Drive trực tiếp trong Excel." }]),
          bulletRich([{ text: "Save Quiz", bold: true }, { text: " là bước bắt buộc trước Preview và Export — auto-sync không thay thế nút lưu chính thức." }]),
          bulletRich([{ text: "coverImage", bold: true }, { text: " (Quiz Settings) = ảnh đại diện cả quiz; cột ", }, { text: "Image", bold: true }, { text: " trên mỗi dòng = ảnh nội dung từng câu hỏi." }]),

          // ===== 2. CHUẨN BỊ =====
          h1("2. Chuẩn bị trước khi soạn"),
          h2("2.1. Tài nguyên mẫu chính thức"),
          table(
            ["Tài nguyên", "Đường dẫn", "Mục đích"],
            [
              [
                "Gói ZIP mẫu",
                "ImportTemplate/Full_quiz_9_types_teky_lms.zip",
                "Excel + media đủ 9 dạng",
              ],
              [
                "Excel chuẩn",
                "…/Full_quiz_9_types_teky_lms_system_ids.xlsx",
                "Template soạn nội dung",
              ],
              [
                "Thư mục media",
                "…/Full_quiz_9_types_sample/media/",
                "Cover, ảnh, audio, video",
              ],
              [
                "Schema Excel",
                "scorm-editor/docs/TEKY_EXCEL_SCHEMA.md",
                "Đặc tả cột & mapping",
              ],
              [
                "JSON template",
                "scorm-editor/docs/cms_json_template.json",
                "Khung JSON 9 dạng",
              ],
              [
                "JSON full sample",
                "scorm-editor/docs/cms_json_full_sample.json",
                "Đối chiếu trước import LMS",
              ],
              [
                "Hướng dẫn Editor",
                "SCORM_Editor_Huong_Dan_Chi_Tiet.docx",
                "Chi tiết UI / API / export",
              ],
            ],
            [2200, 4200, CONTENT_W - 6400]
          ),
          spacer(120),
          callout(
            "Quy tắc làm việc với mẫu",
            [
              "Giữ nguyên file mẫu gốc. Khi tạo quiz mới: sao chép cả Excel và thư mục media/ sang thư mục làm việc riêng (ví dụ work/HP05_B01_On_Tap/).",
              "Không sửa trực tiếp trong ImportTemplate/ để tránh hỏng template dùng chung.",
            ]
          ),

          h2("2.2. Cấu trúc gói import khuyến nghị"),
          ...codeBlock([
            "HP05_B01_On_Tap.zip",
            "├── HP05_B01_On_Tap.xlsx",
            "└── media/",
            "    ├── quiz_cover.jpg          ← coverImage (Quiz Settings)",
            "    ├── q01_question.jpg",
            "    ├── q01_answer_a.png",
            "    ├── q04_left_01.jpg",
            "    ├── q04_right_01.jpg",
            "    ├── voice_question.mp3",
            "    └── sample_lesson.mp4",
          ]),
          spacer(80),
          p(
            "File Excel và thư mục media/ phải cùng cấp trong ZIP. Đây là cách ổn định nhất khi chuyển gói giữa máy biên soạn và máy import."
          ),

          h2("2.3. Khởi chạy SCORM Editor"),
          ...codeBlock([
            "cd scorm-editor",
            "chmod +x start.sh",
            "./start.sh",
            "# Mở trình duyệt: http://localhost:8000",
          ]),
          spacer(80),
          p(
            "Yêu cầu: Python 3+, Node.js/npm, trình duyệt hiện đại. Có thể chạy thủ công (npm run build frontend + uvicorn backend port 8000) nếu start.sh lỗi."
          ),

          // ===== 3. SOẠN EXCEL =====
          h1("3. Soạn nội dung trên Excel"),
          p(
            "Workbook chuẩn gồm 3 sheet: Quiz Questions (nội dung), Quiz Settings (cấu hình), Instructions (hướng dẫn — không import)."
          ),

          h2("3.1. Sheet Quiz Settings (cấu hình quiz)"),
          p(
            "Mỗi dòng là một cặp Field / Value. Các field map trực tiếp sang object quiz trong JSON CMS."
          ),
          table(
            ["Field", "JSON CMS", "Mô tả / giá trị hợp lệ"],
            [
              ["title", "quiz.title", "Tên hiển thị quiz (bắt buộc)"],
              ["description", "quiz.description", "Mô tả / giới thiệu"],
              ["coverImage", "quiz.coverImageUrl", "media/quiz_cover.jpg → S3 khi xuất bản"],
              ["subject", "quiz.subject", "Môn / chủ đề"],
              ["difficultyLevel", "quiz.difficultyLevel", "easy | medium | hard"],
              ["tags", "quiz.tags", "Phân cách bằng dấu phẩy"],
              ["createdBy", "quiz.createdBy", "ID người tạo"],
              ["createdByName", "quiz.createdByName", "Tên người tạo"],
              ["isPublic", "quiz.isPublic", "True / False"],
              ["duration", "quiz.duration", "Thời lượng (giây); Editor hiển thị phút"],
              ["shuffleQuestions", "settings.shuffleQuestions", "True / False"],
              ["shuffleAnswers", "settings.shuffleAnswers", "True / False"],
              ["attemptLimit", "settings.attemptLimit", "Số lần làm; 0 = không giới hạn"],
              ["showResults", "settings.showResults", "after_submit | immediately | never"],
              ["allowReview", "settings.allowReview", "True / False"],
              ["createdAt / updatedAt", "quiz.createdAt/updatedAt", "Để trống → hệ thống tự sinh ISO-8601"],
            ],
            [2400, 2800, CONTENT_W - 5200]
          ),
          spacer(120),
          p(
            "Ví dụ từ file mẫu Full_quiz_9_types_teky_lms_system_ids.xlsx: title = «Bài Kiểm Tra Tổng Hợp 9 Dạng Câu Hỏi»; duration = 2700 (45 phút); attemptLimit = 3; showResults = after_submit."
          ),

          h2("3.2. Sheet Quiz Questions (nội dung câu hỏi)"),
          p("Mỗi dòng = một câu hỏi. Hàng 1 là header cố định."),
          table(
            ["Cột", "Bắt buộc", "Mô tả"],
            [
              ["Question Type", "Có", "MC, MR, TF, MG, SEQ, FIB, TI, NUM, MNUM, WB"],
              ["Question Text", "Có*", "Nội dung đề (*TF có thể chỉ Image)"],
              ["Image / Audio / Video", "Không", "Media cấp câu hỏi; path media/..."],
              ["Answer 1 … Answer 6+", "Theo loại", "Đáp án; * = đúng; brackets media"],
              ["Answer N Image", "Không", "Ảnh của đáp án N"],
              ["Answer N Left/Right Image", "Matching", "Ảnh vế trái / vế phải"],
              ["Difficulty", "Không", "easy | medium | hard"],
              ["Topic", "Không", "Chủ đề câu hỏi"],
              ["Explanation", "Không", "Giải thích sau khi nộp"],
              ["Points", "Không", "Điểm câu (mặc định 1)"],
              ["Correct / Incorrect Feedback", "Không", "Phản hồi + [audio=...] [image=...]"],
            ],
            [2800, 1200, CONTENT_W - 4000]
          ),
          spacer(120),

          h2("3.3. Chín dạng câu hỏi chuẩn"),
          table(
            ["Excel", "JSON Teky", "Cách nhập đáp án"],
            [
              ["MC", "multiple_choice", "* trước đúng 1 đáp án đúng"],
              ["MR", "multiple_select", "* trước mọi đáp án đúng"],
              ["TF", "true_false", "Hai lựa chọn; * đáp án đúng (Đúng/Sai)"],
              ["MG / MA", "matching", "Vế trái | Vế phải; có thể kèm ảnh 2 vế"],
              ["SEQ", "ordering", "Answer 1…N theo đúng thứ tự"],
              ["FIB / WB", "fill_blank", "Dùng ___ trong đề; nhiều đáp án tương đương"],
              ["TI / SA", "short_answer", "1 textbox; thêm từ đồng nghĩa nếu cần"],
              ["NUM / NUMG", "numeric", "Một giá trị số chính xác"],
              ["MNUM", "multiple_numeric", "Nhiều ô số theo thứ tự"],
            ],
            [1600, 2400, CONTENT_W - 4000]
          ),
          spacer(120),
          callout(
            "Lưu ý dạng câu",
            [
              "FIB và short_answer trên LMS đều dùng một textbox. FIB đánh dấu chỗ trống bằng ___ trong Question Text.",
              "WB (Word Bank) map fill_blank; đáp án đúng đánh * khi chọn từ ngân hàng từ.",
              "DND, DIB, HS, ESSAY, LIKERT không thuộc 9 dạng Excel chuẩn Teky — có thể parse/skip khi dùng template iSpring cũ.",
            ]
          ),

          h2("3.4. Ví dụ minh họa theo mẫu 9 dạng"),
          table(
            ["#", "Type", "Ví dụ nội dung (rút gọn từ file mẫu)"],
            [
              ["1", "MC", "Đâu là Tượng Nữ thần Tự do?  *Tượng Nữ thần | Đài tưởng niệm | Hồ nước"],
              ["2", "MR", "Chọn địa danh tự nhiên: *Hồ nước, *Công viên, Tàu thủy"],
              ["3", "TF", "Đây có phải tàu Columbus? *Đúng | Sai"],
              ["4", "MG", "Nối: Ảnh|Hồ nước · Ảnh|Công viên · Ảnh|Đài tưởng niệm + Left/Right Image"],
              ["5", "SEQ", "Sắp xếp: Tàu → Tượng → Đài (thứ tự Answer 1→3)"],
              ["6", "FIB", "Tượng ___ ___ ___  → Nữ thần Tự do / nu than tu do"],
              ["7", "TI", "Gõ tên: Margaret Mitchell / Margaret"],
              ["8", "NUM", "Có bao nhiêu bang? → 50"],
              ["9", "MNUM", "x²−5x+6=0 → 2 và 3"],
              ["10", "WB", "Năm Columbus: *1492 | 1942 | 2024"],
            ],
            [600, 1000, CONTENT_W - 1600]
          ),
          spacer(120),

          h2("3.5. Media trong Excel"),
          h3("Nguyên tắc đường dẫn"),
          bullet("Dùng đường dẫn tương đối bắt đầu bằng media/ (ví dụ media/q01_question.jpg)."),
          bullet("Không dùng đường dẫn tuyệt đối (/Users/…, C:\\…)."),
          bullet("Tên file: không dấu, không khoảng trắng, chữ thường, có tiền tố câu hỏi."),
          bullet("Tên trong Excel khớp chính xác tên file (phân biệt hoa/thường trên Linux)."),

          h3("Gắn media theo vị trí"),
          table(
            ["Vị trí", "Cột / cú pháp"],
            [
              ["Cover quiz", "Quiz Settings → coverImage = media/quiz_cover.jpg"],
              ["Ảnh / audio / video câu hỏi", "Cột Image, Audio, Video"],
              ["Ảnh đáp án", "Answer N Image"],
              ["Matching trái / phải", "Answer N Left Image, Answer N Right Image"],
              ["Media trong ô text", "[image=media/f.png] [audio=media/f.mp3] [video=media/f.mp4]"],
              ["Đáp án đúng + media", "*Đáp án A [audio=media/voice_a.mp3]"],
            ],
            [3200, CONTENT_W - 3200]
          ),
          spacer(100),
          p("Định dạng hỗ trợ: Ảnh .jpg/.png/.gif/.webp… · Audio .mp3/.wav/.m4a/.ogg · Video .mp4/.webm/.mov. Video nên có poster (cột Image)."),

          // ===== 4. IMPORT & BIÊN TẬP =====
          h1("4. Import và biên tập trên SCORM Editor"),
          h2("4.1. Import gói Excel + media"),
          num("Chọn Mode: Teky LMS.", "numbers2"),
          num("Kéo thả file .zip (Excel + media/) vào vùng «Tạo quiz từ Excel».", "numbers2"),
          num("Đọc ImportReport: tổng dòng, imported, skipped, errors, media warnings.", "numbers2"),
          num("Xử lý hết error (sửa Excel/media rồi import lại). Warning media: bổ sung file còn thiếu.", "numbers2"),
          num("Mở session editor khi import thành công.", "numbers2"),

          h2("4.2. Hiệu chỉnh trên Editor"),
          table(
            ["Khu vực", "Nội dung chỉnh"],
            [
              ["Quiz Details", "title, description, cover, subject, difficulty, duration, tags"],
              ["Questions", "text, media, points, topic, explanation, đáp án theo loại; thêm/xóa câu"],
              ["Settings", "attemptLimit, shuffleQuestions/Answers, allowReview, showResults"],
              ["Canvas (mode SCORM)", "Layout tọa độ object — chủ yếu khi import SCORM iSpring gốc"],
            ],
            [2400, CONTENT_W - 2400]
          ),
          spacer(100),
          callout(
            "Save Quiz",
            [
              "Đây là nút lưu chính thức cho toàn session. Thêm/xóa đáp án hoặc câu hỏi chỉ hoàn tất sau khi Save Quiz thành công.",
              "Luôn Save Quiz trước khi mở Viewer hoặc Export CMS JSON.",
            ],
            greenLt,
            green
          ),

          h2("4.3. Kiểm duyệt bằng Viewer"),
          p("Nhấn «Xem & Làm bài» để mô phỏng giao diện Teky LMS:"),
          bullet("MC = radio; MR = checkbox; TF = Đúng/Sai.", "bullets2"),
          bullet("Matching = chọn cặp; Ordering = sắp xếp; FIB/Short Answer = 1 textbox.", "bullets2"),
          bullet("Numeric / Multiple Numeric = ô số.", "bullets2"),
          bullet("Kiểm tra ảnh, điểm, explanation, required, submit.", "bullets2"),
          spacer(80),
          p("Checklist review nhanh:", { bold: true, spacingAfter: 80 }),
          num("Không ảnh vỡ / media warning.", "numbers3"),
          num("Câu không bị cắt; dấu ___ đúng vị trí (FIB).", "numbers3"),
          num("Số đáp án / textbox đúng theo loại.", "numbers3"),
          num("Đáp án đúng, từ đồng nghĩa, thứ tự Matching/Ordering chính xác.", "numbers3"),
          num("Required, điểm, explanation, submit hoạt động.", "numbers3"),

          // ===== 5. XUẤT BẢN =====
          h1("5. Xuất bản và gắn vào Bài học / Học phần"),
          h2("5.1. Export CMS JSON"),
          p("Nhấn Export CMS JSON. Backend thực hiện:"),
          num("Đọc session đã Save.", "numbers4"),
          num("Map từng question sang 1 trong 9 type Teky LMS.", "numbers4"),
          num("Upload media lên S3/FPT (nếu cấu hình hợp lệ) → gắn coverImageUrl, imageUrl, leftImageUrl…", "numbers4"),
          num("Ghi file dạng mảng [ quiz_object ]:", "numbers4"),
          ...codeBlock([
            "SCORM-PROJECT/JSON-EXPORT/{quiz_title}_teky.json",
          ]),
          spacer(80),
          p("JSON-EXPORT nằm cùng cấp với ImportTemplate và được hệ thống tự tạo khi export lần đầu."),
          p("Cấu trúc JSON tối thiểu:", { bold: true, spacingAfter: 80 }),
          ...codeBlock([
            "[",
            "  {",
            '    "id": "quiz_...",',
            '    "title": "...",',
            '    "coverImageUrl": "https://s3-.../...",',
            '    "subject": "...",',
            '    "difficultyLevel": "medium",',
            '    "duration": 2700,',
            '    "settings": { "shuffleQuestions": true, "attemptLimit": 3, ... },',
            '    "questions": [ /* 9 type chuẩn */ ],',
            '    "createdAt": "...Z",',
            '    "updatedAt": "...Z"',
            "  }",
            "]",
          ]),
          spacer(100),
          p(
            "Đối chiếu với docs/cms_json_template.json và cms_json_full_sample.json trước khi import LMS. Nếu upload S3 thất bại, exporter có thể giữ path images/<filename> cho QA local."
          ),

          h2("5.2. Map loại câu hỏi khi xuất bản"),
          table(
            ["Excel", "iSpring (nếu từ SCORM)", "Teky JSON type"],
            [
              ["MC", "MultipleChoice", "multiple_choice"],
              ["MR", "MultipleResponse", "multiple_select"],
              ["TF", "TrueFalse", "true_false"],
              ["MG", "Matching", "matching"],
              ["SEQ", "Sequence", "ordering"],
              ["FIB / WB", "FillInTheBlank / WordBank", "fill_blank"],
              ["TI", "TypeIn", "short_answer"],
              ["NUM", "Numeric (clone TypeIn)", "numeric"],
              ["MNUM", "—", "multiple_numeric"],
            ],
            [1600, 3600, CONTENT_W - 5200]
          ),
          spacer(100),
          p("InfoSlide / Intro / Result không đưa vào questions[] trong JSON CMS."),

          h2("5.3. Gắn quiz vào Bài học / Học phần trên Teky LMS"),
          p(
            "Sau khi có file *_teky.json hợp lệ, vận hành LMS thực hiện (theo quy trình CMS của Teky):"
          ),
          num("Import JSON quiz vào ngân hàng / module quiz của Teky LMS.", "numbers5"),
          num("Smoke test: mở quiz, làm thử 1–2 câu mỗi dạng có dùng, kiểm tra media URL public.", "numbers5"),
          num(
            "Gắn quiz vào đúng Bài học (ôn tập sau bài) hoặc Học phần (quiz tổng hợp) theo ma trận nội dung.",
            "numbers5"
          ),
          num("Cấu hình hiển thị: điều kiện mở (sau khi hoàn thành bài), số lần làm, thời gian — khớp với Quiz Settings đã xuất.", "numbers5"),
          num("Phát hành / publish bài học-học phần trên môi trường production.", "numbers5"),
          spacer(100),
          table(
            ["Kịch bản", "Gợi ý cấu hình quiz", "Gắn LMS"],
            [
              [
                "Ôn tập sau 1 bài học",
                "5–15 câu; duration ngắn; attemptLimit ≥ 2; allowReview = True",
                "Component «Câu hỏi ôn tập» của Bài học",
              ],
              [
                "Kiểm tra cuối học phần",
                "Nhiều topic; shuffleQuestions = True; attemptLimit = 1–3; showResults = after_submit",
                "Quiz tổng hợp cấp Học phần",
              ],
              [
                "Luyện tập voice-first (mầm non)",
                "Audio đề + feedback; ảnh đáp án; điểm thấp / nhiều lần làm",
                "Bài học kỹ năng; media đầy đủ",
              ],
            ],
            [2400, 3800, CONTENT_W - 6200]
          ),

          h2("5.4. Export bổ sung (tùy nhu cầu)"),
          table(
            ["Hành động", "Kết quả", "Khi nào dùng"],
            [
              ["Export SCORM 1.2 ZIP", "Gói LMS chuẩn SCORM", "LMS chỉ nhận SCORM; hoặc backup"],
              ["Export Media ZIP", "Toàn bộ media package", "QA, bàn giao media riêng"],
              ["Export single media", "1 file + quy ước đặt tên ảnh", "Đổi tên theo hậu tố _IMG-DA1…"],
            ],
            [2600, 2800, CONTENT_W - 5400]
          ),

          // ===== 6. CHECKLIST =====
          h1("6. Checklist xuất bản (bắt buộc)"),
          num("Sao chép template → thư mục làm việc riêng theo mã Bài học / Học phần.", "publish"),
          num("Điền đủ Quiz Settings (title, coverImage, duration, attemptLimit…).", "publish"),
          num("Viết toàn bộ Question + đáp án đúng (*) theo 9 dạng cần dùng.", "publish"),
          num("Đặt media vào media/; path khớp Excel; có poster cho video.", "publish"),
          num("Nén ZIP: Excel + media/ cùng cấp.", "publish"),
          num("Import Mode Teky LMS → xử lý hết error / media warning.", "publish"),
          num("Hiệu chỉnh Quiz Details, Questions, Settings trên Editor.", "publish"),
          num("Save Quiz.", "publish"),
          num("Viewer «Xem & Làm bài» — review đủ dạng đã dùng.", "publish"),
          num("Sửa (nếu cần) → Save lại.", "publish"),
          num("Export CMS JSON.", "publish"),
          num("So JSON với template / full sample; kiểm tra URL S3 truy cập được.", "publish"),
          num("Import JSON lên Teky LMS; gắn vào Bài học / Học phần.", "publish"),
          num("Smoke test lần cuối trên LMS thật.", "publish"),

          // ===== 7. LỖI THƯỜNG GẶP =====
          h1("7. Xử lý lỗi thường gặp"),
          table(
            ["Hiện tượng", "Nguyên nhân / cách xử lý"],
            [
              [
                "Không tìm thấy ảnh: media/…",
                "File thiếu trong ZIP hoặc sai hoa/thường; Excel và media/ phải cùng cấp",
              ],
              [
                "Cover bị vỡ",
                "Kiểm tra coverImage trong Quiz Settings; import bằng ZIP đầy đủ",
              ],
              [
                "Thêm đáp án rồi biến mất",
                "Chưa Save Quiz; thêm nội dung rồi nhấn Save",
              ],
              [
                "S3 URL trống sau export",
                "Kiểm tra cấu hình S3/bucket/quyền; media có trong session",
              ],
              [
                "JSON thiếu câu",
                "Loại không mapping, đã xóa, hoặc chưa Save trước export",
              ],
              [
                "Video không preview",
                "Thêm poster cột Image; đúng định dạng .mp4/.webm/.mov",
              ],
              [
                ".xls báo thiếu xlrd",
                "Cài đủ backend/requirements.txt; ưu tiên .xlsx chuẩn Teky",
              ],
            ],
            [3200, CONTENT_W - 3200]
          ),

          // ===== 8. PHỤ LỤC =====
          h1("8. Phụ lục"),
          h2("8.1. API chính liên quan quy trình"),
          table(
            ["Method", "Path", "Mục đích"],
            [
              ["POST", "/api/import/excel", "Import Excel hoặc ZIP Excel+media"],
              ["GET", "/api/session/{id}", "Đọc view editor"],
              ["PUT", "/api/session/{id}", "Save Quiz"],
              ["GET", "/api/session/{id}/preview/player", "Viewer / player"],
              ["POST", "/api/session/{id}/export-cms-json-local", "Export JSON Teky LMS"],
              ["POST", "/api/session/{id}/export", "Export SCORM 1.2 ZIP"],
              ["POST", "/api/session/{id}/export-media", "Export media ZIP"],
            ],
            [1200, 4800, CONTENT_W - 6000]
          ),
          spacer(120),

          h2("8.2. Ma trận bước ↔ vai trò"),
          table(
            ["Bước", "Biên soạn", "QA", "Vận hành LMS"],
            [
              ["Soạn Excel + media", "Chính", "Rà mẫu", "—"],
              ["Import / Edit / Save", "Chính", "Hỗ trợ", "—"],
              ["Viewer review", "Đồng review", "Chính", "—"],
              ["Export CMS JSON", "Thực hiện", "Đối chiếu schema", "Nhận file"],
              ["Import LMS + gắn BH/HP", "—", "Smoke test", "Chính"],
              ["Publish production", "—", "Xác nhận", "Chính"],
            ],
            [2800, 2000, 2000, CONTENT_W - 6800]
          ),
          spacer(120),

          h2("8.3. Tóm tắt Input → Output"),
          table(
            ["Input", "Xử lý", "Output"],
            [
              ["Excel Teky + media ZIP", "Import → Edit → Save → View", "Session quiz hợp lệ"],
              ["Session đã Save", "Export CMS JSON (+ S3)", "*_teky.json + URL media"],
              ["*_teky.json", "Import Teky LMS", "Quiz gắn Bài học / Học phần"],
              ["SCORM iSpring ZIP (tùy chọn)", "Edit → Export SCORM/JSON", "SCORM 1.2 hoặc JSON"],
            ],
            [2800, 3200, CONTENT_W - 6000]
          ),
          spacer(160),

          h2("8.4. Tài liệu liên quan"),
          bullet("scorm-editor/SCORM_Editor_Huong_Dan_Chi_Tiet.docx — hướng dẫn chi tiết Editor.", "bullets3"),
          bullet("scorm-editor/docs/SCORM_EDITOR_GUIDE.md — hướng dẫn vận hành hai mode.", "bullets3"),
          bullet("scorm-editor/docs/TEKY_EXCEL_SCHEMA.md — schema Excel chuẩn.", "bullets3"),
          bullet("ImportTemplate/Full_quiz_9_types_sample/Full_quiz_9_types_teky_lms_system_ids.xlsx — template 9 dạng.", "bullets3"),
          bullet("ImportTemplate/Full_quiz_9_types_teky_lms.zip — gói import chính thức.", "bullets3"),
          bullet("docs/cms_json_full_sample.json — JSON tham chiếu đủ 9 dạng.", "bullets3"),
          spacer(200),

          callout(
            "Kết luận",
            [
              "Quy trình chuẩn cho câu hỏi ôn tập Bài học / Học phần: soạn Excel (Settings + Questions) + media → ZIP → Import Teky LMS trên SCORM Editor → Save → Viewer → Export CMS JSON → Import & gắn LMS.",
              "Bám template Full_quiz_9_types_teky_lms_system_ids.xlsx và checklist mục 6 để giảm lỗi media, thiếu câu, và sai cấu hình khi xuất bản.",
            ],
            blueLt,
            blue
          ),
        ],
      },
    ],
  });

  const outDir = path.join(__dirname);
  const outPath = path.join(outDir, "Quy_Trinh_Xay_Dung_Xuat_Ban_Cau_Hoi_On_Tap.docx");
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  console.log("Wrote", outPath, "(" + buf.length + " bytes)");

  // also root copy for easy find
  const rootCopy = path.join(
    __dirname,
    "..",
    "..",
    "Quy_Trinh_Xay_Dung_Xuat_Ban_Cau_Hoi_On_Tap.docx"
  );
  fs.writeFileSync(rootCopy, buf);
  console.log("Wrote", rootCopy);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
