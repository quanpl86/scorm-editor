"""Build iSpring quiz JSON from parsed Excel rows using SCORM slide templates."""

from __future__ import annotations

import copy
import html
import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from .excel_import import ExcelQuestion, ParsedMediaRefs, SKIP_IMPORT_TYPES, resolve_media_path
from .media_rich import audio_attachment, embed_rich_image, embed_rich_video
from .layout import (
    _blank_object_styles,
    _bump_slide_object_quota,
    reflow_imported_slide,
    set_slide_attachment,
)
from .scorm_parser import image_dimensions
from .typography import FONT_CONTENT, apply_text_to_node, strip_plain

PROJECT_ROOT = Path(__file__).resolve().parent.parent
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

    if "Numeric" not in templates and "TypeIn" in templates:
        numeric = copy.deepcopy(templates["TypeIn"])
        numeric["tp"] = "Numeric"
        templates["Numeric"] = numeric

    if "MultipleNumeric" not in templates and "TypeIn" in templates:
        mnum = copy.deepcopy(templates["TypeIn"])
        mnum["tp"] = "MultipleNumeric"
        templates["MultipleNumeric"] = mnum

    return templates


def _blank_ids_from_html(html_text: str, prefix: str) -> list[str]:
    return re.findall(rf'id="({prefix}\d+)"', html_text or "")


def _upsert_blank_answer(
    rt: dict[str, Any],
    blank_id: str,
    values: list[str],
    blank_type: str,
) -> None:
    clean_values = [str(value).strip() for value in values if str(value).strip()]
    entries = rt.setdefault("r", [])
    for entry in entries:
        if entry.get("id") == blank_id:
            entry["data"] = {"v": clean_values}
            entry["type"] = blank_type
            return
    entries.append({"data": {"v": clean_values}, "id": blank_id, "type": blank_type})


def _upsert_wordbank_answer(rt: dict[str, Any], blank_id: str, value: str) -> None:
    entries = rt.setdefault("r", [])
    for entry in entries:
        if entry.get("id") == blank_id:
            entry["data"] = {"v": value}
            entry["type"] = "qmWordBank"
            return
    entries.append({"data": {"v": value}, "id": blank_id, "type": "qmWordBank"})


def _clear_template_feedback(slide: dict[str, Any]) -> None:
    feedback = slide.get("s", {}).get("F", {})
    for code in ("c", "i"):
        block = feedback.get(code)
        if isinstance(block, dict):
            block.pop("a", None)


def _apply_feedback_block(
    slide: dict[str, Any],
    code: str,
    refs: ParsedMediaRefs,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
    warnings: list[str],
) -> None:
    if not any((refs.text, refs.image, refs.audio, refs.video)):
        return

    block = slide.setdefault("s", {}).setdefault("F", {}).setdefault(code, {})
    block.pop("a", None)
    node = block.setdefault("v", {})

    if refs.text or refs.image or refs.video:
        node.pop("r", None)

    if refs.text:
        apply_text_to_node(node, refs.text, "feedback")
    elif refs.image or refs.video:
        node.setdefault("h", "")
        node.setdefault("d", [])
        node.setdefault("t", {})

    poster_name = _resolve_and_copy_image(
        refs.image,
        package_root=package_root,
        excel_dir=excel_dir,
        fallback_media_dirs=fallback_media_dirs,
        warnings=warnings,
    )

    if refs.video:
        video_name = _resolve_and_copy_video(
            refs.video,
            package_root=package_root,
            excel_dir=excel_dir,
            fallback_media_dirs=fallback_media_dirs,
            warnings=warnings,
        )
        if video_name:
            if not poster_name:
                warnings.append(
                    f"Video feedback cần ảnh poster (thêm [image=...] hoặc cột Image): {refs.video}"
                )
            else:
                embed_rich_video(
                    node,
                    video_name,
                    poster_name,
                    package_root=package_root,
                )
    elif poster_name:
        embed_rich_image(node, poster_name, package_root=package_root)

    if refs.audio:
        audio_name = _resolve_and_copy_audio(
            refs.audio,
            package_root=package_root,
            excel_dir=excel_dir,
            fallback_media_dirs=fallback_media_dirs,
            warnings=warnings,
        )
        if audio_name:
            block["a"] = audio_attachment(audio_name)


def _apply_choice_media(
    ch: dict[str, Any],
    ans,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
    warnings: list[str],
) -> None:
    ch.pop("f", None)

    poster_name = _resolve_and_copy_image(
        ans.image,
        package_root=package_root,
        excel_dir=excel_dir,
        fallback_media_dirs=fallback_media_dirs,
        warnings=warnings,
    )
    if poster_name:
        _apply_choice_image(ch, poster_name)

    if ans.audio:
        audio_name = _resolve_and_copy_audio(
            ans.audio,
            package_root=package_root,
            excel_dir=excel_dir,
            fallback_media_dirs=fallback_media_dirs,
            warnings=warnings,
        )
        if audio_name:
            ch["f"] = {"a": audio_attachment(audio_name)}

    if ans.video:
        video_name = _resolve_and_copy_video(
            ans.video,
            package_root=package_root,
            excel_dir=excel_dir,
            fallback_media_dirs=fallback_media_dirs,
            warnings=warnings,
        )
        if video_name:
            if not poster_name:
                warnings.append(
                    f"Video đáp án cần ảnh (thêm [image=...] trong Answer): {ans.video}"
                )
            else:
                if not isinstance(ch.get("t"), dict):
                    ch["t"] = {}
                t_node = ch["t"]
                t_node.pop("r", None)
                embed_rich_video(
                    t_node,
                    video_name,
                    poster_name,
                    package_root=package_root,
                )


def _set_points(slide: dict[str, Any], points: float | None) -> None:
    if points is None:
        return
    eval_block = slide.setdefault("s", {}).setdefault("e", {})
    eval_block.setdefault("t", "byQuestion")
    eval_block.setdefault("p", 0)
    eval_block.setdefault("atp", 0)
    eval_block["pt"] = max(0.0, float(points))


def _choice_template(chs: list[dict[str, Any]]) -> dict[str, Any]:
    return copy.deepcopy(chs[0]) if chs else {"i": _new_id(), "t": {}, "c": False}


def _apply_choice_text(ch: dict[str, Any], text: str, *, is_correct: bool = False) -> None:
    ch["i"] = _new_id()
    ch["c"] = is_correct
    if isinstance(ch.get("t"), dict):
        apply_text_to_node(ch["t"], text, "content")
    else:
        ch["t"] = text


DEFAULT_PICTURE_RECT = {
    "x": 243.48242530755715,
    "y": 152.17981079537654,
    "w": 233.03514938488576,
    "h": 190.77184773321883,
}
DEFAULT_VIDEO_RECT = {
    "x": 200.0,
    "y": 140.0,
    "w": 320.0,
    "h": 200.0,
}
DEFAULT_AUDIO_RECT = {
    "x": 200.0,
    "y": 160.0,
    "w": 320.0,
    "h": 48.0,
}


def _copy_image_to_package(src: Path, package_root: Path) -> str:
    images_dir = package_root / "res" / "data" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    dest_name = f"img-import-{uuid.uuid4().hex[:12]}{src.suffix.lower()}"
    dest_path = images_dir / dest_name
    shutil.copy2(src, dest_path)
    return dest_name


def _copy_audio_to_package(src: Path, package_root: Path) -> str:
    audios_dir = package_root / "res" / "data" / "audios"
    audios_dir.mkdir(parents=True, exist_ok=True)
    dest_name = f"snd-import-{uuid.uuid4().hex[:12]}{src.suffix.lower()}"
    dest_path = audios_dir / dest_name
    shutil.copy2(src, dest_path)
    return dest_name


def _copy_video_to_package(src: Path, package_root: Path) -> str:
    videos_dir = package_root / "res" / "data" / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    dest_name = f"vid-import-{uuid.uuid4().hex[:12]}{src.suffix.lower()}"
    dest_path = videos_dir / dest_name
    shutil.copy2(src, dest_path)
    return dest_name


def _media_warning(label: str, ref: str) -> str:
    return f"Không tìm thấy {label}: {ref}"


def _is_remote_url(ref: str | None) -> bool:
    return bool(ref and ref.lower().startswith(("https://", "http://")))


def _resolve_and_copy_image(
    ref: str | None,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
    warnings: list[str],
) -> str | None:
    if not ref:
        return None
    if _is_remote_url(ref):
        return ref
    media_src = resolve_media_path(ref, excel_dir, fallback_media_dirs)
    if not media_src or not media_src.exists():
        warnings.append(_media_warning("ảnh", ref))
        return None
    return _copy_image_to_package(media_src, package_root)


def _resolve_and_copy_audio(
    ref: str | None,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
    warnings: list[str],
) -> str | None:
    if not ref:
        return None
    if _is_remote_url(ref):
        return ref
    media_src = resolve_media_path(ref, excel_dir, fallback_media_dirs)
    if not media_src or not media_src.exists():
        warnings.append(_media_warning("audio", ref))
        return None
    return _copy_audio_to_package(media_src, package_root)


def _resolve_and_copy_video(
    ref: str | None,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
    warnings: list[str],
) -> str | None:
    if not ref:
        return None
    if _is_remote_url(ref):
        return ref
    media_src = resolve_media_path(ref, excel_dir, fallback_media_dirs)
    if not media_src or not media_src.exists():
        warnings.append(_media_warning("video", ref))
        return None
    return _copy_video_to_package(media_src, package_root)


def _clear_template_attachments(slide: dict[str, Any]) -> None:
    """
    Strip media inherited from MASTER SCORM slide templates.

    Cloned MC/TF/… slides keep the master's pictureFill background and
    slidePicture objects even when Excel/TSV has no Image column — users
    then see "ghost" images that are not in their media/ folder.
    """
    slide.pop("at", None)

    area = slide.get("a")
    if not isinstance(area, dict):
        return

    # Background: reset pictureFill → solid white (iSpring solidFill)
    bg = area.get("b")
    if isinstance(bg, dict) and bg.get("f") == "pictureFill":
        area["b"] = {"f": "solidFill", "s": {"c": 16777215, "a": 1}}

    # Remove media layout objects; re-added when row has image/audio/video
    objects = area.get("o")
    if isinstance(objects, list):
        area["o"] = [
            obj
            for obj in objects
            if not isinstance(obj, dict)
            or obj.get("tp")
            not in {
                "slidePicture",
                "slideVideo",
                "slideAudio",
                "image",
                "video",
                "audio",
            }
        ]
        # Also clear pictureFill on remaining shapes (icon decorations etc.)
        for obj in area["o"]:
            if not isinstance(obj, dict):
                continue
            styles = obj.get("S")
            if not isinstance(styles, dict):
                continue
            fill = styles.get("b")
            if isinstance(fill, dict) and fill.get("f") == "pictureFill":
                styles["b"] = {"f": "solidFill", "s": {"c": 16777215, "a": 0}}


def _ensure_slide_object(
    slide: dict[str, Any],
    object_type: str,
    name: str,
    rect: dict[str, float],
) -> None:
    objects = slide.setdefault("a", {}).setdefault("o", [])
    if any(obj.get("tp") == object_type for obj in objects):
        return
    objects.append(
        {
            "tp": object_type,
            "I": name,
            "k": False,
            "r": {
                "x": float(rect["x"]),
                "y": float(rect["y"]),
                "w": max(40.0, float(rect["w"])),
                "h": max(40.0, float(rect["h"])),
            },
            "s": "rectangle",
            "S": _blank_object_styles(),
            "b": 0.3,
        }
    )
    _bump_slide_object_quota(slide, object_type)


def _apply_question_image(slide: dict[str, Any], image_name: str) -> None:
    set_slide_attachment(slide, image_name, zoom=True)
    _ensure_slide_object(
        slide,
        "slidePicture",
        "Slide Picture 1",
        DEFAULT_PICTURE_RECT,
    )


def _apply_choice_image(ch: dict[str, Any], image_name: str) -> None:
    ch.setdefault("ia", {})["i"] = f"storage://images/{image_name}"


def _apply_slide_audio(slide: dict[str, Any], audio_name: str) -> None:
    slide.setdefault("at", {})
    slide["at"]["a"] = {
        "i": f"storage://sounds/{audio_name}",
        "a": True,
        "pe": False,
        "pl": 1,
        "pb": True,
        "r": "",
    }
    _ensure_slide_object(slide, "slideAudio", "Slide Audio 1", DEFAULT_AUDIO_RECT)


def _apply_slide_video(
    slide: dict[str, Any],
    video_name: str,
    poster_name: str,
    *,
    package_root: Path,
) -> None:
    video_path = package_root / "res" / "data" / "videos" / video_name
    width, height = 640, 360
    if video_path.is_file():
        width, height = image_dimensions(video_path)

    slide.setdefault("at", {})
    slide["at"]["v"] = {
        "i": f"storage://videos/{video_name}",
        "pi": f"storage://images/{poster_name}",
        "w": width,
        "h": height,
        "a": True,
        "pe": False,
        "pl": 1,
        "pb": True,
        "r": "",
    }
    _ensure_slide_object(slide, "slideVideo", "Slide Video 1", DEFAULT_VIDEO_RECT)


def _apply_row_to_slide(
    slide: dict[str, Any],
    row: ExcelQuestion,
    *,
    package_root: Path,
    excel_dir: Path,
    fallback_media_dirs: list[Path],
) -> list[str]:
    warnings: list[str] = []
    slide["i"] = _new_id()
    slide["tp"] = row.ispring_type
    _clear_template_attachments(slide)
    _clear_template_feedback(slide)
    slide.setdefault("D", {})
    if row.question_text:
        apply_text_to_node(slide["D"], row.question_text, "title")
    _apply_feedback_block(
        slide,
        "c",
        row.correct_feedback,
        package_root=package_root,
        excel_dir=excel_dir,
        fallback_media_dirs=fallback_media_dirs,
        warnings=warnings,
    )
    _apply_feedback_block(
        slide,
        "i",
        row.incorrect_feedback,
        package_root=package_root,
        excel_dir=excel_dir,
        fallback_media_dirs=fallback_media_dirs,
        warnings=warnings,
    )
    _set_points(slide, row.points)

    # Store metadata for CMS export
    slide["_metadata"] = {
        "difficulty": row.difficulty,
        "topic": row.topic,
        "required": row.required,
        "useRegex": row.use_regex,
        "explanation": row.explanation,
        "video": row.video,
        "audio": row.audio,
    }

    question_image = _resolve_and_copy_image(
        row.image,
        package_root=package_root,
        excel_dir=excel_dir,
        fallback_media_dirs=fallback_media_dirs,
        warnings=warnings,
    )
    if question_image:
        _apply_question_image(slide, question_image)

    if not _is_remote_url(row.audio):
        audio_name = _resolve_and_copy_audio(
            row.audio,
            package_root=package_root,
            excel_dir=excel_dir,
            fallback_media_dirs=fallback_media_dirs,
            warnings=warnings,
        )
        if audio_name:
            slide["_metadata"]["audio"] = ""
            _apply_slide_audio(slide, audio_name)

    if not _is_remote_url(row.video):
        video_name = _resolve_and_copy_video(
            row.video,
            package_root=package_root,
            excel_dir=excel_dir,
            fallback_media_dirs=fallback_media_dirs,
            warnings=warnings,
        )
        if video_name:
            slide["_metadata"]["video"] = video_name
            poster_name = question_image
            if not poster_name:
                poster_name = _resolve_and_copy_image(
                    row.image,
                    package_root=package_root,
                    excel_dir=excel_dir,
                    fallback_media_dirs=fallback_media_dirs,
                    warnings=warnings,
                )
            if poster_name:
                _apply_slide_video(slide, video_name, poster_name, package_root=package_root)
            else:
                warnings.append(
                    f"Video {row.video} cần ảnh câu hỏi (poster) — bỏ qua gắn video"
                )

    tp = row.ispring_type
    slide.setdefault("C", {})

    if tp in ("MultipleChoice", "MultipleResponse", "TrueFalse"):
        template = _choice_template(slide["C"].get("chs", []))
        chs = []
        answers = list(row.answers)
        # TF: only two options (Đúng/Sai). Extra columns often are explanation leakage.
        if tp == "TrueFalse":
            answers = answers[:2]
            # Normalize labels if recognizable; keep author text otherwise but cap at 2
            if len(answers) < 2:
                warnings.append("TF thiếu 2 đáp án — bổ sung Đúng/Sai")
        for ans in answers:
            ch = copy.deepcopy(template)
            ch.pop("ia", None)
            ch.pop("f", None)
            label = ans.text
            if tp == "TrueFalse":
                low = (label or "").strip().lower().rstrip(".!?,;:")
                if low in ("đúng", "dung", "true", "yes", "t", "đ", "1"):
                    label = "Đúng"
                elif low in ("sai", "false", "no", "f", "0", "không", "khong"):
                    label = "Sai"
            _apply_choice_text(ch, label, is_correct=ans.is_correct)
            _apply_choice_media(
                ch,
                ans,
                package_root=package_root,
                excel_dir=excel_dir,
                fallback_media_dirs=fallback_media_dirs,
                warnings=warnings,
            )
            chs.append(ch)
        # Ensure TF always has exactly Đúng + Sai if only one answer provided
        if tp == "TrueFalse" and len(chs) == 1:
            other = copy.deepcopy(template)
            other.pop("ia", None)
            other.pop("f", None)
            first_correct = bool(chs[0].get("c"))
            first_text = ""
            tnode = chs[0].get("t")
            if isinstance(tnode, dict):
                from .scorm_parser import strip_html
                first_text = strip_html(tnode.get("h") or tnode.get("a") or "")
            else:
                first_text = str(tnode or "")
            other_label = "Sai" if first_text.strip().lower().startswith("đúng") or first_text.strip().lower() == "true" else "Đúng"
            _apply_choice_text(other, other_label, is_correct=not first_correct)
            chs.append(other)
        slide["C"]["chs"] = chs

    elif tp == "Sequence":
        template = _choice_template(slide["C"].get("chs", []))
        chs = []
        for i, ans in enumerate(row.answers):
            ch = copy.deepcopy(template)
            ch.pop("ia", None)
            ch.pop("f", None)
            _apply_choice_text(ch, ans.text)
            _apply_choice_media(
                ch,
                ans,
                package_root=package_root,
                excel_dir=excel_dir,
                fallback_media_dirs=fallback_media_dirs,
                warnings=warnings,
            )
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
            pair.setdefault("p", {})
            pair.setdefault("r", {})
            pair["p"]["i"] = _new_id()
            pair["r"]["i"] = _new_id()
            # CRITICAL: master Matching pairs often carry left/right images (ia).
            # Strip them first so Excel rows without Left/Right Image stay text-only.
            pair["p"].pop("ia", None)
            pair["r"].pop("ia", None)
            # Clear inline rich-media remnants on text nodes if any
            for side in ("p", "r"):
                tnode = pair[side].get("t")
                if isinstance(tnode, dict):
                    tnode.pop("r", None)
            apply_text_to_node(pair["p"].setdefault("t", {}), ans.premise, "content")
            apply_text_to_node(pair["r"].setdefault("t", {}), ans.response, "content")
            # Apply left image only when Excel/TSV provides it (ans.image)
            if ans.image:
                left_img_name = _resolve_and_copy_image(
                    ans.image,
                    package_root=package_root,
                    excel_dir=excel_dir,
                    fallback_media_dirs=fallback_media_dirs,
                    warnings=warnings,
                )
                if left_img_name:
                    pair["p"].setdefault("ia", {})["i"] = f"storage://images/{left_img_name}"
            # Apply right image only when provided (ans.right_image)
            if ans.right_image:
                right_img_name = _resolve_and_copy_image(
                    ans.right_image,
                    package_root=package_root,
                    excel_dir=excel_dir,
                    fallback_media_dirs=fallback_media_dirs,
                    warnings=warnings,
                )
                if right_img_name:
                    pair["r"].setdefault("ia", {})["i"] = f"storage://images/{right_img_name}"
            pairs.append(pair)
        slide["C"]["m"] = pairs

    elif tp == "TypeIn":
        accepted = [ans.text for ans in row.answers if ans.text]
        slide["C"]["chs"] = [
            {"i": _new_id(), "t": answer} for answer in accepted
        ]

    elif tp == "WordBank":
        rt = slide["C"].setdefault("rt", {})
        blank_ids = _blank_ids_from_html(rt.get("h", ""), "qmWordBank")
        blank_id = blank_ids[0] if blank_ids else "qmWordBank0"
        correct = next((a.text for a in row.answers if a.is_correct and a.text), None)
        if not correct:
            correct = next((a.text for a in row.answers if a.text), "")
        extra_words = [a.text for a in row.answers if a.text and a.text != correct]
        slide["C"]["ew"] = extra_words
        plain = strip_plain(row.question_text)
        blank_span = f'<span id="{blank_id}"></span>'
        rich_html = (
            f'<p style="font-size:18px;font-family:{FONT_CONTENT};color:#000000">'
            f'<span>{html.escape(plain)}</span>​{blank_span}​</p>'
        )
        apply_text_to_node(rt, plain, "content")
        rt["h"] = rich_html
        rt["d"] = [plain, {"id": blank_id}]
        if correct:
            _upsert_wordbank_answer(rt, blank_id, correct)

    elif tp == "FillInTheBlank":
        rt = slide["C"].setdefault("rt", {})
        blank_ids = _blank_ids_from_html(rt.get("h", ""), "qmFillInTheBlank")
        blank_id = blank_ids[0] if blank_ids else "qmFillInTheBlank0"
        answers = [ans.text for ans in row.answers if ans.text]
        plain = strip_plain(row.question_text)
        blank_span = f'<span id="{blank_id}"></span>'
        escaped_question = html.escape(plain)
        if "___" in escaped_question:
            fill_content = escaped_question.replace("___", blank_span, 1)
        else:
            fill_content = f"{escaped_question} {blank_span}".strip()
        rich_html = (
            f'<p style="font-size:18px;font-family:{FONT_CONTENT};color:#000000">'
            f'<span>{fill_content}</span></p>'
        )
        apply_text_to_node(rt, plain, "content")
        rt["h"] = rich_html
        rt["d"] = [plain, {"id": blank_id}]
        if answers:
            _upsert_blank_answer(rt, blank_id, answers, "qmFillInTheBlank")

    elif tp in ("Numeric", "MultipleNumeric"):
        slide["C"]["chs"] = [
            {"i": _new_id(), "t": ans.text}
            for ans in row.answers
            if ans.text
        ]

    elif tp == "InfoSlide":
        body = row.answers[0].text if row.answers else row.question_text
        slide.setdefault("D", {})
        apply_text_to_node(slide["D"], body, "content")

    reflow_imported_slide(slide)
    return warnings


def build_quiz_from_excel(
    quiz_json: dict[str, Any],
    rows: list[ExcelQuestion],
    *,
    package_root: Path,
    excel_dir: Path,
    group_title: str = "Imported Questions",
    quiz_title: str | None = None,
    teky_quiz: dict[str, Any] | None = None,
    additional_media_dirs: list[Path] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Inject parsed Excel rows into quiz JSON (adds a new question group).
    Returns (updated_quiz, import_report).
    """
    templates = load_slide_templates()
    fallback_dirs = [
        excel_dir,
        *(additional_media_dirs or []),
        IMPORT_TEMPLATE_DIR,
        PROJECT_ROOT,
    ]
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

        skip_reason = SKIP_IMPORT_TYPES.get(row.ispring_type)
        if skip_reason:
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "skipped",
                "errors": [skip_reason],
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
            warnings = _apply_row_to_slide(
                slide,
                row,
                package_root=package_root,
                excel_dir=excel_dir,
                fallback_media_dirs=fallback_dirs,
            )
            new_slides.append(slide)
            entry: dict[str, Any] = {
                "row": row.row_index,
                "type": row.excel_type,
                "status": "imported",
                "slideId": slide["i"],
                "question": (row.question_text or row.image or "")[:80],
            }
            if warnings:
                entry["warnings"] = warnings
            report.append(entry)
        except Exception as exc:
            report.append({
                "row": row.row_index,
                "type": row.excel_type,
                "status": "error",
                "errors": [str(exc)],
            })

    quiz = copy.deepcopy(quiz_json)
    if teky_quiz:
        teky_meta = copy.deepcopy(teky_quiz)
        cover_ref = teky_meta.get("coverImage")
        if cover_ref:
            cover_warnings: list[str] = []
            cover_name = _resolve_and_copy_image(
                cover_ref,
                package_root=package_root,
                excel_dir=excel_dir,
                fallback_media_dirs=fallback_dirs,
                warnings=cover_warnings,
            )
            if cover_name:
                teky_meta["coverImage"] = cover_name
            elif cover_warnings:
                # Avoid returning an Excel-relative URL that is guaranteed to
                # produce a broken image and repeated asset 404 responses.
                teky_meta["coverImage"] = ""
                target = next((item for item in report if item.get("status") == "imported"), None)
                if target is not None:
                    target.setdefault("warnings", []).extend(cover_warnings)
                    target.setdefault("quizWarnings", []).extend(cover_warnings)
        quiz["_teky"] = teky_meta
    resolved_title = quiz_title or (teky_quiz or {}).get("title")
    if resolved_title:
        quiz.setdefault("d", {})["T"] = resolved_title

    groups = quiz.setdefault("d", {}).setdefault("sl", {}).setdefault("g", [])
    groups.clear()
    groups.append({"T": group_title, "S": new_slides})

    return quiz, report
