"""SCORM package extraction, quiz decode/encode, and zip export."""

from __future__ import annotations

import base64
import html
import io
import json
import os
import re
import shutil
import struct
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from .fonts import extract_font_manifest
from .layout import apply_question_layout_edit, extract_layout, image_path_from_html
from .typography import (
    apply_html_to_node,
    apply_text_to_node,
    build_styled_html,
    extract_text_format,
    should_apply_text,
    strip_plain,
)

SESSIONS_ROOT = Path(__file__).resolve().parent.parent / "data" / "sessions"

IMAGE_FOLDERS = ("res/data/images", "data/images", "images")
AUDIO_FOLDERS = ("res/data/audios", "data/audios", "audios")
VIDEO_FOLDERS = ("res/data/videos", "data/videos", "videos")

MIME_BY_EXT: dict[str, str] = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}


def image_dimensions(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        pass
    if path.suffix.lower() == ".png" and path.is_file():
        with path.open("rb") as handle:
            handle.seek(16)
            return struct.unpack(">II", handle.read(8))
    if path.suffix.lower() in {".jpg", ".jpeg"} and path.is_file():
        with path.open("rb") as handle:
            handle.seek(2)
            while True:
                marker = handle.read(2)
                if len(marker) < 2 or marker[0] != 0xFF:
                    break
                if marker[1] in (0xC0, 0xC1, 0xC2):
                    handle.read(3)
                    h, w = struct.unpack(">HH", handle.read(4))
                    return w, h
                length = struct.unpack(">H", handle.read(2))[0]
                handle.seek(length - 2, os.SEEK_CUR)
    return 800, 600


def ensure_image_registry(quiz_json: dict[str, Any], package_root: Path) -> None:
    """Register uploaded images in rs.i so iSpring player can render them."""
    registry = quiz_json.setdefault("rs", {}).setdefault("i", {})
    raw = json.dumps(quiz_json, ensure_ascii=False)
    for match in re.finditer(r"storage://images/([^\"'\s>]+)", raw):
        filename = match.group(1)
        storage_key = f"storage://images/{filename}"
        if storage_key in registry:
            continue
        image_path = None
        for folder in IMAGE_FOLDERS:
            candidate = package_root / folder / filename
            if candidate.is_file():
                image_path = candidate
                break
        if not image_path:
            continue
        width, height = image_dimensions(image_path)
        registry[storage_key] = {
            "s": f"data\\images\\{filename}",
            "v": width,
            "h": height,
        }


def _resolve_package_file(filename: str, package_root: Path, folders: tuple[str, ...]) -> Path | None:
    safe = Path(filename).name
    for folder in folders:
        candidate = package_root / folder / safe
        if candidate.is_file():
            return candidate
    return None


def ensure_audio_registry(quiz_json: dict[str, Any], package_root: Path) -> None:
    """Register audio files referenced as storage://sounds/... in rs.a."""
    registry = quiz_json.setdefault("rs", {}).setdefault("a", {})
    raw = json.dumps(quiz_json, ensure_ascii=False)
    for match in re.finditer(r"storage://sounds/([^\"'\s>]+)", raw):
        filename = match.group(1)
        storage_key = f"storage://sounds/{filename}"
        if storage_key in registry:
            continue
        audio_path = _resolve_package_file(filename, package_root, AUDIO_FOLDERS)
        if not audio_path:
            continue
        mime = MIME_BY_EXT.get(audio_path.suffix.lower(), "audio/mpeg")
        registry[storage_key] = [{"m": mime, "s": f"data\\audios\\{filename}"}]


def ensure_video_registry(quiz_json: dict[str, Any], package_root: Path) -> None:
    """Register video files referenced as storage://videos/... in rs.v."""
    registry = quiz_json.setdefault("rs", {}).setdefault("v", {})
    raw = json.dumps(quiz_json, ensure_ascii=False)
    for match in re.finditer(r"storage://videos/([^\"'\s>]+)", raw):
        filename = match.group(1)
        storage_key = f"storage://videos/{filename}"
        if storage_key in registry:
            continue
        video_path = _resolve_package_file(filename, package_root, VIDEO_FOLDERS)
        if not video_path:
            continue
        mime = MIME_BY_EXT.get(video_path.suffix.lower(), "video/mp4")
        registry[storage_key] = [{"m": mime, "s": f"data\\videos\\{filename}"}]


def ensure_media_registry(quiz_json: dict[str, Any], package_root: Path) -> None:
    """Register images, audio, and video assets used in quiz JSON."""
    ensure_image_registry(quiz_json, package_root)
    ensure_audio_registry(quiz_json, package_root)
    ensure_video_registry(quiz_json, package_root)


def atomic_write_text(path: Path, content: str) -> None:
    """Write file atomically so concurrent readers never see partial content."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def get_package_root(session_id: str) -> Path:
    package_root = SESSIONS_ROOT / session_id / "package"
    if not package_root.exists():
        raise FileNotFoundError("Session không tồn tại")
    return package_root


def resolve_asset_path(session_id: str, filename: str) -> Path:
    package_root = get_package_root(session_id)
    safe = Path(filename).name
    for folder in (*IMAGE_FOLDERS, *AUDIO_FOLDERS, *VIDEO_FOLDERS):
        candidate = package_root / folder / safe
        if candidate.exists():
            return candidate
    raise FileNotFoundError(safe)


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


def sound_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    match = re.search(r"storage://sounds/(.+)", storage_uri)
    return match.group(1) if match else None


def video_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    match = re.search(r"storage://videos/(.+)", storage_uri)
    return match.group(1) if match else None


def _rich_inline_media(v_node: dict[str, Any]) -> tuple[str | None, str | None]:
    image_name = None
    video_name = None
    for item in v_node.get("r", []) or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "image":
            image_name = image_path_from_storage(item.get("assetId", "")) or image_name
        elif item.get("type") == "video":
            video_name = video_path_from_storage(item.get("assetId", "")) or video_name
    return image_name, video_name


def get_feedback(slide: dict[str, Any]) -> dict[str, Any]:
    fields = {"correct": "c", "incorrect": "i", "attempt": "at", "partial": "pc", "any": "a"}
    result: dict[str, Any] = {"formats": {}}
    feedback = slide.get("s", {}).get("F", {})
    for key, code in fields.items():
        block = feedback.get(code, {})
        node = block.get("v", {})
        text = strip_html(node.get("h") or node.get("a") or "")
        result[key] = text
        if text:
            result["formats"][key] = extract_text_format(node.get("h", ""), None, "feedback")
        audio_name = sound_path_from_storage((block.get("a") or {}).get("i", ""))
        if audio_name:
            result[f"{key}Audio"] = audio_name
        inline_image, inline_video = _rich_inline_media(node)
        if inline_image:
            result[f"{key}Image"] = inline_image
        if inline_video:
            result[f"{key}Video"] = inline_video
    return result


def set_feedback(slide: dict[str, Any], feedback: dict[str, Any]) -> None:
    from .media_rich import audio_attachment, embed_rich_image, embed_rich_video

    fields = {"correct": "c", "incorrect": "i", "attempt": "at", "partial": "pc", "any": "a"}
    if "s" not in slide:
        slide["s"] = {}
    if "F" not in slide["s"]:
        slide["s"]["F"] = {}
    formats = feedback.get("formats") or {}
    for key, code in fields.items():
        text = feedback.get(key, "")
        audio_name = feedback.get(f"{key}Audio")
        image_name = feedback.get(f"{key}Image")
        video_name = feedback.get(f"{key}Video")
        if not any((text, audio_name, image_name, video_name)):
            continue

        block = slide["s"]["F"].setdefault(code, {})
        node = block.setdefault("v", {})
        if text or image_name or video_name:
            node.pop("r", None)

        f_fmt = formats.get(key)
        if text and should_apply_text(node, text, f_fmt, "feedback"):
            apply_text_to_node(node, text, "feedback", f_fmt)
        elif image_name or video_name:
            node.setdefault("h", "")
            node.setdefault("d", [])
            node.setdefault("t", {})

        if image_name:
            embed_rich_image(node, image_name)
        if video_name:
            poster = image_name
            if poster:
                embed_rich_video(node, video_name, poster)
        if audio_name:
            block["a"] = audio_attachment(audio_name)
        elif "a" in block and not audio_name:
            block.pop("a", None)


def extract_choices(slide: dict[str, Any]) -> list[dict[str, Any]]:
    choices = []
    chs = slide.get("C", {}).get("chs", [])
    for ch in chs:
        if isinstance(ch.get("t"), dict):
            text = strip_html(ch["t"].get("h") or ch["t"].get("a") or "")
        else:
            text = str(ch.get("t", ""))
        t_node = ch.get("t") if isinstance(ch.get("t"), dict) else {}
        choice_html = t_node.get("h") or t_node.get("a") or ""
        choice_image = image_path_from_storage((ch.get("ia") or {}).get("i", ""))
        if not choice_image:
            choice_image = image_path_from_html(choice_html)
        choice_audio = sound_path_from_storage((ch.get("f") or {}).get("a", {}).get("i", ""))
        _, choice_video = _rich_inline_media(t_node)
        choices.append(
            {
                "id": ch.get("i", ""),
                "text": text,
                "html": choice_html,
                "format": extract_text_format(t_node.get("h", ""), t_node.get("t"), "content"),
                "image": choice_image,
                "audio": choice_audio,
                "video": choice_video,
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
        else:
            ch.pop("ia", None)

        from .media_rich import audio_attachment, embed_rich_image, embed_rich_video

        if choice.get("audio"):
            ch["f"] = {"a": audio_attachment(choice["audio"])}
        else:
            ch.pop("f", None)

        if choice.get("video") and choice.get("image"):
            if isinstance(ch.get("t"), dict):
                t_node = ch["t"]
                t_node.pop("r", None)
                embed_rich_video(t_node, choice["video"], choice["image"])
        elif isinstance(ch.get("t"), dict) and not choice.get("video"):
            t_node = ch["t"]
            if t_node.get("r"):
                t_node["r"] = [
                    item for item in t_node["r"]
                    if not (isinstance(item, dict) and item.get("type") == "video")
                ]

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
    full = {"MultipleChoice", "MultipleResponse", "MultipleChoiceText", "TypeIn", "Numeric"}
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
    time_block = slide.get("s", {}).get("t", {}) or {}
    time_limit = time_block.get("v", 0)
    time_enabled = bool(time_block.get("e", False))
    shuffle_answers = bool(slide.get("s", {}).get("sh", False))

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
        "timeLimitEnabled": time_enabled,
        "shuffleAnswers": shuffle_answers,
    }

    if qtype in {"MultipleChoice", "MultipleResponse", "MultipleChoiceText", "TrueFalse", "Sequence"}:
        view["choices"] = extract_choices(slide)
    elif qtype == "Matching":
        view["matchingPairs"] = extract_matching_pairs(slide)
    elif qtype == "Sequence":
        view["sequenceItems"] = extract_sequence_items(slide)
    elif qtype == "WordBank":
        view["wordBankWords"] = list(slide.get("C", {}).get("ew", []) or [])
    elif qtype in ("TypeIn", "Numeric"):
        view["typeInAnswers"] = extract_type_in_answers(slide)

    view["layout"] = extract_layout(slide)

    return view


REPORTING_FILTER_VALUES = frozenset({"passedAndFailed", "passed", "failed"})


def extract_reporting(quiz_json: dict[str, Any]) -> dict[str, Any]:
    """Map iSpring d.s.r reporting block to editor-friendly fields."""
    reporting = quiz_json.get("d", {}).get("s", {}).get("r", {})
    ads = reporting.get("ads", {}) or {}
    sts = reporting.get("sts", {}) or {}
    ss = reporting.get("ss", {}) or {}

    admin_filter = ads.get("x", "passedAndFailed")
    if admin_filter not in REPORTING_FILTER_VALUES:
        admin_filter = "passedAndFailed"
    student_filter = sts.get("x", "passedAndFailed")
    if student_filter not in REPORTING_FILTER_VALUES:
        student_filter = "passedAndFailed"

    return {
        "sendToServer": {
            "enabled": bool(ss.get("e")),
            "url": str(ss.get("u") or ""),
        },
        "adminEmail": {
            "enabled": bool(ads.get("e")),
            "emails": str(ads.get("em") or ""),
            "filter": admin_filter,
        },
        "studentEmail": {
            "enabled": bool(sts.get("e")),
            "filter": student_filter,
        },
    }


def apply_reporting_settings(quiz_json: dict[str, Any], reporting: dict[str, Any] | None) -> None:
    """Persist editor reporting fields into iSpring d.s.r (ss, ads, sts)."""
    if not reporting:
        return

    quiz_json.setdefault("d", {}).setdefault("s", {})
    block = quiz_json["d"]["s"].setdefault("r", {})

    server = reporting.get("sendToServer") or {}
    ss = block.setdefault("ss", {})
    if "enabled" in server:
        ss["e"] = bool(server["enabled"])
    if "url" in server:
        ss["u"] = str(server.get("url") or "").strip()

    admin = reporting.get("adminEmail") or {}
    ads = block.setdefault("ads", {})
    if "enabled" in admin:
        ads["e"] = bool(admin["enabled"])
    if "emails" in admin:
        ads["em"] = str(admin.get("emails") or "").strip()
    if admin.get("filter") in REPORTING_FILTER_VALUES:
        ads["x"] = admin["filter"]
    if ads.get("e"):
        ads["ua"] = True
        ads["ca"] = True
        ads["f"] = False

    student = reporting.get("studentEmail") or {}
    sts = block.setdefault("sts", {})
    if "enabled" in student:
        sts["e"] = bool(student["enabled"])
    if student.get("filter") in REPORTING_FILTER_VALUES:
        sts["x"] = student["filter"]
    if sts.get("e"):
        sts["ua"] = True
        sts["ca"] = True
        sts["f"] = False


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
        "reporting": extract_reporting(quiz_json),
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
        "TrueFalse",
        "Sequence",
    }:
        apply_choices(slide, edit["choices"])

    if edit.get("wordBankWords") is not None and slide.get("tp") == "WordBank":
        slide.setdefault("C", {})["ew"] = [w for w in edit["wordBankWords"] if str(w).strip()]

    if edit.get("richHtml") is not None and slide.get("tp") in {"WordBank", "FillInTheBlank"}:
        slide.setdefault("C", {})
        slide["C"].setdefault("rt", {})
        slide["C"]["rt"]["h"] = edit["richHtml"]

    if edit.get("typeInAnswers") is not None and slide.get("tp") in ("TypeIn", "Numeric"):
        slide.setdefault("C", {})
        slide["C"]["chs"] = [
            {"i": f"ans-{idx}", "t": ans} for idx, ans in enumerate(edit["typeInAnswers"]) if ans.strip()
        ]

    if edit.get("timeLimitEnabled") is not None or edit.get("timeLimit") is not None:
        slide.setdefault("s", {})
        time_block = slide["s"].setdefault("t", {})
        if edit.get("timeLimitEnabled") is not None:
            time_block["e"] = bool(edit["timeLimitEnabled"])
        if edit.get("timeLimit") is not None:
            time_block["v"] = max(0, int(edit["timeLimit"]))

    if edit.get("shuffleAnswers") is not None:
        slide.setdefault("s", {})["sh"] = bool(edit["shuffleAnswers"])

    if edit.get("points") is not None:
        slide.setdefault("s", {})
        eval_block = slide["s"].setdefault("e", {})
        eval_block.setdefault("t", "byQuestion")
        eval_block.setdefault("p", 0)
        eval_block.setdefault("atp", 0)
        try:
            pts = float(edit["points"])
        except (TypeError, ValueError):
            pts = 1.0
        eval_block["pt"] = max(0.0, pts)

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
        apply_reporting_settings(self.quiz_json, payload.get("reporting"))
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
        ensure_media_registry(self.quiz_json, self.package_root)
        self.persist()
        return self.get_view()

    def persist(self) -> None:
        quiz_path = self.package_root / "quiz_data.json"
        atomic_write_text(
            quiz_path,
            json.dumps(self.quiz_json, ensure_ascii=False, indent=2),
        )
        atomic_write_text(
            self.index_path,
            replace_quiz_data(self.index_html_template, self.quiz_json),
        )

    def asset_path(self, relative: str) -> Path:
        return resolve_asset_path(self.session_id, relative)

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


def _load_saved_quiz_json(session: ScormSession, package_root: Path) -> None:
    saved = package_root / "quiz_data.json"
    if not saved.exists():
        return
    for attempt in range(5):
        try:
            raw = saved.read_text(encoding="utf-8")
            if not raw.strip():
                raise json.JSONDecodeError("empty quiz_data.json", raw, 0)
            session.quiz_json = json.loads(raw)
            return
        except json.JSONDecodeError:
            if attempt < 4:
                time.sleep(0.02)
                continue
            # Auto-save may still be flushing; keep quiz_json decoded from index.html.


def get_session(session_id: str) -> ScormSession:
    package_root = get_package_root(session_id)
    session = ScormSession(session_id, package_root)
    _load_saved_quiz_json(session, package_root)
    return session