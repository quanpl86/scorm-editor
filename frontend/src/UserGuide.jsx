import { useEffect, useRef, useState } from 'react'

const SECTIONS = [
  { id: 'overview', title: '1. Tổng quan & tài nguyên' },
  { id: 'scorm-mode', title: '2. Mode iSpring SCORM' },
  { id: 'teky-mode', title: '3. Mode Teky LMS' },
  { id: 'excel', title: '4. Excel cấu hình quiz/question' },
  { id: 'media', title: '5. Thư mục media & link ảnh' },
  { id: 'types', title: '6. Chín dạng question' },
  { id: 'edit-save', title: '7. Edit & Save Quiz' },
  { id: 'viewer', title: '8. Viewer & kiểm duyệt' },
  { id: 'export', title: '9. Export JSON LMS' },
  { id: 'checklist', title: '10. Checklist & xử lý lỗi' },
  { id: 'api', title: '11. API & vận hành' },
]

function GuideTable({ headers, rows }) {
  return (
    <div className="guide-table-wrap">
      <table className="guide-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
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
      <section id="guide-overview" className="guide-section">
        <h2>1. Tổng quan và tài nguyên chuẩn</h2>
        <p>
          SCORM Editor có hai mode biên soạn dùng chung editor, viewer và JSON xuất bản Teky LMS:
          <strong> iSpring SCORM</strong> dành cho package `.zip` và <strong>Teky LMS</strong> dành
          cho Excel chuẩn kèm thư mục media.
        </p>
        <GuideCode>{`SCORM ZIP ─┐
           ├─> Import -> Edit -> Save Quiz -> View & Làm bài -> Export
Excel+media┘                                ├─> SCORM 1.2 ZIP
                                           └─> Teky LMS JSON + media S3/FPT`}</GuideCode>
        <GuideNote>
          Quiz ID, Question ID, ID đáp án và ID cặp ghép do hệ thống tự sinh. Không nhập ID trong
          Excel và không cần hiển thị ID trên editor.
        </GuideNote>

        <h3>1.1. Tài nguyên mẫu</h3>
        <GuideTable
          headers={['Tài nguyên', 'Vị trí/vai trò']}
          rows={[
            ['SCORM mẫu', 'DGSA2025-HP05-B01.zip, DGSA2025-HP05-B05.zip'],
            ['Excel iSpring', 'ImportTemplate/Sample_import_template.xls'],
            ['Excel media', 'ImportTemplate/Media_import_sample.xlsx'],
            ['Excel FIB/WB/Numeric', 'ImportTemplate/FIB_WB_import_sample.xlsx'],
            ['Gói Teky chính thức', 'ImportTemplate/Full_quiz_9_types_teky_lms.zip'],
            ['Excel Teky nguồn chuẩn', 'Full_quiz_9_types_sample/Full_quiz_9_types_teky_lms_system_ids.xlsx'],
            ['Media Teky', 'ImportTemplate/Full_quiz_9_types_sample/media/'],
            ['JSON template', 'docs/cms_json_template.json'],
            ['JSON đầy đủ', 'docs/cms_json_full_sample.json'],
            ['Schema Excel', 'docs/TEKY_EXCEL_SCHEMA.md'],
            ['Hướng dẫn đầy đủ', 'docs/SCORM_EDITOR_GUIDE.md và bản Word'],
          ]}
        />
        <p>
          Trên màn hình import có liên kết tải trực tiếp gói 9 dạng, Excel iSpring, Excel media và
          Excel FIB/WB/Numeric. Luôn sao chép template sang thư mục làm việc riêng trước khi soạn.
        </p>
      </section>

      <section id="guide-scorm-mode" className="guide-section">
        <h2>2. Mode iSpring SCORM: ZIP → Edit → View → Export</h2>
        <h3>2.1. Import</h3>
        <ol>
          <li>Chọn <strong>Mode: iSpring SCORM</strong>.</li>
          <li>Kéo package SCORM 1.2 `.zip` vào vùng <strong>Chỉnh sửa SCORM có sẵn</strong>.</li>
          <li>Chờ hệ thống tìm `imsmanifest.xml`, giải mã quiz và tạo session.</li>
          <li>Kiểm tra title, số câu, slide đặc biệt và media.</li>
        </ol>
        <p>Hỗ trợ package zip lồng zip. Không sửa trực tiếp JSON key ngắn của iSpring.</p>

        <h3>2.2. Edit và Save</h3>
        <ul>
          <li>Sửa title, điểm đạt, nội dung câu hỏi, đáp án, feedback và reporting.</li>
          <li>Sửa chữ/định dạng, ảnh và bố cục object trên canvas.</li>
          <li>Sửa điểm, thời gian, shuffle answer và media đã có trong package.</li>
          <li>Nhấn <strong>Save Quiz</strong> để ghi nội dung vào session/package.</li>
        </ul>

        <h3>2.3. View và Export</h3>
        <ol>
          <li>Nhấn <strong>Xem & Làm bài</strong> để kiểm tra player và tương tác.</li>
          <li>Quay lại editor, chỉnh và Save lại nếu cần.</li>
          <li>Dùng <strong>Export SCORM</strong> để lấy lại SCORM 1.2 zip.</li>
          <li>Dùng <strong>Export CMS JSON</strong> để chuyển các question được hỗ trợ sang Teky LMS.</li>
        </ol>
        <GuideNote>
          InfoSlide, IntroSlide và ResultSlide không trở thành question trong JSON Teky. Dạng iSpring
          không có mapping Teky cũng được bỏ qua khi export JSON.
        </GuideNote>
      </section>

      <section id="guide-teky-mode" className="guide-section">
        <h2>3. Mode Teky LMS: Excel + media → Edit → View → JSON</h2>
        <h3>3.1. Cấu trúc nguồn của một bài học</h3>
        <GuideCode>{`Quiz_Teky/
├── quiz_teky.xlsx
└── media/
    ├── quiz_cover.jpg
    ├── question_01.jpg
    └── answer_01_a.jpg

Đường dẫn trong Excel:
media/quiz_cover.jpg
media/question_01.jpg
media/answer_01_a.jpg`}</GuideCode>
        <ul>
          <li><code>Quiz Settings.coverImage</code>: ảnh đại diện toàn quiz.</li>
          <li><code>Image</code>: ảnh nội dung câu hỏi.</li>
          <li><code>Answer N Image</code>: ảnh đáp án.</li>
          <li>Video dùng URL YouTube/Vimeo; Audio dùng URL HTTPS, không lưu trong media.</li>
        </ul>

        <h3>3.2. Import trên web/deploy: dùng ZIP</h3>
        <GuideCode>{`Quiz_Teky.zip
├── quiz_teky.xlsx
└── media/
    ├── quiz_cover.jpg
    ├── question_01.jpg
    └── answer_01_a.jpg`}</GuideCode>
        <p>
          Trình duyệt chỉ gửi file được chọn, không tự gửi thư mục media cùng cấp trên máy người
          dùng. Vì vậy Excel và media phải cùng cấp trong ZIP khi chạy web/deploy hoặc bàn giao.
        </p>

        <h3>3.3. Import riêng Excel khi chạy local</h3>
        <GuideCode>{`SCORM-PROJECT/
└── ImportTemplate/
    ├── SNLT-HP01-B01/
    │   ├── SNLT-HP01-B01.xlsx
    │   └── media/
    │       └── quiz_cover.jpg
    ├── SNLT-HP01-B02/
    │   ├── SNLT-HP01-B02.xlsx
    │   └── media/
    │       └── quiz_cover.jpg
    └── SNLT-HP02-B01/
        ├── SNLT-HP02-B01.xlsx
        └── media/
            └── quiz_cover.jpg`}</GuideCode>
        <p>
          Hệ thống dùng tên workbook để xác định đúng thư mục bài học. Import
          `SNLT-HP01-B02.xlsx` sẽ ưu tiên ảnh trong `SNLT-HP01-B02/media/`.
        </p>

        <h3>3.4. Quy tắc tổ chức ImportTemplate</h3>
        <ul>
          <li>Tên folder bài học phải duy nhất; tên Excel phải trùng chính xác tên folder.</li>
          <li>Không dùng cùng một tên chung như <code>quiz.xlsx</code> cho nhiều bài học.</li>
          <li>Mỗi bài học có <code>media/</code> riêng; không tạo kho dùng chung tại ImportTemplate/media.</li>
          <li>Tên ảnh trong một bài học phải duy nhất; nên dùng tiền tố q01, q02…</li>
          <li>Đường dẫn trong Excel luôn là <code>media/tên_file</code>, không dùng đường dẫn tuyệt đối.</li>
          <li>Nếu nhiều file không thể phân biệt, hệ thống cảnh báo thay vì chọn ngẫu nhiên ảnh khác.</li>
        </ul>

        <h3>3.5. Quy trình chuẩn</h3>
        <ol>
          <li>Chọn <strong>Mode: Teky LMS</strong>.</li>
          <li>Sao chép template, đổi đồng thời tên folder và file Excel.</li>
          <li>Điền Quiz Settings, Quiz Questions và đặt ảnh vào media.</li>
          <li>Local: import riêng Excel khi nguồn nằm đúng trong ImportTemplate.</li>
          <li>Web/deploy: nén Excel + media rồi import ZIP.</li>
          <li>Xử lý toàn bộ error/media warning trong ImportReport.</li>
          <li>Hiệu chỉnh ở Quiz Details, Questions và Settings.</li>
          <li>Nhấn Save Quiz, sau đó Xem & Làm bài.</li>
          <li>Export CMS JSON và kiểm tra URL S3/FPT trước khi import LMS.</li>
        </ol>
      </section>

      <section id="guide-excel" className="guide-section">
        <h2>4. Excel cấu hình toàn bộ quiz và question</h2>
        <h3>4.1. Sheet Quiz Settings</h3>
        <GuideTable
          headers={['Field', 'Ý nghĩa']}
          rows={[
            ['title, description', 'Tiêu đề và mô tả quiz'],
            ['coverImage', 'Ảnh đại diện toàn quiz, ví dụ media/quiz_cover.jpg'],
            ['subject, difficultyLevel, tags', 'Môn học, độ khó chung, tag'],
            ['createdBy, createdByName, isPublic', 'Thông tin tác giả/công khai'],
            ['duration', 'Thời lượng theo giây; UI hiển thị phút'],
            ['shuffleQuestions, shuffleAnswers', 'Trộn câu hỏi/đáp án'],
            ['attemptLimit', 'Số lần làm; 0 là không giới hạn'],
            ['showResults, allowReview', 'Thời điểm hiện kết quả và quyền xem lại'],
            ['createdAt, updatedAt', 'ISO-8601; để trống để hệ thống tự sinh'],
          ]}
        />
        <GuideNote>
          `coverImage` là ảnh đại diện chung của quiz. Cột `Image` trong sheet Questions là ảnh nội
          dung riêng của từng câu hỏi.
        </GuideNote>

        <h3>4.2. Sheet Quiz Questions</h3>
        <GuideTable
          headers={['Cột', 'Nội dung']}
          rows={[
            ['Question Type', 'Mã MC, MR, TF, MG, SEQ, FIB/WB, TI, NUM, MNUM'],
            ['Question Text', 'Nội dung đề bài; FIB dùng ___ tại vị trí trống'],
            ['Image', 'Ảnh cấp question; dùng file trong thư mục media'],
            ['Video, Audio', 'Chỉ dùng URL trực tuyến; Video hỗ trợ YouTube/Vimeo'],
            ['Answer 1…6', 'Tối đa 6 đáp án; dùng * để đánh dấu đáp án đúng khi áp dụng'],
            ['Answer N Image', 'Ảnh đáp án N'],
            ['Answer N Left/Right Image', 'Ảnh hai vế của Matching'],
            ['Difficulty, Topic', 'Độ khó và chủ đề từng question'],
            ['Explanation', 'Giải thích sau khi nộp bài'],
            ['Points', 'Điểm câu hỏi'],
            ['Required, Use Regex', 'Bắt buộc trả lời và so khớp RegEx cho FIB/TI'],
          ]}
        />
        <p>
          Không tạo cột Quiz ID hoặc Question ID. Hệ thống sinh ID duy nhất khi import, giữ ổn định
          trong session và sử dụng khi xuất bản.
        </p>
      </section>

      <section id="guide-media" className="guide-section">
        <h2>5. Tạo thư mục media và gắn link ảnh trên Excel</h2>
        <h3>5.1. Quy ước</h3>
        <ul>
          <li>Dùng đường dẫn tương đối bắt đầu bằng <code>media/</code>.</li>
          <li>Không dùng đường dẫn máy cá nhân như `/Users/...` hoặc `C:\Users\...`.</li>
          <li>Tên file nên không dấu, không khoảng trắng và có tiền tố question.</li>
          <li>Tên trong Excel phải khớp chính xác tên file, gồm cả chữ hoa/thường.</li>
        </ul>

        <h3>5.2. Vị trí gắn media</h3>
        <GuideTable
          headers={['Vị trí', 'Cột/cú pháp']}
          rows={[
            ['Cover quiz', 'Quiz Settings → coverImage'],
            ['Ảnh question', 'Image → media/file.png'],
            ['Video question', 'Video → URL YouTube/Vimeo'],
            ['Audio question', 'Audio → URL HTTPS trực tiếp'],
            ['Ảnh đáp án', 'Answer N Image'],
            ['Matching trái/phải', 'Answer N Left Image / Right Image'],
          ]}
        />
        <GuideCode>{`Image: media/q01_question.jpg
Answer 1 Image: media/q01_answer_a.png
Video: https://www.youtube.com/watch?v=VIDEO_ID
Audio: https://cdn.example.com/audio/bai-hoc.mp3`}</GuideCode>

        <h3>5.3. Định dạng hỗ trợ và S3</h3>
        <ul>
          <li>Ảnh: jpg, jpeg, png, gif, bmp, webp.</li>
          <li>Audio: URL HTTPS trực tiếp; không lưu file audio trong thư mục media.</li>
          <li>Video: URL YouTube/Vimeo; không lưu file video trong thư mục media.</li>
          <li>Ảnh và cover được upload S3/FPT khi xuất bản nếu cấu hình hợp lệ.</li>
        </ul>
        <p>
          JSON cuối dùng `coverImageUrl`, `imageUrl`, `leftImageUrl`, `rightImageUrl`, `videoUrl`.
          Nếu không thấy file, ImportReport hiển thị media warning thay vì làm hỏng toàn bộ quiz.
        </p>
      </section>

      <section id="guide-types" className="guide-section">
        <h2>6. Xây dựng nội dung với 9 dạng question</h2>
        <GuideTable
          headers={['Excel', 'JSON Teky', 'Cách xây dựng']}
          rows={[
            ['MC', 'multiple_choice', 'Nhiều lựa chọn, đúng duy nhất một đáp án'],
            ['MR', 'multiple_select', 'Nhiều lựa chọn, có thể đúng nhiều đáp án'],
            ['TF', 'true_false', 'Chọn Đúng hoặc Sai'],
            ['MG / MA', 'matching', 'Các cặp Vế trái|Vế phải, hỗ trợ ảnh hai vế'],
            ['SEQ', 'ordering', 'Answer 1…N chính là thứ tự đúng'],
            ['FIB / WB', 'fill_blank', 'Một textbox; đề dùng ___; hỗ trợ đáp án tương đồng'],
            ['TI / SA', 'short_answer', 'Một textbox; hỗ trợ từ đồng nghĩa và RegEx'],
            ['NUM / NUMG', 'numeric', 'Một giá trị số chính xác'],
            ['MNUM', 'multiple_numeric', 'Nhiều giá trị/ô số theo thứ tự'],
          ]}
        />
        <GuideNote>
          FIB và Short Answer trên LMS đều chỉ có một textbox. Nút THÊM TỪ ĐỒNG NGHĨA thêm các
          giá trị chấp nhận cho cùng textbox; không tạo thêm textbox trả lời.
        </GuideNote>
        <ul>
          <li><strong>Required:</strong> bật/tắt bắt buộc trả lời cho từng question.</li>
          <li><strong>RegEx:</strong> chỉ bật sau khi đã kiểm thử biểu thức và dữ liệu mẫu.</li>
          <li><strong>Explanation:</strong> nội dung giải thích hiển thị sau khi nộp.</li>
          <li>DND, DIB, Hotspot, Essay, Likert không thuộc 9 dạng import Excel chuẩn Teky.</li>
        </ul>
      </section>

      <section id="guide-edit-save" className="guide-section">
        <h2>7. Edit và Save Quiz</h2>
        <h3>7.1. Ba khu vực editor</h3>
        <ul>
          <li><strong>Quiz Details:</strong> title, description, cover, subject, difficulty, duration, tags.</li>
          <li><strong>Questions:</strong> text, media, điểm, topic, required, explanation và đáp án.</li>
          <li><strong>Settings:</strong> attempts, shuffle, allow review và show results.</li>
        </ul>

        <h3>7.2. Thêm/xoá và upload</h3>
        <p>
          Có thể thêm/xoá question, lựa chọn, cặp Matching, item Ordering, ô Multiple Numeric và từ
          đồng nghĩa. Nút upload ảnh/video cập nhật media trong session; preview ảnh dùng tỷ lệ
          `object-fit: contain` để không méo.
        </p>

        <h3>7.3. Quy tắc lưu</h3>
        <ul>
          <li><strong>Save Quiz</strong> là nút lưu chính thức cho toàn bộ session.</li>
          <li>Trước khi View hoặc Export, luôn Save Quiz.</li>
          <li>Text mới được đồng bộ với HTML; HTML cũ không được phép ghi đè text mới.</li>
          <li>Thêm/xoá nội dung chỉ hoàn tất sau khi save thành công.</li>
        </ul>
      </section>

      <section id="guide-viewer" className="guide-section">
        <h2>8. Viewer và kiểm duyệt trước xuất bản</h2>
        <p>Nhấn <strong>Xem & Làm bài</strong> để review giao diện/tương tác giống Teky LMS:</p>
        <ul>
          <li>MC radio, MR checkbox, TF hai lựa chọn.</li>
          <li>Matching chọn cặp, Ordering sắp xếp.</li>
          <li>FIB/Short Answer một textbox; Numeric là ô số.</li>
          <li>Multiple Numeric có nhiều ô theo danh sách đáp án số.</li>
          <li>Hiển thị ảnh question, ảnh đáp án, chủ đề, điểm và timer.</li>
        </ul>
        <GuideTable
          headers={['Kiểm tra', 'Tiêu chí đạt']}
          rows={[
            ['Media', 'Không ảnh vỡ, không còn media warning'],
            ['FIB', 'Dấu ___ đúng vị trí, chỉ một textbox'],
            ['Đáp án', 'Đúng nội dung, số lượng, correct answer và từ đồng nghĩa'],
            ['Matching/Ordering', 'Đúng cặp/thứ tự và đúng ảnh'],
            ['Cấu hình', 'Required, điểm, explanation, submit và review hoạt động'],
          ]}
        />
      </section>

      <section id="guide-export" className="guide-section">
        <h2>9. Export JSON chuẩn Teky LMS</h2>
        <ol>
          <li>Save Quiz.</li>
          <li>Nhấn <strong>Export CMS JSON</strong>.</li>
          <li>Backend chuyển toàn bộ question sang 9 type Teky.</li>
          <li>Media được upload S3/FPT nếu cấu hình S3 hợp lệ.</li>
          <li>JSON được ghi vào thư mục JSON-EXPORT.</li>
        </ol>
        <GuideCode>{`SCORM-PROJECT/JSON-EXPORT/{quiz_title}_teky.json`}</GuideCode>
        <p>
          <code>JSON-EXPORT</code> nằm cùng cấp với <code>ImportTemplate</code> và được hệ thống
          tự tạo khi export lần đầu.
        </p>
        <p>File cuối được bọc dạng mảng `[quiz]`:</p>
        <GuideCode>{`[
  {
    "id": "quiz_...",
    "title": "...",
    "coverImageUrl": "https://s3-sgn10.fptcloud.com/...",
    "settings": {},
    "questions": []
  }
]`}</GuideCode>
        <p>
          Đối chiếu `docs/cms_json_template.json` và `docs/cms_json_full_sample.json`. Nếu upload S3
          thất bại, exporter có thể trả `images/&lt;filename&gt;` cho quy trình local/QA; không dùng
          đường dẫn này như URL production.
        </p>
      </section>

      <section id="guide-checklist" className="guide-section">
        <h2>10. Checklist xuất bản và xử lý lỗi</h2>
        <h3>10.1. Checklist</h3>
        <ol>
          <li>Sao chép template và tạo thư mục làm việc riêng.</li>
          <li>Điền Quiz Settings, Questions và đặt media đúng path.</li>
          <li>Zip Excel + media, import và xử lý hết warning/error.</li>
          <li>Edit Quiz Details, Questions, Settings và Save Quiz.</li>
          <li>View & Làm bài, kiểm tra đủ 9 dạng.</li>
          <li>Export JSON, so với template/full sample và kiểm tra URL S3.</li>
          <li>Import JSON lên Teky LMS và smoke test lần cuối.</li>
        </ol>

        <h3>10.2. Lỗi thường gặp</h3>
        <GuideTable
          headers={['Hiện tượng', 'Cách xử lý']}
          rows={[
            ['Không tìm thấy media/...', 'Kiểm tra file trong zip và chữ hoa/thường; Excel + media cùng cấp'],
            ['Cover bị vỡ', 'Kiểm tra Quiz Settings.coverImage; import zip đầy đủ'],
            ['Text quay lại sau Save', 'Restart app ở bản mới, import lại rồi Save Quiz'],
            ['Thêm đáp án rồi biến mất', 'Nhập nội dung và Save Quiz; không dựa vào auto-save cũ'],
            ['JSON thiếu câu', 'Kiểm tra loại mapping, deleted và trạng thái Save'],
            ['S3 URL trống', 'Kiểm tra credential/bucket/quyền upload và media trong session'],
            ['.xls thiếu xlrd', 'Cài backend/requirements.txt hoặc dùng .xlsx chuẩn Teky'],
          ]}
        />
      </section>

      <section id="guide-api" className="guide-section">
        <h2>11. API và vận hành</h2>
        <GuideCode>{`cd scorm-editor
./start.sh
# Mở http://localhost:8000`}</GuideCode>
        <GuideTable
          headers={['Method', 'API', 'Vai trò']}
          rows={[
            ['POST', '/api/import', 'Import SCORM zip'],
            ['POST', '/api/import/excel', 'Import Excel hoặc zip Excel+media'],
            ['GET', '/api/import/excel/templates', 'Danh sách/tải template'],
            ['GET', '/api/session/{id}', 'Đọc editor view'],
            ['PUT', '/api/session/{id}', 'Save Quiz'],
            ['POST', '/api/session/{id}/asset/{filename}', 'Upload media'],
            ['GET', '/api/session/{id}/preview/player', 'Viewer/player'],
            ['POST', '/api/session/{id}/export', 'Export SCORM zip'],
            ['POST', '/api/session/{id}/export-cms-json-local', 'Export JSON Teky'],
            ['POST', '/api/session/{id}/export-media', 'Export media zip'],
          ]}
        />
        <p className="guide-end">— Hết tài liệu · SCORM Editor Guide —</p>
      </section>
    </div>
  )
}

export function UserGuideModal({ open, onClose }) {
  const bodyRef = useRef(null)
  const [activeId, setActiveId] = useState(SECTIONS[0].id)

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !bodyRef.current) return undefined
    const root = bodyRef.current
    const sectionNodes = SECTIONS.map((section) => root.querySelector(`#guide-${section.id}`)).filter(Boolean)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)
        if (visible[0]?.target?.id) setActiveId(visible[0].target.id.replace(/^guide-/, ''))
      },
      { root, rootMargin: '-10% 0px -70% 0px', threshold: [0, 0.2, 0.5] },
    )
    sectionNodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [open])

  if (!open) return null

  const scrollTo = (id) => {
    const element = bodyRef.current?.querySelector(`#guide-${id}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
              Hai mode · SCORM ZIP · Excel Teky LMS + media · Editor · Viewer · JSON LMS
            </p>
          </div>
          <button type="button" className="btn guide-close-btn" onClick={onClose}>Đóng</button>
        </header>
        <div className="guide-modal-body">
          <nav className="guide-toc" aria-label="Mục lục">
            <div className="guide-toc-label">Mục lục</div>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`guide-toc-item ${activeId === section.id ? 'active' : ''}`}
                onClick={() => scrollTo(section.id)}
              >
                {section.title}
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

export function GuideButton({ className = '', onClick }) {
  return (
    <button type="button" className={`btn btn-guide ${className}`.trim()} onClick={onClick}>
      <span className="btn-guide-icon" aria-hidden>📖</span>
      Guide
    </button>
  )
}

export default UserGuideModal
