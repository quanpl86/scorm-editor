"""Lossy migration of legacy CMS-only JSON into canonical editor rows."""

from __future__ import annotations

from typing import Any

from .excel_import import ExcelQuestion, ParsedAnswer
from .fill_blank import align_blank_answers, normalize_blank_answers, normalize_distractors, normalize_question_prompt


CMS_TO_ISPRING = {
    "multiple_choice": ("MC", "MultipleChoice"),
    "multiple_select": ("MR", "MultipleResponse"),
    "true_false": ("TF", "TrueFalse"),
    "short_answer": ("TI", "TypeIn"),
    "fill_blank": ("FIB", "FillInTheBlank"),
    "numeric": ("NUM", "Numeric"),
    "multiple_numeric": ("MNUM", "MultipleNumeric"),
    "matching": ("MG", "Matching"),
    "ordering": ("SEQ", "Sequence"),
}


def cms_questions_to_excel_rows(quiz_obj: dict[str, Any]) -> list[ExcelQuestion]:
    rows: list[ExcelQuestion] = []
    for index, question in enumerate(quiz_obj.get("questions") or [], start=2):
        mapped = CMS_TO_ISPRING.get(str(question.get("type") or ""))
        if not mapped:
            continue
        excel_type, ispring_type = mapped
        correct_values = [str(value) for value in (question.get("correctAnswer") or [])]
        correct = set(correct_values)
        answers: list[ParsedAnswer] = []

        if ispring_type in {"MultipleChoice", "MultipleResponse", "TrueFalse"}:
            for option in question.get("options") or []:
                option_id = str(option.get("id") or "")
                answers.append(ParsedAnswer(
                    text=str(option.get("text") or ""),
                    is_correct=option_id in correct,
                    image=option.get("imageUrl"),
                ))
        elif ispring_type == "Matching":
            for pair in question.get("pairs") or []:
                answers.append(ParsedAnswer(
                    text="",
                    premise=str(pair.get("left") or ""),
                    response=str(pair.get("right") or ""),
                    image=pair.get("leftImageUrl"),
                    right_image=pair.get("rightImageUrl"),
                ))
        elif ispring_type == "Sequence":
            items = question.get("orderingItems") or []
            order = [str(value) for value in (question.get("correctAnswer") or [])]
            by_id = {str(item.get("id") or ""): item for item in items}
            ordered = [by_id[item_id] for item_id in order if item_id in by_id]
            ordered.extend(item for item in items if item not in ordered)
            for item in ordered:
                answers.append(ParsedAnswer(
                    text=str(item.get("text") or ""),
                    image=item.get("imageUrl"),
                ))
        elif ispring_type == "FillInTheBlank":
            raw_blanks = question.get("blankAnswers") or question.get("blanks") or []
            blank_answers = align_blank_answers(
                question.get("question"),
                normalize_blank_answers(raw_blanks, fallback=correct_values),
            )
            answers = [
                ParsedAnswer(text=value, is_correct=True)
                for value in (blank_answers[0]["values"] if blank_answers else correct_values)
            ]
        else:
            blank_answers = []
            answers = [ParsedAnswer(text=value, is_correct=True) for value in correct_values]

        if ispring_type != "FillInTheBlank":
            blank_answers = []

        metadata = question.get("metadata") or {}
        rows.append(ExcelQuestion(
            row_index=index,
            excel_type=excel_type,
            ispring_type=ispring_type,
            question_text=(
                normalize_question_prompt(question.get("question"))
                if ispring_type == "FillInTheBlank"
                else str(question.get("question") or "")
            ),
            image=question.get("imageUrl"),
            video=question.get("videoUrl"),
            audio=question.get("audioUrl"),
            difficulty=metadata.get("difficulty") or "medium",
            topic=metadata.get("topic") or "",
            explanation=str(question.get("explanation") or ""),
            required=bool(question.get("required", False)),
            use_regex=bool(question.get("useRegex", False)),
            blank_answers=blank_answers,
            distractors=normalize_distractors(
                question.get("distractors")
                or question.get("blankDistractors")
                or []
            ),
            points=float(question.get("points", 1) or 1),
            answers=answers,
        ))
    return rows


def cms_quiz_config(quiz_obj: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "id", "title", "description", "subject", "targetLesson", "difficultyLevel",
        "tags", "createdBy", "createdByName", "isPublic", "duration", "settings",
        "createdAt", "updatedAt",
    )
    config = {key: quiz_obj[key] for key in keys if key in quiz_obj}
    if quiz_obj.get("coverImageUrl"):
        config["coverImage"] = quiz_obj["coverImageUrl"]
    return config
