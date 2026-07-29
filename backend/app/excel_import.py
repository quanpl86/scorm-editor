"""Parse iSpring Quiz Maker Excel import templates.

Format: https://ispringhelpdocs.com/quizmaker9/importing-questions-from-excel-6128674.html
Sample: ImportTemplate/Sample_import_template.xls
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

# Excel abbreviation → iSpring slide tp
EXCEL_TYPE_MAP: dict[str, str] = {
    "MC": "MultipleChoice",
    "MR": "MultipleResponse",
    "TF": "TrueFalse",
    "TI": "TypeIn",
    "SA": "TypeIn",
    "SEQ": "Sequence",
    "MG": "Matching",
    "MA": "Matching",
    "FIB": "FillInTheBlank",
    "FITB": "FillInTheBlank",
    "WB": "WordBank",
    "IS": "InfoSlide",
    "NUMG": "Numeric",
    "NUM": "Numeric",
    "DND": "DND",
    "DIB": "DIB",
    "HS": "Hotspot",
    "ESSAY": "Essay",
    "LIKERT": "LikertScale",
    "MNUM": "MultipleNumeric",
}

SUPPORTED_TYPES = {
    "MultipleChoice",
    "MultipleResponse",
    "TrueFalse",
    "TypeIn",
    "Sequence",
    "Matching",
    "FillInTheBlank",
    "WordBank",
    "InfoSlide",
    "Numeric",
    "MultipleNumeric",
}

# Parsed from Excel but not injectable — clear skip reason in import report
SKIP_IMPORT_TYPES: dict[str, str] = {
    "DND": "Kéo thả (DND) — chỉnh layout trên Canvas SCORM gốc, không import từ Excel",
    "DIB": "Drag in Blank — chưa hỗ trợ import Excel",
    "Hotspot": "Hotspot — chỉnh trên Canvas SCORM gốc, không import từ Excel",
    "Essay": "Essay — chưa hỗ trợ import Excel",
    "LikertScale": "Likert Scale — chưa hỗ trợ import Excel",
}


IMAGE_EXTS = frozenset({"jpg", "jpeg", "png", "gif", "bmp", "webp"})
AUDIO_EXTS = frozenset({"mp3", "wav", "m4a", "ogg"})
VIDEO_EXTS = frozenset({"mp4", "webm", "mov"})
MAX_ANSWERS = 6

MEDIA_TAG_RE = re.compile(
    r"\[(?P<tag>image|audio|video|sound)\s*=\s*(?P<path>[^\]]+)\]",
    re.IGNORECASE,
)
MEDIA_EXT_RE = re.compile(
    r"\[(?P<path>[^\]]+\.(?P<ext>[A-Za-z0-9]+))\]",
    re.IGNORECASE,
)


@dataclass
class ParsedMediaRefs:
    text: str = ""
    image: str | None = None
    audio: str | None = None
    video: str | None = None


@dataclass
class ParsedAnswer:
    text: str
    is_correct: bool = False
    premise: str | None = None
    response: str | None = None
    image: str | None = None
    audio: str | None = None
    video: str | None = None
    right_image: str | None = None  # For Matching: image of the right side


@dataclass
class ExcelQuestion:
    row_index: int
    excel_type: str
    ispring_type: str
    question_text: str
    image: str | None = None
    video: str | None = None
    audio: str | None = None
    difficulty: str | None = None
    topic: str | None = None
    explanation: str | None = None
    required: bool = False
    use_regex: bool = False
    answers: list[ParsedAnswer] = field(default_factory=list)
    correct_feedback: ParsedMediaRefs = field(default_factory=ParsedMediaRefs)
    incorrect_feedback: ParsedMediaRefs = field(default_factory=ParsedMediaRefs)
    points: float | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _cell_str(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _cell_bool(value: Any) -> bool:
    raw = _cell_str(value).lower()
    return raw in {"1", "true", "yes", "y", "có", "x", "bắt buộc", "required"}


def _coerce_setting_value(key: str, value: Any) -> Any:
    """Normalize values from the optional Quiz Settings sheet."""
    raw = _cell_str(value)
    if key in {"isPublic", "shuffleQuestions", "shuffleAnswers", "allowReview"}:
        return raw.lower() in {"1", "true", "yes", "y", "có", "x"}
    if key in {"duration", "attemptLimit"}:
        try:
            return int(float(raw.replace(",", ".")))
        except ValueError:
            return 0
    if key == "tags":
        return [item.strip() for item in re.split(r"[,;\n]", raw) if item.strip()]
    return raw


QUIZ_SETTING_KEYS: dict[str, str] = {
    "title": "title",
    "quiz title": "title",
    "description": "description",
    "cover image": "coverImage",
    "coverimage": "coverImage",
    "cover": "coverImage",
    # Related Subject (Context) = tên học phần
    "subject": "subject",
    "related subject": "subject",
    "relatedsubject": "subject",
    "ten hoc phan": "subject",
    "tên học phần": "subject",
    "hoc phan": "subject",
    # Target Lesson (Context) = tên bài học
    "target lesson": "targetLesson",
    "targetlesson": "targetLesson",
    "target_lesson": "targetLesson",
    "ten bai hoc": "targetLesson",
    "tên bài học": "targetLesson",
    "bai hoc": "targetLesson",
    "lesson": "targetLesson",
    # Mã package / Tên Bài học (thư mục ImportTemplate)
    "lesson code": "lessonCode",
    "lessoncode": "lessonCode",
    "lesson_code": "lessonCode",
    "ten bai hoc package": "lessonCode",
    "ma bai hoc": "lessonCode",
    "mã bài học": "lessonCode",
    "difficulty": "difficultyLevel",
    "difficulty level": "difficultyLevel",
    "difficultylevel": "difficultyLevel",
    "tags": "tags",
    "created by": "createdBy",
    "createdby": "createdBy",
    "created by name": "createdByName",
    "createdbyname": "createdByName",
    "is public": "isPublic",
    "ispublic": "isPublic",
    "duration": "duration",
    "shuffle questions": "shuffleQuestions",
    "shufflequestions": "shuffleQuestions",
    "shuffle answers": "shuffleAnswers",
    "shuffleanswers": "shuffleAnswers",
    "attempt limit": "attemptLimit",
    "attemptlimit": "attemptLimit",
    "show results": "showResults",
    "showresults": "showResults",
    "allow review": "allowReview",
    "allowreview": "allowReview",
    "created at": "createdAt",
    "createdat": "createdAt",
    "updated at": "updatedAt",
    "updatedat": "updatedAt",
}


def parse_quiz_settings(path: Path) -> dict[str, Any]:
    """Read optional `Quiz Settings` sheet as Field/Value pairs."""
    suffix = path.suffix.lower()
    engine = "xlrd" if suffix == ".xls" else "openpyxl"
    try:
        workbook = pd.ExcelFile(path, engine=engine)
    except Exception:
        return {}

    sheet_name = next(
        (name for name in workbook.sheet_names if name.strip().lower() in {"quiz settings", "quiz config"}),
        None,
    )
    if not sheet_name:
        return {}

    df = pd.read_excel(path, sheet_name=sheet_name, header=0, engine=engine)
    df.columns = [str(c).strip() for c in df.columns]
    columns = {c.lower(): c for c in df.columns}
    field_col = columns.get("field") or columns.get("key")
    value_col = columns.get("value")
    if not field_col or not value_col:
        raise ValueError("Sheet 'Quiz Settings' cần có cột 'Field' và 'Value'")

    quiz: dict[str, Any] = {}
    settings: dict[str, Any] = {}
    settings_keys = {
        "shuffleQuestions", "shuffleAnswers", "attemptLimit", "showResults", "allowReview",
    }
    for _, row in df.iterrows():
        raw_field = _cell_str(row.get(field_col))
        if not raw_field:
            continue
        normalized = re.sub(r"[_\-.]+", " ", raw_field).strip().lower()
        key = QUIZ_SETTING_KEYS.get(normalized)
        if not key:
            continue
        value = _coerce_setting_value(key, row.get(value_col))
        if key in settings_keys:
            settings[key] = value
        else:
            quiz[key] = value
    if settings:
        quiz["settings"] = settings
    return quiz


def _media_kind_for_ext(ext: str) -> str | None:
    key = ext.lower().lstrip(".")
    if key in IMAGE_EXTS:
        return "image"
    if key in AUDIO_EXTS:
        return "audio"
    if key in VIDEO_EXTS:
        return "video"
    return None


def parse_media_brackets(raw: str) -> ParsedMediaRefs:
    """Parse iSpring Excel optional params in brackets: [image=path], [audio=path], [path.jpg]."""
    text = raw.strip()
    refs = ParsedMediaRefs()

    for match in MEDIA_TAG_RE.finditer(text):
        tag = match.group("tag").lower()
        if tag == "sound":
            tag = "audio"
        path = match.group("path").strip()
        if tag in ("image", "audio", "video") and path:
            setattr(refs, tag, path)
        text = text.replace(match.group(0), "", 1).strip()

    for match in MEDIA_EXT_RE.finditer(text):
        ext = match.group("ext")
        kind = _media_kind_for_ext(ext)
        if not kind:
            continue
        path = match.group("path").strip()
        if path and getattr(refs, kind) is None:
            setattr(refs, kind, path)
        text = text.replace(match.group(0), "", 1).strip()

    refs.text = text.strip()
    return refs


def _parse_answer_cell(raw: str, excel_type: str) -> ParsedAnswer | None:
    text = raw.strip()
    if not text:
        return None

    if excel_type in ("MG", "MA"):
        if "|" not in text:
            return None
        left, right = text.split("|", 1)
        return ParsedAnswer(text=text, premise=left.strip(), response=right.strip())

    if excel_type in ("NUMG", "NUM", "MNUM"):
        numeric = text.lstrip("=").strip()
        if numeric:
            return ParsedAnswer(text=numeric, is_correct=True)
        return None

    is_correct = text.startswith("*")
    body = text.lstrip("*").strip()
    media = parse_media_brackets(body)

    if not media.text and not any((media.image, media.audio, media.video)):
        return None
    return ParsedAnswer(
        text=media.text,
        is_correct=is_correct,
        image=media.image,
        audio=media.audio,
        video=media.video,
    )


def _validate_question(q: ExcelQuestion) -> None:
    tp = q.ispring_type
    n = len([a for a in q.answers if a.text or a.premise])

    if not q.question_text and tp != "InfoSlide" and not q.image:
        q.errors.append("Thiếu nội dung câu hỏi")

    if tp == "MultipleChoice" and n < 2:
        q.errors.append("MC cần ít nhất 2 đáp án")
    elif tp == "MultipleChoice" and not any(a.is_correct for a in q.answers):
        q.errors.append("MC cần 1 đáp án đúng (prefix *)")
    elif tp == "MultipleResponse" and n < 2:
        q.errors.append("MR cần ít nhất 2 đáp án")
    elif tp == "MultipleResponse" and not any(a.is_correct for a in q.answers):
        q.errors.append("MR cần ít nhất 1 đáp án đúng (prefix *)")
    elif tp == "TrueFalse" and n < 2:
        q.errors.append("TF cần True và False")
    elif tp == "Matching" and n < 2:
        q.errors.append("Matching cần ít nhất 2 cặp (premise|response)")
    elif tp == "Sequence" and n < 2:
        q.warnings.append("Sequence cần ít nhất 2 mục")
    elif tp == "TypeIn" and n < 1:
        q.errors.append("Short answer cần ít nhất 1 đáp án chấp nhận")
    elif tp in ("Numeric", "MultipleNumeric") and n < 1:
        q.warnings.append("Numeric cần ít nhất 1 đáp án (=số, ví dụ =5)")
    elif tp == "FillInTheBlank" and n < 1:
        q.warnings.append("FIB cần ít nhất 1 đáp án cho ô trống")
    elif tp == "WordBank" and n < 2:
        q.errors.append("WB cần ít nhất 2 từ (1 đúng * + 1 nhiễu)")
    elif tp == "WordBank" and not any(a.is_correct for a in q.answers):
        q.errors.append("WB cần 1 đáp án đúng (prefix *)")


def parse_excel_file(path: Path, *, sheet_index: int = 0) -> list[ExcelQuestion]:
    """Read first sheet; row 1 = headers, following rows = questions."""
    suffix = path.suffix.lower()
    if suffix == ".xls":
        df = pd.read_excel(path, sheet_name=sheet_index, header=0, engine="xlrd")
    else:
        df = pd.read_excel(path, sheet_name=sheet_index, header=0, engine="openpyxl")

    df.columns = [str(c).strip() for c in df.columns]
    col_map = {c.lower(): c for c in df.columns}

    def col(*names: str) -> str | None:
        for name in names:
            key = name.lower()
            if key in col_map:
                return col_map[key]
        return None

    type_col = col("question type")
    text_col = col("question text")
    if not type_col or not text_col:
        raise ValueError("File Excel thiếu cột 'Question Type' hoặc 'Question Text'")

    image_col = col("image")
    video_col = col("video")
    audio_col = col("audio")
    diff_col = col("difficulty")
    topic_col = col("topic")
    expl_col = col("explanation") or col("correct feedback")
    required_col = col("required", "mandatory", "bắt buộc")
    regex_col = col("use regex", "useregex", "regex", "sử dụng regex")
    correct_fb_col = col("correct feedback")
    incorrect_fb_col = col("incorrect feedback")
    points_col = col("points")
    answer_cols = [col(f"answer {i}") for i in range(1, MAX_ANSWERS + 1)]
    answer_cols = [c for c in answer_cols if c]

    # Per-answer image columns: "Answer 1 Image", "Answer 2 Image", ...
    answer_img_cols = [
        col(f"answer {i} image", f"image answer {i}", f"img {i}")
        for i in range(1, MAX_ANSWERS + 1)
    ]
    # For Matching: separate left/right image columns
    answer_left_img_cols = [
        col(f"answer {i} left image", f"left image {i}", f"left img {i}")
        for i in range(1, MAX_ANSWERS + 1)
    ]
    answer_right_img_cols = [
        col(f"answer {i} right image", f"right image {i}", f"right img {i}")
        for i in range(1, MAX_ANSWERS + 1)
    ]
    overflow_cols = [
        candidate
        for i in range(MAX_ANSWERS + 1, 11)
        for candidate in (
            col(f"answer {i}"),
            col(f"answer {i} image", f"image answer {i}", f"img {i}"),
            col(f"answer {i} left image", f"left image {i}", f"left img {i}"),
            col(f"answer {i} right image", f"right image {i}", f"right img {i}"),
        )
        if candidate
    ]

    questions: list[ExcelQuestion] = []
    for idx, row in df.iterrows():
        excel_type = _cell_str(row.get(type_col)).upper()
        if not excel_type:
            continue

        ispring_type = EXCEL_TYPE_MAP.get(excel_type)
        if not ispring_type:
            questions.append(
                ExcelQuestion(
                    row_index=int(idx) + 2,
                    excel_type=excel_type,
                    ispring_type="",
                    question_text=_cell_str(row.get(text_col)),
                    errors=[f"Loại '{excel_type}' không được hỗ trợ"],
                )
            )
            continue

        answers: list[ParsedAnswer] = []
        for ai, ac in enumerate(answer_cols):
            if not ac:
                continue
            parsed = _parse_answer_cell(_cell_str(row.get(ac)), excel_type)
            if parsed:
                # Merge dedicated image column into answer (column takes priority)
                img_col = answer_img_cols[ai] if ai < len(answer_img_cols) else None
                if img_col and not parsed.image:
                    img_val = _cell_str(row.get(img_col))
                    if img_val:
                        parsed.image = img_val
                # For Matching: merge left/right image columns
                if excel_type in ("MG", "MA"):
                    left_col = answer_left_img_cols[ai] if ai < len(answer_left_img_cols) else None
                    right_col = answer_right_img_cols[ai] if ai < len(answer_right_img_cols) else None
                    left_img = _cell_str(row.get(left_col)) if left_col else ""
                    right_img = _cell_str(row.get(right_col)) if right_col else ""
                    if left_img:
                        parsed.image = left_img
                    if right_img:
                        parsed.right_image = right_img
                answers.append(parsed)

        points_raw = _cell_str(row.get(points_col)) if points_col else ""
        points = None
        if points_raw:
            try:
                points = float(points_raw.replace(",", "."))
            except ValueError:
                pass

        q = ExcelQuestion(
            row_index=int(idx) + 2,
            excel_type=excel_type,
            ispring_type=ispring_type,
            question_text=_cell_str(row.get(text_col)),
            image=_cell_str(row.get(image_col)) if image_col else None,
            video=_cell_str(row.get(video_col)) if video_col else None,
            audio=_cell_str(row.get(audio_col)) if audio_col else None,
            difficulty=_cell_str(row.get(diff_col)) if diff_col else "medium",
            topic=_cell_str(row.get(topic_col)) if topic_col else "",
            explanation=_cell_str(row.get(expl_col)) if expl_col else "",
            required=_cell_bool(row.get(required_col)) if required_col else False,
            use_regex=_cell_bool(row.get(regex_col)) if regex_col else False,
            answers=answers,
            correct_feedback=(
                parse_media_brackets(_cell_str(row.get(correct_fb_col)))
                if correct_fb_col
                else ParsedMediaRefs()
            ),
            incorrect_feedback=(
                parse_media_brackets(_cell_str(row.get(incorrect_fb_col)))
                if incorrect_fb_col
                else ParsedMediaRefs()
            ),
            points=points,
        )
        if any(_cell_str(row.get(overflow_col)) for overflow_col in overflow_cols):
            q.errors.append(
                f"Tối đa {MAX_ANSWERS} đáp án hoặc {MAX_ANSWERS} cặp ghép cho mỗi câu hỏi"
            )
        if ispring_type in SKIP_IMPORT_TYPES:
            pass
        elif ispring_type not in SUPPORTED_TYPES:
            q.errors.append(f"Loại {ispring_type} chưa hỗ trợ import")
        else:
            _validate_question(q)
        questions.append(q)

    return questions


def resolve_media_path(media_ref: str, excel_dir: Path, fallback_dirs: list[Path]) -> Path | None:
    if not media_ref:
        return None
    ref = media_ref.replace("\\", "/")
    candidate = excel_dir / ref
    if candidate.exists():
        return candidate
    name = Path(ref).name
    for base in fallback_dirs:
        for probe in [base / ref, base / name, base / "media" / name]:
            if probe.exists():
                return probe
        # A standalone workbook cannot carry its sibling media directory.
        # Allow the server's bundled template tree one nested directory level,
        # but only use the result when it is unambiguous.
        nested_matches = {
            path.resolve()
            for pattern in (f"*/{ref}", f"*/media/{name}")
            for path in base.glob(pattern)
            if path.is_file()
        }
        if len(nested_matches) == 1:
            return next(iter(nested_matches))
    return None
