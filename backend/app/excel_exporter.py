"""Export an editor session as the canonical Teky Excel + media project ZIP."""

from __future__ import annotations

import io
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

from .scorm_parser import ScormSession


MAX_ANSWERS = 6
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}

QUESTION_HEADERS = [
    "Question Type",
    "Question Text",
    *[f"Answer {i}" for i in range(1, MAX_ANSWERS + 1)],
    "Explanation",
    "Difficulty",
    "Topic",
    "Points",
    "Required",
    "Use Regex",
    "Image",
    "Video",
    "Audio",
    *[f"Answer {i} Image" for i in range(1, MAX_ANSWERS + 1)],
    *[f"Answer {i} Left Image" for i in range(1, MAX_ANSWERS + 1)],
    *[f"Answer {i} Right Image" for i in range(1, MAX_ANSWERS + 1)],
]

TYPE_MAP = {
    "MultipleChoice": "MC",
    "MultipleChoiceText": "MC",
    "MultipleResponse": "MR",
    "TrueFalse": "TF",
    "TypeIn": "TI",
    "Sequence": "SEQ",
    "Matching": "MG",
    "FillInTheBlank": "FIB",
    "WordBank": "WB",
    "InfoSlide": "IS",
    "Numeric": "NUM",
    "MultipleNumeric": "MNUM",
    # Teky Excel has no native drag/drop representation. Preserve the visible
    # prompt/media as an information slide instead of producing a skipped row.
    "DND": "IS",
}


def _safe_filename(value: str, fallback: str = "Quiz") -> str:
    cleaned = "".join(c if c.isalnum() or c in " _-" else "_" for c in (value or "").strip())
    return cleaned[:120].strip() or fallback


def _remote_url(value: str | None) -> bool:
    return bool(value and str(value).startswith(("http://", "https://")))


def _url_filename(value: str) -> str:
    return Path(urlsplit(value).path).name


def _answer_values(q: dict[str, Any], excel_type: str) -> list[dict[str, Any]]:
    """Normalize every supported editor type to at most six canonical Excel answers."""
    if q.get("type") == "Hotspot":
        return [
            {
                "text": choice.get("text", f"Vùng {idx + 1}"),
                "correct": bool(choice.get("isCorrect")),
                "image": choice.get("image"),
                "hotspotRect": choice.get("rect") or {},
            }
            for idx, choice in enumerate(q.get("choices") or [])
        ][:MAX_ANSWERS]

    if excel_type == "MG":
        return [
            {
                "text": f"{pair.get('premise', '')} | {pair.get('response', '')}",
                "leftImage": pair.get("leftImage") or pair.get("image"),
                "rightImage": pair.get("rightImage"),
            }
            for pair in (q.get("matchingPairs") or [])[:MAX_ANSWERS]
        ]

    if excel_type == "SEQ":
        items = q.get("sequenceItems") or q.get("choices") or []
        return [
            {"text": item.get("text", ""), "image": item.get("image")}
            for item in items[:MAX_ANSWERS]
        ]

    if excel_type in {"TI", "NUM", "MNUM"}:
        return [{"text": str(value), "correct": True} for value in (q.get("typeInAnswers") or [])[:MAX_ANSWERS]]

    if excel_type == "FIB":
        values: list[str] = []
        for blank in q.get("blankAnswers") or []:
            for value in blank.get("values") or blank.get("acceptedAnswers") or []:
                if value and str(value) not in values:
                    values.append(str(value))
        return [{"text": value, "correct": True} for value in values[:MAX_ANSWERS]]

    if excel_type == "WB":
        correct: list[str] = []
        for blank in q.get("blankAnswers") or []:
            for value in blank.get("values") or blank.get("acceptedAnswers") or []:
                if value and str(value) not in correct:
                    correct.append(str(value))
        extras = [str(value) for value in (q.get("wordBankWords") or []) if value and str(value) not in correct]
        return (
            [{"text": value, "correct": True} for value in correct]
            + [{"text": value, "correct": False} for value in extras]
        )[:MAX_ANSWERS]

    return [
        {
            "text": choice.get("text", ""),
            "correct": bool(choice.get("isCorrect")),
            "image": choice.get("image"),
        }
        for choice in (q.get("choices") or [])[:MAX_ANSWERS]
    ]


def export_session_to_excel_zip(session: ScormSession) -> tuple[Path, str]:
    view = session.get_view()
    teky = view.get("tekyQuiz") or {}
    safe_title = _safe_filename(teky.get("title") or view.get("title") or "Quiz")

    fd, temp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)

    wb = openpyxl.Workbook()
    ws_questions = wb.active
    ws_questions.title = "Quiz Questions"
    ws_questions.append(QUESTION_HEADERS)
    for cell in ws_questions[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="DDDDDD", end_color="DDDDDD", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")

    added_names: set[str] = set()
    warnings: list[str] = []

    with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        def add_local_media(original: str | None, proposed_name: str) -> str:
            if not original:
                return ""
            raw = str(original).strip()
            if not raw:
                return ""
            search_value = _url_filename(raw) if _remote_url(raw) else raw
            try:
                source = session.asset_path(search_value)
            except FileNotFoundError:
                return raw if _remote_url(raw) else ""
            final_name = f"{_safe_filename(proposed_name, 'media')}{source.suffix.lower()}"
            archive_name = f"media/{final_name}"
            if archive_name not in added_names:
                zf.write(source, archive_name)
                added_names.add(archive_name)
            return archive_name

        def add_hotspot_crop(answer: dict[str, Any], proposed_name: str) -> str:
            image_ref = answer.get("image")
            rect = answer.get("hotspotRect") or {}
            if not image_ref or not rect:
                return add_local_media(image_ref, proposed_name)
            try:
                from PIL import Image

                source = session.asset_path(_url_filename(image_ref) if _remote_url(image_ref) else str(image_ref))
                with Image.open(source) as image:
                    x = max(0, int(float(rect.get("x", 0)) * image.width / 10000))
                    y = max(0, int(float(rect.get("y", 0)) * image.height / 10000))
                    width = max(1, int(float(rect.get("w", 0)) * image.width / 10000))
                    height = max(1, int(float(rect.get("h", 0)) * image.height / 10000))
                    crop = image.crop((x, y, min(image.width, x + width), min(image.height, y + height)))
                    suffix = source.suffix.lower() if source.suffix.lower() in IMAGE_EXTS else ".png"
                    if crop.mode in {"RGBA", "LA"} and suffix in {".jpg", ".jpeg"}:
                        crop = crop.convert("RGB")
                    archive_name = f"media/{_safe_filename(proposed_name, 'hotspot')}{suffix}"
                    buffer = io.BytesIO()
                    fmt = "JPEG" if suffix in {".jpg", ".jpeg"} else ("GIF" if suffix == ".gif" else "PNG")
                    crop.save(buffer, format=fmt)
                    if archive_name not in added_names:
                        zf.writestr(archive_name, buffer.getvalue())
                        added_names.add(archive_name)
                    return archive_name
            except Exception as exc:
                warnings.append(f"Không crop được hotspot {proposed_name}: {exc}")
                return add_local_media(image_ref, proposed_name)

        for q_index, q in enumerate(view.get("questions") or [], start=1):
            source_type = q.get("type", "")
            answers = _answer_values(q, TYPE_MAP.get(source_type, source_type))
            if source_type == "Hotspot":
                excel_type = "MC" if sum(bool(answer.get("correct")) for answer in answers) <= 1 else "MR"
                if excel_type == "MC" and len(answers) == 1:
                    answers.append({"text": "Khu vực khác", "correct": False})
            elif source_type == "MultipleChoiceText" and len(answers) < 2:
                # This iSpring-only type is not representable in the canonical
                # Teky schema when the source exposes no choices.
                excel_type = "IS"
                answers = []
            else:
                excel_type = TYPE_MAP.get(source_type, source_type)

            prefix = f"{safe_title}_{q_index}"
            question_media: list[str] = []
            for image in q.get("slideImages") or []:
                exported = add_local_media(image, f"{prefix}_IMG-ND{len(question_media) + 1}")
                if exported:
                    question_media.append(exported)
            if not question_media:
                for obj in (q.get("layout") or {}).get("objects") or []:
                    if obj.get("image"):
                        exported = add_local_media(obj["image"], f"{prefix}_IMG-ND{len(question_media) + 1}")
                        if exported:
                            question_media.append(exported)

            video = q.get("video") or ""
            audio = q.get("audio") or ""
            for obj in (q.get("layout") or {}).get("objects") or []:
                video = video or obj.get("video") or ""
                audio = audio or obj.get("audio") or ""
            video_ref = video if _remote_url(video) else add_local_media(video, f"{prefix}_VID-ND")
            audio_ref = audio if _remote_url(audio) else add_local_media(audio, f"{prefix}_AUD-ND")

            explanation = q.get("explanation") or (q.get("feedback") or {}).get("correct") or ""
            feedback = q.get("feedback") or {}
            for kind, key, code in (
                ("image", "correctImage", "IMG-GT"),
                ("audio", "correctAudio", "AUD-GT"),
                ("video", "correctVideo", "VID-GT"),
            ):
                value = feedback.get(key)
                if value:
                    ref = value if _remote_url(value) else add_local_media(value, f"{prefix}_{code}")
                    if ref:
                        explanation = f"{explanation} [{kind}={ref}]".strip()

            row: dict[str, Any] = {
                "Question Type": excel_type,
                "Question Text": q.get("questionText", ""),
                "Explanation": explanation,
                "Difficulty": q.get("difficulty") or "medium",
                "Topic": q.get("topic") or "",
                "Points": q.get("points", 1),
                "Required": bool(q.get("required", False)),
                "Use Regex": bool(q.get("useRegex", False)),
                "Image": question_media[0] if question_media else "",
                "Video": video_ref,
                "Audio": audio_ref,
            }

            for answer_index, answer in enumerate(answers, start=1):
                text = str(answer.get("text") or "")
                if answer.get("correct") and excel_type in {"MC", "MR", "TF", "WB"}:
                    text = f"*{text}"
                row[f"Answer {answer_index}"] = text
                if source_type == "Hotspot":
                    row[f"Answer {answer_index} Image"] = add_hotspot_crop(
                        answer, f"{prefix}_IMG-DA{answer_index}"
                    )
                else:
                    row[f"Answer {answer_index} Image"] = add_local_media(
                        answer.get("image"), f"{prefix}_IMG-DA{answer_index}"
                    )
                row[f"Answer {answer_index} Left Image"] = add_local_media(
                    answer.get("leftImage"), f"{prefix}_IMG-DA-Left{answer_index}"
                )
                row[f"Answer {answer_index} Right Image"] = add_local_media(
                    answer.get("rightImage"), f"{prefix}_IMG-DA-Right{answer_index}"
                )

            ws_questions.append([row.get(header, "") for header in QUESTION_HEADERS])

        ws_settings = wb.create_sheet("Quiz Settings")
        ws_settings.append(["Field", "Value", "Description"])
        configured_settings = teky.get("settings") or {}
        settings_rows = [
            ("title", teky.get("title") or view.get("title") or "", "Tên bài kiểm tra"),
            ("description", teky.get("description") or "", "Mô tả"),
            ("coverImage", add_local_media(teky.get("coverImage"), f"{safe_title}_IMG-COVER"), "Ảnh bìa"),
            ("subject", teky.get("subject") or "", "Tên học phần"),
            ("targetLesson", teky.get("targetLesson") or "", "Tên bài học"),
            ("lessonCode", teky.get("lessonCode") or "", "Mã package"),
            ("difficultyLevel", teky.get("difficultyLevel") or "medium", "Độ khó"),
            ("tags", ", ".join(teky.get("tags") or []) if isinstance(teky.get("tags"), list) else teky.get("tags") or "", "Tags"),
            ("createdBy", teky.get("createdBy") or "", "Người tạo"),
            ("createdByName", teky.get("createdByName") or "", "Tên người tạo"),
            ("isPublic", bool(teky.get("isPublic", False)), "Công khai"),
            ("duration", int(teky.get("duration", 1800) or 0), "Thời lượng giây"),
            ("shuffleQuestions", bool(configured_settings.get("shuffleQuestions", False)), "Trộn câu"),
            ("shuffleAnswers", bool(configured_settings.get("shuffleAnswers", False)), "Trộn đáp án"),
            ("attemptLimit", int(configured_settings.get("attemptLimit", 1) or 0), "Số lần làm"),
            ("showResults", configured_settings.get("showResults", "after_submit"), "Hiện kết quả"),
            ("allowReview", bool(configured_settings.get("allowReview", True)), "Cho phép xem lại"),
            ("createdAt", teky.get("createdAt") or "", "Thời gian tạo"),
            ("updatedAt", teky.get("updatedAt") or "", "Thời gian cập nhật"),
        ]
        for setting in settings_rows:
            ws_settings.append(setting)

        if warnings:
            ws_warnings = wb.create_sheet("Export Warnings")
            ws_warnings.append(["Warning"])
            for warning in warnings:
                ws_warnings.append([warning])

        excel_buffer = io.BytesIO()
        wb.save(excel_buffer)
        zf.writestr(f"{safe_title}.xlsx", excel_buffer.getvalue())

    return Path(temp_path), safe_title
