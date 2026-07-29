# Hướng dẫn SCORM Editor

Phiên bản cập nhật theo dự án hiện tại: hai mode biên soạn nội dung, editor, viewer và xuất JSON chuẩn Teky LMS.

## 1. Tổng quan

SCORM Editor hỗ trợ hai quy trình độc lập nhưng dùng chung một editor và một định dạng JSON xuất bản:

1. **Mode iSpring SCORM**: import gói SCORM 1.2 `.zip` đã tạo từ iSpring QuizMaker, chỉnh sửa, xem thử và xuất lại SCORM hoặc JSON Teky LMS.
2. **Mode Teky LMS**: import Excel chuẩn kèm thư mục `media`, chỉnh nội dung/cấu hình quiz, xem trên viewer và xuất JSON Teky LMS.

Luồng dữ liệu chung:

```text
SCORM ZIP ─┐
           ├─> Import session -> Edit -> Save Quiz -> View & Làm bài -> Export
Excel+media┘                                      ├─> SCORM 1.2 ZIP
                                                 └─> Teky LMS JSON + URL media S3/FPT
```

`Quiz ID`, `Question ID`, ID đáp án và ID cặp ghép do hệ thống tự sinh. Người biên soạn không nhập ID trong Excel và không cần nhìn thấy ID trên editor.

## 2. Tài nguyên mẫu của dự án

| Tài nguyên | Vị trí | Mục đích |
|---|---|---|
| SCORM mẫu bài 1 | `DGSA2025-HP05-B01.zip` | Import, kiểm tra editor/canvas và export |
| SCORM mẫu bài 5 | `DGSA2025-HP05-B05.zip` | Kiểm tra một package iSpring khác |
| Excel iSpring gốc | `ImportTemplate/Sample_import_template.xls` | MC, MR, TF, TI, MG, SEQ, IS, NUMG |
| Excel media | `ImportTemplate/Media_import_sample.xlsx` | Câu hỏi có ảnh, audio, video |
| Excel FIB/WB/Numeric | `ImportTemplate/FIB_WB_import_sample.xlsx` | Điền khuyết, Word Bank và số |
| Gói Teky LMS chính thức | `ImportTemplate/Full_quiz_9_types_teky_lms.zip` | Excel cấu hình đầy đủ + toàn bộ media |
| Excel Teky LMS | `ImportTemplate/Full_quiz_9_types_sample/Full_quiz_9_types_teky_lms_system_ids.xlsx` | Nguồn chuẩn để biên soạn quiz |
| Media Teky LMS | `ImportTemplate/Full_quiz_9_types_sample/media/` | Cover, ảnh câu hỏi và ảnh đáp án |
| Schema Excel Teky | `docs/TEKY_EXCEL_SCHEMA.md` | Đặc tả cột và cấu hình |
| JSON template | `docs/cms_json_template.json` | Khung JSON đủ 9 dạng câu hỏi |
| JSON mẫu đầy đủ | `docs/cms_json_full_sample.json` | Dữ liệu tham chiếu để import LMS |
| Excel 9 dạng rút gọn | `docs/Quiz_Template_9_Types.xlsx` | Mẫu tham khảo nhanh |

Nên giữ nguyên các file mẫu gốc. Khi tạo quiz mới, sao chép cả Excel và thư mục `media` sang một thư mục làm việc mới.

## 3. Mode iSpring SCORM: ZIP -> Edit -> View -> Export

### 3.1. Chuẩn bị gói SCORM

- File phải là `.zip` xuất từ iSpring QuizMaker/SCORM 1.2.
- Package cần có `imsmanifest.xml` và nội dung player trong `res/`.
- Hệ thống hỗ trợ cả zip lồng zip.
- Không giải nén rồi sửa JSON iSpring bằng tay.

### 3.2. Import

1. Chọn `Mode: iSpring SCORM`.
2. Kéo file `.zip` vào vùng **Chỉnh sửa SCORM có sẵn**.
3. Chờ hệ thống tạo session, giải mã quiz và liệt kê slide.
4. Kiểm tra tiêu đề, số câu, nhóm câu hỏi và các cảnh báo media.

### 3.3. Edit

Có thể sửa:

- Tiêu đề quiz, điểm đạt và cấu hình reporting.
- Nội dung câu hỏi, định dạng chữ và đáp án.
- Phản hồi đúng/sai, điểm, thời gian và trộn đáp án.
- Ảnh câu hỏi, ảnh đáp án và các tài nguyên đã nằm trong package.
- Vị trí/kích thước đối tượng trên canvas đối với SCORM gốc.
- Thêm, xoá câu hỏi trong phạm vi loại được editor hỗ trợ.

Sau khi sửa, nhấn **Save Quiz**. Nút này lưu nội dung text, HTML, đáp án, cấu hình và media vào session/package. Không chỉ click ra ngoài hoặc chuyển tab rồi coi như đã xuất bản.

### 3.4. View

Nhấn **Xem & Làm bài** để mở player/viewer:

- Kiểm tra câu hỏi, hình ảnh và tương tác trả lời.
- Kiểm tra thứ tự câu, điểm và thông báo chưa trả lời.
- Preview không lưu kết quả học viên vào LMS.
- Quay lại editor nếu nội dung hoặc bố cục chưa đúng.

### 3.5. Export

- **Export SCORM**: tạo lại package SCORM 1.2 `.zip`.
- **Export CMS JSON**: chuyển các câu hỏi hỗ trợ sang schema Teky LMS.
- **Export Media**: xuất media riêng để QA hoặc triển khai ngoài.

Các slide `InfoSlide`, `IntroSlide`, `ResultSlide` không trở thành question trong JSON Teky. Các loại iSpring không có mapping Teky cũng được bỏ qua khi export JSON.

## 4. Mode Teky LMS: Excel + media -> Edit -> View -> JSON

### 4.1. Cấu trúc nguồn của một bài học

Mỗi bài học phải có một thư mục riêng. File Excel và thư mục `media` nằm cùng cấp:

```text
Quiz_Teky/
├── quiz_teky.xlsx
└── media/
    ├── quiz_cover.jpg
    ├── question_01.jpg
    └── answer_01_a.jpg
```

Trong Excel, mọi ảnh dùng đường dẫn tương đối tính từ vị trí file Excel:

```text
media/quiz_cover.jpg
media/question_01.jpg
media/answer_01_a.jpg
```

- Ảnh đại diện toàn quiz được khai báo tại `Quiz Settings.coverImage`.
- Ảnh nội dung câu hỏi được khai báo tại cột `Image`.
- Ảnh lựa chọn dùng `Answer N Image`.
- Matching dùng `Answer N Left Image` và `Answer N Right Image`.
- Video chỉ nhập URL YouTube/Vimeo; Audio chỉ nhập URL HTTPS. Không đặt file video/audio trong `media/`.

### 4.2. Import trên web/deploy: luôn dùng ZIP

Khi chọn một file Excel trong trình duyệt, trình duyệt chỉ gửi chính file Excel; thư mục `media` cùng cấp trên máy người dùng không được gửi lên server. Vì vậy, với web deploy phải nén Excel và `media` thành một gói:

```text
Quiz_Teky.zip
├── quiz_teky.xlsx
└── media/
    ├── quiz_cover.jpg
    ├── question_01.jpg
    └── answer_01_a.jpg
```

File Excel và `media/` phải cùng cấp trong ZIP. Đây cũng là cách ổn định nhất khi chuyển nội dung giữa các máy hoặc bàn giao cho người khác.

### 4.3. Import riêng Excel khi chạy local

Chỉ import riêng `.xlsx` khi toàn bộ nguồn bài học đã nằm trong `SCORM-PROJECT/ImportTemplate`:

```text
SCORM-PROJECT/
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
            └── quiz_cover.jpg
```

Hệ thống dùng tên workbook để xác định đúng thư mục bài học và ưu tiên `media/` trong thư mục đó. Ví dụ, khi import `SNLT-HP01-B02.xlsx`, ảnh được tìm trong `SNLT-HP01-B02/media/`, không lấy từ bài học khác.

Không dùng cách import riêng Excel nếu workbook nằm trong một thư mục bất kỳ ngoài `ImportTemplate`; server không biết đường dẫn gốc trên máy người dùng. Trong trường hợp đó hãy import ZIP.

### 4.4. Quy tắc đặt tên và sắp xếp trong ImportTemplate

- Tên thư mục bài học phải duy nhất.
- Tên file Excel phải trùng chính xác tên thư mục, ví dụ `SNLT-HP01-B01/SNLT-HP01-B01.xlsx`.
- Không đặt nhiều workbook cùng tên như `quiz.xlsx` trong các thư mục bài học khác nhau.
- Mỗi bài học có `media/` riêng; không tạo kho ảnh dùng chung tại `ImportTemplate/media/`.
- Trong một bài học, tên file ảnh phải duy nhất. Nên dùng tiền tố câu hỏi như `q01_question.jpg`, `q01_answer_a.jpg`.
- Tên file trong Excel phải khớp chính xác tên thật, kể cả chữ hoa/thường.
- Không dùng đường dẫn tuyệt đối `/Users/...`, `C:\...` hoặc đường dẫn ra ngoài bằng `../`.
- Có thể dùng cùng tên `quiz_cover.jpg` ở nhiều bài học nếu cấu trúc thư mục và tên workbook đúng chuẩn; tuy nhiên đặt tiền tố bài học sẽ giúp QA dễ hơn.

Nếu có nhiều kết quả không thể phân biệt, hệ thống báo cảnh báo media thay vì tự chọn ngẫu nhiên ảnh của bài học khác.

### 4.5. Quy trình xây dựng và kiểm tra

1. Chọn `Mode: Teky LMS`.
2. Sao chép thư mục/template bài học chuẩn và đổi đồng thời tên folder + Excel.
3. Điền `Quiz Settings`, `Quiz Questions`; đặt ảnh vào `media/`.
4. Kiểm tra toàn bộ đường dẫn ảnh trong Excel.
5. Chạy local: có thể import riêng Excel nếu nguồn nằm đúng trong `ImportTemplate`.
6. Chạy web/deploy hoặc bàn giao: nén Excel + `media/` thành ZIP.
7. Import vào vùng **Tạo quiz từ Excel**.
8. Đọc `ImportReport`; xử lý hết error và media warning.
9. Mở **Quiz Details**, **Questions**, **Settings** để hiệu chỉnh.
10. Nhấn **Save Quiz**, sau đó **Xem & Làm bài** để review.
11. Nhấn **Export CMS JSON** để xuất JSON cuối cùng.

## 5. Excel chuẩn Teky LMS

Workbook gồm tối thiểu hai sheet:

- `Quiz Settings`: một dòng `Field`/`Value` cho từng cấu hình quiz.
- `Quiz Questions`: mỗi dòng là một câu hỏi.

### 5.1. Sheet Quiz Settings

| Field | Ý nghĩa/JSON |
|---|---|
| `title` | Tiêu đề quiz |
| `description` | Mô tả/giới thiệu thử thách |
| `coverImage` | Ảnh đại diện chung, ví dụ `media/quiz_cover.jpg` |
| `subject` | Môn/chủ đề chung |
| `difficultyLevel` | `easy`, `medium`, `hard` |
| `tags` | Danh sách phân cách bằng dấu phẩy/chấm phẩy |
| `createdBy`, `createdByName` | Tác giả/hệ thống tạo |
| `isPublic` | Công khai hay không |
| `duration` | Thời lượng theo giây; editor hiển thị phút |
| `shuffleQuestions` | Trộn thứ tự câu hỏi |
| `shuffleAnswers` | Trộn đáp án |
| `attemptLimit` | Số lần làm tối đa; `0` là không giới hạn |
| `showResults` | Thời điểm hiển thị kết quả, thường `after_submit` |
| `allowReview` | Cho phép xem lại bài |
| `createdAt`, `updatedAt` | ISO-8601; để trống thì hệ thống tự sinh khi export |

`coverImage` khác cột `Image`: cover là ảnh đại diện của toàn quiz, còn `Image` là ảnh nội dung của từng question.

### 5.2. Sheet Quiz Questions

| Cột | Nội dung |
|---|---|
| `Question Type` | Mã dạng câu hỏi |
| `Question Text` | Nội dung đề bài |
| `Image` | Ảnh cấp question; dùng file trong thư mục `media/` |
| `Audio`, `Video` | Chỉ dùng URL trực tuyến; Video hỗ trợ YouTube/Vimeo |
| `Answer 1` ... `Answer 6` | Nội dung đáp án; tối đa 6 đáp án |
| `Answer N Image` | Ảnh của đáp án N |
| `Answer N Left Image` | Ảnh vế trái Matching |
| `Answer N Right Image` | Ảnh vế phải Matching |
| `Difficulty` | Độ khó của question |
| `Topic` | Chủ đề question |
| `Explanation` | Giải thích hiển thị sau nộp bài |
| `Points` | Điểm câu hỏi |
| `Required`, `Use Regex` | Bắt buộc trả lời và so khớp RegEx cho FIB/TI |

Không thêm `Quiz ID` hoặc `Question ID`. Hệ thống tạo ID duy nhất khi import, giữ ổn định trong session và sử dụng khi export.
Mỗi câu hỏi có tối đa 6 đáp án; dạng Matching có tối đa 6 cặp ghép.

## 6. Tạo và liên kết media

### 6.1. Nguyên tắc đường dẫn

- Dùng đường dẫn tương đối bắt đầu bằng `media/`.
- Ví dụ: `media/q01_question.jpg`.
- Không ghi đường dẫn tuyệt đối như `/Users/...` hoặc `C:\Users\...`.
- Tên file nên không dấu, không khoảng trắng, chữ thường và có tiền tố câu hỏi.
- Tên trong Excel phải khớp chính xác tên file, kể cả chữ hoa/thường trên Linux.

### 6.2. Gắn media theo vị trí

| Vị trí | Cột/cú pháp |
|---|---|
| Cover quiz | `Quiz Settings.coverImage` |
| Ảnh câu hỏi | `Image` |
| Audio câu hỏi | `Audio`; URL HTTPS trực tiếp |
| Video câu hỏi | `Video`; URL YouTube hoặc Vimeo |
| Ảnh đáp án | `Answer N Image` |
| Matching trái/phải | `Answer N Left Image`, `Answer N Right Image` |

Ví dụ:

```text
Image: media/q01_question.jpg
Answer 1 Image: media/q01_answer_a.png
Video: https://www.youtube.com/watch?v=VIDEO_ID
Audio: https://cdn.example.com/audio/bai-hoc.mp3
```

Định dạng hỗ trợ:

- Ảnh: `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`
- Audio không lưu trong `media/`; chỉ nhập URL HTTPS trực tiếp.
- Video không lưu trong `media/`; chỉ nhập URL YouTube hoặc Vimeo.

Khi import, ảnh được copy vào package và đăng ký trong session. Khi export JSON có cấu hình S3, ảnh được upload lên FPT S3; URL video/audio được giữ dưới dạng liên kết trực tuyến.

## 7. Chín dạng question chuẩn Teky LMS

| Excel | Editor | JSON Teky | Cách nhập đáp án |
|---|---|---|---|
| `MC` | Trắc nghiệm chọn 1 | `multiple_choice` | Dùng `*` trước một đáp án đúng |
| `MR` | Trắc nghiệm chọn nhiều | `multiple_select` | Dùng `*` trước mọi đáp án đúng |
| `TF` | Đúng/Sai | `true_false` | Đánh dấu đáp án đúng |
| `MG`/`MA` | Ghép cặp | `matching` | `Vế trái|Vế phải`; có thể kèm ảnh hai vế |
| `SEQ` | Sắp xếp thứ tự | `ordering` | Thứ tự Answer 1...N là thứ tự đúng |
| `FIB`/`WB` | Điền vào chỗ trống | `fill_blank` | Câu hỏi dùng `___`; một textbox và nhiều đáp án tương đồng |
| `TI`/`SA` | Trả lời ngắn | `short_answer` | Một textbox; thêm từ đồng nghĩa nếu cần |
| `NUM`/`NUMG` | Đáp án số | `numeric` | Một giá trị số chính xác |
| `MNUM` | Nhiều đáp án số | `multiple_numeric` | Nhiều ô/giá trị số theo thứ tự |

Lưu ý:

- `FIB` và `short_answer` trên LMS đều dùng một textbox duy nhất. `FIB` biểu diễn vị trí trống bằng `___` trong câu hỏi.
- Nút **THÊM TỪ ĐỒNG NGHĨA** thêm các giá trị chấp nhận cho cùng một textbox.
- **Sử dụng RegEx để so khớp** chỉ bật khi nội dung được thiết kế và kiểm thử như biểu thức chính quy.
- `required` là cấu hình bắt buộc trả lời của từng câu.
- `Explanation` hiển thị sau khi nộp bài theo cấu hình quiz.

Các mã `DND`, `DIB`, `HS`, `ESSAY`, `LIKERT` có thể tồn tại trong SCORM gốc nhưng hiện không phải 9 dạng import Excel chuẩn Teky LMS.

## 8. Editor và quy tắc lưu

### 8.1. Quiz Details

Sửa title, description, cover, subject, độ khó chung, duration, tags và thông tin nâng cao.

### 8.2. Questions

Sửa question text, media, points, difficulty, topic, required, explanation và toàn bộ đáp án theo loại. Có thể thêm/xoá question, lựa chọn, cặp Matching, item Ordering hoặc từ đồng nghĩa.

### 8.3. Settings

Sửa attempt limit, shuffle questions, shuffle answers, allow review và show results.

### 8.4. Save Quiz

- Đây là nút lưu chính thức cho toàn bộ session.
- Text và HTML phải được đồng bộ; hệ thống ưu tiên text mới nếu client gửi kèm HTML cũ.
- Thêm/xoá đáp án hoặc question chỉ được coi là hoàn tất sau khi Save Quiz thành công.
- Trước khi preview hoặc export, luôn nhấn Save Quiz.

## 9. Viewer và kiểm duyệt

Viewer mô phỏng giao diện Teky LMS:

- MC dùng radio; MR dùng checkbox.
- TF hiển thị hai lựa chọn Đúng/Sai.
- Matching dùng danh sách chọn cặp.
- Ordering hỗ trợ sắp xếp.
- FIB/Short Answer dùng một textbox.
- Numeric dùng ô số; Multiple Numeric có nhiều ô.
- Hiển thị ảnh question, ảnh đáp án, chủ đề, điểm và thời gian.

Checklist review:

1. Không có ảnh vỡ hoặc media warning.
2. Câu hỏi không bị cắt và dấu `___` đúng vị trí.
3. Số textbox/đáp án đúng theo loại.
4. Đáp án đúng, từ đồng nghĩa và RegEx hoạt động như thiết kế.
5. Matching/Ordering đúng thứ tự và đúng ảnh.
6. Required, điểm, explanation và submit hoạt động.

## 10. Export JSON chuẩn Teky LMS

Nhấn **Export CMS JSON**. Backend:

1. Đọc session đã lưu.
2. Chuyển từng question sang một trong 9 `type` Teky.
3. Upload media tìm được lên S3/FPT nếu cấu hình S3 hợp lệ.
4. Gắn URL media vào JSON.
5. Ghi file vào:

```text
SCORM-PROJECT/JSON-EXPORT/{quiz_title}_teky.json
```

`JSON-EXPORT` nằm cùng cấp với `ImportTemplate`. Hệ thống tự tạo thư mục này khi export lần đầu, không phụ thuộc thư mục `Downloads` của tài khoản đang chạy backend.

File được bọc dạng mảng:

```json
[
  {
    "id": "quiz_...",
    "title": "...",
    "coverImageUrl": "https://s3-sgn10.fptcloud.com/...",
    "settings": {},
    "questions": []
  }
]
```

Đối chiếu trước khi import LMS:

- `docs/cms_json_template.json`: schema/khung.
- `docs/cms_json_full_sample.json`: mẫu đầy đủ.
- JSON phải chứa toàn bộ quiz settings và toàn bộ question đã lưu.
- URL S3 phải truy cập được; nếu upload S3 thất bại, exporter có thể dùng đường dẫn `images/<filename>` để phục vụ quy trình local/QA.

## 11. Checklist xuất bản

1. Sao chép template và tạo thư mục làm việc riêng.
2. Điền `Quiz Settings`.
3. Viết toàn bộ question và đáp án.
4. Đặt media vào `media/`, kiểm tra đúng tên/path.
5. Zip Excel + media.
6. Import và xử lý hết error/media warning.
7. Edit toàn bộ Quiz Details, Questions, Settings.
8. Save Quiz.
9. View & Làm bài, kiểm tra 9 dạng.
10. Quay lại sửa và Save lại nếu cần.
11. Export CMS JSON.
12. So JSON với template/full sample.
13. Kiểm tra URL S3/FPT.
14. Import JSON lên Teky LMS và smoke test lần cuối.

## 12. Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân/giải pháp |
|---|---|
| `Không tìm thấy ảnh: media/...` | File không có trong zip hoặc sai chữ hoa/thường; đặt Excel và `media/` cùng cấp |
| Cover bị vỡ | Kiểm tra `Quiz Settings.coverImage`; nên import zip đầy đủ |
| Nội dung quay lại sau Save | Cần dùng phiên bản mới có đồng bộ text/HTML; restart backend/frontend rồi import lại |
| Thêm đáp án rồi biến mất | Không dùng auto-save cũ; thêm nội dung rồi nhấn Save Quiz |
| S3 URL trống | Kiểm tra biến môi trường S3, bucket, quyền upload và file media trong session |
| JSON thiếu câu | Câu thuộc loại không mapping, bị xoá, hoặc chưa Save Quiz |
| `.xls` báo thiếu `xlrd` | Cài đầy đủ `backend/requirements.txt`; có thể dùng `.xlsx` chuẩn Teky |
| Video không có preview | Thêm ảnh poster ở cột `Image` và kiểm tra định dạng video |

## 13. Chạy dự án và API chính

```bash
cd scorm-editor
./start.sh
# Mở http://localhost:8000
```

| Method | API | Mục đích |
|---|---|---|
| `POST` | `/api/import` | Import SCORM zip |
| `POST` | `/api/import/excel` | Import Excel hoặc zip Excel+media |
| `GET` | `/api/import/excel/templates` | Danh sách tài nguyên mẫu |
| `GET` | `/api/session/{id}` | Đọc editor view |
| `PUT` | `/api/session/{id}` | Save Quiz |
| `POST` | `/api/session/{id}/asset/{filename}` | Upload media |
| `GET` | `/api/session/{id}/preview/player` | Viewer/player |
| `POST` | `/api/session/{id}/export` | Export SCORM zip |
| `POST` | `/api/session/{id}/export-cms-json-local` | Export JSON Teky LMS |
| `POST` | `/api/session/{id}/export-media` | Export media zip |
