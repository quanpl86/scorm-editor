"""Build iSpring quiz JSON from parsed Excel rows using SCORM slide templates."""

from __future__ import annotations

import copy
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from .excel_import import ExcelQuestion, resolve_media_path
from .typography import apply_text_to_node, strip_plain

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
MASTER_SCORM = PROJECT_ROOT / "DGSA_Level5_Bài 1_Thế giới 3D diệu kỳ - Huyền Diệu"
IMPORT_TEMPLATE_DIR = PROJECT_ROOT / "ImportTemplate"
SESSIONS_ROOT = Path(__file__).resolve().parent.parent / "data" / "sessions"


def _new_id() -> str:
    return f"{uuid.uuid4().hex[:12]}-{uuid.uuid4().hex[:12]}"


def _load_quiz_json(path: Path) -> dict[str, Any]:
    if path.suffix == ".json":
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    from .scorm_parser import decode_quiz_data, find_index_html

    index = find_index_html(path if path.is_dir() else path.parent)
    return decode_quiz_data(index.read_text(encoding="utf-8"))


def _find_slide(quiz: dict[str, Any], tp: str) -> dict[str, Any] | None:
    def walk(obj: Any) -> dict[str, Any] | None:
        if isinstance(obj, dict):
            if obj.get("tp") == tp:
                return obj
            for value in obj.values():
                found = walk(value)
                if found:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = walk(item)
                if found:
                    return found
        return None

    return walk(quiz)


def load_slide_templates() -> dict[str, dict[str, Any]]:
    """Load one template slide per question type from master SCORM + sessions."""
    templates: dict[str, dict[str, Any]] = {}
    if MASTER_SCORM.exists():
        quiz = _load_quiz_json(MASTER_SCORM)
        for tp in (
            "MultipleChoice",
            "MultipleResponse",
            "Sequence",
            "Matching",
            "TypeIn",
            "WordBank",
            "FillInTheBlank",
            "InfoSlide",
        ):
            slide = _find_slide(quiz, tp)
            if slide:
                templates[tp] = copy.deepcopy(slide)

    if "TrueFalse" not in templates and SESSIONS_ROOT.exists():
        for session_dir in SESSIONS_ROOT.iterdir():
            quiz_path = session_dir / "package" / "quiz_data.json"
            if not quiz_path.exists():
                continue
            quiz = _load_quiz_json(quiz_path)
            slide = _find_slide(quiz, "TrueFalse")
            if slide:
                templates["TrueFalse"] = copy.deepcopy(slide)
                break

    if "TrueFalse" not in templates and "MultipleChoice" in templates:
        templates["TrueFalse"] = copy.deepcopy(templates["MultipleChoice"])
        templates["TrueFalse"]["tp"] = "TrueFalse"

    if "InfoSlide" not in templates and "MultipleChoice" in templates:
        info = copy.deepcopy(templates["MultipleChoice"])
        info["tp"] = "InfoSlide"
        info.get("C", {}).pop("chs", None)
        templates["InfoSlide"] = info

    return templates


def _set_feedback(slide: dict[str, Any], correct: str, incorrect: str) -> None:
    slide.setdefault("s", {}).setdefault("F", {})
    for key, code, text in (
        ("correct", "c", correct),
        ("incorrect", "i", incorrect),
    ):
        if not text:
            continue
        slide["s"]["F"].setdefault(code, {"v": {}})
        node = slide["s"]["F"][code]["v"]
        apply_text_to_node(node, text, "feedback")


def _set_points(slide: dict[str, Any], points: float | None) -> None:
    if points is None:
        return
    slide.setdefault("s", {}).setdefault("e", {})["pt"] = points


def _choice_template(chs: list[dict[str, Any]]) -> dict[str, Any]:
    return copy.deepcopy(chs[0]) if chs else {"i": _new_id(), "t": {}, "c": False}


def _apply_choice_text(ch: dict[str, Any], text: str, *, is_correct: bool = False) -> None:
    ch["i"] = _new_id()
    ch["c"] = is_correct
    if isinstance(ch.get("t"), dict):
        apply_text_to_node(ch["t"], text, "content")
    else:
        ch["t"] = text


def _apply_image(slide: dict[str, Any], image_name: str) -> None:
    if not image_name:
        return
    chs = slide.get("C", {}).get("chs", [])
    if chs:
        chs[0].setdefault("ia", {})["i"] = f"storage://images/{image_name}"
        return
    for obj in slide.get("a", {}).get("o", []):
        if obj.get("I") == "content" and obj.get("tp") == "shape":
            obj.setdefault("rt", {})
            break


def _copy_image_to_package(src: Path, package_root: Path) -> str:
    images_dir = package_root / "res" / "data" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    dest_name = f"img-import-{uuid.uuid4().hex[:12]}{src.suffix.lower()}"
    shutil.copy2(src, images_dir / dest_name)
    return dest_name


def _apply_row_to_slide(
    slide: dict[str, Any],
    row: ExcelQuestion,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
) -> None:
    slide["i"] = _new_id()
    slide["tp"] = row.ispring_type
    slide.setdefault("D", {})
    apply_text_to_node(slide["D"], row.question_text, "title")
    _set_feedback(slide, row.correct_feedback, row.incorrect_feedback)
    _set_points(slide, row.points)

    image_name = None
    if row.image:
        media_src = resolve_media_path(row.image, excel_dir, fallback_media_dirs)
        if media_src and media_src.exists():
            image_name = _copy_image_to_package(media_src, package_root)

    tp = row.ispring_type
    slide.setdefault("C", {})

    if tp in ("MultipleChoice", "MultipleResponse", "TrueFalse"):
        template = _choice_template(slide["C"].get("chs", []))
        chs = []
        for ans in row.answers:
            ch = copy.deepcopy(template)
            _apply_choice_text(ch, ans.text, is_correct=ans.is_correct)
            chs.append(ch)
        slide["C"]["chs"] = chs
        if image_name and chs:
            chs[0].setdefault("ia", {})["i"] = f"storage://images/{image_name}"

    elif tp == "Sequence":
        template = _choice_template(slide["C"].get("chs", []))
        chs = []
        for i, ans in enumerate(row.answers):
            ch = copy.deepcopy(template)
            _apply_choice_text(ch, ans.text)
            ch["o"] = i
            chs.append(ch)
        slide["C"]["chs"] = chs

    elif tp == "Matching":
        pairs_tpl = slide["C"].get("m", [])
        pair_tpl = copy.deepcopy(pairs_tpl[0]) if pairs_tpl else {
            "p": {"i": _new_id(), "t": {}},
            "r": {"i": _new_id(), "t": {}},
        }
        pairs = []
        for ans in row.answers:
            if not ans.premise or not ans.response:
                continue
            pair = copy.deepcopy(pair_tpl)
            pair["p"]["i"] = _new_id()
            pair["r"]["i"] = _new_id()
            apply_text_to_node(pair["p"]["t"], ans.premise, "content")
            apply_text_to_node(pair["r"]["t"], ans.response, "content")
            pairs.append(pair)
        slide["C"]["m"] = pairs

    elif tp == "TypeIn":
        slide["C"]["chs"] = [
            {"i": _new_id(), "t": ans.text}
            for ans in row.answers
            if ans.text
        ]

    elif tp == "WordBank":
        words = [ans.text for ans in row.answers if ans.text]
        slide["C"]["ew"] = words
        rt = slide["C"].setdefault("rt", {})
        blank_id = re.search(r'id="(qmWordBank\d+)"', rt.get("h", ""))
        blank_span = (
            f'<span id="{blank_id.group(1)}"></span>'
            if blank_id
            else '<span id="qmWordBank0"></span>'
        )
        html = (
            f'<p style="font-size:18px;font-family:fnt5_24031;color:#000000">'
            f'<span>{row.question_text}</span>​{blank_span}​</p>'
        )
        apply_text_to_node(rt, strip_plain(row.question_text), "content")
        rt["h"] = html

    elif tp == "FillInTheBlank":
        rt = slide["C"].setdefault("rt", {})
        blank_id = re.search(r'id="(qmFillInTheBlank\d+)"', rt.get("h", ""))
        blank_span = (
            f'<span id="{blank_id.group(1)}"></span>'
            if blank_id
            else '<span id="qmFillInTheBlank0"></span>'
        )
        answers = [ans.text for ans in row.answers if ans.text]
        extra = f" {answers[0]}" if answers else ""
        html = (
            f'<p style="font-size:18px;font-family:fnt5_24031;color:#000000">'
            f'​{blank_span}​<span>{row.question_text}{extra}</span></p>'
        )
        apply_text_to_node(rt, strip_plain(row.question_text), "content")
        rt["h"] = html

    elif tp == "InfoSlide":
        body = row.answers[0].text if row.answers else row.question_text
        slide.setdefault("D", {})
        apply_text_to_node(slide["D"], body, "content")

    if image_name:
        _apply_image(slide, image_name)


def build_quiz_from_excel(
    quiz_json: dict[str, Any],
    rows: list[ExcelQuestion],
    *,
    package_root: Path,
    excel_dir: Path,
    group_title: str = "Imported Questions",
    quiz_title: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Inject parsed Excel rows into quiz JSON (adds a new question group).
    Returns (updated_quiz, import_report).
    """
    templates = load_slide_templates()
    fallback_dirs = [IMPORT_TEMPLATE_DIR, excel_dir, PROJECT_ROOT]
    report: list[dict[str, Any]] = []
    new_slides: list[dict[str, Any]] = []

    for row in rows:
        if row.errors:
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "error",
                "errors": row.errors,
            })
            continue

        if row.ispring_type == "Numeric":
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "skipped",
                "errors": ["Numeric chưa hỗ trợ import"],
            })
            continue

        template = templates.get(row.ispring_type)
        if not template:
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "error",
                "errors": [f"Không có slide mẫu cho {row.ispring_type}"],
            })
            continue

        slide = copy.deepcopy(template)
        try:
            _apply_row_to_slide(
                slide,
                row,
                package_root=package_root,
                excel_dir=excel_dir,
                fallback_media_dirs=fallback_dirs,
            )
            new_slides.append(slide)
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "imported",
                "slideId": slide["i"],
                "question": row.question_text[:80],
            })
        except Exception as exc:
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "error",
                "errors": [str(exc)],
            })

    quiz = copy.deepcopy(quiz_json)
    if quiz_title:
        quiz.setdefault("d", {})["T"] = quiz_title

    groups = quiz.setdefault("d", {}).setdefault("sl", {}).setdefault("g", [])
    groups.insert(0, {"T": group_title, "S": new_slides})

    return quiz, report