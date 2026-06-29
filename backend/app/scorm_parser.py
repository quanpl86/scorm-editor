"""SCORM package extraction, quiz decode/encode, and zip export."""

from __future__ import annotations

import base64
import html
import io
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .fonts import extract_font_manifest
from .layout import apply_question_layout_edit, extract_layout
from .typography import (
    apply_html_to_node,
    apply_text_to_node,
    build_styled_html,
    extract_text_format,
    should_apply_text,
    strip_plain,
)

SESSIONS_ROOT = Path(__file__).resolve().parent.parent / "data" / "sessions"


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(text))).strip()


def wrap_html(text: str, template: str | None = None, role: str = "content") -> str:
    if not text:
        return ""
    if "<" in text and ">" in text and not template:
        return text
    if template and "{{TEXT}}" in template:
        return template.replace("{{TEXT}}", html.escape(text))
    if template and "<" in template:
        return build_styled_html(text, "title" if role == "title" else "content")
    return build_styled_html(text, "title" if role == "title" else "content")


def extract_scorm_package(source: Path, dest: Path) -> Path:
    """Extract SCORM zip (handles nested zip wrapper) into dest."""
    dest.mkdir(parents=True, exist_ok=True)

    if source.is_dir():
        for item in source.iterdir():
            target = dest / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)
        package_root = dest
    else:
        with zipfile.ZipFile(source, "r") as zf:
            names = zf.namelist()
            if len(names) == 1 and names[0].lower().endswith(".zip"):
                inner_bytes = zf.read(names[0])
                with zipfile.ZipFile(io.BytesIO(inner_bytes), "r") as inner:
                    inner.extractall(dest)
            else:
                zf.extractall(dest)
        package_root = dest

    manifest = package_root / "imsmanifest.xml"
    if not manifest.exists():
        for candidate in package_root.rglob("imsmanifest.xml"):
            package_root = candidate.parent
            break
        else:
            raise ValueError("Không tìm thấy imsmanifest.xml trong gói SCORM")

    return package_root


def find_index_html(package_root: Path) -> Path:
    for candidate in [package_root / "res" / "index.html", package_root / "index.html"]:
        if candidate.exists():
            return candidate
    found = list(package_root.rglob("index.html"))
    if not found:
        raise ValueError("Không tìm thấy index.html")
    return found[0]


def decode_quiz_data(index_html: str) -> dict[str, Any]:
    match = re.search(r'var data = "([^"]+)"', index_html)
    if not match:
        raise ValueError("Không tìm thấy dữ liệu quiz (var data) trong index.html")
    return json.loads(base64.b64decode(match.group(1)).decode("utf-8"))


def encode_quiz_data(quiz_json: dict[str, Any]) -> str:
    raw = json.dumps(quiz_json, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def replace_quiz_data(index_html: str, quiz_json: dict[str, Any]) -> str:
    encoded = encode_quiz_data(quiz_json)
    return re.sub(
        r'var data = "[^"]*"',
        f'var data = "{encoded}"',
        index_html,
        count=1,
    )


def image_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    match = re.search(r"storage://images/(.+)", storage_uri)
    return match.group(1) if match else None


def get_feedback(slide: dict[str, Any]) -> dict[str, Any]:
    fields = {"correct": "c", "incorrect": "i", "attempt": "at", "partial": "pc", "any": "a"}
    result: dict[str, Any] = {"formats": {}}
    feedback = slide.get("s", {}).get("F", {})
    for key, code in fields.items():
        node = feedback.get(code, {}).get("v", {})
        text = strip_html(node.get("h") or node.get("a") or "")
        result[key] = text
        if text:
            result["formats"][key] = extract_text_format(node.get("h", ""), None, "feedback")
    return result


def set_feedback(slide: dict[str, Any], feedback: dict[str, Any]) -> None:
    fields = {"correct": "c", "incorrect": "i", "attempt": "at", "partial": "pc", "any": "a"}
    if "s" not in slide:
        slide["s"] = {}
    if "F" not in slide["s"]:
        slide["s"]["F"] = {}
    formats = feedback.get("formats") or {}
    for key, code in fields.items():
        text = feedback.get(key, "")
        if not text:
            continue
        if code not in slide["s"]["F"]:
            slide["s"]["F"][code] = {"v": {}}
        node = slide["s"]["F"][code]["v"]
        f_fmt = formats.get(key)
        if should_apply_text(node, text, f_fmt, "feedback"):
            apply_text_to_node(node, text, "feedback", f_fmt)


def extract_choices(slide: dict[str, Any]) -> list[dict[str, Any]]:
    choices = []
    chs = slide.get("C", {}).get("chs", [])
    for ch in chs:
        if isinstance(ch.get("t"), dict):
            text = strip_html(ch["t"].get("h") or ch["t"].get("a") or "")
        else:
            text = str(ch.get("t", ""))
        t_node = ch.get("t") if isinstance(ch.get("t"), dict) else {}
        choices.append(
            {
                "id": ch.get("i", ""),
                "text": text,
                "format": extract_text_format(t_node.get("h", ""), t_node.get("t"), "content"),
                "image": image_path_from_storage((ch.get("ia") or {}).get("i", "")),
                "isCorrect": bool(ch.get("c")),
            }
        )
    return choices


def apply_choices(slide: dict[str, Any], choices: list[dict[str, Any]]) -> None:
    if "C" not in slide:
        slide["C"] = {}
    chs = slide["C"].get("chs", [])
    by_id = {ch.get("i"): ch for ch in chs}
    new_chs = []
    for choice in choices:
        ch = by_id.get(choice["id"], {"i": choice["id"], "t": {}, "ia": {}})
        if isinstance(ch.get("t"), dict):
            if choice.get("html"):
                text = choice.get("text", "")
                if should_apply_text(ch["t"], text, choice.get("format"), "content") or (
                    ch["t"].get("h") != choice["html"]
                ):
                    apply_html_to_node(ch["t"], choice["html"], text, "content")
            else:
                c_fmt = choice.get("format")
                if should_apply_text(ch["t"], choice.get("text", ""), c_fmt, "content"):
                    apply_text_to_node(ch["t"], choice["text"], "content", c_fmt)
        else:
            ch["t"] = choice["text"]
        if choice.get("image"):
            ch.setdefault("ia", {})
            ch["ia"]["i"] = f"storage://images/{choice['image']}"
        ch["c"] = bool(choice.get("isCorrect"))
        new_chs.append(ch)
    slide["C"]["chs"] = new_chs


def extract_matching_pairs(slide: dict[str, Any]) -> list[dict[str, Any]]:
    pairs = []
    for item in slide.get("C", {}).get("m", []):
        left = item.get("p", {})
        right = item.get("r", {})
        pairs.append(
            {
                "leftText": strip_html((left.get("t") or {}).get("h", "")),
                "leftImage": image_path_from_storage((left.get("ia") or {}).get("i", "")),
                "rightText": strip_html((right.get("t") or {}).get("h", "")),
                "rightImage": image_path_from_storage((right.get("ia") or {}).get("i", "")),
            }
        )
    return pairs


def extract_sequence_items(slide: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for ch in slide.get("C", {}).get("chs", []):
        items.append(
            {
                "id": ch.get("i", ""),
                "text": strip_html((ch.get("t") or {}).get("h", "")),
                "order": ch.get("o", len(items)),
            }
        )
    return sorted(items, key=lambda x: x.get("order", 0))


def extract_type_in_answers(slide: dict[str, Any]) -> list[str]:
    answers = []
    for ch in slide.get("C", {}).get("chs", []):
        text = ch.get("t", "")
        if isinstance(text, str) and text.strip():
            answers.append(text.strip())
    return answers


def extract_slide_images(slide: dict[str, Any]) -> list[str]:
    images = set()
    raw = json.dumps(slide, ensure_ascii=False)
    for match in re.finditer(r"storage://images/([^\"]+)", raw):
        images.add(match.group(1))
    return sorted(images)


def editable_level(question_type: str) -> str:
    full = {"MultipleChoice", "MultipleResponse", "MultipleChoiceText", "TypeIn"}
    partial = {"Matching", "Sequence", "WordBank", "FillInTheBlank", "TrueFalse"}
    if question_type in full:
        return "full"
    if question_type in partial:
        return "partial"
    return "readonly"


def detect_result_kind(slide: dict[str, Any], index: int) -> str:
    for obj in slide.get("a", {}).get("o", []):
        if obj.get("tp") == "iconPlaceholder":
            icon_id = obj.get("I", "")
            if icon_id in ("passed", "failed"):
                return icon_id
    return "passed" if index == 0 else "failed"


def special_slide_to_view(
    slide: dict[str, Any],
    *,
    slide_role: str,
    result_kind: str | None = None,
    result_index: int = 0,
) -> dict[str, Any]:
    qtype = slide.get("tp", "Unknown")
    question_text = strip_html(slide.get("D", {}).get("h", ""))
    subtitle_text = ""
    subtitle_format = None
    if qtype == "IntroSlide":
        rt = slide.get("C", {}).get("rt", {})
        subtitle_text = strip_html(rt.get("h") or rt.get("a") or "")
        if subtitle_text:
            subtitle_format = extract_text_format(rt.get("h", ""), rt.get("t"), "content")

    view: dict[str, Any] = {
        "id": slide.get("i", ""),
        "type": qtype,
        "slideRole": slide_role,
        "resultKind": result_kind,
        "resultIndex": result_index,
        "groupIndex": -1,
        "questionIndex": -1,
        "groupTitle": "",
        "questionText": question_text,
        "questionFormat": extract_text_format(
            slide.get("D", {}).get("h", ""), slide.get("D", {}).get("t"), "title"
        ),
        "subtitleText": subtitle_text,
        "subtitleFormat": subtitle_format,
        "feedback": {"formats": {}},
        "choices": [],
        "matchingPairs": [],
        "sequenceItems": [],
        "typeInAnswers": [],
        "slideImages": extract_slide_images(slide),
        "editableLevel": "full",
        "points": 0,
        "timeLimit": 0,
        "layout": extract_layout(slide),
    }
    return view


def extract_intro_slide(quiz_json: dict[str, Any]) -> dict[str, Any] | None:
    intro = quiz_json.get("d", {}).get("sl", {}).get("i")
    if not intro or intro.get("tp") != "IntroSlide":
        return None
    return special_slide_to_view(intro, slide_role="intro")


def extract_result_slides(quiz_json: dict[str, Any]) -> list[dict[str, Any]]:
    results = []
    for index, slide in enumerate(quiz_json.get("d", {}).get("sl", {}).get("r", {}).get("g", [])):
        if slide.get("tp") != "ResultSlide":
            continue
        kind = detect_result_kind(slide, index)
        results.append(
            special_slide_to_view(slide, slide_role="result", result_kind=kind, result_index=index)
        )
    return results


def apply_special_slide_edit(slide: dict[str, Any], edit: dict[str, Any]) -> None:
    slide.setdefault("D", {})
    if edit.get("questionHtml"):
        text = edit.get("questionText") or strip_html(edit["questionHtml"])
        if should_apply_text(slide["D"], text, edit.get("questionFormat"), "title") or (
            slide["D"].get("h") != edit["questionHtml"]
        ):
            apply_html_to_node(slide["D"], edit["questionHtml"], text, "title")
    elif edit.get("questionText") is not None:
        text = edit.get("questionText")
        q_fmt = edit.get("questionFormat") if edit.get("questionFormat") is not None else extract_text_format(
            slide["D"].get("h", ""), slide["D"].get("t"), "title"
        )
        if should_apply_text(slide["D"], text, q_fmt, "title"):
            apply_text_to_node(slide["D"], text, "title", q_fmt)
    elif edit.get("questionFormat") is not None:
        text = strip_html(slide["D"].get("h", ""))
        if should_apply_text(slide["D"], text, edit["questionFormat"], "title"):
            apply_text_to_node(slide["D"], text, "title", edit["questionFormat"])

    if slide.get("tp") == "IntroSlide" and edit.get("subtitleHtml"):
        slide.setdefault("C", {})
        slide["C"].setdefault("rt", {})
        rt = slide["C"]["rt"]
        sub_text = edit.get("subtitleText") or strip_html(edit["subtitleHtml"])
        if should_apply_text(rt, sub_text, edit.get("subtitleFormat"), "content") or (
            rt.get("h") != edit["subtitleHtml"]
        ):
            apply_html_to_node(rt, edit["subtitleHtml"], sub_text, "content")
    elif slide.get("tp") == "IntroSlide" and edit.get("subtitleText") is not None:
        slide.setdefault("C", {})
        slide["C"].setdefault("rt", {})
        rt = slide["C"]["rt"]
        sub_text = edit.get("subtitleText")
        if sub_text is None:
            sub_text = strip_html(rt.get("h", ""))
        sub_fmt = edit.get("subtitleFormat") if edit.get("subtitleFormat") is not None else extract_text_format(
            rt.get("h", ""), rt.get("t"), "content"
        )
        if should_apply_text(rt, sub_text, sub_fmt, "content"):
            apply_text_to_node(rt, sub_text, "content", sub_fmt)
    elif slide.get("tp") == "IntroSlide" and edit.get("subtitleFormat") is not None:
        rt = slide.get("C", {}).get("rt", {})
        sub_text = strip_html(rt.get("h", ""))
        if should_apply_text(rt, sub_text, edit["subtitleFormat"], "content"):
            apply_text_to_node(rt, sub_text, "content", edit["subtitleFormat"])

    if edit.get("layout"):
        apply_question_layout_edit(slide, edit)


def slide_to_view(slide: dict[str, Any], group_index: int, question_index: int, group_title: str) -> dict[str, Any]:
    qtype = slide.get("tp", "Unknown")
    question_text = strip_html(slide.get("D", {}).get("h", ""))
    points = slide.get("s", {}).get("e", {}).get("pt", 1)
    time_limit = slide.get("s", {}).get("t", {}).get("v", 0)

    view: dict[str, Any] = {
        "id": slide.get("i", ""),
        "type": qtype,
        "slideRole": "question",
        "resultKind": None,
        "resultIndex": -1,
        "subtitleText": "",
        "subtitleFormat": None,
        "groupIndex": group_index,
        "questionIndex": question_index,
        "groupTitle": group_title,
        "questionText": question_text,
        "questionFormat": extract_text_format(
            slide.get("D", {}).get("h", ""), slide.get("D", {}).get("t"), "title"
        ),
        "feedback": get_feedback(slide),
        "choices": [],
        "matchingPairs": [],
        "sequenceItems": [],
        "typeInAnswers": [],
        "slideImages": extract_slide_images(slide),
        "editableLevel": editable_level(qtype),
        "points": points,
        "timeLimit": time_limit,
    }

    if qtype in {"MultipleChoice", "MultipleResponse", "MultipleChoiceText"}:
        view["choices"] = extract_choices(slide)
    elif qtype == "Matching":
        view["matchingPairs"] = extract_matching_pairs(slide)
    elif qtype == "Sequence":
        view["sequenceItems"] = extract_sequence_items(slide)
    elif qtype == "TypeIn":
        view["typeInAnswers"] = extract_type_in_answers(slide)

    view["layout"] = extract_layout(slide)

    return view


def quiz_to_view(quiz_json: dict[str, Any]) -> dict[str, Any]:
    groups = quiz_json.get("d", {}).get("sl", {}).get("g", [])
    questions = []
    for gi, group in enumerate(groups):
        title = group.get("T", f"Nhóm {gi + 1}")
        for qi, slide in enumerate(group.get("S", [])):
            questions.append(slide_to_view(slide, gi, qi, title))

    passing = 80
    try:
        passing = quiz_json["d"]["sl"]["r"]["g"][0]["C"]["Rs"]["ps"]["v"]
    except (KeyError, TypeError, IndexError):
        pass

    intro_slide = extract_intro_slide(quiz_json)
    result_slides = extract_result_slides(quiz_json)

    return {
        "title": quiz_json.get("d", {}).get("T", "Untitled Quiz"),
        "passingScore": passing,
        "groups": [{"title": g.get("T", ""), "questionCount": len(g.get("S", []))} for g in groups],
        "introSlide": intro_slide,
        "resultSlides": result_slides,
        "questions": questions,
        "questionCount": len(questions),
        "ispringVersion": None,
    }


def apply_question_edit(slide: dict[str, Any], edit: dict[str, Any]) -> None:
    slide.setdefault("D", {})
    if edit.get("questionHtml"):
        text = edit.get("questionText") or strip_html(edit["questionHtml"])
        if should_apply_text(slide["D"], text, edit.get("questionFormat"), "title") or (
            slide["D"].get("h") != edit["questionHtml"]
        ):
            apply_html_to_node(slide["D"], edit["questionHtml"], text, "title")
    elif edit.get("questionText") is not None:
        text = edit.get("questionText")
        q_fmt = edit.get("questionFormat") if edit.get("questionFormat") is not None else extract_text_format(
            slide["D"].get("h", ""), slide["D"].get("t"), "title"
        )
        if should_apply_text(slide["D"], text, q_fmt, "title"):
            apply_text_to_node(slide["D"], text, "title", q_fmt)
    elif edit.get("questionFormat") is not None:
        text = strip_html(slide["D"].get("h", ""))
        if should_apply_text(slide["D"], text, edit["questionFormat"], "title"):
            apply_text_to_node(slide["D"], text, "title", edit["questionFormat"])

    if edit.get("feedback"):
        set_feedback(slide, edit["feedback"])

    if edit.get("choices") is not None and slide.get("tp") in {
        "MultipleChoice",
        "MultipleResponse",
        "MultipleChoiceText",
    }:
        apply_choices(slide, edit["choices"])

    if edit.get("typeInAnswers") is not None and slide.get("tp") == "TypeIn":
        slide.setdefault("C", {})
        slide["C"]["chs"] = [
            {"i": f"ans-{idx}", "t": ans} for idx, ans in enumerate(edit["typeInAnswers"]) if ans.strip()
        ]

    if edit.get("layout"):
        apply_question_layout_edit(slide, edit)


def apply_quiz_meta(quiz_json: dict[str, Any], meta: dict[str, Any]) -> None:
    if meta.get("title"):
        quiz_json.setdefault("d", {})["T"] = meta["title"]
    if meta.get("passingScore") is not None:
        try:
            quiz_json["d"]["sl"]["r"]["g"][0]["C"]["Rs"]["ps"]["v"] = int(meta["passingScore"])
            quiz_json["d"]["sl"]["r"]["g"][1]["C"]["Rs"]["ps"]["v"] = int(meta["passingScore"])
        except (KeyError, TypeError, IndexError):
            pass


def delete_question(quiz_json: dict[str, Any], group_index: int, question_index: int) -> None:
    groups = quiz_json["d"]["sl"]["g"]
    slides = groups[group_index]["S"]
    if question_index < 0 or question_index >= len(slides):
        raise IndexError("Câu hỏi không tồn tại")
    del slides[question_index]


def parse_manifest_meta(manifest_path: Path) -> dict[str, str]:
    tree = ET.parse(manifest_path)
    root = tree.getroot()
    ns = {"lom": "http://www.imsglobal.org/xsd/imsmd_rootv1p2p1"}
    title = ""
    lang = root.find(".//lom:langstring", ns)
    if lang is not None and lang.text:
        title = lang.text
    org_title = root.find(".//{http://www.imsproject.org/xsd/imscp_rootv1p1p2}title")
    if org_title is not None and org_title.text:
        title = org_title.text
    schema = root.find(".//{http://www.imsproject.org/xsd/imscp_rootv1p1p2}schemaversion")
    return {
        "manifestTitle": title,
        "schemaVersion": schema.text if schema is not None else "1.2",
    }


def update_manifest_title(manifest_path: Path, title: str) -> None:
    content = manifest_path.read_text(encoding="utf-8")
    content = re.sub(
        r"(<lom:langstring[^>]*>)(.*?)(</lom:langstring>)",
        lambda m: f"{m.group(1)}{title}{m.group(3)}",
        content,
        count=1,
    )
    content = re.sub(
        r"(<organization[^>]*>\s*<title>)(.*?)(</title>)",
        lambda m: f"{m.group(1)}{title}{m.group(3)}",
        content,
        count=1,
        flags=re.DOTALL,
    )
    manifest_path.write_text(content, encoding="utf-8")


def export_scorm_zip(package_root: Path, quiz_json: dict[str, Any], title: str | None = None) -> bytes:
    index_path = find_index_html(package_root)
    index_html = index_path.read_text(encoding="utf-8")
    index_path.write_text(replace_quiz_data(index_html, quiz_json), encoding="utf-8")

    manifest_path = package_root / "imsmanifest.xml"
    if title and manifest_path.exists():
        update_manifest_title(manifest_path, title)
        title_tag = re.search(r"<title>(.*?)</title>", index_path.read_text(encoding="utf-8"))
        if title_tag:
            content = index_path.read_text(encoding="utf-8")
            content = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", content, count=1)
            index_path.write_text(content, encoding="utf-8")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in package_root.rglob("*"):
            if file_path.is_file() and file_path.name != ".DS_Store":
                arcname = file_path.relative_to(package_root).as_posix()
                zf.write(file_path, arcname)
    return buffer.getvalue()


class ScormSession:
    def __init__(self, session_id: str, package_root: Path):
        self.session_id = session_id
        self.package_root = package_root
        self.index_path = find_index_html(package_root)
        self.manifest_path = package_root / "imsmanifest.xml"
        index_html = self.index_path.read_text(encoding="utf-8")
        self.index_html_template = index_html
        self.quiz_json = decode_quiz_data(index_html)
        self.meta = parse_manifest_meta(self.manifest_path) if self.manifest_path.exists() else {}

    @classmethod
    def create_from_source(cls, source: Path) -> "ScormSession":
        session_id = str(uuid.uuid4())
        session_dir = SESSIONS_ROOT / session_id
        package_root = extract_scorm_package(source, session_dir / "package")
        return cls(session_id, package_root)

    def get_fonts(self) -> dict[str, Any]:
        return extract_font_manifest(self.quiz_json, self.package_root)

    def get_view(self) -> dict[str, Any]:
        view = quiz_to_view(self.quiz_json)
        view["sessionId"] = self.session_id
        view["manifestTitle"] = self.meta.get("manifestTitle", "")
        view["fonts"] = self.get_fonts()
        if not view["title"] or view["title"] == "Untitled Quiz":
            view["title"] = view["manifestTitle"] or view["title"]
        return view

    def save_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        apply_quiz_meta(
            self.quiz_json,
            {"title": payload.get("title"), "passingScore": payload.get("passingScore")},
        )
        intro_edit = payload.get("introSlide")
        intro = self.quiz_json.get("d", {}).get("sl", {}).get("i")
        if intro_edit and intro:
            apply_special_slide_edit(intro, intro_edit)

        result_edits = {r["id"]: r for r in payload.get("resultSlides", []) if r.get("id")}
        for slide in self.quiz_json.get("d", {}).get("sl", {}).get("r", {}).get("g", []):
            sid = slide.get("i")
            if sid in result_edits:
                apply_special_slide_edit(slide, result_edits[sid])

        questions = {q["id"]: q for q in payload.get("questions", [])}
        groups = self.quiz_json["d"]["sl"]["g"]
        for gi, group in enumerate(groups):
            new_slides = []
            for slide in group.get("S", []):
                sid = slide.get("i")
                if sid in questions and questions[sid].get("deleted"):
                    continue
                if sid in questions:
                    apply_question_edit(slide, questions[sid])
                new_slides.append(slide)
            group["S"] = new_slides
        self.persist()
        return self.get_view()

    def persist(self) -> None:
        quiz_path = self.package_root / "quiz_data.json"
        quiz_path.write_text(json.dumps(self.quiz_json, ensure_ascii=False, indent=2), encoding="utf-8")
        self.index_path.write_text(replace_quiz_data(self.index_html_template, self.quiz_json), encoding="utf-8")

    def asset_path(self, relative: str) -> Path:
        safe = Path(relative).name
        for folder in ["res/data/images", "data/images", "images"]:
            candidate = self.package_root / folder / safe
            if candidate.exists():
                return candidate
        raise FileNotFoundError(safe)

    def replace_image(self, filename: str, content: bytes) -> str:
        for folder in ["res/data/images", "data/images", "images"]:
            target_dir = self.package_root / folder
            if target_dir.exists():
                path = target_dir / Path(filename).name
                path.write_bytes(content)
                return path.name
        target_dir = self.package_root / "res" / "data" / "images"
        target_dir.mkdir(parents=True, exist_ok=True)
        path = target_dir / Path(filename).name
        path.write_bytes(content)
        return path.name

    def export_zip(self, title: str | None = None) -> bytes:
        self.persist()
        export_title = title or self.quiz_json.get("d", {}).get("T")
        return export_scorm_zip(self.package_root, self.quiz_json, export_title)


def get_session(session_id: str) -> ScormSession:
    package_root = SESSIONS_ROOT / session_id / "package"
    if not package_root.exists():
        raise FileNotFoundError("Session không tồn tại")
    session = ScormSession(session_id, package_root)
    saved = package_root / "quiz_data.json"
    if saved.exists():
        session.quiz_json = json.loads(saved.read_text(encoding="utf-8"))
    return session