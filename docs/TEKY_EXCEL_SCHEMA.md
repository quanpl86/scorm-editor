# Teky LMS — Excel Import Standard

Excel là nguồn dữ liệu chuẩn cho toàn bộ nội dung câu hỏi và cấu hình quiz trước khi export JSON CMS.

## Gói import chính thức

`ImportTemplate/Full_quiz_9_types_teky_lms.zip`

```text
Full_quiz_9_types_teky_lms.zip
├── Full_quiz_9_types_teky_lms_system_ids.xlsx
└── media/
    ├── *.jpg / *.png
    ├── *.mp3
    └── *.mp4
```

## Sheet `Quiz Questions`

Mỗi dòng là một question. Các trường chính:

- `Question Type`, `Question Text`
- `Image`, `Video`, `Audio`
- `Answer 1` … `Answer 6` và ảnh từng đáp án
- `Difficulty`, `Topic`, `Explanation`, `Points`
- `Correct Feedback`, `Incorrect Feedback`
- Ảnh trái/phải cho Matching

`Question ID` và `Quiz ID` không nằm trong Excel, không hiển thị trên Editor.
Hệ thống tự sinh ID duy nhất khi import, giữ ổn định trong phiên biên tập và dùng
ID đó trong JSON xuất bản, tránh trùng hoặc sai ID do người làm nội dung nhập tay.

`Image` là ảnh nội dung của từng câu hỏi. Ảnh đại diện chung của quiz được cấu
hình bằng `coverImage` trong sheet `Quiz Settings`.

Loại hỗ trợ:

| Excel | JSON Teky LMS |
|---|---|
| MC | multiple_choice |
| MR | multiple_select |
| TF | true_false |
| MG | matching |
| SEQ | ordering |
| FIB / WB | fill_blank |
| TI | short_answer |
| NUM | numeric |
| MNUM | multiple_numeric |

## Sheet `Quiz Settings`

| Field | JSON |
|---|---|
| title | quiz.title |
| description | quiz.description |
| coverImage | quiz.coverImageUrl |
| subject | quiz.subject |
| difficultyLevel | quiz.difficultyLevel |
| tags | quiz.tags |
| createdBy | quiz.createdBy |
| createdByName | quiz.createdByName |
| isPublic | quiz.isPublic |
| duration | quiz.duration |
| shuffleQuestions | quiz.settings.shuffleQuestions |
| shuffleAnswers | quiz.settings.shuffleAnswers |
| attemptLimit | quiz.settings.attemptLimit |
| showResults | quiz.settings.showResults |
| allowReview | quiz.settings.allowReview |
| createdAt | quiz.createdAt |
| updatedAt | quiz.updatedAt |

`createdAt` và `updatedAt` có thể để trống để hệ thống tự sinh ISO-8601 khi export.
`coverImage` nhận đường dẫn media trong gói import, ví dụ
`media/quiz_cover.jpg`; khi xuất bản, hệ thống đổi thành URL S3/FPT.

## Luồng dữ liệu

```text
Excel + media
  → Import Teky LMS Editor
  → chỉnh nội dung/cấu hình
  → Teky Viewer
  → Export CMS JSON
  → Import vào Teky LMS
```
