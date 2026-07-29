# User Prompt Template — Gen quiz TSV schema v2 (SNLT-HP01-B01)

Gắn `SYSTEM_PROMPT.txt` (hoặc full `AI_AGENT_PROMPT_QUIZ_CONTENT_TSV.md`) làm system instruction, rồi gửi:

---

```text
## Nhiệm vụ
Sinh bộ câu hỏi Teky LMS theo schema v2 template SNLT-HP01-B01.xlsx.
Đầu ra: ASSESSMENT_BLUEPRINT + quiz_settings.tsv + quiz_questions.tsv + media_manifest.tsv + VALIDATION_REPORT.
TSV tab-separated, 35 cột Questions đúng thứ tự: TEXT trước, MEDIA sau.

## Learning Objectives
(Dán LO — hoặc NONE)

- LO1: ...
- LO2: ...

## Lesson Info
(Dán — hoặc NONE)

- module_code / lesson_code / title / subject / level / key_concepts:

## Project Instruction
(Dán — hoặc NONE)

## Overrides
- quiz_scope: lesson
- total_questions: 10
- media_policy: text_first
- language: vi
- allowed_types: MC,MR,TF,MG,SEQ,FIB,TI,NUM,MNUM
- attempt_limit: 3

## Ràng buộc media (bắt buộc)
- Ảnh: media/file.ext hoặc để trống (human gắn sau khi import Excel)
- Video: chỉ URL YouTube/Vimeo (không file trong media/)
- Audio: chỉ URL HTTPS trực tiếp (không .mp3 trong media/)
- Tối đa Answer 1…6; matching tối đa 6 cặp
- Không cột ID; không Correct/Incorrect Feedback
- Required / Use Regex = True|False
```
