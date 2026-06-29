"""Quicksand typography + text formatting for iSpring quiz slides."""

from __future__ import annotations

import html
import math
import re
from typing import Any, Literal

CANVAS_W = 720
CANVAS_H = 540

FONT_TITLE = "fnt6_24031"
FONT_CONTENT = "fnt5_24031"
FONT_TITLE_NAME = "Quicksand SemiBold"
FONT_CONTENT_NAME = "Quicksand"

TextRole = Literal["title", "content", "feedback"]

DEFAULT_FORMAT: dict[str, Any] = {
    "fontSize": None,
    "bold": False,
    "italic": False,
    "underline": False,
    "color": "#000000",
    "align": "left",
}

TITLE_SIZE_OPTIONS = [14, 16, 18, 20, 22, 24]
CONTENT_SIZE_OPTIONS = [12, 14, 16, 18, 20]


def strip_plain(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(text))).strip()


def normalize_color(value: str) -> str:
    value = (value or "#000000").strip()
    if value.startswith("#") and len(value) in {4, 7}:
        if len(value) == 4:
            return "#" + "".join(ch * 2 for ch in value[1:])
        return value.lower()
    return "#000000"


def hex_to_ispring_color(hex_color: str) -> int:
    h = normalize_color(hex_color).lstrip("#")
    return int(h, 16)


def default_format_for_role(role: TextRole) -> dict[str, Any]:
    fmt = {**DEFAULT_FORMAT}
    if role == "title":
        fmt.update({"bold": True, "align": "center"})
    return fmt


def extract_font_family_from_html(html_text: str | None) -> str | None:
    if not html_text:
        return None
    match = re.search(r"font-family:\s*([^;\"']+)", html_text, re.I)
    return match.group(1).strip() if match else None


def default_font_for_role(role: TextRole) -> str:
    return FONT_TITLE if role == "title" else FONT_CONTENT


def resolve_font_display_name(
    font_family: str,
    role: TextRole,
    existing_name: str | None = None,
) -> str:
    if existing_name:
        return existing_name
    if font_family in (FONT_TITLE, "fnt1_24031", "fnt3_24031", "fnt6_24031"):
        return FONT_TITLE_NAME
    if font_family in (FONT_CONTENT, "fnt0_24031", "fnt2_24031", "fnt5_24031"):
        return FONT_CONTENT_NAME
    return FONT_TITLE_NAME if role == "title" else FONT_CONTENT_NAME


def extract_text_format(
    html_text: str | None,
    meta: dict[str, Any] | None = None,
    role: TextRole = "content",
) -> dict[str, Any]:
    fmt = default_format_for_role(role)
    if meta:
        tf = meta.get("tf", {}) or {}
        if tf.get("s"):
            fmt["fontSize"] = int(tf["s"])
        if "b" in tf:
            fmt["bold"] = bool(tf["b"])
        fmt["italic"] = bool(tf.get("i"))
        fmt["underline"] = bool(tf.get("u"))
        if tf.get("c") not in (None, 0):
            fmt["color"] = f"#{int(tf['c']):06x}"
        pf = meta.get("pf", {}) or {}
        if pf.get("a"):
            fmt["align"] = pf["a"]

    if html_text:
        size_match = re.search(r"font-size:\s*(\d+)px", html_text)
        if size_match:
            fmt["fontSize"] = int(size_match.group(1))
        color_match = re.search(r"color:\s*(#[0-9a-fA-F]{3,6})", html_text)
        if color_match:
            fmt["color"] = normalize_color(color_match.group(1))
        if re.search(r"font-weight:\s*bold", html_text, re.I):
            fmt["bold"] = True
        elif re.search(r"font-weight:\s*normal", html_text, re.I):
            fmt["bold"] = False
        if re.search(r"font-style:\s*italic", html_text, re.I):
            fmt["italic"] = True
        if "underline" in html_text:
            fmt["underline"] = True
        align_match = re.search(r"text-align:\s*(left|center|right|justify)", html_text, re.I)
        if align_match:
            fmt["align"] = align_match.group(1).lower()
        font_family = extract_font_family_from_html(html_text)
        if font_family:
            fmt["fontFamily"] = font_family
    return fmt


def pick_title_size(text: str, width: float = 520) -> int:
    length = len(text)
    if length <= 35 and width >= 400:
        return 20
    if length <= 70:
        return 18
    if length <= 110:
        return 16
    return 14


def pick_content_size(text: str, title_size: int) -> int:
    length = len(text)
    if length <= 25:
        return max(12, title_size - 2)
    if length <= 55:
        return max(12, title_size - 3)
    return max(12, title_size - 4)


def resolve_font_size(
    text: str,
    role: TextRole,
    fmt: dict[str, Any] | None,
    title_ref: int = 18,
    width: float = 520,
) -> int:
    if fmt and fmt.get("fontSize"):
        return int(fmt["fontSize"])
    if role == "title":
        return pick_title_size(text, width)
    return pick_content_size(text, title_ref)


def estimate_lines(text: str, font_size: int, width: float, padding: float = 24) -> int:
    if not text:
        return 1
    usable = max(80, width - padding)
    chars_per_line = max(12, int(usable / (font_size * 0.52)))
    return max(1, math.ceil(len(text) / chars_per_line))


def estimate_text_height(text: str, font_size: int, width: float, padding: float = 20) -> float:
    lines = estimate_lines(text, font_size, width, padding)
    return lines * font_size * 1.35 + padding


def build_styled_html(
    text: str,
    role: TextRole,
    *,
    title_size: int | None = None,
    align: str | None = None,
    color: str | None = None,
    fmt: dict[str, Any] | None = None,
    font_family: str | None = None,
) -> str:
    plain = strip_plain(text) if "<" in (text or "") else (text or "").strip()
    merged = default_format_for_role(role)
    if fmt:
        merged.update({k: v for k, v in fmt.items() if v is not None and k != "fontFamily"})

    base_title = title_size or resolve_font_size(plain, "title", merged if role == "title" else None)
    size = resolve_font_size(plain, role, merged, base_title)
    font = font_family or merged.get("fontFamily") or default_font_for_role(role)
    align_val = align or merged.get("align") or ("center" if role == "title" else "left")
    color_val = normalize_color(color or merged.get("color") or "#000000")

    weight = "bold" if merged.get("bold") else "normal"
    style = "italic" if merged.get("italic") else "normal"
    decoration = "underline" if merged.get("underline") else "none"

    escaped = html.escape(plain)
    return (
        f'<p style="text-align:{align_val};font-size:{size}px;font-family:{font};'
        f"color:{color_val};font-weight:{weight};font-style:{style};"
        f'text-decoration:{decoration}">'
        f'<span style="color:{color_val};text-decoration:{decoration};font-size:{size}px;'
        f"font-family:{font};font-weight:{weight};font-style:{style};"
        f'">{escaped}</span></p>'
    )


def build_text_meta(
    role: TextRole,
    size: int,
    fmt: dict[str, Any] | None = None,
    *,
    font_family: str | None = None,
    font_name: str | None = None,
) -> dict[str, Any]:
    merged = default_format_for_role(role)
    if fmt:
        merged.update({k: v for k, v in fmt.items() if v is not None and k != "fontFamily"})
    align = merged.get("align") or ("center" if role == "title" else "left")
    family = font_family or merged.get("fontFamily") or default_font_for_role(role)
    display_name = resolve_font_display_name(family, role, font_name)
    return {
        "tf": {
            "f": display_name,
            "s": size,
            "c": hex_to_ispring_color(merged.get("color", "#000000")),
            "b": bool(merged.get("bold")),
            "i": bool(merged.get("italic")),
            "u": bool(merged.get("underline")),
        },
        "pf": {"t": "p", "a": align},
    }


def node_plain_text(node: dict[str, Any]) -> str:
    return strip_plain(node.get("h") or node.get("a") or "")


def _normalize_format_for_compare(
    fmt: dict[str, Any] | None,
    existing: dict[str, Any],
    role: TextRole,
) -> dict[str, Any]:
    """Merge editor defaults with slide HTML so unchanged saves do not rewrite text."""
    base = default_format_for_role(role)
    merged = {**base, **existing}
    if fmt:
        for key, value in fmt.items():
            if value is not None:
                merged[key] = value
    if merged.get("fontSize") is None:
        merged["fontSize"] = existing.get("fontSize")
    if merged.get("fontFamily") is None:
        merged["fontFamily"] = existing.get("fontFamily")
    if merged.get("color") in (None, "#000000") and existing.get("color"):
        merged["color"] = existing["color"]
    return merged


def format_differs(node: dict[str, Any], fmt: dict[str, Any] | None, role: TextRole) -> bool:
    if not fmt:
        return False
    existing = extract_text_format(node.get("h"), node.get("t"), role)
    incoming = _normalize_format_for_compare(fmt, existing, role)
    for key in ("fontSize", "bold", "italic", "underline", "color", "align", "fontFamily"):
        if incoming.get(key) != existing.get(key):
            return True
    return False


def should_apply_text(node: dict[str, Any], text: str, fmt: dict[str, Any] | None, role: TextRole) -> bool:
    plain = strip_plain(text) if "<" in (text or "") else (text or "").strip()
    if node_plain_text(node) != plain:
        return True
    return format_differs(node, fmt, role)


def apply_html_to_node(
    node: dict[str, Any],
    html_text: str,
    plain_text: str | None = None,
    role: TextRole = "content",
) -> None:
    """Write canvas HTML verbatim — no rebuild (preserves font/layout exactly)."""
    plain = plain_text if plain_text is not None else strip_plain(html_text)
    existing_meta = (node.get("t") or {}).get("tf", {})
    preserved_name = existing_meta.get("f")
    fmt = extract_text_format(html_text, node.get("t"), role)
    size = fmt.get("fontSize") or resolve_font_size(plain, role, fmt)
    family = fmt.get("fontFamily") or extract_font_family_from_html(html_text)

    node["h"] = html_text
    node["a"] = f"<p>{html.escape(plain)}</p>"
    node["d"] = [plain] if plain else []
    node["t"] = build_text_meta(
        role,
        int(size),
        fmt,
        font_family=family,
        font_name=preserved_name,
    )


def apply_text_to_node(
    node: dict[str, Any],
    text: str,
    role: TextRole,
    fmt: dict[str, Any] | None = None,
    *,
    title_ref: int = 18,
    width: float = 520,
) -> None:
    plain = strip_plain(text) if "<" in text else text.strip()
    existing_html = node.get("h", "")
    existing_meta = (node.get("t") or {}).get("tf", {})
    preserved_family = extract_font_family_from_html(existing_html)
    preserved_name = existing_meta.get("f")

    merged_fmt = dict(fmt or {})
    if preserved_family and "fontFamily" not in merged_fmt:
        merged_fmt["fontFamily"] = preserved_family
    if not fmt:
        merged_fmt = extract_text_format(existing_html, node.get("t"), role)

    if role == "title":
        size = resolve_font_size(plain, role, merged_fmt, width=width)
    else:
        size = resolve_font_size(plain, role, merged_fmt, title_ref, width)

    family = merged_fmt.get("fontFamily") or preserved_family or default_font_for_role(role)
    node["h"] = build_styled_html(
        plain,
        role,
        title_size=title_ref,
        fmt=merged_fmt,
        font_family=family,
    )
    node["a"] = f"<p>{html.escape(plain)}</p>"
    node["d"] = [plain] if plain else []
    node["t"] = build_text_meta(
        role,
        size,
        merged_fmt,
        font_family=family,
        font_name=preserved_name,
    )


def _get_align_from_slide(slide: dict[str, Any]) -> str:
    try:
        return slide.get("D", {}).get("t", {}).get("pf", {}).get("a", "center") or "center"
    except (AttributeError, TypeError):
        return "center"


def _find_object(slide: dict[str, Any], name: str) -> dict[str, Any] | None:
    for obj in slide.get("a", {}).get("o", []):
        if obj.get("I") == name:
            return obj
    return None


def auto_layout_text_regions(slide: dict[str, Any], title_size: int | None = None) -> None:
    direction = _find_object(slide, "direction")
    content = _find_object(slide, "content")
    additional = _find_object(slide, "additionalContent")

    question = strip_plain(slide.get("D", {}).get("h", ""))
    dir_width = direction["r"]["w"] if direction else 520
    fmt = extract_text_format(slide.get("D", {}).get("h", ""), slide.get("D", {}).get("t"), "title")
    resolved_title = title_size or resolve_font_size(question, "title", fmt, dir_width)

    if direction:
        r = direction.setdefault("r", {})
        est_h = estimate_text_height(question, resolved_title, r.get("w", 500), padding=18)
        r["h"] = round(max(40, min(est_h, CANVAS_H * 0.28)), 2)
        direction.setdefault("S", {}).setdefault("t", {})["a"] = "resizeShapeToFitText"

    if content:
        r = content.setdefault("r", {})
        choice_count = len(slide.get("C", {}).get("chs", []))
        qtype = slide.get("tp", "")
        row_size = pick_content_size("M" * 20, resolved_title)

        if qtype in ("MultipleChoice", "MultipleResponse", "MultipleChoiceText") and choice_count:
            cols = 1 if choice_count <= 2 else 2
            rows = math.ceil(choice_count / cols)
            longest = max(
                (
                    strip_plain((ch.get("t") or {}).get("h", "") if isinstance(ch.get("t"), dict) else str(ch.get("t", "")))
                    for ch in slide.get("C", {}).get("chs", [])
                ),
                key=len,
                default="",
            )
            row_h = max(28, estimate_text_height(longest, row_size, r.get("w", 400) / cols, padding=12))
            est_h = rows * row_h + 16
        elif qtype == "TypeIn":
            est_h = 56
        else:
            est_h = max(80, r.get("h", 100))

        if direction:
            dir_bottom = direction["r"]["y"] + direction["r"]["h"]
            min_y = dir_bottom + 12
            if r.get("y", 0) < min_y - 4:
                r["y"] = round(min_y, 2)

        r["h"] = round(max(48, min(est_h, CANVAS_H - r.get("y", 300) - 16)), 2)

        if additional:
            ar = additional.setdefault("r", {})
            content_bottom = r["y"] + r["h"]
            gap = 10
            if ar.get("y", 0) < content_bottom + gap - 4:
                ar["y"] = round(content_bottom + gap, 2)
            ar["h"] = round(min(ar.get("h", 60), CANVAS_H - ar["y"] - 8), 2)


def apply_slide_typography(
    slide: dict[str, Any],
    *,
    auto_layout: bool = True,
    formats: dict[str, Any] | None = None,
) -> None:
    """Apply Quicksand fonts; preserve explicit formats when provided."""
    slide.setdefault("D", {})
    formats = formats or {}
    question = strip_plain(slide["D"].get("h", "")) or strip_plain(slide["D"].get("a", ""))
    direction = _find_object(slide, "direction")
    dir_width = direction["r"]["w"] if direction else 520

    q_fmt = formats.get("question") or extract_text_format(
        slide["D"].get("h", ""), slide["D"].get("t"), "title"
    )
    title_size = resolve_font_size(question, "title", q_fmt, dir_width)
    if should_apply_text(slide["D"], question, q_fmt, "title"):
        apply_text_to_node(slide["D"], question, "title", q_fmt, title_ref=title_size, width=dir_width)

    choice_fmts = formats.get("choices") or {}
    for ch in slide.get("C", {}).get("chs", []):
        if not isinstance(ch.get("t"), dict):
            continue
        choice_text = strip_plain(ch["t"].get("h") or ch["t"].get("a") or "")
        c_fmt = choice_fmts.get(ch.get("i", "")) or extract_text_format(
            ch["t"].get("h", ""), ch["t"].get("t"), "content"
        )
        if should_apply_text(ch["t"], choice_text, c_fmt, "content"):
            apply_text_to_node(ch["t"], choice_text, "content", c_fmt, title_ref=title_size)

    feedback_fmts = formats.get("feedback") or {}
    feedback = slide.get("s", {}).get("F", {})
    code_map = {"correct": "c", "incorrect": "i", "attempt": "at", "partial": "pc", "any": "a"}
    for key, code in code_map.items():
        node = feedback.get(code, {}).get("v", {})
        if not node:
            continue
        fb_text = strip_plain(node.get("h") or node.get("a") or "")
        if not fb_text:
            continue
        f_fmt = feedback_fmts.get(key) or extract_text_format(node.get("h", ""), None, "feedback")
        if should_apply_text(node, fb_text, f_fmt, "feedback"):
            apply_text_to_node(node, fb_text, "feedback", f_fmt, title_ref=title_size)

    slide.setdefault("a", {})
    existing_af = slide["a"].get("af") or {}
    slide["a"]["af"] = {
        "u": existing_af.get("u", False),
        "s": existing_af.get("s") or resolve_font_size("", "content", None, title_size),
        "c": existing_af.get("c", 0),
        "f": existing_af.get("f") or FONT_CONTENT,
        "b": existing_af.get("b", False),
        "i": existing_af.get("i", False),
    }

    if auto_layout:
        auto_layout_text_regions(slide, title_size)


def apply_quiz_typography(quiz_json: dict[str, Any], *, auto_layout: bool = True) -> None:
    for group in quiz_json.get("d", {}).get("sl", {}).get("g", []):
        for slide in group.get("S", []):
            if slide.get("tp") in ("ResultSlide", "IntroSlide", "InstructionsSlide"):
                continue
            apply_slide_typography(slide, auto_layout=auto_layout)