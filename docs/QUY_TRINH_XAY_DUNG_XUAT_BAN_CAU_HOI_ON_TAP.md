# Quy trình xây dựng nội dung & xuất bản câu hỏi ôn tập (v2.0)

**Bản Word:** `docs/Quy_Trinh_Xay_Dung_Xuat_Ban_Cau_Hoi_On_Tap.docx`  
**Hướng dẫn Editor:** `docs/SCORM_Editor_Huong_Dan_Chi_Tiet.docx`  
**Ngày:** 2026-07-29

---

## Luồng end-to-end

```text
[1] SOẠN          LO / Lesson / Project → Agent drop-in → quiz_questions.tsv
[2] ĐÓNG GÓI      Tab TSV→Excel: form/settings + questions → ImportTemplate/{MãBài}/
[3] BIÊN TẬP      Editor: Context (học phần/bài học), Questions, Save, Viewer
[4] XUẤT BẢN      Export CMS JSON (subject + targetLesson) → Import Teky LMS
```

## Context LMS

| UI | Field | Ý nghĩa |
|----|-------|---------|
| RELATED SUBJECT | `subject` | Tên **học phần** |
| TARGET LESSON | `targetLesson` | Tên **bài học** |

## Template chuẩn

`ImportTemplate/SNLT-HP01-B01/` — schema v2 (TEXT rồi MEDIA, max 6 đáp án; media chỉ ảnh; Video YT/Vimeo; Audio HTTPS).

## Ba tab Import

1. **TSV → Excel** (chính)  
2. **Tạo quiz từ Excel**  
3. **Chỉnh sửa SCORM Zip**

## Agent

`docs/agent-drop-in/` — SYSTEM_PROMPT + schema + header TSV.

## Checklist

1. TSV questions đúng 35 cột  
2. Settings: title, subject, targetLesson…  
3. Mã bài `SNLT-HPxx-Byy`  
4. Import → xlsx + media/  
5. Gắn ảnh · Save · Viewer  
6. Export JSON · Import LMS · smoke test  

Chi tiết đầy đủ xem file Word.
