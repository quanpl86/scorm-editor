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
}


@dataclass
class ParsedAnswer:
    text: str
    is_correct: bool = False
    premise: str | None = None
    response: str | None = None


@dataclass
class ExcelQuestion:
    row_index: int
    excel_type: str
    ispring_type: str
    question_text: str
    image: str | None = None
    video: str | None = None
    audio: str | None = None
    answers: list[ParsedAnswer] = field(default_factory=list)
    correct_feedback: str = ""
    incorrect_feedback: str = ""
    points: float | None = None
    errors: list[str] = field(default_factory=list)


def _cell_str(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _parse_answer_cell(raw: str, excel_type: str) -> ParsedAnswer | None:
    text = raw.strip()
    if not text:
        return None

    if excel_type in ("MG", "MA"):
        if "|" not in text:
            return None
        left, right = text.split("|", 1)
        return ParsedAnswer(text=text, premise=left.strip(), response=right.strip())

    if excel_type == "NUMG":
        numeric = text.lstrip("=").strip()
        return ParsedAnswer(text=numeric, is_correct=True)

    is_correct = text.startswith("*")
    body = text.lstrip("*").strip()
    if not body:
        return None
    return ParsedAnswer(text=body, is_correct=is_correct)


def _validate_question(q: ExcelQuestion) -> None:
    tp = q.ispring_type
    n = len([a for a in q.answers if a.text or a.premise])

    if not q.question_text and tp != "InfoSlide":
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
        q.errors.append("Sequence cần ít nhất 2 mục")
    elif tp == "TypeIn" and n < 1:
        q.errors.append("Short answer cần ít nhất 1 đáp án chấp nhận")


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
    correct_fb = col("correct feedback")
    incorrect_fb = col("incorrect feedback")
    points_col = col("points")
    answer_cols = [col(f"answer {i}") for i in range(1, 11)]
    answer_cols = [c for c in answer_cols if c]

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
        for ac in answer_cols:
            parsed = _parse_answer_cell(_cell_str(row.get(ac)), excel_type)
            if parsed:
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
            answers=answers,
            correct_feedback=_cell_str(row.get(correct_fb)) if correct_fb else "",
            incorrect_feedback=_cell_str(row.get(incorrect_fb)) if incorrect_fb else "",
            points=points,
        )
        if ispring_type not in SUPPORTED_TYPES and ispring_type != "Numeric":
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
    return None