"""SCORM package extraction, quiz decode/encode, and zip export."""

from __future__ import annotations

import base64
import copy
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
from .session_manager import (
    SESSION_STORAGE_LIMIT_BYTES,
    delete_session_dir,
    ensure_storage_capacity,
    session_lock,
    storage_write_lock,
    touch_session,
)
from .typography import (
    apply_html_to_node,
    apply_text_to_node,
    build_styled_html,
    extract_text_format,
    should_apply_text,
    strip_plain,
)

SESSIONS_ROOT = Path(
    os.getenv(
        "SESSIONS_ROOT",
        str(Path(__file__).resolve().parent.parent / "data" / "sessions"),
    )
).expanduser().resolve()

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
        storage_key = (filename if filename.startswith('http') else f'storage://images/{filename}')
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
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def get_package_root(session_id: str) -> Path:
    package_root = SESSIONS_ROOT / session_id / "package"
    if not package_root.exists():
        session_json = SESSIONS_ROOT / session_id / "session.json"
        if session_json.exists():
            package_root.mkdir(parents=True, exist_ok=True)
        else:
            raise FileNotFoundError("Session không tồn tại")
    return package_root


def resolve_asset_path(session_id: str, filename: str) -> Path:
    clean_filename = filename.split("{")[0] if "{" in filename else filename
    package_root = get_package_root(session_id)
    safe = Path(clean_filename).name
    safe_stem = Path(clean_filename).stem
    for folder in (*IMAGE_FOLDERS, *AUDIO_FOLDERS, *VIDEO_FOLDERS):
        candidate = package_root / folder / safe
        if candidate.exists():
            return candidate

        folder_path = package_root / folder
        if folder_path.exists():
            for child in folder_path.iterdir():
                if child.is_file() and child.stem == safe_stem:
                    return child
    raise FileNotFoundError(safe)


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    stripped = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", html.unescape(stripped)).strip()


def collapse_repeated_question_text(text: str | None) -> str:
    """Collapse an accidentally repeated whole question while preserving normal prose."""
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    tokens = normalized.split()
    # Short repetitions such as "đúng đúng" may be intentional answer content.
    for repeat_count in range(min(8, len(tokens)), 1, -1):
        if len(tokens) % repeat_count:
            continue
        unit_length = len(tokens) // repeat_count
        if unit_length < 5:
            continue
        unit = tokens[:unit_length]
        if all(
            tokens[index * unit_length:(index + 1) * unit_length] == unit
            for index in range(1, repeat_count)
        ):
            return " ".join(unit)
    return normalized


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


def safe_extract_zip(
    archive: zipfile.ZipFile,
    dest: Path,
    *,
    max_uncompressed_bytes: int = SESSION_STORAGE_LIMIT_BYTES,
) -> None:
    total = 0
    destination = dest.resolve()
    for info in archive.infolist():
        total += max(0, info.file_size)
        if total > max_uncompressed_bytes:
            raise ValueError("Gói ZIP sau giải nén vượt giới hạn lưu trữ session")
        target = (dest / info.filename).resolve()
        if target != destination and destination not in target.parents:
            raise ValueError(f"ZIP chứa đường dẫn không an toàn: {info.filename}")
    archive.extractall(dest)


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
                    safe_extract_zip(inner, dest)
            else:
                safe_extract_zip(zf, dest)
        package_root = dest

    manifest = package_root / "imsmanifest.xml"
    if not manifest.exists():
        for candidate in package_root.rglob("imsmanifest.xml"):
            package_root = candidate.parent
            break
        else:
            raise ValueError("Không tìm thấy imsmanifest.xml trong gói SCORM")

    return package_root


def source_uncompressed_size(source: Path) -> int:
    """Estimate persistent bytes before admitting a new session."""
    if source.is_dir():
        return sum(
            item.stat().st_size
            for item in source.rglob("*")
            if item.is_file()
        )
    with zipfile.ZipFile(source, "r") as archive:
        infos = archive.infolist()
        if len(infos) == 1 and infos[0].filename.lower().endswith(".zip"):
            inner_bytes = archive.read(infos[0])
            with zipfile.ZipFile(io.BytesIO(inner_bytes), "r") as inner:
                return sum(max(0, info.file_size) for info in inner.infolist())
        return sum(max(0, info.file_size) for info in infos)


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
    if storage_uri.startswith("http://") or storage_uri.startswith("https://"):
        return storage_uri
    match = re.search(r"storage://images/(.+)", storage_uri)
    return match.group(1) if match else None


def sound_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    if storage_uri.startswith("http://") or storage_uri.startswith("https://"):
        return storage_uri
    match = re.search(r"storage://sounds/(.+)", storage_uri)
    return match.group(1) if match else None


def video_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    if storage_uri.startswith("http://") or storage_uri.startswith("https://"):
        return storage_uri
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
                html_matches_text = strip_html(choice["html"]).strip() == str(text).strip()
                if not html_matches_text:
                    c_fmt = choice.get("format") if choice.get("format") is not None else extract_text_format(
                        ch["t"].get("h", ""), ch["t"].get("t"), "content"
                    )
                    apply_text_to_node(ch["t"], text, "content", c_fmt)
                elif should_apply_text(ch["t"], text, choice.get("format"), "content") or (
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
            ch["ia"]["i"] = (choice['image'] if choice['image'].startswith('http') else f"storage://images/{choice['image']}")
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


def apply_matching_pairs(slide: dict[str, Any], pairs: list[dict[str, Any]]) -> None:
    if "C" not in slide:
        slide["C"] = {}
    current_pairs = slide["C"].get("m", [])

    # We will just overwrite since pairs might be added/removed.
    new_pairs = []
    import uuid
    for i, pair in enumerate(pairs):
        # pair could have 'text', 'matchText', 'image', 'matchImage' from frontend
        # or 'leftText', 'rightText', 'leftImage', 'rightImage'
        left_text = pair.get("leftText", pair.get("text", ""))
        right_text = pair.get("rightText", pair.get("matchText", ""))
        left_image = pair.get("leftImage", pair.get("image", ""))
        right_image = pair.get("rightImage", pair.get("matchImage", ""))

        if i < len(current_pairs):
            m_pair = current_pairs[i]
        else:
            m_pair = {
                "p": {"i": f"p-{uuid.uuid4().hex[:8]}", "t": {}},
                "r": {"i": f"r-{uuid.uuid4().hex[:8]}", "t": {}}
            }

        # Apply left
        if isinstance(m_pair["p"].get("t"), dict):
            m_pair["p"]["t"]["h"] = left_text
        else:
            m_pair["p"]["t"] = left_text

        if left_image:
            m_pair["p"].setdefault("ia", {})["i"] = (left_image if left_image.startswith('http') else f'storage://images/{left_image}')
        else:
            m_pair["p"].pop("ia", None)

        # Apply right
        if isinstance(m_pair["r"].get("t"), dict):
            m_pair["r"]["t"]["h"] = right_text
        else:
            m_pair["r"]["t"] = right_text

        if right_image:
            m_pair["r"].setdefault("ia", {})["i"] = (right_image if right_image.startswith('http') else f'storage://images/{right_image}')
        else:
            m_pair["r"].pop("ia", None)

        new_pairs.append(m_pair)

    slide["C"]["m"] = new_pairs


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



def extract_hotspot_choices(slide: dict[str, Any]) -> list[dict[str, Any]]:
    c = slide.get("C", {})
    bg_image = image_path_from_storage(c.get("i", ""))
    areas = c.get("a", [])
    choices = []
    for idx, area in enumerate(areas):
        choices.append({
            "id": f"hotspot-{idx}",
            "text": area.get("l", f"Vùng {idx+1}"),
            "image": bg_image,
            "isCorrect": bool(area.get("c", False)),
            "rect": area.get("r", {}),
            "type": area.get("t", "freeform")
        })
    return choices


def extract_dnd_items(slide: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize iSpring C.d drag-object → drop-target mappings."""
    if slide.get("tp") != "DND":
        return []
    from .layout import extract_object_image, extract_object_text, resolve_object_rect

    objects = {
        str(obj.get("I")): obj
        for obj in slide.get("a", {}).get("o", [])
        if obj.get("I")
    }
    mappings: dict[str, str] = {}
    target_ids: set[str] = set()
    for entry in slide.get("C", {}).get("d", []) or []:
        source_id = str((entry.get("o") or {}).get("s") or "")
        target_id = str((entry.get("d") or {}).get("s") or "")
        if target_id:
            target_ids.add(target_id)
        if source_id and target_id:
            mappings[source_id] = target_id

    source_ids = list(mappings)
    # Include image decoys that are draggable but absent from the correct map.
    for object_id, obj in objects.items():
        if obj.get("tp") == "image" and object_id not in target_ids and object_id not in source_ids:
            source_ids.append(object_id)

    result: list[dict[str, Any]] = []
    for index, source_id in enumerate(source_ids):
        source_obj = objects.get(source_id, {})
        target_id = mappings.get(source_id, "")
        target_obj = objects.get(target_id, {})
        source_text = extract_object_text(source_obj, slide).replace("\u200b", "").strip() or source_id
        target_text = extract_object_text(target_obj, slide).replace("\u200b", "").strip()
        target_rect = resolve_object_rect(target_obj, slide) if target_obj else {}
        if not target_text and target_rect:
            tx = float(target_rect.get("x", 0)) + float(target_rect.get("w", 0)) / 2
            ty = float(target_rect.get("y", 0)) + float(target_rect.get("h", 0)) / 2
            labels: list[tuple[float, str]] = []
            for label_id, label_obj in objects.items():
                if label_id in {target_id, "direction"}:
                    continue
                label = extract_object_text(label_obj, slide).replace("\u200b", "").strip()
                if not label:
                    continue
                lr = resolve_object_rect(label_obj, slide)
                lx = float(lr.get("x", 0)) + float(lr.get("w", 0)) / 2
                ly = float(lr.get("y", 0)) + float(lr.get("h", 0)) / 2
                labels.append(((lx - tx) ** 2 + (ly - ty) ** 2, label))
            if labels:
                target_text = min(labels, key=lambda item: item[0])[1]
        target_text = target_text or target_id
        result.append({
            "id": f"dnd-{index}",
            "sourceId": source_id,
            "sourceText": source_text,
            "sourceImage": extract_object_image(source_obj, slide),
            "sourceRect": resolve_object_rect(source_obj, slide) if source_obj else {},
            "targetId": target_id,
            "targetText": target_text,
            "targetImage": extract_object_image(target_obj, slide),
            "targetRect": target_rect,
            "isMapped": bool(target_id),
        })
    return result


def extract_sequence_items(slide: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for ch in slide.get("C", {}).get("chs", []):
        items.append(
            {
                "id": ch.get("i", ""),
                "text": strip_html((ch.get("t") or {}).get("h", "")),
                "image": image_path_from_storage((ch.get("ia") or {}).get("i", "")),
                "order": ch.get("o", len(items)),
            }
        )
    return sorted(items, key=lambda x: x.get("order", 0))


def extract_type_in_answers(slide: dict[str, Any]) -> list[str]:
    answers = []
    # 1. Try C.chs (TypeIn usually uses this)
    for ch in slide.get("C", {}).get("chs", []):
        text = ch.get("t", "")
        if isinstance(text, dict):
            text_str = strip_html(text.get("h") or text.get("a") or "")
        else:
            text_str = str(text)
        if text_str.strip():
            answers.append(text_str.strip())
            
    # 2. Try C.na (Numeric usually uses this)
    for na in slide.get("C", {}).get("na", []):
        if na.get("co") == "equal" and "op" in na:
            answers.append(str(na["op"]))
        elif na.get("co") == "between" and "op" in na:
            answers.append(str(na["op"])) # fallback for between, though Teky only supports exact matching
            
    return answers


def extract_blank_answers(slide: dict[str, Any]) -> list[dict[str, Any]]:
    answers = []
    rt = slide.get("C", {}).get("rt", {})
    entries = rt.get("r", [])
    if entries:
        for entry in entries:
            data = entry.get("data", {})
            v = data.get("v")
            if isinstance(v, list):
                values = [str(x) for x in v if x is not None]
            else:
                values = [str(v)] if v is not None else []
            answers.append({
                "id": entry.get("id", ""),
                "values": values
            })
    else:
        # Fallback to C.chs for some iSpring versions
        for ch in slide.get("C", {}).get("chs", []):
            text = ch.get("t", "")
            if isinstance(text, dict):
                text_str = strip_html(text.get("h") or text.get("a") or "")
            else:
                text_str = str(text)
            answers.append({
                "id": ch.get("i", ""),
                "values": [text_str.strip()] if text_str.strip() else []
            })
    return answers


def extract_slide_images(slide: dict[str, Any]) -> list[str]:
    meta = slide.get("_metadata", {})
    if meta.get("slideImages"):
        return meta["slideImages"]

    from .layout import extract_slide_attachment_image, extract_object_image
    images = []
    att = extract_slide_attachment_image(slide)
    if att:
        images.append(att)
    for obj in slide.get("a", {}).get("o", []):
        if obj.get("tp") == "image":
            img = extract_object_image(obj, slide)
            if img:
                images.append(img)
    return images


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
        raw_html = rt.get("h") or rt.get("a") or ""
        subtitle_text = strip_html(raw_html)
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
        "dndItems": [],
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
        html_matches_text = strip_html(edit["questionHtml"]).strip() == str(text).strip()
        if not html_matches_text:
            q_fmt = edit.get("questionFormat") if edit.get("questionFormat") is not None else extract_text_format(
                slide["D"].get("h", ""), slide["D"].get("t"), "title"
            )
            apply_text_to_node(slide["D"], text, "title", q_fmt)
        elif should_apply_text(slide["D"], text, edit.get("questionFormat"), "title") or (
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
    if qtype in ("TypeIn", "FillInTheBlank", "WordBank"):
        question_text = collapse_repeated_question_text(question_text)
    points = slide.get("s", {}).get("e", {}).get("pt", 1)
    time_block = slide.get("s", {}).get("t", {}) or {}
    time_limit = time_block.get("v", 0)
    time_enabled = bool(time_block.get("e", False))
    shuffle_answers = bool(slide.get("s", {}).get("sh", False))

    subtitle_text = ""
    subtitle_format = None
    if qtype in ("WordBank", "FillInTheBlank"):
        rt = slide.get("C", {}).get("rt", {})
        h_html = rt.get("h") or ""
        a_html = rt.get("a") or ""
        raw_html = a_html if len(strip_html(a_html)) > len(strip_html(h_html)) else (h_html or a_html)
        for entry in rt.get("r", []):
            blank_id = entry.get("id")
            if blank_id:
                raw_html = re.sub(rf'<[^>]*id="{blank_id}"[^>]*>(?:.*?</[^>]+>)?', "___", raw_html)
        subtitle_text = collapse_repeated_question_text(strip_html(raw_html))
        if subtitle_text.casefold() == question_text.casefold():
            subtitle_text = ""
        if subtitle_text:
            subtitle_format = extract_text_format(rt.get("h", ""), rt.get("t"), "content")

    view: dict[str, Any] = {
        "id": slide.get("i", ""),
        "type": qtype,
        "slideRole": "question",
        "resultKind": None,
        "resultIndex": -1,
        "subtitleText": subtitle_text,
        "subtitleFormat": subtitle_format,
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
        "dndItems": [],
        "typeInAnswers": [],
        "slideImages": extract_slide_images(slide),
        "editableLevel": editable_level(qtype),
        "points": points,
        "difficulty": slide.get("_metadata", {}).get("difficulty", "medium"),
        "topic": slide.get("_metadata", {}).get("topic", ""),
        "required": bool(slide.get("_metadata", {}).get("required", False)),
        "useRegex": bool(slide.get("_metadata", {}).get("useRegex", False)),
        "explanation": slide.get("_metadata", {}).get("explanation", ""),
        "video": slide.get("_metadata", {}).get("video", ""),
        "audio": slide.get("_metadata", {}).get("audio", ""),
        "timeLimit": time_limit,
        "timeLimitEnabled": time_enabled,
        "shuffleAnswers": shuffle_answers,
    }

    if qtype in {"MultipleChoice", "MultipleResponse", "MultipleChoiceText", "TrueFalse"}:
        view["choices"] = extract_choices(slide)
    elif qtype == "Sequence":
        view["choices"] = extract_choices(slide)
        view["sequenceItems"] = extract_sequence_items(slide)
    elif qtype == "Matching":
        view["matchingPairs"] = extract_matching_pairs(slide)
    elif qtype == "Hotspot":
        view["choices"] = extract_hotspot_choices(slide)
    elif qtype == "DND":
        view["dndItems"] = extract_dnd_items(slide)
    elif qtype in ("WordBank", "FillInTheBlank"):
        view["blankAnswers"] = extract_blank_answers(slide)
        rt = slide.get("C", {}).get("rt", {})
        h_html = rt.get("h") or ""
        a_html = rt.get("a") or ""
        view["richHtml"] = a_html if len(strip_html(a_html)) > len(strip_html(h_html)) else (h_html or a_html)
        if qtype == "WordBank":
            view["wordBankWords"] = list(slide.get("C", {}).get("ew", []) or [])
    elif qtype in ("TypeIn", "Numeric", "MultipleNumeric"):
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

    title = quiz_json.get("d", {}).get("T", "Untitled Quiz")
    teky_quiz = copy.deepcopy(quiz_json.get("_teky") or {})
    teky_quiz.setdefault("title", title)

    return {
        "title": title,
        "tekyQuiz": teky_quiz,
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
    if edit.get("type"):
        slide["tp"] = edit["type"]

    slide.setdefault("D", {})
    if edit.get("questionHtml"):
        text = edit.get("questionText") or strip_html(edit["questionHtml"])
        html_matches_text = strip_html(edit["questionHtml"]).strip() == str(text).strip()
        if not html_matches_text:
            q_fmt = edit.get("questionFormat") if edit.get("questionFormat") is not None else extract_text_format(
                slide["D"].get("h", ""), slide["D"].get("t"), "title"
            )
            apply_text_to_node(slide["D"], text, "title", q_fmt)
        elif should_apply_text(slide["D"], text, edit.get("questionFormat"), "title") or (
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

    if edit.get("matchingPairs") is not None and slide.get("tp") == "Matching":
        apply_matching_pairs(slide, edit["matchingPairs"])

    if edit.get("wordBankWords") is not None and slide.get("tp") == "WordBank":
        slide.setdefault("C", {})["ew"] = [w for w in edit["wordBankWords"] if str(w).strip()]

    if edit.get("richHtml") is not None and slide.get("tp") in {"WordBank", "FillInTheBlank"}:
        slide.setdefault("C", {})
        slide["C"].setdefault("rt", {})
        slide["C"]["rt"]["h"] = edit["richHtml"]

    if edit.get("blankAnswers") is not None and slide.get("tp") == "FillInTheBlank":
        slide.setdefault("C", {})
        rt = slide["C"].setdefault("rt", {})
        existing_entries = rt.get("r", [])
        existing_id = next(
            (entry.get("id") for entry in existing_entries if entry.get("id")),
            "qmFillInTheBlank0",
        )
        answer = (edit.get("blankAnswers") or [{}])[0]
        blank_id = answer.get("id") or existing_id
        values = answer.get("values") or answer.get("acceptedAnswers") or []
        accepted_answers = [
            str(value).strip() for value in values if str(value).strip()
        ]
        correct_answer = accepted_answers[0] if accepted_answers else ""

        rt["r"] = [{
            "id": blank_id,
            "type": "qmFillInTheBlank",
            "data": {"v": accepted_answers},
        }]

        question_text = edit.get("questionText")
        if question_text is None:
            question_text = strip_html(slide.get("D", {}).get("h", ""))
        question_text = str(question_text or "")
        blank_span = f'<span id="{html.escape(blank_id)}"></span>'
        escaped_question = html.escape(question_text)
        if "___" in escaped_question:
            rich_content = escaped_question.replace("___", blank_span, 1)
        else:
            rich_content = f"{escaped_question} {blank_span}".strip()
        rt["h"] = f"<p><span>{rich_content}</span></p>"
        rt["d"] = [question_text, {"id": blank_id}]
        slide["C"]["chs"] = [{
            "i": blank_id,
            "t": {"h": correct_answer},
        }]

    if edit.get("blankAnswers") is not None and slide.get("tp") == "WordBank":
        slide.setdefault("C", {})
        rt = slide["C"].setdefault("rt", {})
        entries = rt.setdefault("r", [])
        entry_map = {e.get("id"): e for e in entries if e.get("id")}
        for ans in edit["blankAnswers"]:
            bid = ans.get("id")
            vals = ans.get("values", [])
            val_list = [str(x).strip() for x in vals if str(x).strip()]
            val_single = val_list[0] if val_list else ""
            if not bid:
                continue
            if bid in entry_map:
                entry_map[bid]["data"] = {"v": val_single}
            else:
                entry = {
                    "id": bid,
                    "type": "qmWordBank",
                    "data": {"v": val_single},
                }
                entries.append(entry)

        # Also sync to C.chs if present
        chs = slide["C"].get("chs", [])
        if chs:
            chs_map = {ch.get("i"): ch for ch in chs if ch.get("i")}
            for ans in edit["blankAnswers"]:
                bid = ans.get("id")
                vals = ans.get("values", [])
                val_list = [str(x).strip() for x in vals if str(x).strip()]
                val_single = val_list[0] if val_list else ""
                if bid and bid in chs_map:
                    if isinstance(chs_map[bid].get("t"), dict):
                        chs_map[bid]["t"]["h"] = val_single
                    else:
                        chs_map[bid]["t"] = val_single

    if edit.get("typeInAnswers") is not None and slide.get("tp") in (
        "TypeIn",
        "Numeric",
        "MultipleNumeric",
    ):
        answers = [str(ans).strip() for ans in edit["typeInAnswers"] if str(ans).strip()]
        slide.setdefault("C", {})
        slide["C"]["chs"] = [
            {"i": f"ans-{idx}", "t": ans} for idx, ans in enumerate(answers)
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

    if "slideImages" in edit:
        slide_images = edit["slideImages"]
        slide.setdefault("_metadata", {})["slideImages"] = slide_images
        from .layout import set_slide_attachment, _prune_orphan_slide_picture
        from .quiz_builder import _ensure_slide_object, DEFAULT_PICTURE_RECT

        if slide_images:
            url = slide_images[0]
            # Strip storage://images/ prefix if it's there so we don't double it
            if url.startswith("storage://images/"):
                url = url[17:]
            set_slide_attachment(slide, url, zoom=True)
            _ensure_slide_object(slide, "slidePicture", "Slide Picture 1", DEFAULT_PICTURE_RECT)
        else:
            set_slide_attachment(slide, None)
            _prune_orphan_slide_picture(slide)

    # Save Teky LMS metadata
    for key in ("difficulty", "topic", "required", "useRegex", "explanation", "video", "audio"):
        if edit.get(key) is not None:
            slide.setdefault("_metadata", {})[key] = edit[key]


def apply_quiz_meta(quiz_json: dict[str, Any], meta: dict[str, Any]) -> None:
    teky_quiz = meta.get("tekyQuiz")
    if isinstance(teky_quiz, dict):
        quiz_json["_teky"] = copy.deepcopy(teky_quiz)
        if teky_quiz.get("title"):
            quiz_json.setdefault("d", {})["T"] = teky_quiz["title"]
    if meta.get("title"):
        quiz_json.setdefault("d", {})["T"] = meta["title"]
        quiz_json.setdefault("_teky", {})["title"] = meta["title"]
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


def export_scorm_zip(package_root: Path, quiz_json: dict[str, Any], title: str | None = None) -> Path:
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

    import tempfile
    fd, temp_path = tempfile.mkstemp(suffix=".zip")
    import os
    os.close(fd)
    
    with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in package_root.rglob("*"):
            if file_path.is_file() and file_path.name != ".DS_Store":
                arcname = file_path.relative_to(package_root).as_posix()
                zf.write(file_path, arcname)
    return Path(temp_path)


class ScormSession:
    def __init__(self, session_id: str, package_root: Path):
        self.session_id = session_id
        self.package_root = package_root
        try:
            self.index_path = find_index_html(package_root)
            index_html = self.index_path.read_text(encoding="utf-8")
            self.index_html_template = index_html
            self.quiz_json = decode_quiz_data(index_html)
        except ValueError:
            self.index_path = None
            self.index_html_template = ""
            self.quiz_json = {}
        
        self.manifest_path = package_root / "imsmanifest.xml"
        self.meta = parse_manifest_meta(self.manifest_path) if self.manifest_path.exists() else {}

    @classmethod
    def create_from_source(cls, source: Path) -> "ScormSession":
        with storage_write_lock():
            reserve_bytes = source_uncompressed_size(source)
            ensure_storage_capacity(SESSIONS_ROOT, reserve_bytes=reserve_bytes)
            session_id = str(uuid.uuid4())
            session_dir = SESSIONS_ROOT / session_id
            try:
                package_root = extract_scorm_package(source, session_dir / "package")
                ensure_storage_capacity(SESSIONS_ROOT, protected_ids={session_id})
                touch_session(SESSIONS_ROOT, session_id, event="create")
                return cls(session_id, package_root)
            except Exception:
                delete_session_dir(SESSIONS_ROOT, session_id)
                raise

    def get_fonts(self) -> dict[str, Any]:
        return extract_font_manifest(self.quiz_json, self.package_root)

    def get_view(self) -> dict[str, Any]:
        view = quiz_to_view(self.quiz_json)
        view["sessionId"] = self.session_id
        view["manifestTitle"] = self.meta.get("manifestTitle", "")
        view["fonts"] = self.get_fonts()
        teky_quiz = view.get("tekyQuiz")
        cover_ref = teky_quiz.get("coverImage") if isinstance(teky_quiz, dict) else None
        if cover_ref and not str(cover_ref).startswith(("http://", "https://", "data:")):
            try:
                self.asset_path(str(cover_ref))
            except FileNotFoundError:
                # Old sessions may retain an unresolved Excel-relative path.
                # Return the cover placeholder instead of a known-broken URL.
                teky_quiz["coverImage"] = ""
        if not view["title"] or view["title"] == "Untitled Quiz":
            view["title"] = view["manifestTitle"] or view["title"]
        return view

    def save_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        apply_quiz_meta(
            self.quiz_json,
            {
                "title": payload.get("title"),
                "passingScore": payload.get("passingScore"),
                "tekyQuiz": payload.get("tekyQuiz"),
            },
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
        new_qs = [q for q in payload.get("questions", []) if q.get("isNew") or str(q.get("id", "")).startswith("new_")]

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

            if gi == 0 and new_qs and new_slides:
                import copy
                import uuid
                for q in new_qs:
                    template = copy.deepcopy(new_slides[-1])
                    template["i"] = f"slide_{uuid.uuid4().hex[:8]}"
                    apply_question_edit(template, q)
                    new_slides.append(template)

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
        if self.index_path:
            atomic_write_text(
                self.index_path,
                replace_quiz_data(self.index_html_template, self.quiz_json),
            )

    def asset_path(self, relative: str) -> Path:
        # Check if this asset is mapped to a different file in iSpring's rs (resources) dict
        mapped = self.quiz_json.get("rs", {}).get("i", {}).get((relative if relative.startswith('http') else f'storage://images/{relative}'))
        if not mapped and "{" in relative:
            clean_rel = relative.split("{")[0]
            mapped = self.quiz_json.get("rs", {}).get("i", {}).get((clean_rel if clean_rel.startswith('http') else f'storage://images/{clean_rel}'))

        if not mapped:
            clean_rel = relative.split("{")[0]
            prefix = (clean_rel if clean_rel.startswith('http') else f'storage://images/{clean_rel}')
            for k, v in self.quiz_json.get("rs", {}).get("i", {}).items():
                if k.startswith(prefix):
                    mapped = v
                    break

        if mapped and isinstance(mapped, dict) and mapped.get("s"):
            # The 's' value is often a Windows path like "data\\images\\c9f7.png"
            # We need to extract just the filename part to let resolve_asset_path find it
            real_name = mapped["s"].replace("\\", "/").split("/")[-1]
            return resolve_asset_path(self.session_id, real_name)

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

    def export_zip(self, title: str | None = None) -> Path:
        self.persist()
        export_title = title or self.quiz_json.get("d", {}).get("T")
        return export_scorm_zip(self.package_root, self.quiz_json, export_title)

    def export_media_zip(self) -> Path:
        view = self.get_view()
        safe_title = (view.get("title") or "Quiz").strip()
        safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_title)

        import tempfile
        import os
        fd, temp_path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)

        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            added_names = set()
            processed_source_files = set()

            def add_file(filename: str, name_template: str):
                if not filename: return
                clean_filename = filename.split("{")[0] if "{" in filename else filename
                try:
                    path = self.asset_path(clean_filename)
                    if not path.is_file(): return

                    ext = path.suffix.lower()
                    final_name = f"{name_template}{ext}"
                    idx = 2
                    while final_name in added_names:
                        final_name = f"{name_template}_{idx}{ext}"
                        idx += 1

                    zf.write(path, final_name)
                    added_names.add(final_name)
                    processed_source_files.add(filename)
                except FileNotFoundError:
                    pass

            for q in view.get("questions", []):
                stt = q.get("questionIndex", 0) + 1
                prefix = f"{safe_title}_{stt}"
                processed_source_files.clear()

                # Choices (DA)
                for idx, choice in enumerate(q.get("choices", [])):
                    add_file(choice.get("image"), f"{prefix}_IMG-DA{idx+1}")
                    add_file(choice.get("video"), f"{prefix}_VID-DA{idx+1}")

                # Matching Pairs (DA)
                for idx, pair in enumerate(q.get("matchingPairs", [])):
                    add_file(pair.get("leftImage"), f"{prefix}_IMG-DA-Left{idx+1}")
                    add_file(pair.get("rightImage"), f"{prefix}_IMG-DA-Right{idx+1}")

                # Feedback (GT)
                for fb in ["correct", "incorrect", "any", "attempt", "partial"]:
                    add_file(q.get("feedback", {}).get(f"{fb}Image"), f"{prefix}_IMG-GT")
                    add_file(q.get("feedback", {}).get(f"{fb}Video"), f"{prefix}_VID-GT")

                # Content (ND) from layout objects
                nd_img_idx = 1
                nd_vid_idx = 1
                nd_aud_idx = 1
                for obj in q.get("layout", {}).get("objects", []):
                    img = obj.get("image")
                    if img and img not in processed_source_files:
                        pos = "ND" if nd_img_idx == 1 else f"ND{nd_img_idx}"
                        add_file(img, f"{prefix}_IMG-{pos}")
                        nd_img_idx += 1
                    vid = obj.get("video")
                    if vid and vid not in processed_source_files:
                        pos = "ND" if nd_vid_idx == 1 else f"ND{nd_vid_idx}"
                        add_file(vid, f"{prefix}_VID-{pos}")
                        nd_vid_idx += 1
                    aud = obj.get("audio")
                    if aud and aud not in processed_source_files:
                        pos = "ND" if nd_aud_idx == 1 else f"ND{nd_aud_idx}"
                        add_file(aud, f"{prefix}_AUD-{pos}")
                        nd_aud_idx += 1

                # Any leftover slide images
                for img in q.get("slideImages", []):
                    if img not in processed_source_files:
                        pos = "ND" if nd_img_idx == 1 else f"ND{nd_img_idx}"
                        add_file(img, f"{prefix}_IMG-{pos}")
                        nd_img_idx += 1

        return Path(temp_path)

    def export_media_local(self) -> str:
        import shutil
        from pathlib import Path

        view = self.get_view()
        safe_title = (view.get("title") or "Quiz").strip()
        safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_title)

        target_dir = Path.home() / "Downloads" / "SNLT-CHECKQUIZ" / safe_title
        target_dir.mkdir(parents=True, exist_ok=True)

        added_names = set()
        processed_source_files = set()

        def add_file(filename: str, name_template: str):
            if not filename: return
            clean_filename = filename.split("{")[0] if "{" in filename else filename
            try:
                path = self.asset_path(clean_filename)
                if not path.is_file(): return

                ext = path.suffix.lower()
                final_name = f"{name_template}{ext}"
                idx = 2
                while final_name in added_names:
                    final_name = f"{name_template}_{idx}{ext}"
                    idx += 1

                target_file = target_dir / final_name
                shutil.copy2(path, target_file)
                added_names.add(final_name)
                processed_source_files.add(filename)
            except Exception:
                pass

        for q in view.get("questions", []):
            stt = q.get("questionIndex", 0) + 1
            prefix = f"{safe_title}_{stt}"
            processed_source_files.clear()

            for idx, choice in enumerate(q.get("choices", [])):
                add_file(choice.get("image"), f"{prefix}_IMG-DA{idx+1}")
                add_file(choice.get("video"), f"{prefix}_VID-DA{idx+1}")

            for idx, pair in enumerate(q.get("matchingPairs", [])):
                add_file(pair.get("leftImage"), f"{prefix}_IMG-DA-Left{idx+1}")
                add_file(pair.get("rightImage"), f"{prefix}_IMG-DA-Right{idx+1}")

            for fb in ["correct", "incorrect", "any", "attempt", "partial"]:
                add_file(q.get("feedback", {}).get(f"{fb}Image"), f"{prefix}_IMG-GT")
                add_file(q.get("feedback", {}).get(f"{fb}Video"), f"{prefix}_VID-GT")

            nd_img_idx = 1
            nd_vid_idx = 1
            nd_aud_idx = 1
            for obj in q.get("layout", {}).get("objects", []):
                img = obj.get("image")
                if img and img not in processed_source_files:
                    pos = "ND" if nd_img_idx == 1 else f"ND{nd_img_idx}"
                    add_file(img, f"{prefix}_IMG-{pos}")
                    nd_img_idx += 1
                vid = obj.get("video")
                if vid and vid not in processed_source_files:
                    pos = "ND" if nd_vid_idx == 1 else f"ND{nd_vid_idx}"
                    add_file(vid, f"{prefix}_VID-{pos}")
                    nd_vid_idx += 1
                aud = obj.get("audio")
                if aud and aud not in processed_source_files:
                    pos = "ND" if nd_aud_idx == 1 else f"ND{nd_aud_idx}"
                    add_file(aud, f"{prefix}_AUD-{pos}")
                    nd_aud_idx += 1

            for img in q.get("slideImages", []):
                if img not in processed_source_files:
                    pos = "ND" if nd_img_idx == 1 else f"ND{nd_img_idx}"
                    add_file(img, f"{prefix}_IMG-{pos}")
                    nd_img_idx += 1

        return str(target_dir)


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
    with session_lock(session_id):
        package_root = get_package_root(session_id)
        session = ScormSession(session_id, package_root)
        _load_saved_quiz_json(session, package_root)
        touch_session(SESSIONS_ROOT, session_id)
        return session
