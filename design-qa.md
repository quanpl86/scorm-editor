# Design QA — Teky LMS Editor & Viewer

## Nguồn đối chiếu

- Editor: bộ 13 ảnh LMS từ `14.36.30` đến `14.38.51` do người dùng cung cấp.
- Viewer: bộ 8 ảnh LMS từ `14.32.12` đến `14.33.45`, bao phủ toàn bộ 9 dạng câu hỏi:
  TypeIn, Matching, Multiple Response, Ordering, Multiple Choice, Fill,
  Numeric, Multiple Numeric và True/False.
- Dữ liệu QA: `ImportTemplate/Full_quiz_9_types_teky_lms.zip`.
- JSON chuẩn LMS: `docs/cms_json_full_sample.json`.

## Viewport và ảnh đối chiếu Viewer

- Desktop nguồn và implementation: 1738 × 1167 px.
- Mobile implementation: 760 × 1000 px; không có tràn ngang.
- Implementation:
  - `qa-artifacts/teky-viewer-desktop-top-final3.png`
  - `qa-artifacts/teky-viewer-desktop-sticky-final3.png`
  - `qa-artifacts/teky-viewer-submit-modal-final.png`
  - `qa-artifacts/teky-viewer-mobile-final.png`
- Ảnh ghép nguồn/implementation được đánh giá trong cùng một canvas:
  - `qa-artifacts/compare-viewer-top-final.png`
  - `qa-artifacts/compare-viewer-scroll-final.png`

## Kết quả đối chiếu Viewer

### Full-view

- Banner preview màu cam, header tên quiz, tiến độ, mô tả và đồng hồ bám đúng
  hierarchy LMS.
- Header tiếp tục hiển thị khi cuộn; kiểm tra thực tế tại `scrollTop = 2454`:
  banner ở `top = 0`, quiz header ở `top = 52`.
- Nội dung dùng một trang cuộn gồm intro card, toàn bộ question card và footer
  nộp bài; không còn chuyển từng câu bằng pagination.
- Card, nhãn `CÂU HỎI`, điểm số, topic chip, khoảng cách, viền và bán kính bo
  khớp ngôn ngữ UI của LMS.
- Media câu hỏi và media đáp án giữ đúng tỉ lệ, nằm trong vùng nền xám nhạt.

### Tương tác 9 dạng câu hỏi

- Multiple Choice: chọn duy nhất một đáp án.
- Multiple Response: chọn/bỏ chọn nhiều đáp án.
- True/False: hai lựa chọn Đúng/Sai.
- Matching: mỗi dòng có item trái, mũi tên và dropdown ghép bên phải.
- Ordering: kéo thả và hỗ trợ bàn phím Arrow Up/Down để đổi thứ tự.
- TypeIn và Fill: đúng một textbox; Fill dùng `___` trong nội dung để biểu thị
  chỗ trống.
- Numeric: một input số.
- Multiple Numeric: nhiều input số có nhãn `Ô 1`, `Ô 2`, ...
- Word Bank legacy dùng cùng UX một textbox theo yêu cầu tương thích LMS.

### Nộp bài

- Footer hiển thị số câu chưa trả lời và nút `Nộp bài`.
- Modal xác nhận hiển thị tổng câu, đã trả lời, bỏ trống, phần trăm hoàn thành
  và liên kết quay tới từng câu chưa trả lời.
- Nút đóng và `Tiếp tục làm bài` quay lại viewer đúng trạng thái.

## Editor

- Quiz Details, Settings và Questions đã khớp hierarchy LMS.
- MC/MR dùng lưới hai cột; True/False một hàng; Matching trái/phải; Ordering
  dạng lưới; Numeric một ô; Multiple Numeric nhiều ô đánh số.
- TypeIn và Fill chỉ còn một textbox đáp án; question ID do hệ thống sinh và
  không hiển thị trên editor.
- TypeIn và Fill có danh sách đáp án chấp nhận/từ đồng nghĩa trong editor,
  nút `+ THÊM TỪ ĐỒNG NGHĨA` và checkbox `Sử dụng RegEx để so khớp`; viewer
  vẫn giữ đúng một textbox trả lời như LMS.
- Mỗi câu có switch `BẮT BUỘC`; trạng thái được lưu và xuất sang CMS JSON.
- Các nút tải media ở câu hỏi/đáp án dùng icon upload thật và khung cố định
  44 × 44 px, không còn co méo theo nội dung bên cạnh.
- Import Excel/media, hiệu chỉnh, xem trước và export CMS JSON giữ nguyên luồng.

## QA bổ sung — Required, từ đồng nghĩa, RegEx và upload

- Nguồn LMS:
  - `Screenshot 2026-07-28 at 14.59.46.png`
  - `Screenshot 2026-07-28 at 15.00.50.png`
  - `Screenshot 2026-07-28 at 15.01.49.png`
- Implementation:
  - `qa-artifacts/teky-editor-required-regex-upload-final.png`
- Ảnh ghép nguồn/implementation được đánh giá trong cùng một canvas:
  - `qa-artifacts/compare-editor-required-regex-upload-final.png`
- Viewport nguồn: 983 × 1022 px; viewport implementation: 1280 × 720 px.
  Đối chiếu tập trung vào cùng trạng thái editor Fill-in-the-Blank và cùng cụm
  điều khiển `BẮT BUỘC` / đáp án chấp nhận / RegEx.
- Kiểm tra DOM:
  - 10 switch `BẮT BUỘC`;
  - 3 checkbox RegEx cho TypeIn, FillInTheBlank và WordBank legacy;
  - TypeIn và Fill đọc đủ 2 đáp án chấp nhận từ Excel;
  - 6 nút upload đang hiển thị đều đo đúng 44 × 44 px.
- Kiểm tra tương tác trên Fill:
  - bật `BẮT BUỘC` → `aria-pressed="true"`;
  - bật RegEx → checkbox checked;
  - thêm từ đồng nghĩa → sinh thêm một input có thể sửa/xóa.
- CMS JSON giữ toàn bộ `correctAnswer`, đồng thời xuất `required` và
  `useRegex`.

## Interaction, responsive và console

- Đã thử chọn MC/MR/TF, ba dropdown Matching, TypeIn, Fill, Numeric, hai ô
  Multiple Numeric và Word Bank.
- Ordering đã đổi thứ tự bằng bàn phím; trạng thái answered cập nhật tức thời.
- Desktop và mobile đều cuộn được; mobile 760 px có `scrollWidth = 760`.
- Console errors: 0.
- Frontend production build: passed.
- Backend tests: 35 passed.

## Lịch sử sửa lỗi

- P0: `.app` chặn cuộn viewer do `overflow: hidden` — đã tạo scroll container
  riêng cho Teky preview.
- P1: Viewer cũ hiển thị từng câu — đã chuyển sang toàn bộ bài trên một trang.
- P1: banner/header không sticky vì preview container bị flex co còn một
  viewport — đã để container tăng theo nội dung; sticky được xác nhận bằng DOM.
- P1: media video local từng render iframe lồng cả ứng dụng — đã dùng thẻ
  `<video controls>` cho asset local; URL ngoài vẫn dùng iframe.
- P1: TypeIn/Fill từng làm mất accepted answers phụ — editor/parser/exporter nay
  giữ đầy đủ từ đồng nghĩa, trong khi viewer vẫn chỉ hiển thị một textbox trả lời.
- P1: switch `BẮT BUỘC` trước đây chỉ là hình tĩnh — đã nối state, save và CMS
  export.
- P1: nút upload media đáp án bị co méo — đã cố định kích thước và dùng icon
  upload nhất quán.
- P2: Ordering chỉ phụ thuộc chuột — đã thêm thao tác bàn phím và aria-label.
- P2: thiếu trạng thái xác nhận nộp bài — đã thêm modal thống kê và danh sách
  câu còn trống.

## Follow-up polish

- `Tự luận` vẫn disabled vì chưa có mapping tương ứng trong JSON Teky LMS chuẩn.
  Khi LMS xác nhận schema type này, có thể bật mà không đổi lại bố cục.

final result: passed
