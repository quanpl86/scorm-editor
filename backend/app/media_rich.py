"""Embed image/video assets in iSpring rich-text nodes (feedback, choices)."""

from __future__ import annotations

import uuid
from typing import Any

from .scorm_parser import image_dimensions
from pathlib import Path


def audio_attachment(filename: str) -> dict[str, Any]:
    return {
        "i": f"storage://sounds/{filename}",
        "a": True,
        "pe": False,
        "pl": 1,
        "pb": True,
        "r": "",
    }


def _new_span_id(prefix: str = "image") -> str:
    return f"{prefix}{uuid.uuid4().hex[:6]}"


def embed_rich_image(
    node: dict[str, Any],
    image_filename: str,
    *,
    package_root: Path | None = None,
    width: int | None = None,
    height: int | None = None,
) -> None:
    """Add inline image to rich node `v` (feedback or choice text)."""
    if package_root:
        img_path = package_root / "res" / "data" / "images" / image_filename
        if img_path.is_file():
            width, height = image_dimensions(img_path)

    w = width or 320
    h = height or 240
    span_id = _new_span_id("image")
    asset_id = f"storage://images/{image_filename}"

    html = node.get("h", "")
    block = (
        '<div style="padding-top:10px;padding-bottom:10px;text-align:center">'
        f'<span id="{span_id}"></span></div>'
    )
    node["h"] = (html + block) if html else block
    plain = node.get("d", [])
    if not isinstance(plain, list):
        plain = [plain] if plain else []
    node["d"] = plain + [{"id": span_id}]
    node.setdefault("r", []).append(
        {
            "assetId": asset_id,
            "width": w,
            "height": h,
            "text": "",
            "url": "",
            "target": "",
            "increaseByClick": False,
            "id": span_id,
            "type": "image",
        }
    )


def embed_rich_video(
    node: dict[str, Any],
    video_filename: str,
    poster_filename: str,
    *,
    package_root: Path | None = None,
    width: int | None = None,
    height: int | None = None,
) -> None:
    """Add inline video to rich node `v` (feedback or choice text)."""
    if package_root:
        poster_path = package_root / "res" / "data" / "images" / poster_filename
        if poster_path.is_file():
            width, height = image_dimensions(poster_path)

    w = width or 320
    h = height or 200
    span_id = _new_span_id("video")
    asset_id = f"storage://videos/{video_filename}"
    poster_id = f"storage://images/{poster_filename}"

    html = node.get("h", "")
    block = (
        '<div style="padding-top:10px;padding-bottom:10px;text-align:center">'
        f'<span id="{span_id}"></span></div>'
    )
    node["h"] = (html + block) if html else block
    plain = node.get("d", [])
    if not isinstance(plain, list):
        plain = [plain] if plain else []
    node["d"] = plain + [{"id": span_id}]
    node.setdefault("r", []).append(
        {
            "assetId": asset_id,
            "posterAssetId": poster_id,
            "width": w,
            "height": h,
            "text": "",
            "showControls": True,
            "id": span_id,
            "type": "video",
        }
    )