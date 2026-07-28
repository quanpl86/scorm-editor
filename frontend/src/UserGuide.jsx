import { useEffect, useRef, useState } from 'react'

const SECTIONS = [
  { id: 'intro', title: '1. Giới thiệu tổng quan' },
  { id: 'install', title: '2. Cài đặt & khởi chạy' },
  { id: 'input', title: '3. Đầu vào (Input)' },
  { id: 'editor', title: '4. Giao diện & Editor' },
  { id: 'media', title: '5. Media SCORM / iSpring' },
  { id: 'view-json', title: '6. JSON trung gian (View)' },
  { id: 'export', title: '7. Đầu ra (Export)' },
  { id: 'naming', title: '8. Quy ước đặt tên ảnh' },
  { id: 'api', title: '9. Tham chiếu API' },
  { id: 'checklist', title: '10. Checklist thực hành' },
  { id: 'limits', title: '11. Giới hạn & kỹ thuật' },
  { id: 'appendix', title: '12. Phụ lục tóm tắt' },
]

function GuideTable({ headers, rows }) {
  return (
    <div className="guide-table-wrap">
      <table className="guide-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GuideCode({ children }) {
  return <pre className="guide-code">{children}</pre>
}

function GuideNote({ children }) {
  return <div className="guide-note">{children}</div>
}

function GuideContent() {
  return (
    <div className="guide-content">
      {/* ── 1 ── */}
      <section id="guide-intro" className="guide-section">
        <h2>1. Giới thiệu tổng quan</h2>
        <h3>1.1. SCORM Editor là gì?</h3>
        <p>
          SCORM Editor là ứng dụng web full-stack giúp mở, chỉnh sửa và xuất gói bài kiểm tra{' '}
          <strong>SCORM 1.2</strong> từ iSpring Quiz Maker. Hỗ trợ hai luồng nhập: import gói SCORM
          có sẵn, hoặc tạo quiz từ Excel chuẩn iSpring — sau đó chỉnh canvas, preview và export ra
          LMS hoặc JSON Teky-school.
        </p>

        <h3>1.2. Luồng làm việc tổng quát</h3>
        <GuideCode>{`[INPUT]  SCORM .zip  ─────────────────┐
         Excel .xls/.xlsx ────────────┼──► Editor (session) ──► [OUTPUT]
         Excel.zip + media/ ──────────┘
                                            ├─ SCORM 1.2 .zip  (LMS)
                                            ├─ Teky JSON       (*_teky.json)
                                            └─ Media zip/local`}</GuideCode>

        <h3>1.3. Kiến trúc kỹ thuật</h3>
        <GuideTable
          headers={['Thành phần', 'Công nghệ', 'Vai trò']}
          rows={[
            ['Backend', 'Python FastAPI', 'Parse SCORM/Excel, session, save, export, preview'],
            ['Frontend', 'React + Vite', 'UI import, editor, canvas, preview, toolbar'],
            ['Session storage', 'backend/data/sessions/', 'Mỗi lần import tạo session riêng'],
            ['MASTER SCORM', 'DGSA_Level5_Bài 1_...', 'Template slide khi tạo quiz từ Excel'],
            ['Import templates', 'ImportTemplate/', 'File Excel mẫu + thư mục media'],
          ]}
        />

        <h3>1.4. Cấu trúc thư mục dự án</h3>
        <GuideCode>{`scorm-editor/
├── backend/app/
│   ├── main.py           # API endpoints
│   ├── scorm_parser.py   # Decode/encode iSpring, view, save, export
│   ├── excel_import.py   # Parse Excel + media brackets
│   ├── quiz_builder.py   # Inject Excel → quiz JSON + layout
│   ├── cms_export.py     # Export Teky-school JSON
│   ├── media_rich.py     # Audio/video/image rich text
│   ├── layout.py         # Canvas layout / reflow
│   └── preview.py        # Preview player + report proxy
├── frontend/src/         # React UI
├── docs/                 # Đặc tả + plan + Word guide
└── start.sh              # Chạy nhanh local`}</GuideCode>
      </section>

      {/* ── 2 ── */}
      <section id="guide-install" className="guide-section">
        <h2>2. Cài đặt và khởi chạy</h2>
        <h3>2.1. Yêu cầu hệ thống</h3>
        <ul>
          <li>Python 3+ (backend)</li>
          <li>Node.js &amp; npm (frontend build)</li>
          <li>Trình duyệt hiện đại (Chrome / Edge / Firefox / Safari)</li>
        </ul>

        <h3>2.2. Chạy nhanh bằng start.sh</h3>
        <ol>
          <li>Mở Terminal, vào thư mục <code>scorm-editor</code>.</li>
          <li>Cấp quyền: <code>chmod +x start.sh</code></li>
          <li>Chạy: <code>./start.sh</code></li>
        </ol>
        <p>
          Script: tạo venv → cài requirements → npm install → npm run build → uvicorn port 8000.
        </p>
        <p>
          Truy cập: <strong>http://localhost:8000</strong>
        </p>

        <h3>2.3. Chạy thủ công</h3>
        <p><strong>Frontend:</strong></p>
        <GuideCode>{`cd frontend
npm install
npm run build
cd ..`}</GuideCode>
        <p><strong>Backend:</strong></p>
        <GuideCode>{`cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000`}</GuideCode>

        <h3>2.4. Chạy test tự động</h3>
        <GuideCode>{`cd scorm-editor/backend
.venv/bin/pytest tests/ -v`}</GuideCode>
      </section>

      {/* ── 3 ── */}
      <section id="guide-input" className="guide-section">
        <h2>3. Đầu vào (Input)</h2>
        <h3>3.1. Gói SCORM iSpring (.zip)</h3>
        <p>
          Import package SCORM 1.2 từ iSpring Quiz Maker để chỉnh nội dung, layout và media.
        </p>
        <GuideTable
          headers={['Mục', 'Chi tiết']}
          rows={[
            ['API', 'POST /api/import'],
            ['File', '.zip (hỗ trợ zip lồng zip)'],
            ['Bên trong', 'imsmanifest.xml + res/index.html'],
            ['Dữ liệu quiz', 'Base64 trong HTML → decode UTF-8 JSON iSpring'],
            ['UI', 'Dropzone «Chỉnh sửa SCORM có sẵn» hoặc Load mẫu'],
          ]}
        />
        <GuideNote>
          Quiz iSpring dùng key ngắn (d, sl, tp, C, rs…). Người dùng không cần chỉnh trực tiếp JSON thô.
        </GuideNote>

        <h3>3.2. Excel iSpring QuizMaker</h3>
        <p>
          Tạo quiz mới dựa trên MASTER SCORM (slide templates), inject từng dòng Excel thành slide.
        </p>
        <GuideTable
          headers={['Mục', 'Chi tiết']}
          rows={[
            ['API', 'POST /api/import/excel'],
            ['File', '.xls / .xlsx hoặc .zip (Excel + media/)'],
            ['Form options', 'quiz_title, group_title'],
            ['UI', 'Dropzone Excel + form tên + nút import mẫu'],
          ]}
        />

        <h3>3.2.1. Cột Excel (hàng 1 = header)</h3>
        <GuideTable
          headers={['Cột', 'Bắt buộc', 'Mô tả']}
          rows={[
            ['Question Type', 'Có', 'MC, MR, TF, TI, SEQ, MG, FIB, WB, IS, NUMG…'],
            ['Question Text', 'Có*', 'Nội dung câu hỏi (*TF có thể chỉ có Image)'],
            ['Image', 'Không', 'Ảnh câu hỏi — đường dẫn tương đối'],
            ['Audio', 'Không', 'Audio đọc đề'],
            ['Video', 'Không', 'Video bài học; cần poster (cột Image)'],
            ['Answer 1…10', 'Theo loại', 'Đáp án; * = đúng; brackets media'],
            ['Correct Feedback', 'Không', 'Phản hồi khi đúng + media'],
            ['Incorrect Feedback', 'Không', 'Phản hồi khi sai + media'],
            ['Points', 'Không', 'Điểm câu hỏi'],
          ]}
        />

        <h3>3.2.2. Map loại câu hỏi Excel → iSpring</h3>
        <GuideTable
          headers={['Mã Excel', 'Loại iSpring', 'Ghi chú']}
          rows={[
            ['MC', 'MultipleChoice', 'Trắc nghiệm 1 đáp án đúng'],
            ['MR', 'MultipleResponse', 'Chọn nhiều'],
            ['TF', 'TrueFalse', 'Đúng / Sai'],
            ['TI / SA', 'TypeIn', 'Nhập câu trả lời ngắn'],
            ['NUM / NUMG', 'Numeric', 'Số (clone template TypeIn)'],
            ['SEQ', 'Sequence', 'Sắp xếp thứ tự'],
            ['MG / MA', 'Matching', 'Nối cặp'],
            ['FIB / FITB', 'FillInTheBlank', 'Điền khuyết'],
            ['WB', 'WordBank', 'Kéo từ vào chỗ trống'],
            ['IS', 'InfoSlide', 'Slide thông tin (không chấm điểm)'],
            ['DND, DIB, HS, ESSAY…', '—', 'Parse nhưng SKIP (không import Excel)'],
          ]}
        />

        <h3>3.2.3. Cú pháp media trong ô Excel (brackets)</h3>
        <p><strong>Cú pháp rõ ràng (khuyến nghị):</strong></p>
        <GuideCode>{`[image=media\\ten_anh.jpg]
[audio=media\\ten_audio.mp3]
[video=media\\ten_video.mp4]
[sound=media\\ten_audio.mp3]    ← alias audio`}</GuideCode>
        <p><strong>Cú pháp ngắn theo đuôi file:</strong></p>
        <GuideCode>{`[media\\anh.png]      → image
[media\\voice.mp3]    → audio
[media\\clip.mp4]     → video`}</GuideCode>
        <p><strong>Đáp án đúng + media:</strong></p>
        <GuideCode>{`*Con heo [audio=media\\voice_heo.mp3]
*Đáp án A [image=media\\icon_a.png]`}</GuideCode>
        <p><strong>Nhiều media trong feedback:</strong></p>
        <GuideCode>{`Giỏi lắm! [audio=media\\voice_chuc.mp3] [image=media\\star.png]
Thử lại nhé [audio=media\\voice_goi_y.mp3] [image=media\\goi_y.jpg]`}</GuideCode>

        <h3>3.2.4. Định dạng file media hỗ trợ</h3>
        <GuideTable
          headers={['Loại', 'Đuôi file']}
          rows={[
            ['Ảnh', '.jpg .jpeg .png .gif .bmp .webp'],
            ['Audio', '.mp3 .wav .m4a .ogg'],
            ['Video', '.mp4 .webm .mov'],
          ]}
        />

        <h3>3.2.5. File mẫu có sẵn</h3>
        <GuideTable
          headers={['File', 'Vai trò', 'Nút UI']}
          rows={[
            ['Sample_import_template.xls', 'Đầy đủ MC/MR/TF/TI/MG/SEQ/IS/NUMG', 'Import mẫu Excel'],
            ['Media_import_sample.xlsx', 'Audio/video mầm non', 'Import mẫu Audio/Video'],
            ['FIB_WB_import_sample.xlsx', 'FIB, Word Bank, Numeric', 'Import mẫu FIB / WB / Numeric'],
            ['media/', 'Ảnh, voice_*.mp3, sample_lesson.mp4', 'Cùng cấp Excel trong zip'],
          ]}
        />

        <h3>3.3. Nguyên tắc media</h3>
        <ul>
          <li>Media <strong>local only</strong> — copy vào package; không dùng direct URL (YouTube, Drive…).</li>
          <li>Video luôn cần ảnh poster (cột Image hoặc <code>[image=...]</code>).</li>
          <li>Media thiếu file → warning trong ImportReport, không fail cả dòng.</li>
          <li>Sau import: <code>ensure_media_registry()</code> đăng ký rs.i / rs.a / rs.v.</li>
        </ul>
      </section>

      {/* ── 4 ── */}
      <section id="guide-editor" className="guide-section">
        <h2>4. Giao diện và tính năng Editor</h2>
        <h3>4.1. Trang Import</h3>
        <ul>
          <li>
            <strong>Tạo quiz từ Excel:</strong> form tên quiz/nhóm; hướng dẫn cột; tải template;
            dropzone; 3 nút import mẫu.
          </li>
          <li>
            <strong>Chỉnh sửa SCORM có sẵn:</strong> dropzone .zip; Load mẫu ZIP / thư mục.
          </li>
          <li>
            <strong>ImportReport:</strong> imported / errors / skipped / media warnings; link «Mở
            slide #N».
          </li>
        </ul>

        <h3>4.2. Meta quiz</h3>
        <GuideTable
          headers={['Trường', 'Mô tả']}
          rows={[
            ['Tên quiz', 'Ghi vào d.T của iSpring'],
            ['Điểm đạt (%)', 'passingScore — ngưỡng Result slide'],
            ['Reporting — Gửi server', 'Bật + URL nhận kết quả'],
            ['Reporting — Email admin', 'Bật + email + filter (passed/failed/both)'],
            ['Reporting — Email học viên', 'Bật + filter'],
          ]}
        />

        <h3>4.3. Danh sách câu hỏi</h3>
        <ul>
          <li>Hiển thị theo nhóm (groups) và thứ tự slide.</li>
          <li>Chọn slide để chỉnh Nội dung / Canvas / Preview.</li>
          <li>Xóa câu hỏi (nếu editable); hiển thị loại, điểm, preview ngắn.</li>
        </ul>

        <h3>4.4. Tab Nội dung (Question Editor)</h3>
        <ul>
          <li>Sửa questionText; định dạng chữ (TextFormatToolbar).</li>
          <li>Điểm (points), giới hạn thời gian, xáo đáp án (shuffle).</li>
        </ul>
        <GuideTable
          headers={['Loại', 'Chỉnh sửa trên tab Nội dung']}
          rows={[
            ['MultipleChoice / MR / TF', 'choices[]: text, isCorrect, image, audio, video'],
            ['Sequence', 'choices / sequenceItems + thứ tự'],
            ['Matching', 'matchingPairs (left/right text + image)'],
            ['TypeIn / Numeric', 'typeInAnswers[]'],
            ['FIB / WordBank', 'blankAnswers, richHtml, wordBankWords'],
            ['InfoSlide', 'Nội dung thông tin / media'],
            ['Hotspot / DND…', 'Hạn chế — ưu tiên Canvas; notice readonly/partial'],
          ]}
        />
        <p><strong>Feedback đúng / sai:</strong></p>
        <GuideTable
          headers={['Field view', 'Ý nghĩa']}
          rows={[
            ['correct / incorrect', 'Text phản hồi'],
            ['correctAudio / incorrectAudio', 'File trong res/data/audios/'],
            ['correctImage / incorrectImage', 'Ảnh inline feedback'],
            ['correctVideo / incorrectVideo', 'Video inline feedback'],
          ]}
        />

        <h3>4.5. Tab Canvas (LayoutCanvas)</h3>
        <ul>
          <li>Kéo thả / resize object trên canvas theo tọa độ iSpring.</li>
          <li>Sửa text inline; icon, shape, typography; font nhúng từ package.</li>
          <li>Choice layout: reflow hàng đáp án MC/MR/TF/Sequence.</li>
          <li>Matching preview; blank HTML cho FIB/WB.</li>
          <li>Hotspot / kéo thả: chỉnh layout trên Canvas.</li>
        </ul>
        <GuideNote>
          Sau import Excel, backend gọi reflow_imported_slide() để giảm overlap text/media.
        </GuideNote>

        <h3>4.6. Preview</h3>
        <ul>
          <li>Preview player: <code>GET /api/session/&#123;id&#125;/preview/player</code></li>
          <li>Mock SCORM API để làm thử bài.</li>
          <li>Report proxy CORS — host cho phép ispringsolutions.com, teky.vn.</li>
        </ul>

        <h3>4.7. Auto-save &amp; lịch sử</h3>
        <ul>
          <li>
            <strong>useAutoSync:</strong> đồng bộ dirty fields lên server (PUT session).
          </li>
          <li>
            <strong>useQuizHistory:</strong> undo/redo.
          </li>
          <li>
            Save ghi quiz JSON (quiz_data.json) + encode base64 trong index.html.
          </li>
        </ul>

        <h3>4.8. Upload / thay ảnh</h3>
        <ul>
          <li>
            <code>POST /api/session/&#123;id&#125;/asset/&#123;filename&#125;</code> — thay file ảnh.
          </li>
          <li>uploadNewImage tạo tên <code>img-&#123;uuid&#125;.ext</code>.</li>
        </ul>
        <GuideNote>
          Upload audio/video từ UI editor hạn chế — ưu tiên re-import Excel hoặc file trong package.
        </GuideNote>
      </section>

      {/* ── 5 ── */}
      <section id="guide-media" className="guide-section">
        <h2>5. Media — ánh xạ SCORM / iSpring</h2>
        <h3>5.1. Ma trận media theo vị trí</h3>
        <GuideTable
          headers={['Vị trí', 'Ảnh', 'Audio', 'Video', 'Khai báo Excel']}
          rows={[
            ['Câu hỏi', 'Có', 'Có', 'Có', 'Cột Image / Audio / Video'],
            ['Đáp án', 'Có', 'Có', 'Có', 'Brackets trong Answer N'],
            ['Feedback đúng', 'Có', 'Có', 'Có', 'Correct Feedback'],
            ['Feedback sai', 'Có', 'Có', 'Có', 'Incorrect Feedback'],
          ]}
        />

        <h3>5.2. Storage &amp; registry</h3>
        <GuideCode>{`storage://images/{filename}
storage://sounds/{filename}
storage://videos/{filename}

rs.i  → registry ảnh
rs.a  → registry audio
rs.v  → registry video`}</GuideCode>
        <ul>
          <li>Ảnh: <code>res/data/images/img-import-*.ext</code></li>
          <li>Audio: <code>res/data/audios/snd-import-*.ext</code></li>
          <li>Video: <code>res/data/videos/vid-import-*.ext</code></li>
        </ul>

        <h3>5.3. JSON object iSpring (tóm tắt)</h3>
        <GuideTable
          headers={['Media', 'JSON / object', 'Ghi chú']}
          rows={[
            ['Ảnh câu hỏi', 'slide.at.i + slidePicture', 'Không gắn vào choice đầu'],
            ['Audio câu hỏi', 'slide.at.a + slideAudio', ''],
            ['Video câu hỏi', 'slide.at.v (+ pi poster)', 'Bắt buộc poster'],
            ['Ảnh đáp án', 'choice.ia.i', 'Icon / ảnh lựa chọn'],
            ['Audio đáp án', 'choice.f.a', 'Voice từng đáp án (mầm non)'],
            ['Video đáp án', 'choice.t.r[] type video', 'Cần poster = ảnh đáp án'],
            ['Feedback text', 'slide.s.F.c.v / F.i.v', 'h, d, t'],
            ['Feedback audio', 'slide.s.F.c.a / F.i.a', ''],
            ['Feedback inline media', 'slide.s.F.c.v.r[]', 'image / video rich'],
          ]}
        />

        <h3>5.4. Mẫu thiết kế mầm non (voice-first)</h3>
        <GuideCode>{`Câu hỏi:  Audio (đọc đề) + Image (minh họa) + Video (tùy chọn)
Đáp án:   text ngắn + [audio=...] riêng  hoặc [image=...]
Feedback: Đúng → voice chúc mừng; Sai → voice gợi ý + ảnh`}</GuideCode>
        <GuideCode>{`media/
  voice_de_cau_01.mp3
  voice_dap_an_a.mp3
  voice_dung.mp3
  voice_sai_goi_y.mp3
  hinh_cau_01.jpg
  clip_gioi_thieu.mp4`}</GuideCode>
      </section>

      {/* ── 6 ── */}
      <section id="guide-view-json" className="guide-section">
        <h2>6. JSON trung gian (Editor View)</h2>
        <p>
          Sau import, API trả <strong>view phẳng</strong> cho UI (không phải raw iSpring). Dùng cho
          hiển thị, chỉnh sửa và SavePayload.
        </p>
        <h3>6.1. Cấu trúc quiz view</h3>
        <GuideCode>{`{
  "sessionId": "...",
  "title": "Tên quiz",
  "passingScore": 80,
  "reporting": {
    "sendToServer": { "enabled": false, "url": "" },
    "adminEmail": { "enabled": false, "emails": "", "filter": "passedAndFailed" },
    "studentEmail": { "enabled": false, "filter": "passedAndFailed" }
  },
  "groups": [{ "title": "...", "questionCount": N }],
  "introSlide": { ... },
  "resultSlides": [ ... ],
  "questions": [ /* slide_to_view */ ],
  "questionCount": N
}`}</GuideCode>

        <h3>6.2. Cấu trúc một câu hỏi (slide view)</h3>
        <GuideCode>{`{
  "id": "slide-id",
  "type": "MultipleChoice",
  "groupIndex": 0,
  "questionIndex": 0,
  "groupTitle": "Imported Questions",
  "questionText": "...",
  "feedback": { "correct": "...", "incorrect": "..." },
  "choices": [{ "id", "text", "isCorrect", "image", "audio", "video" }],
  "matchingPairs": [],
  "sequenceItems": [],
  "typeInAnswers": [],
  "blankAnswers": [],
  "wordBankWords": [],
  "slideImages": ["img-....jpg"],
  "editableLevel": "full|partial|readonly",
  "points": 1,
  "layout": { ... }
}`}</GuideCode>

        <h3>6.3. SavePayload (PUT session)</h3>
        <GuideCode>{`{
  "title": "...",
  "passingScore": 80,
  "reporting": { ... },
  "introSlide": { ... },
  "resultSlides": [ ... ],
  "questions": [ /* chỉnh từ view */ ]
}`}</GuideCode>
        <p>
          Backend apply_question_edit + apply_quiz_meta + apply_reporting_settings → ghi lại iSpring
          quiz JSON.
        </p>
      </section>

      {/* ── 7 ── */}
      <section id="guide-export" className="guide-section">
        <h2>7. Đầu ra (Export)</h2>
        <h3>7.1. Export SCORM 1.2 (.zip) — LMS</h3>
        <GuideTable
          headers={['Mục', 'Chi tiết']}
          rows={[
            ['API', 'POST /api/session/{id}/export'],
            ['Body', '{ "title": "tùy chọn" }'],
            ['Kết quả', 'application/zip — gói SCORM 1.2'],
            ['Nội dung', 'imsmanifest.xml + res/ + index.html (quiz base64)'],
          ]}
        />
        <p><strong>Checklist upload LMS:</strong></p>
        <ol>
          <li>Export zip → upload LMS hỗ trợ SCORM 1.2.</li>
          <li>Làm thử: MC, TF, NUMG, media audio/video.</li>
          <li>Kiểm tra điểm từng câu + màn hình kết quả.</li>
          <li>Bật reporting email → thử gửi (LMS hoặc preview proxy).</li>
        </ol>

        <h3>7.2. Export Teky-school JSON (CMS)</h3>
        <GuideTable
          headers={['Mục', 'Chi tiết']}
          rows={[
            ['API', 'POST /api/session/{id}/export-cms-json-local'],
            ['File', '~/Downloads/SNLT-CHECKQUIZ/JSON-EXPORT/{title}_teky.json'],
            ['Schema', 'Giống scorm-cvt parseScormToTekyJson'],
            ['Format file', 'Mảng bọc: [ quiz_object ]'],
            ['Ảnh', 'Public URL FPT S3 khi upload thành công; không dùng base64'],
            ['Code', 'backend/app/cms_export.py → quiz_to_cms_json()'],
          ]}
        />

        <h3>7.2.1. Object quiz Teky</h3>
        <GuideCode>{`[
  {
    "id": "quiz_1780130018131",
    "title": "Untitled Quiz",
    "description": "Được chuyển đổi từ SCORM Editor.",
    "subject": "Lập trình",
    "difficultyLevel": "medium",
    "tags": ["SCORM", "Imported"],
    "createdBy": "admin",
    "isPublic": false,
    "duration": 1800,
    "questions": [ ... ],
    "settings": {
      "shuffleQuestions": false,
      "shuffleAnswers": false,
      "attemptLimit": 1,
      "showResults": "after_submit",
      "allowReview": true
    },
    "createdAt": "...Z",
    "updatedAt": "...Z"
  }
]`}</GuideCode>

        <h3>7.2.2. Map loại iSpring → Teky</h3>
        <GuideTable
          headers={['iSpring type', 'Teky type', 'Fields chính']}
          rows={[
            ['MultipleChoice / MultipleChoiceText', 'multiple_choice', 'options[], correctAnswer: [id]'],
            ['MultipleResponse', 'multiple_select', 'options[], correctAnswer: [id,…]'],
            ['TrueFalse', 'true_false', 'options[], correctAnswer: ["true"|"false"]'],
            ['TypeIn / Numeric / FIB / WordBank', 'fill_blank', 'correctAnswer: [text,…]'],
            ['Matching', 'matching', 'pairs[], correctAnswer: ["pair-0:right",…]'],
            ['Sequence', 'ordering', 'orderingItems[], correctAnswer: [id theo thứ tự]'],
            ['InfoSlide / Intro / Result', '(bỏ qua)', 'Không đưa vào questions[]'],
          ]}
        />

        <h3>7.2.3. Ví dụ multiple_choice</h3>
        <GuideCode>{`{
  "id": "ts66r2idjy78-...",
  "type": "multiple_choice",
  "question": "Để bắt đầu chạy một chương trình...?",
  "points": 1,
  "metadata": { "difficulty": "medium", "topic": "Imported Questions" },
  "imageUrl": "images/img-....jpg",
  "options": [
    { "id": "2j16y7h...", "text": "Một lá cờ xanh", "imageUrl": "images/img-....jpg" },
    { "id": "2aejpty...", "text": "Một ngôi sao vàng", "imageUrl": "images/img-....jpg" }
  ],
  "correctAnswer": ["2j16y7h..."]
}`}</GuideCode>

        <h3>7.2.4. Matching &amp; Ordering</h3>
        <GuideCode>{`"pairs": [{ "id": "pair-0", "left": "...", "right": "...", "leftImageUrl": "..." }],
"correctAnswer": ["pair-0:right text", "pair-1:..."]

"orderingItems": [{ "id": "...", "text": "..." }],
"correctAnswer": ["id1", "id2", "id3"]  // đúng thứ tự`}</GuideCode>

        <h3>7.3. Export Media</h3>
        <GuideTable
          headers={['API', 'Kết quả']}
          rows={[
            ['POST .../export-media', 'Zip toàn bộ media của package'],
            ['POST .../export-media-local', 'Copy media ra thư mục local máy server'],
            ['POST .../export-single-media-local', 'Xuất 1 file media với tên đích'],
          ]}
        />
      </section>

      {/* ── 8 ── */}
      <section id="guide-naming" className="guide-section">
        <h2>8. Quy ước đặt tên khi Export Ảnh</h2>
        <p>
          Khi export ảnh, hệ thống gán hậu tố theo vai trò hình ảnh để tránh trùng lặp.
        </p>
        <h3>8.1. Nội dung câu hỏi &amp; ảnh nền/minh họa</h3>
        <p>
          Background, Picture/Image, minh họa thân câu hỏi → nhóm Nội dung (ND).
        </p>
        <ul>
          <li>Hậu tố: <code>_IMG-ND</code> hoặc <code>_IMG-ND-[số thứ tự]</code></li>
        </ul>
        <h3>8.2. Feedback &amp; slide Intro / Result</h3>
        <ul>
          <li>Hậu tố: <code>_IMG-ND-[số thứ tự]</code></li>
        </ul>
        <h3>8.3. Ảnh trong từng dạng đáp án</h3>
        <GuideTable
          headers={['Loại câu hỏi', 'Hậu tố']}
          rows={[
            ['Matching — vế trái', '_IMG-VT1, _IMG-VT2, …'],
            ['Matching — vế phải', '_IMG-VP1, _IMG-VP2, …'],
            ['Multiple Choice / TrueFalse', '_IMG-DA1, _IMG-DA2, _IMG-DA3, …'],
            ['Multiple Response', '_IMG-DA1, _IMG-DA2, …'],
            ['Sequence', '_IMG-DA1, _IMG-DA2, … (trên xuống)'],
            ['Hotspot', '_IMG-content (ảnh vùng tương tác)'],
            ['FIB / TypeIn / WordBank', 'Không ảnh trong đáp án text; ảnh khác → _IMG-ND'],
          ]}
        />
      </section>

      {/* ── 9 ── */}
      <section id="guide-api" className="guide-section">
        <h2>9. Tham chiếu API đầy đủ</h2>
        <h3>9.1. Health &amp; Import</h3>
        <GuideTable
          headers={['Method', 'Path', 'Mô tả']}
          rows={[
            ['GET', '/api/health', 'Health check'],
            ['POST', '/api/import', 'Upload SCORM .zip'],
            ['POST', '/api/import/sample?source=zip|dir', 'Load mẫu'],
            ['POST', '/api/import/excel', 'Upload Excel hoặc zip Excel+media'],
            ['GET', '/api/import/excel/templates', 'Danh sách template'],
            ['GET', '/api/import/excel/templates/{id}', 'Download template'],
            ['POST', '/api/import/excel/sample', 'Import Sample_import_template'],
            ['POST', '/api/import/excel/media-sample', 'Import Media_import_sample'],
            ['POST', '/api/import/excel/fib-wb-sample', 'Import FIB_WB sample'],
          ]}
        />
        <h3>9.2. Session</h3>
        <GuideTable
          headers={['Method', 'Path', 'Mô tả']}
          rows={[
            ['GET', '/api/session/{id}', 'Lấy view hiện tại'],
            ['PUT', '/api/session/{id}', 'Save (SavePayload JSON)'],
            ['GET', '/api/session/{id}/asset/{filename}', 'Lấy asset media'],
            ['POST', '/api/session/{id}/asset/{filename}', 'Upload/thay asset'],
            ['GET', '/api/session/{id}/fonts', 'Font manifest'],
            ['GET', '/api/session/{id}/res/{path}', 'File trong package res/'],
          ]}
        />
        <h3>9.3. Export &amp; Preview</h3>
        <GuideTable
          headers={['Method', 'Path', 'Mô tả']}
          rows={[
            ['POST', '/api/session/{id}/export', 'SCORM zip'],
            ['POST', '/api/session/{id}/export-cms-json-local', 'Teky JSON → Downloads'],
            ['POST', '/api/session/{id}/export-media', 'Media zip download'],
            ['POST', '/api/session/{id}/export-media-local', 'Media local path'],
            ['POST', '/api/session/{id}/export-single-media-local', '1 file media local'],
            ['GET', '/api/session/{id}/preview/player', 'HTML player preview'],
            ['POST', '/api/session/{id}/preview/report-proxy', 'Proxy báo cáo CORS'],
            ['GET', '/api/session/{id}/preview/res/{path}', 'Res cho player'],
          ]}
        />
      </section>

      {/* ── 10 ── */}
      <section id="guide-checklist" className="guide-section">
        <h2>10. Checklist thực hành</h2>
        <h3>10.1. Tạo template Excel mới</h3>
        <ul>
          <li>Sheet đầu tiên; hàng 1 đúng tên cột iSpring.</li>
          <li>Thư mục <code>media/</code> cùng cấp file Excel (hoặc trong zip).</li>
          <li>Đường dẫn <code>media\...</code> khớp tên file (phân biệt hoa thường trên Linux).</li>
          <li>Video luôn kèm ảnh poster.</li>
          <li>Audio đáp án: bracket trong từng Answer N cần voice riêng.</li>
          <li>Feedback: tách voice đúng/sai bằng file mp3 khác nhau.</li>
          <li>Import → kiểm tra ImportReport (0 error, xem warnings).</li>
          <li>Preview Slide View: nghe audio câu hỏi + feedback.</li>
        </ul>

        <h3>10.2. Quy trình biên soạn đầy đủ</h3>
        <ol>
          <li>Import SCORM hoặc Excel (+ media zip).</li>
          <li>Xem ImportReport; sửa các dòng error (nếu Excel).</li>
          <li>Chỉnh meta quiz: tên, điểm đạt, reporting.</li>
          <li>Sửa nội dung từng câu (text, đáp án, điểm, feedback).</li>
          <li>Chỉnh layout trên Canvas nếu cần.</li>
          <li>Preview player — làm thử bài.</li>
          <li>Save (auto-sync).</li>
          <li>Export SCORM zip cho LMS và/hoặc Teky JSON + media.</li>
        </ol>

        <h3>10.3. QA regression gợi ý</h3>
        <ul>
          <li>3 template × import → save → export (test_qa_e2e.py).</li>
          <li>Re-open zip export → session view khớp.</li>
          <li>Sửa điểm / text sau import → save → export → dữ liệu khớp.</li>
        </ul>
      </section>

      {/* ── 11 ── */}
      <section id="guide-limits" className="guide-section">
        <h2>11. Giới hạn và lưu ý kỹ thuật</h2>
        <GuideTable
          headers={['Hạng mục', 'Trạng thái / ghi chú']}
          rows={[
            ['Direct URL media (YouTube, Drive…)', 'Chưa hỗ trợ — chỉ file local'],
            ['Upload audio/video từ UI editor', 'Hạn chế; ưu tiên Excel re-import'],
            ['DND / DIB / Hotspot / Essay từ Excel', 'Skip có lý do trong ImportReport'],
            ['Hotspot / DND trên SCORM gốc', 'Chỉnh layout Canvas; partial/readonly'],
            ['SCORM version export', '1.2 (iSpring MASTER)'],
            ['Points', 'slide.s.e.pt, t: byQuestion'],
            ['Reporting iSpring', 'd.s.r — ss, ads, sts'],
            ['FIB/WB blank IDs', 'Giữ span id qmFillInTheBlank / qmWordBank trong rt.h'],
            ['CORS frontend dev', 'localhost:5173 và :8000'],
          ]}
        />
        <h3>11.1. Module backend quan trọng</h3>
        <GuideTable
          headers={['Module', 'Trách nhiệm']}
          rows={[
            ['scorm_parser.py', 'Decode/encode quiz, quiz_to_view, save, export zip, media registry'],
            ['excel_import.py', 'Parse Excel + media brackets + validate loại'],
            ['quiz_builder.py', 'Inject rows → slides từ MASTER; reflow; points'],
            ['cms_export.py', 'iSpring view → Teky JSON'],
            ['media_rich.py', 'Embed audio/video/image rich text'],
            ['layout.py / typography.py', 'Canvas layout, reflow import, typography'],
            ['preview.py', 'Player HTML, report proxy allowlist'],
          ]}
        />
      </section>

      {/* ── 12 ── */}
      <section id="guide-appendix" className="guide-section">
        <h2>12. Phụ lục — Tóm tắt nhanh</h2>
        <h3>12.1. Input vs Output</h3>
        <GuideTable
          headers={['', 'Nội dung']}
          rows={[
            ['Input chính', 'SCORM zip iSpring HOẶC Excel (template iSpring) ± media local'],
            ['JSON editor', 'View phẳng: title, questions[], choices, layout, feedback…'],
            [
              'JSON CMS (Teky)',
              '[quiz] với type multiple_choice | multiple_select | true_false | fill_blank | matching | ordering',
            ],
            ['Export LMS', 'SCORM 1.2 .zip (raw iSpring JSON trong package)'],
          ]}
        />
        <h3>12.2. Tài liệu &amp; mẫu liên quan</h3>
        <GuideTable
          headers={['Tài nguyên', 'Đường dẫn']}
          rows={[
            ['Plan import Excel', 'scorm-editor/docs/EXCEL_IMPORT_PLAN.md'],
            ['Đặc tả media', 'scorm-editor/docs/MEDIA_TEMPLATE_SPEC.md'],
            ['Word guide', 'scorm-editor/docs/SCORM_Editor_Huong_Dan_Chi_Tiet.docx'],
            ['README chạy app', 'scorm-editor/README.md'],
            ['Template Excel', 'ImportTemplate/'],
            ['Output mẫu Teky (scorm-cvt)', 'scorm-cvt/scorm-cvt/output/*_teky.json'],
          ]}
        />
        <p className="guide-end">— Hết tài liệu · SCORM Editor Guide v1.0 —</p>
      </section>
    </div>
  )
}

/**
 * Full-screen guide modal with sticky TOC sidebar.
 */
export function UserGuideModal({ open, onClose }) {
  const bodyRef = useRef(null)
  const [activeId, setActiveId] = useState(SECTIONS[0].id)

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !bodyRef.current) return undefined
    const root = bodyRef.current
    const nodes = SECTIONS.map((s) => root.querySelector(`#guide-${s.id}`)).filter(Boolean)
    if (!nodes.length) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id.replace(/^guide-/, ''))
        }
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.2, 0.5] },
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [open])

  if (!open) return null

  const scrollTo = (id) => {
    const el = bodyRef.current?.querySelector(`#guide-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <button type="button" className="guide-backdrop" aria-label="Đóng hướng dẫn" onClick={onClose} />
      <div className="guide-modal">
        <header className="guide-modal-header">
          <div className="guide-modal-heading">
            <h2 id="guide-title">Hướng dẫn SCORM Editor</h2>
            <p className="guide-modal-sub">
              Tài liệu chi tiết toàn bộ tính năng · Import · Editor · Export SCORM &amp; Teky JSON
            </p>
          </div>
          <button type="button" className="btn guide-close-btn" onClick={onClose}>
            Đóng
          </button>
        </header>

        <div className="guide-modal-body">
          <nav className="guide-toc" aria-label="Mục lục">
            <div className="guide-toc-label">Mục lục</div>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`guide-toc-item ${activeId === s.id ? 'active' : ''}`}
                onClick={() => scrollTo(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div className="guide-scroll" ref={bodyRef}>
            <GuideContent />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Guide trigger button used on homepage (and optionally editor header).
 */
export function GuideButton({ className = '', onClick }) {
  return (
    <button type="button" className={`btn btn-guide ${className}`.trim()} onClick={onClick}>
      <span className="btn-guide-icon" aria-hidden>
        📖
      </span>
      Guide
    </button>
  )
}

export default UserGuideModal
