"""Layout extraction, overlap detection, and apply for iSpring quiz slides."""

from __future__ import annotations

import html
import json
import math
import re
from typing import Any

from .typography import (
    FONT_CONTENT,
    FONT_TITLE,
    extract_text_format,
    pick_content_size,
    pick_title_size,
    strip_plain,
)


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(text))).strip()


def image_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    match = re.search(r"storage://images/(.+)", storage_uri)
    return match.group(1) if match else None

CANVAS_W = 720
CANVAS_H = 540

ROLE_LABELS = {
    "direction": "Câu hỏi",
    "content": "Vùng đáp án",
    "additionalContent": "Nội dung phụ",
    "slidePicture": "Ảnh slide",
    "image": "Ảnh",
    "shape": "Hình",
    "icon": "Biểu tượng",
    "hotspotArea": "Vùng hotspot",
}

# iSpring auto-layout defaults when shape has no explicit rect (common on result/intro slides)
DEFAULT_OBJECT_RECTS: dict[tuple[str, str], dict[str, float]] = {
    ("ResultSlide", "direction"): {"x": 33, "y": 118, "w": 654, "h": 72},
    ("IntroSlide", "direction"): {"x": 35, "y": 79, "w": 654, "h": 200},
    ("IntroSlide", "content"): {"x": 35, "y": 347, "w": 654, "h": 32},
    ("iconPlaceholder", "passed"): {"x": 285, "y": 68, "w": 150, "h": 110},
    ("iconPlaceholder", "failed"): {"x": 285, "y": 68, "w": 150, "h": 110},
}

RESULT_BUTTON_IDS = {"reviewBtn", "reportBtn", "restartBtn"}
RESULT_LABEL_IDS = {
    "passingScoreLabel",
    "passingScoreValue",
    "awardedScoreLabel",
    "awardedScoreValue",
}

FILL_MODE_CSS = {
    "fill": "cover",
    "fit": "contain",
    "stretch": "fill",
    "tile": "none",
}


def ispring_color_to_hex(value: int | float | None) -> str:
    if value is None:
        return "#000000"
    return f"#{int(value) & 0xFFFFFF:06x}"


def resolve_object_rect(obj: dict[str, Any], slide: dict[str, Any]) -> dict[str, float]:
    r = obj.get("r") or {}
    if r.get("w") and r.get("h"):
        return {
            "x": round(float(r.get("x", 0)), 2),
            "y": round(float(r.get("y", 0)), 2),
            "w": round(float(r.get("w", 0)), 2),
            "h": round(float(r.get("h", 0)), 2),
        }

    slide_tp = slide.get("tp", "")
    obj_id = obj.get("I", "")
    obj_tp = obj.get("tp", "")
    key = (obj_tp, obj_id) if obj_tp == "iconPlaceholder" else (slide_tp, obj_id)
    fallback = DEFAULT_OBJECT_RECTS.get(key)
    if fallback:
        return {k: round(float(v), 2) for k, v in fallback.items()}

    return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}


def extract_shape_visual(obj: dict[str, Any]) -> dict[str, Any]:
    style = obj.get("S", {}) or {}
    bg = style.get("b", {}) or {}
    stroke = style.get("s", {}) or {}
    text_box = style.get("t", {}) or {}
    shape_kind = obj.get("s") or "rectangle"
    obj_id = obj.get("I", "")

    visual: dict[str, Any] = {
        "shapeKind": shape_kind,
        "padding": {
            "l": text_box.get("l", 8),
            "r": text_box.get("r", 8),
            "t": text_box.get("t", 4),
            "b": text_box.get("b", 4),
        },
        "verticalAlign": text_box.get("v", "middle"),
        "borderRadius": 19 if shape_kind == "roundedRectangle" else 0,
        "background": "transparent",
        "gradient": None,
        "border": None,
        "variant": "default",
    }

    if obj_id in RESULT_BUTTON_IDS:
        visual["variant"] = "button"
    elif obj_id in RESULT_LABEL_IDS:
        visual["variant"] = "label"
    elif obj_id == "direction":
        visual["variant"] = "titleBox"

    if bg.get("f") == "gradientFill":
        gradient = bg.get("g", {}) or {}
        stops = gradient.get("c", []) or []
        visual["gradient"] = {
            "angle": gradient.get("a", 90),
            "stops": [
                {"color": ispring_color_to_hex(stop.get("c")), "pos": stop.get("p", 0)}
                for stop in stops
            ],
        }
    elif bg.get("f") == "solidFill" and bg.get("c") is not None:
        visual["background"] = ispring_color_to_hex(bg.get("c"))
    elif bg.get("f") == "none":
        visual["background"] = "transparent"

    if stroke.get("t") == "solid" and stroke.get("C") is not None:
        visual["border"] = {
            "width": stroke.get("s", 1),
            "color": ispring_color_to_hex(stroke.get("C")),
        }

    return visual


def object_role(obj: dict[str, Any]) -> str:
    name = obj.get("I", "")
    tp = obj.get("tp", "")
    if tp == "iconPlaceholder":
        return "icon"
    if name == "direction":
        return "direction"
    if name == "content":
        return "content"
    if name == "additionalContent":
        return "additionalContent"
    if tp == "slidePicture":
        return "slidePicture"
    if tp == "image":
        return "image"
    return "shape"


def object_display_name(obj: dict[str, Any]) -> str:
    role = object_role(obj)
    label = ROLE_LABELS.get(role, role)
    custom = obj.get("I", "")
    if custom and custom not in ("direction", "content"):
        return f"{label} — {custom}"
    return label


def extract_slide_attachment_image(slide: dict[str, Any]) -> str | None:
    """Image shown in slidePicture frame (slide.at), separate from slide background."""
    return image_path_from_storage(slide.get("at", {}).get("i", {}).get("i", ""))


def extract_background_meta(slide: dict[str, Any]) -> dict[str, Any]:
    bg = slide.get("a", {}).get("b", {})
    if bg.get("f") != "pictureFill":
        return {"image": None, "mode": "fill"}
    props = bg.get("p", {})
    mode = props.get("p", "fill") or "fill"
    return {
        "image": image_path_from_storage(props.get("i", "")),
        "mode": mode,
        "objectFit": FILL_MODE_CSS.get(mode, "cover"),
    }


def extract_object_image(obj: dict[str, Any], slide: dict[str, Any]) -> str | None:
    if obj.get("tp") == "slidePicture":
        attached = extract_slide_attachment_image(slide)
        if attached:
            return attached

    fill = obj.get("S", {}).get("b", {})
    if fill.get("f") == "pictureFill":
        return image_path_from_storage(fill.get("p", {}).get("i", ""))

    raw = json.dumps(obj, ensure_ascii=False)
    match = re.search(r"storage://images/([^\"]+)", raw)
    if match:
        return match.group(1)

    return None


def extract_object_html(obj: dict[str, Any], slide: dict[str, Any]) -> str:
    if obj.get("I") == "direction":
        return slide.get("D", {}).get("h", "") or ""
    if obj.get("I") == "content" and slide.get("tp") == "IntroSlide":
        rt = slide.get("C", {}).get("rt", {})
        return rt.get("h") or rt.get("a") or ""
    if "rt" in obj:
        return obj["rt"].get("h") or obj["rt"].get("a") or ""
    return ""


def extract_object_text(obj: dict[str, Any], slide: dict[str, Any]) -> str:
    html_text = extract_object_html(obj, slide)
    if html_text:
        return strip_html(html_text)
    return ""


def rect_tuple(r: dict[str, float]) -> tuple[float, float, float, float]:
    x, y, w, h = r.get("x", 0), r.get("y", 0), r.get("w", 0), r.get("h", 0)
    return (x, y, x + w, y + h)


def rects_overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def overlap_area(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    if not rects_overlap(a, b):
        return 0
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    return max(0, x2 - x1) * max(0, y2 - y1)


def detect_overlaps(objects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    important = [o for o in objects if o.get("role") in ("slidePicture", "image", "content", "direction")]

    for i, a in enumerate(important):
        for b in important[i + 1 :]:
            ra, rb = rect_tuple(a["r"]), rect_tuple(b["r"])
            if rects_overlap(ra, rb):
                area = overlap_area(ra, rb)
                warnings.append(
                    {
                        "a": a["index"],
                        "b": b["index"],
                        "aName": a["name"],
                        "bName": b["name"],
                        "area": round(area, 1),
                        "severity": "error"
                        if ("content" in (a["role"], b["role"]) and "slidePicture" in (a["role"], b["role"]))
                        or ("content" in (a["role"], b["role"]) and "image" in (a["role"], b["role"]))
                        else "warning",
                    }
                )

    for o in objects:
        r = o["r"]
        if r["y"] < 0:
            warnings.append({"object": o["index"], "name": o["name"], "message": "Tràn ra ngoài mép trên", "severity": "error"})
        if r["y"] + r["h"] > CANVAS_H:
            warnings.append({"object": o["index"], "name": o["name"], "message": "Tràn ra ngoài mép dưới", "severity": "error"})
        if r["x"] < 0:
            warnings.append({"object": o["index"], "name": o["name"], "message": "Tràn ra ngoài mép trái", "severity": "warning"})
        if r["x"] + r["w"] > CANVAS_W:
            warnings.append({"object": o["index"], "name": o["name"], "message": "Tràn ra ngoài mép phải", "severity": "warning"})

    return warnings


def extract_hotspots(slide: dict[str, Any]) -> list[dict[str, Any]]:
    if slide.get("tp") != "Hotspot":
        return []

    content = next((o for o in slide.get("a", {}).get("o", []) if o.get("I") == "content"), None)
    if not content:
        return []

    cr = content.get("r", {})
    areas = slide.get("C", {}).get("a", [])
    if not areas:
        return []

    max_x = max(a["r"]["x"] + a["r"]["w"] for a in areas)
    max_y = max(a["r"]["y"] + a["r"]["h"] for a in areas)
    scale_x = cr.get("w", 1) / max_x if max_x else 1
    scale_y = cr.get("h", 1) / max_y if max_y else 1

    result = []
    for idx, area in enumerate(areas):
        ar = area.get("r", {})
        result.append(
            {
                "index": idx,
                "label": area.get("l", f"Hotspot {idx + 1}"),
                "type": area.get("t", "rect"),
                "correct": bool(area.get("c")),
                "image": image_path_from_storage(slide.get("C", {}).get("i", "")),
                "sourceR": {"x": ar.get("x", 0), "y": ar.get("y", 0), "w": ar.get("w", 0), "h": ar.get("h", 0)},
                "r": {
                    "x": cr.get("x", 0) + ar.get("x", 0) * scale_x,
                    "y": cr.get("y", 0) + ar.get("y", 0) * scale_y,
                    "w": ar.get("w", 0) * scale_x,
                    "h": ar.get("h", 0) * scale_y,
                },
            }
        )
    return result


def extract_choice_preview(slide: dict[str, Any]) -> dict[str, Any] | None:
    qtype = slide.get("tp", "")
    content = next((o for o in slide.get("a", {}).get("o", []) if o.get("I") == "content"), None)
    if not content:
        return None

    preview: dict[str, Any] = {"type": qtype, "contentRect": content.get("r", {}), "items": []}

    if qtype in ("MultipleChoice", "MultipleResponse", "MultipleChoiceText"):
        for ch in slide.get("C", {}).get("chs", []):
            text = ""
            if isinstance(ch.get("t"), dict):
                text = strip_html(ch["t"].get("h") or ch["t"].get("a") or "")
            else:
                text = str(ch.get("t", ""))
            html = ""
            if isinstance(ch.get("t"), dict):
                html = ch["t"].get("h") or ch["t"].get("a") or ""
            t_node = ch.get("t") if isinstance(ch.get("t"), dict) else {}
            preview["items"].append(
                {
                    "text": text,
                    "html": html,
                    "format": extract_text_format(t_node.get("h", ""), t_node.get("t"), "content"),
                    "image": image_path_from_storage((ch.get("ia") or {}).get("i", "")),
                    "isCorrect": bool(ch.get("c")),
                    "inputType": "radio" if qtype == "MultipleChoice" else "checkbox",
                }
            )
    elif qtype == "TypeIn":
        preview["items"] = [{"inputType": "text", "placeholder": "Nhập đáp án..."}]
    elif qtype in ("WordBank", "FillInTheBlank"):
        preview["items"] = [{"inputType": "blank", "text": strip_html(slide.get("C", {}).get("rt", {}).get("h", ""))[:120]}]
    elif qtype == "Sequence":
        for ch in slide.get("C", {}).get("chs", []):
            preview["items"].append({"text": strip_html((ch.get("t") or {}).get("h", "")), "inputType": "sequence"})
    else:
        return preview if preview["items"] else None

    items = preview.get("items") or []
    if items and qtype in ("MultipleChoice", "MultipleResponse", "MultipleChoiceText"):
        cr = content.get("r", {}) or {}
        pad = extract_shape_visual(content).get("padding", {})
        avail_h = float(cr.get("h", 0)) - float(pad.get("t", 0)) - float(pad.get("b", 0))
        avail_w = float(cr.get("w", 0)) - float(pad.get("l", 0)) - float(pad.get("r", 0))
        has_images = any(item.get("image") for item in items)
        count = len(items)

        if has_images:
            cols = 1 if count <= 2 else 2
        elif qtype == "MultipleResponse":
            cols = 1 if count <= 3 else 2
        else:
            cols = 1

        rows = math.ceil(count / cols) if cols else count
        row_h = round(avail_h / rows, 2) if rows and avail_h > 0 else None

        preview["layout"] = {
            "columns": cols,
            "rows": rows,
            "rowHeight": row_h,
            "radioSize": 23,
            "choicePadding": 10,
            "contentPadding": pad,
            "contentWidth": round(avail_w, 2) if avail_w > 0 else None,
        }

    return preview


def extract_layout(slide: dict[str, Any]) -> dict[str, Any]:
    bg_meta = extract_background_meta(slide)

    objects = []
    for idx, obj in enumerate(slide.get("a", {}).get("o", [])):
        role = object_role(obj)
        rect = resolve_object_rect(obj, slide)
        html_text = extract_object_html(obj, slide)
        rt_node = obj.get("rt") if isinstance(obj.get("rt"), dict) else {}
        objects.append(
            {
                "index": idx,
                "tp": obj.get("tp", ""),
                "I": obj.get("I", ""),
                "name": object_display_name(obj),
                "role": role,
                "r": rect,
                "image": extract_object_image(obj, slide),
                "text": extract_object_text(obj, slide),
                "html": html_text,
                "textFormat": extract_text_format(
                    html_text,
                    rt_node.get("t") if rt_node else slide.get("D", {}).get("t") if obj.get("I") == "direction" else None,
                    "title" if obj.get("I") == "direction" else "content",
                )
                if html_text or rt_node
                else None,
                "iconKind": obj.get("I") if role == "icon" else None,
                "visual": extract_shape_visual(obj)
                if role in ("shape", "icon", "direction") or obj.get("tp") in ("shape", "iconPlaceholder")
                else None,
                "hasDefaultRect": not (obj.get("r") or {}).get("w"),
                "locked": bool(obj.get("k", False)),
                "selectable": role
                in ("direction", "content", "additionalContent", "slidePicture", "image", "shape", "icon"),
            }
        )

    question_text = strip_plain(slide.get("D", {}).get("h", ""))
    direction = next((o for o in objects if o.get("role") == "direction"), None)
    dir_w = direction["r"]["w"] if direction else 520
    q_fmt = extract_text_format(slide.get("D", {}).get("h", ""), slide.get("D", {}).get("t"), "title")
    title_size = q_fmt.get("fontSize") or pick_title_size(question_text, dir_w)

    choice_preview = extract_choice_preview(slide)
    content_size = None
    if choice_preview and choice_preview.get("items"):
        for item in choice_preview["items"]:
            fmt = item.get("format") or {}
            if fmt.get("fontSize"):
                content_size = fmt["fontSize"]
                break
    if not content_size:
        content_size = pick_content_size(question_text, title_size)

    return {
        "canvas": {"w": CANVAS_W, "h": CANVAS_H},
        "background": bg_meta["image"],
        "backgroundMode": bg_meta["mode"],
        "backgroundFit": bg_meta["objectFit"],
        "slidePicture": extract_slide_attachment_image(slide),
        "typography": {
            "titleFont": FONT_TITLE,
            "contentFont": FONT_CONTENT,
            "titleSize": title_size,
            "contentSize": content_size,
        },
        "objects": objects,
        "zOrder": [o["index"] for o in objects],
        "hotspots": extract_hotspots(slide),
        "choicePreview": choice_preview,
        "overlaps": detect_overlaps(objects),
    }


def layout_changed(slide: dict[str, Any], layout: dict[str, Any], *, epsilon: float = 0.5) -> bool:
    """True when incoming layout rects/z-order differ from the slide."""
    if not layout:
        return False

    objects = slide.get("a", {}).get("o", [])
    for obj_update in layout.get("objects", []):
        idx = obj_update.get("index")
        if idx is None or idx < 0 or idx >= len(objects):
            continue
        incoming = obj_update.get("r", {})
        current = objects[idx].get("r") or {}
        if not current.get("w") and not incoming.get("w"):
            continue
        for key in ("x", "y", "w", "h"):
            cur_val = float(current.get(key, 0))
            new_val = float(incoming.get(key, cur_val))
            if abs(cur_val - new_val) > epsilon:
                return True

    z_order = layout.get("zOrder")
    if z_order and len(z_order) == len(objects):
        current_order = list(range(len(objects)))
        if z_order != current_order:
            return True

    return False


def apply_layout(slide: dict[str, Any], layout: dict[str, Any]) -> None:
    objects = slide.get("a", {}).get("o", [])
    for obj_update in layout.get("objects", []):
        idx = obj_update.get("index")
        if idx is None or idx < 0 or idx >= len(objects):
            continue
        r = obj_update.get("r", {})
        objects[idx].setdefault("r", {})
        objects[idx]["r"]["x"] = float(r.get("x", objects[idx]["r"].get("x", 0)))
        objects[idx]["r"]["y"] = float(r.get("y", objects[idx]["r"].get("y", 0)))
        objects[idx]["r"]["w"] = max(8.0, float(r.get("w", objects[idx]["r"].get("w", 0))))
        objects[idx]["r"]["h"] = max(8.0, float(r.get("h", objects[idx]["r"].get("h", 0))))

    z_order = layout.get("zOrder")
    if z_order and len(z_order) == len(objects):
        slide["a"]["o"] = [objects[i] for i in z_order if i < len(objects)]


def apply_question_layout_edit(slide: dict[str, Any], edit: dict[str, Any]) -> None:
    layout = edit.get("layout")
    if layout and layout_changed(slide, layout):
        apply_layout(slide, layout)