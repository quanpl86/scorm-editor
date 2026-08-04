"""
Convert SCORM/iSpring quiz JSON to Teky-school JSON schema
(same format as scorm-cvt parseScormToTekyJson).

Type mapping (iSpring → Teky):
  MultipleChoice / MultipleChoiceText  → multiple_choice
  MultipleResponse                     → multiple_select
  TrueFalse                            → true_false
  TypeIn / Numeric                     → fill_blank
  FillInTheBlank / WordBank            → fill_blank
  Matching                             → matching
  Sequence                             → ordering
  InfoSlide                            → skipped
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any, Callable

from .fill_blank import (
    align_blank_answers,
    drag_options,
    ensure_question_markers,
    normalize_blank_answers,
    normalize_distractors,
)
from .media_bundle import fetch_remote_media, is_remote_url
from .scorm_parser import (
    extract_blank_answers,
    extract_choices,
    extract_matching_pairs,
    extract_sequence_items,
    extract_type_in_answers,
    get_package_root,
    quiz_to_view,
    strip_html,
)

# ── Type mapping ─────────────────────────────────────────────────────────────
ISPRING_TO_TEKY: dict[str, str] = {
    "MultipleChoice":     "multiple_choice",
    "MultipleChoiceText": "multiple_choice",
    "MultipleResponse":   "multiple_select",
    "TrueFalse":          "true_false",
    "TypeIn":             "short_answer",
    "Numeric":            "numeric",
    "MultipleNumeric":    "multiple_numeric",
    "FillInTheBlank":     "fill_blank",
    "WordBank":           "fill_blank",
    "Matching":           "matching",
    "Sequence":           "ordering",
    "Hotspot":            "multiple_select",
    "DND":                "matching",
}

SKIP_TYPES = {"InfoSlide", "IntroSlide", "ResultSlide"}


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", strip_html(text)).strip()


def _normalize_asset_filename(filename: str | None) -> str | None:
    """Strip media/images/storage prefixes → bare file name for package lookup."""
    if not filename:
        return None
    f = str(filename).strip().replace("\\", "/")
    if not f:
        return None
    if f.startswith("http://") or f.startswith("https://"):
        return f
    f = f.split("?")[0].split("%7B")[0].split("{")[0]
    for prefix in (
        "storage://images/",
        "storage://sounds/",
        "storage://videos/",
        "res/data/images/",
        "res/data/audios/",
        "res/data/videos/",
        "data/images/",
        "media/",
        "images/",
    ):
        if f.lower().startswith(prefix):
            f = f[len(prefix) :]
            break
    # keep only file name (CMS/S3 use basename after package copy)
    name = Path(f).name if f else ""
    return name or None


def _asset_url(
    session_id: str,
    filename: str | None,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> str | None:
    """Return public S3 URL if uploader provided, else relative images/ path for local QA."""
    if not filename:
        return None
    raw = str(filename).strip()
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw

    clean = _normalize_asset_filename(raw)
    if not clean:
        return None

    if s3_uploader:
        # Try original + normalized names
        for candidate in (raw, clean, f"media/{clean}", f"images/{clean}"):
            try:
                s3_url = s3_uploader(candidate)
            except Exception:
                s3_url = None
            if s3_url:
                return s3_url

    # Fallback local/QA path (CMS LMS thường KHÔNG load được relative path này)
    return f"images/{clean}"


def _convert_mc_options(
    choices: list[dict[str, Any]],
    session_id: str,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Returns (options, correctAnswer).
    options: [{id, text, imageUrl?}]
    correctAnswer: [id, ...] of correct choices
    """
    options: list[dict[str, Any]] = []
    correct_ids: list[str] = []
    for ch in choices:
        opt: dict[str, Any] = {
            "id": ch.get("id", ""),
            "text": _clean(ch.get("text", "")),
        }
        img = _asset_url(session_id, ch.get("image"), base_url, s3_uploader)
        if img:
            opt["imageUrl"] = img
        options.append(opt)
        if ch.get("isCorrect"):
            correct_ids.append(ch.get("id", ""))
    return options, correct_ids


def _tf_polarity(text: str) -> str | None:
    """
    Classify a choice label as 'true' / 'false' / None (not a TF label).
    Strips punctuation so 'Đúng.' / 'Sai!' still match.
    """
    raw = _clean(text).lower().strip()
    if not raw:
        return None
    # remove trailing/leading punctuation & spaces
    normalized = re.sub(r"^[\s\.\,\!\?\:\;\"'\(\)\[\]…]+|[\s\.\,\!\?\:\;\"'\(\)\[\]…]+$", "", raw)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    true_labels = {
        "đúng", "dung", "true", "yes", "y", "t", "đ", "d", "1",
        "đúng rồi", "chính xác", "đúng.", "true.",
    }
    false_labels = {
        "sai", "false", "no", "n", "f", "0", "không", "khong",
        "sai rồi", "sai.", "false.",
    }
    if normalized in true_labels:
        return "true"
    if normalized in false_labels:
        return "false"
    # starts with đúng/true (e.g. "Đúng (True)")
    if normalized.startswith("đúng") or normalized.startswith("dung") or normalized.startswith("true"):
        return "true"
    if normalized.startswith("sai") or normalized.startswith("false"):
        return "false"
    return None


def _convert_true_false(
    choices: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Returns (options, correctAnswer) for TrueFalse — always exactly 2 options
    matching Teky LMS CMS schema:

      options: [{id: "true", text: "Đúng"}, {id: "false", text: "Sai"}]
      correctAnswer: ["true"] | ["false"]
    """
    # Determine which polarity is marked correct
    correct_polarity: str | None = None
    for ch in choices or []:
        if not ch.get("isCorrect"):
            continue
        pol = _tf_polarity(ch.get("text", "") or "")
        if pol:
            correct_polarity = pol
            break
        # marked correct but text not recognized as TF label —
        # if it's the first choice assume true, else false (legacy MC-like order)
        # Prefer scanning all isCorrect first; fallback below.

    if correct_polarity is None:
        # Fallback: first isCorrect choice by index among TF-like labels only
        for ch in choices or []:
            pol = _tf_polarity(ch.get("text", "") or "")
            if pol is None:
                continue
            if ch.get("isCorrect"):
                correct_polarity = pol
                break
        if correct_polarity is None:
            # any isCorrect among first two slots
            for idx, ch in enumerate((choices or [])[:2]):
                if ch.get("isCorrect"):
                    # slot 0 → true, slot 1 → false (common iSpring order Đúng/Sai)
                    correct_polarity = "true" if idx == 0 else "false"
                    break

    if correct_polarity not in ("true", "false"):
        correct_polarity = "true"

    options = [
        {"id": "true", "text": "Đúng"},
        {"id": "false", "text": "Sai"},
    ]
    return options, [correct_polarity]


def _convert_matching(
    pairs: list[dict[str, Any]],
    session_id: str,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Returns (pairs, correctAnswer).
    pairs: [{id, left, leftImageUrl?, right, rightImageUrl?}]
    correctAnswer: ["id:right", ...]
    """
    result: list[dict[str, Any]] = []
    correct: list[str] = []
    for idx, pair in enumerate(pairs):
        left = _clean(pair.get("leftText", ""))
        right = _clean(pair.get("rightText", ""))
        pair_id = f"pair-{idx}"
        item: dict[str, Any] = {
            "id": pair_id,
            "left": left,
            "right": right,
        }
        li = _asset_url(session_id, pair.get("leftImage"), base_url, s3_uploader)
        ri = _asset_url(session_id, pair.get("rightImage"), base_url, s3_uploader)
        if li:
            item["leftImageUrl"] = li
        if ri:
            item["rightImageUrl"] = ri
        result.append(item)
        correct.append(f"{pair_id}:{right}")
    return result, correct


def _convert_ordering(
    items: list[dict[str, Any]],
    session_id: str,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Returns (orderingItems, correctAnswer).
    orderingItems: [{id, text, imageUrl?}]
    correctAnswer: [id, ...] in correct order
    """
    sorted_items = sorted(items, key=lambda x: x.get("order", 0))
    ordering: list[dict[str, Any]] = []

    for it in sorted_items:
        item = {"id": it.get("id", ""), "text": _clean(it.get("text", ""))}
        img_url = _asset_url(session_id, it.get("image"), base_url, s3_uploader)
        if img_url:
            item["imageUrl"] = img_url
        ordering.append(item)

    correct = [it["id"] for it in ordering]
    return ordering, correct



def _convert_hotspot(
    slide_view: dict[str, Any],
    session_id: str,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    from pathlib import Path
    try:
        from PIL import Image
    except ImportError:
        Image = None

    package_root = get_package_root(session_id)
    
    choices = slide_view.get("choices", [])
    if not choices:
        return [], []
        
    bg_image_raw = choices[0].get("image")
    if not bg_image_raw:
        return [], []
        
    bg_filename = str(bg_image_raw).split("/")[-1].split("?")[0] or "hotspot.png"
    bg_stem = Path(bg_filename).stem
    bg_path = None
    if not is_remote_url(str(bg_image_raw)):
        for folder in ("res/data/images", "data/images", "images"):
            d = package_root / folder
            if not d.is_dir():
                continue
            for cand in d.iterdir():
                if cand.is_file() and cand.stem == bg_stem:
                    bg_path = cand
                    break
            if bg_path:
                break
            
    img = None
    if Image and is_remote_url(str(bg_image_raw)):
        try:
            import io
            remote_bytes, _, _ = fetch_remote_media(str(bg_image_raw))
            img = Image.open(io.BytesIO(remote_bytes))
        except Exception:
            img = None
    elif bg_path and Image:
        try:
            img = Image.open(bg_path)
        except Exception:
            img = None
            
    result = []
    correct = []
    for idx, ch in enumerate(choices):
        opt = {
            "id": ch.get("id", f"hotspot-{idx}"),
            "text": ch.get("text", f"Vùng {idx+1}")
        }
        
        rect = ch.get("rect", {})
        if img and rect and "w" in rect and "h" in rect:
            x = int(rect.get("x", 0) * img.width / 10000)
            y = int(rect.get("y", 0) * img.height / 10000)
            w = int(rect.get("w", 0) * img.width / 10000)
            h = int(rect.get("h", 0) * img.height / 10000)
            
            try:
                crop = img.crop((x, y, x + w, y + h))
                crop_name = f"crop_{idx}_{bg_filename}"
                crop_path = package_root / "res/data/images" / crop_name
                crop_path.parent.mkdir(parents=True, exist_ok=True)
                if crop.mode == "RGBA" and crop_path.suffix.lower() in (".jpg", ".jpeg"):
                    crop = crop.convert("RGB")
                crop.save(crop_path)
                
                if s3_uploader:
                    # Give it to s3_uploader with the bare filename since it looks up in package_root
                    s3_url = s3_uploader(crop_name)
                    if s3_url:
                        opt["imageUrl"] = s3_url
                    else:
                        opt["imageUrl"] = f"images/{crop_name}"
                else:
                    opt["imageUrl"] = f"images/{crop_name}"
            except Exception:
                pass
                
        result.append(opt)
        if ch.get("isCorrect"):
            correct.append(opt["id"])

    if len(result) == 1:
        result.append({"id": "hotspot-other", "text": "Khu vực khác"})
    return result, correct


def _convert_dnd(
    slide_view: dict[str, Any],
    session_id: str,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> tuple[str, dict[str, Any]] | None:
    items = slide_view.get("dndItems") or []
    mapped = [item for item in items if item.get("isMapped") and item.get("targetId")]
    target_ids = list(dict.fromkeys(str(item.get("targetId")) for item in mapped))
    if not mapped or not target_ids:
        return None

    if len(target_ids) == 1:
        target_id = target_ids[0]
        choices = []
        for item in items:
            choices.append({
                "id": item.get("id", ""),
                "text": item.get("sourceText", ""),
                "image": item.get("sourceImage"),
                "isCorrect": item.get("targetId") == target_id,
            })
        options, correct = _convert_mc_options(choices, session_id, base_url, s3_uploader)
        qtype = "multiple_choice" if len(correct) <= 1 else "multiple_select"
        if len(options) == 1:
            options.append({"id": "dnd-other", "text": "Phương án khác"})
        return qtype, {"options": options, "correctAnswer": correct}

    pairs = []
    for index, item in enumerate(mapped):
        pairs.append({
            "id": item.get("id") or f"dnd-pair-{index}",
            "leftText": item.get("sourceText", ""),
            "rightText": item.get("targetText", ""),
            "leftImage": item.get("sourceImage"),
            "rightImage": item.get("targetImage"),
        })
    pairs_out, correct = _convert_matching(pairs, session_id, base_url, s3_uploader)
    return "matching", {"pairs": pairs_out, "correctAnswer": correct}


def _slide_to_teky(
    slide_view: dict[str, Any],
    session_id: str,
    base_url: str,
    s3_uploader: Callable[[str], str | None] = None,
) -> dict[str, Any] | None:
    """Convert one slide view to Teky question object. Returns None for skipped types."""
    ispring_type = slide_view.get("type", "")
    if ispring_type in SKIP_TYPES:
        return None

    teky_type = ISPRING_TO_TEKY.get(ispring_type)
    if not teky_type:
        return None  # Unknown type — skip

    question_text = _clean(slide_view.get("questionText", ""))
    subtitle_text = _clean(slide_view.get("subtitleText", ""))
    if subtitle_text and slide_view.get("type") in ("WordBank", "FillInTheBlank"):
        question_text = f"{question_text}\n\n{subtitle_text}".strip()

    # Question-level image (first in slideImages)
    slide_images = slide_view.get("slideImages") or []
    question_img = _asset_url(session_id, slide_images[0] if slide_images else None, base_url, s3_uploader)

    q: dict[str, Any] = {
        "id": slide_view.get("id", ""),
        "type": teky_type,
        "question": question_text,
        "points": slide_view.get("points", 1),
        "required": bool(slide_view.get("required", False)),
        "metadata": {
            "difficulty": slide_view.get("difficulty") or "medium",
            "topic": slide_view.get("topic") or slide_view.get("groupTitle", ""),
        },
        "explanation": slide_view.get("explanation", ""),
    }
    if question_img:
        q["imageUrl"] = question_img

    question_video = slide_view.get("video")
    if question_video:
        video_url = question_video
        if not question_video.startswith("http") and s3_uploader:
            video_url = s3_uploader(question_video) or question_video
        q["videoUrl"] = video_url

    question_audio = slide_view.get("audio")
    if question_audio:
        q["audioUrl"] = question_audio

    choices = slide_view.get("choices") or []
    matching_pairs = slide_view.get("matchingPairs") or []
    sequence_items = slide_view.get("sequenceItems") or []
    blank_answers = slide_view.get("blankAnswers") or []
    type_in = slide_view.get("typeInAnswers") or []

    if ispring_type == "DND":
        converted = _convert_dnd(slide_view, session_id, base_url, s3_uploader)
        if not converted:
            return None
        q["type"], payload = converted
        q.update(payload)
        q["conversionMetadata"] = {
            "sourceType": "DND",
            "strategy": "single-target-mc-mr" if q["type"] != "matching" else "multi-target-matching",
        }
        return q

    if teky_type in {"multiple_choice", "multiple_select", "true_false"}:
        if ispring_type == "TrueFalse":
            opts, correct = _convert_true_false(slide_view.get("choices", []))
        elif ispring_type == "Hotspot":
            opts, correct = _convert_hotspot(slide_view, session_id, base_url, s3_uploader)
            if len(correct) <= 1:
                q["type"] = "multiple_choice"
            q["conversionMetadata"] = {
                "sourceType": "Hotspot",
                "strategy": "cropped-regions-mc-mr",
            }
        else:
            opts, correct = _convert_mc_options(slide_view.get("choices", []), session_id, base_url, s3_uploader)
        q["options"] = opts
        q["correctAnswer"] = correct

    elif teky_type == "fill_blank":
        source_text = subtitle_text or question_text
        blanks = align_blank_answers(source_text, normalize_blank_answers(blank_answers))
        distractors = normalize_distractors(
            slide_view.get("blankDistractors")
            or slide_view.get("wordBankWords")
            or []
        )
        # Teky CMS treats `options` of fill_blank as *distractor cards only*;
        # correct cards are generated from correctAnswer/blankAnswers.  Never
        # allow a correct value to leak into the distractor collection, even
        # when an older editor state accidentally stored it among extra words.
        correct_value_keys = {
            str(value).strip().casefold()
            for blank in blanks
            for value in (blank.get("values") or [])
            if str(value).strip()
        }
        distractors = [
            value for value in distractors
            if value.strip().casefold() not in correct_value_keys
        ]
        q["question"] = ensure_question_markers(source_text, len(blanks))
        # Legacy CMS: one blank used correctAnswer as a synonym list. Keep that
        # exact shape; for multiple holders use the primary value in holder order.
        q["correctAnswer"] = (
            list(blanks[0]["values"])
            if len(blanks) == 1
            else [blank["values"][0] if blank["values"] else "" for blank in blanks]
        )
        q["blankAnswers"] = [
            {
                "id": blank["id"],
                "index": index,
                "values": list(blank["values"]),
                "acceptedAnswers": list(blank["values"]),
            }
            for index, blank in enumerate(blanks)
        ]
        # `blanks` is an explicit transport alias for the new CMS renderer;
        # `blankAnswers` remains the editor/iSpring-compatible representation.
        q["blanks"] = [
            {
                "id": blank["id"],
                "index": index,
                "correctAnswers": list(blank["values"]),
            }
            for index, blank in enumerate(blanks)
        ]
        q["distractors"] = distractors
        q["blankDistractors"] = distractors
        all_drag_options = drag_options(blanks, distractors)
        distractor_options = [
            option for option in all_drag_options
            if option.get("isDistractor")
        ]
        # Both aliases are intentionally distractor-only for compatibility
        # with CMS importer versions that bind either field to the
        # "Thẻ từ nhiễu bổ sung" form collection.
        q["dragOptions"] = distractor_options
        q["options"] = list(distractor_options)
        q["responseMode"] = "drag_in_blank"
        q["useRegex"] = bool(slide_view.get("useRegex", False))

    elif teky_type in ("short_answer", "numeric", "multiple_numeric"):
        answers = [a for a in type_in if a]
        q["correctAnswer"] = answers
        if teky_type == "short_answer":
            q["useRegex"] = bool(slide_view.get("useRegex", False))

    elif teky_type == "matching":
        pairs_out, correct = _convert_matching(matching_pairs, session_id, base_url, s3_uploader)
        q["pairs"] = pairs_out
        q["correctAnswer"] = correct

    elif teky_type == "ordering":
        order_items, correct = _convert_ordering(sequence_items, session_id, base_url, s3_uploader)
        q["orderingItems"] = order_items
        q["correctAnswer"] = correct

    return q


def quiz_to_cms_json(
    quiz_view: dict[str, Any],
    session_id: str,
    *,
    base_url: str = "",
    include_sections: bool = False,  # ignored — kept for API compat
    s3_uploader: Callable[[str], str | None] = None,
) -> dict[str, Any]:
    """
    Convert the full quiz view to Teky-school JSON schema.
    Matches the output of scorm-cvt parseScormToTekyJson().
    Returns a single quiz object (not wrapped in an array).
    """
    title = quiz_view.get("title") or "Quiz SCORM"
    configured = quiz_view.get("tekyQuiz") or {}
    questions_raw = quiz_view.get("questions") or []
    datetime_module = __import__("datetime")
    now = datetime_module.datetime.now(datetime_module.timezone.utc).isoformat().replace("+00:00", "Z")
    configured_settings = configured.get("settings") or {}
    tags = configured.get("tags", ["SCORM", "Imported"])
    if isinstance(tags, str):
        tags = [item.strip() for item in re.split(r"[,;\n]", tags) if item.strip()]

    questions: list[dict[str, Any]] = []
    for slide in questions_raw:
        if slide.get("deleted"):
            continue
        q = _slide_to_teky(slide, session_id, base_url, s3_uploader)
        if q:
            questions.append(q)

    # Context Information (Teky LMS UI):
    # - subject / Related Subject → tên học phần
    # - targetLesson / Target Lesson → tên bài học
    groups = quiz_view.get("groups") or []
    group_title = (groups[0].get("title") if groups else None) or None
    target_lesson = (
        configured.get("targetLesson")
        or configured.get("target_lesson")
        or group_title
        or ""
    )

    result = {
        "id": configured.get("id") or f"quiz_{int(time.time() * 1000)}",
        "title": configured.get("title") or title,
        "description": configured.get("description", "Được chuyển đổi từ SCORM Editor."),
        "subject": configured.get("subject", "Lập trình"),
        "targetLesson": target_lesson or None,
        "difficultyLevel": configured.get("difficultyLevel", "medium"),
        "tags": tags,
        "createdBy": configured.get("createdBy", "admin"),
        "createdByName": configured.get("createdByName", "Hệ thống"),
        "isPublic": bool(configured.get("isPublic", False)),
        "duration": int(configured.get("duration", 1800) or 0),
        "questions": questions,
        "settings": {
            "shuffleQuestions": bool(configured_settings.get("shuffleQuestions", False)),
            "shuffleAnswers": bool(configured_settings.get("shuffleAnswers", False)),
            "attemptLimit": int(configured_settings.get("attemptLimit", 1) or 0),
            "showResults": configured_settings.get("showResults", "after_submit"),
            "allowReview": bool(configured_settings.get("allowReview", True)),
        },
        "createdAt": configured.get("createdAt") or now,
        "updatedAt": configured.get("updatedAt") or now,
    }
    if not result.get("targetLesson"):
        result.pop("targetLesson", None)
    cover_url = _asset_url(
        session_id,
        configured.get("coverImage"),
        base_url,
        s3_uploader,
    )
    if cover_url:
        result["coverImageUrl"] = cover_url
    return result
