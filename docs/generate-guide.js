/**
 * Generate the Word version of the canonical SCORM Editor guide.
 *
 * Source: docs/SCORM_EDITOR_GUIDE.md
 * Output: docs/SCORM_Editor_Huong_Dan_Chi_Tiet.docx
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sourcePath = path.join(__dirname, 'SCORM_EDITOR_GUIDE.md')
const outputPath = path.join(__dirname, 'SCORM_Editor_Huong_Dan_Chi_Tiet.docx')

const COLORS = {
  blue: '2E74B5',
  darkBlue: '1F4D78',
  body: '202124',
  muted: '667085',
  lightBlue: 'E8EEF5',
  lightGray: 'F4F6F9',
  border: 'C8D2DF',
  white: 'FFFFFF',
}

const PAGE_WIDTH_DXA = 12240
const PAGE_HEIGHT_DXA = 15840
const PAGE_MARGIN_DXA = 1440
const PAGE_BOTTOM_MARGIN_DXA = 1800
const CONTENT_WIDTH_DXA = 9360
const TABLE_INDENT_DXA = 120

function inlineRuns(text, options = {}) {
  const runs = []
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let cursor = 0
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > cursor) {
      runs.push(new TextRun({
        text: text.slice(cursor, match.index),
        font: 'Calibri',
        size: 20,
        color: COLORS.body,
        ...options,
      }))
    }
    const token = match[0]
    if (token.startsWith('**')) {
      runs.push(new TextRun({
        text: token.slice(2, -2),
        bold: true,
        font: 'Calibri',
        size: 20,
        color: COLORS.body,
        ...options,
      }))
    } else {
      runs.push(new TextRun({
        text: token.slice(1, -1),
        font: 'Courier New',
        size: 18,
        color: COLORS.darkBlue,
        shading: { type: ShadingType.CLEAR, fill: 'EEF2F6', color: 'auto' },
      }))
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) {
    runs.push(new TextRun({
      text: text.slice(cursor),
      font: 'Calibri',
      size: 20,
      color: COLORS.body,
      ...options,
    }))
  }
  return runs.length ? runs : [new TextRun({ text: '', font: 'Calibri', size: 20 })]
}

function bodyParagraph(text) {
  return new Paragraph({
    children: inlineRuns(text),
    spacing: { after: 100, line: 280, lineRule: 'auto' },
  })
}

function headingParagraph(level, text) {
  const heading = level === 1
    ? HeadingLevel.HEADING_1
    : level === 2
      ? HeadingLevel.HEADING_2
      : HeadingLevel.HEADING_3
  return new Paragraph({
    heading,
    children: [new TextRun({
      text,
      bold: true,
      font: 'Calibri',
      color: level === 3 ? COLORS.darkBlue : COLORS.blue,
      size: level === 1 ? 30 : level === 2 ? 25 : 23,
    })],
    spacing: {
      before: level === 1 ? 360 : level === 2 ? 280 : 200,
      after: level === 1 ? 200 : level === 2 ? 140 : 100,
    },
    keepNext: true,
    pageBreakBefore: level === 1 && /^([2-9]|1[0-3])\./.test(text),
  })
}

function listParagraph(text, ordered, orderNumber = null) {
  return new Paragraph({
    children: ordered
      ? [
          new TextRun({
            text: `${orderNumber}. `,
            font: 'Calibri',
            size: 20,
            color: COLORS.body,
          }),
          ...inlineRuns(text),
        ]
      : inlineRuns(text),
    numbering: ordered
      ? undefined
      : {
          reference: 'guide-bullets',
          level: 0,
        },
    indent: ordered ? { left: 540, hanging: 270 } : undefined,
    spacing: { after: 60, line: 280, lineRule: 'auto' },
  })
}

function codeBlock(lines) {
  return new Paragraph({
    children: lines.flatMap((line, index) => [
      new TextRun({
        text: line,
        font: 'Courier New',
        size: 18,
        color: COLORS.darkBlue,
        break: index === 0 ? 0 : 1,
      }),
    ]),
    spacing: { before: 100, after: 160, line: 260, lineRule: 'auto' },
    indent: { left: 220, right: 220 },
    shading: { type: ShadingType.CLEAR, fill: COLORS.lightGray, color: 'auto' },
    border: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    },
  })
}

function tableFromRows(rows) {
  const columnCount = Math.max(...rows.map((row) => row.length))
  const widths = columnCount === 2
    ? [2700, CONTENT_WIDTH_DXA - 2700]
    : Array.from({ length: columnCount }, () => Math.floor(CONTENT_WIDTH_DXA / columnCount))
  widths[widths.length - 1] += CONTENT_WIDTH_DXA - widths.reduce((sum, width) => sum + width, 0)

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    indent: { size: TABLE_INDENT_DXA, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: COLORS.border },
      insideVertical: { style: BorderStyle.SINGLE, size: 3, color: COLORS.border },
    },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      cantSplit: true,
      children: Array.from({ length: columnCount }, (_, columnIndex) => new TableCell({
        width: { size: widths[columnIndex], type: WidthType.DXA },
        verticalAlign: 'center',
        shading: rowIndex === 0
          ? { type: ShadingType.CLEAR, fill: COLORS.lightBlue, color: 'auto' }
          : undefined,
        children: [new Paragraph({
          children: inlineRuns(row[columnIndex] || '', {
            bold: rowIndex === 0,
            size: rowIndex === 0 ? 19 : 18,
          }),
          spacing: { before: 20, after: 20, line: 250, lineRule: 'auto' },
        })],
      })),
    })),
  })
}

function parseMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const children = []
  let paragraphBuffer = []
  let codeLines = null

  const flushParagraph = () => {
    const text = paragraphBuffer.join(' ').trim()
    if (text) children.push(bodyParagraph(text))
    paragraphBuffer = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.startsWith('```')) {
      flushParagraph()
      if (codeLines === null) codeLines = []
      else {
        children.push(codeBlock(codeLines))
        codeLines = null
      }
      continue
    }
    if (codeLines !== null) {
      codeLines.push(line)
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      if (headingMatch[1].length === 1) continue
      children.push(headingParagraph(headingMatch[1].length - 1, headingMatch[2]))
      continue
    }

    if (line.startsWith('|') && index + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[index + 1])) {
      flushParagraph()
      const tableRows = []
      const parseRow = (value) => {
        const cells = []
        let cell = ''
        let inCode = false
        for (const character of value.slice(1, -1)) {
          if (character === '`') {
            inCode = !inCode
            continue
          }
          if (character === '|' && !inCode) {
            cells.push(cell.trim())
            cell = ''
          } else {
            cell += character
          }
        }
        cells.push(cell.trim())
        return cells
      }
      tableRows.push(parseRow(line))
      index += 2
      while (index < lines.length && lines[index].startsWith('|')) {
        tableRows.push(parseRow(lines[index]))
        index += 1
      }
      index -= 1
      children.push(tableFromRows(tableRows))
      children.push(new Paragraph({ spacing: { after: 120 } }))
      continue
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/)
    if (orderedMatch) {
      flushParagraph()
      children.push(listParagraph(orderedMatch[2], true, orderedMatch[1]))
      continue
    }
    const bulletMatch = line.match(/^-\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      children.push(listParagraph(bulletMatch[1], false))
      continue
    }

    paragraphBuffer.push(line.trim())
  }
  flushParagraph()
  if (codeLines !== null) children.push(codeBlock(codeLines))
  return children
}

function coverPage() {
  return [
    new Paragraph({ spacing: { before: 1300, after: 360 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'SCORM EDITOR',
        bold: true,
        font: 'Arial',
        size: 56,
        color: COLORS.blue,
      })],
      spacing: { after: 180 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'Hướng dẫn chi tiết hai mode biên soạn nội dung',
        font: 'Arial',
        size: 26,
        color: COLORS.darkBlue,
      })],
      spacing: { after: 100 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'SCORM ZIP · Excel Teky LMS + media · Editor · Viewer · JSON LMS',
        font: 'Arial',
        size: 20,
        color: COLORS.muted,
      })],
      spacing: { after: 700 },
    }),
    tableFromRows([
      ['Phạm vi', 'Nội dung'],
      ['Mode 1', 'Import SCORM zip → Edit → View → Export SCORM/JSON'],
      ['Mode 2', 'Import Excel + media → Edit → View → Export JSON Teky LMS'],
      ['Đầu ra chuẩn', 'JSON đủ cấu hình quiz, 9 dạng question và link media S3/FPT'],
      ['Nguồn chuẩn', 'docs/SCORM_EDITOR_GUIDE.md'],
    ]),
    new Paragraph({ children: [new PageBreak()] }),
    headingParagraph(1, 'Mục lục nội dung'),
    ...[
      '1. Tổng quan',
      '2. Tài nguyên mẫu',
      '3. Mode iSpring SCORM',
      '4. Mode Teky LMS',
      '5. Excel chuẩn Teky LMS',
      '6. Media và link ảnh',
      '7. Chín dạng question',
      '8. Editor và Save Quiz',
      '9. Viewer',
      '10. Export JSON',
      '11. Checklist',
      '12. Xử lý lỗi',
      '13. API',
    ].map((item) => listParagraph(item, false)),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

const markdown = fs.readFileSync(sourcePath, 'utf8')
const content = [...coverPage(), ...parseMarkdown(markdown)]

const document = new Document({
  creator: 'SCORM Editor',
  title: 'Hướng dẫn SCORM Editor',
  description: 'Hướng dẫn hai mode iSpring SCORM và Teky LMS',
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 20, color: COLORS.body },
        paragraph: { spacing: { after: 100, line: 280, lineRule: 'auto' } },
      },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { bold: true, font: 'Calibri', size: 30, color: COLORS.blue },
        paragraph: { spacing: { before: 360, after: 200 }, keepNext: true },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { bold: true, font: 'Calibri', size: 25, color: COLORS.blue },
        paragraph: { spacing: { before: 280, after: 140 }, keepNext: true },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { bold: true, font: 'Calibri', size: 23, color: COLORS.darkBlue },
        paragraph: { spacing: { before: 200, after: 100 }, keepNext: true },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'guide-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: {
              indent: { left: 540, hanging: 270 },
              spacing: { after: 60, line: 280, lineRule: 'auto' },
            },
          },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_WIDTH_DXA, height: PAGE_HEIGHT_DXA },
        margin: {
          top: PAGE_MARGIN_DXA,
          right: PAGE_MARGIN_DXA,
          bottom: PAGE_BOTTOM_MARGIN_DXA,
          left: PAGE_MARGIN_DXA,
          header: 708,
          footer: 708,
        },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [new TextRun({
            text: 'SCORM Editor — Hướng dẫn chi tiết',
            font: 'Arial',
            size: 16,
            color: COLORS.muted,
          })],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
          },
          spacing: { after: 80 },
        })],
      }),
    },
    children: content,
  }],
})

const buffer = await Packer.toBuffer(document)
fs.writeFileSync(outputPath, buffer)
console.log(outputPath)
