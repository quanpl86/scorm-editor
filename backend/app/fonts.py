"""Discover iSpring embedded fonts from quiz JSON and package files."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

EDITOR_TITLE_FAMILY = "fnt6_24031"
EDITOR_CONTENT_FAMILY = "fnt5_24031"

FONT_FILE_FALLBACKS = {
    "fnt5.woff": EDITOR_CONTENT_FAMILY,
    "fnt6.woff": EDITOR_TITLE_FAMILY,
}


def _font_weight(meta: dict[str, Any]) -> int:
    name = str(meta.get("f", "")).lower()
    if meta.get("b"):
        return 700
    if "semibold" in name or "semi bold" in name:
        return 600
    if "bold" in name:
        return 700
    if "medium" in name:
        return 500
    return 400


def _available_woff_names(package_root: Path) -> set[str]:
    fonts_dir = package_root / "res" / "data" / "fonts"
    if not fonts_dir.is_dir():
        return set()
    return {p.name for p in fonts_dir.glob("*.woff")}


def extract_font_manifest(quiz_json: dict[str, Any], package_root: Path) -> dict[str, Any]:
    fs = quiz_json.get("fs", {}) or {}
    styles = quiz_json.get("S", {}) or {}
    available = _available_woff_names(package_root)

    faces: list[dict[str, Any]] = []
    by_family: dict[str, dict[str, Any]] = {}

    for family, paths in fs.items():
        if not paths:
            continue
        rel = str(paths[0]).replace("\\", "/")
        filename = Path(rel).name
        if filename not in available:
            continue
        meta = styles.get(family, {}) if isinstance(styles.get(family), dict) else {}
        face = {
            "family": family,
            "path": rel,
            "weight": _font_weight(meta),
            "name": meta.get("f", family),
        }
        faces.append(face)
        by_family[family] = face

    def pick_family(preferred: list[str], *, quicksand: bool = False, min_weight: int = 0) -> str | None:
        for family in preferred:
            if family in by_family:
                return family
        if quicksand:
            for family, face in by_family.items():
                if "quicksand" in face["name"].lower() and face["weight"] >= min_weight:
                    return family
        return None

    title_family = pick_family(
        [EDITOR_TITLE_FAMILY, "fnt1_24031", "fnt1_17443", "fnt3_24031"],
        quicksand=True,
        min_weight=600,
    )
    content_family = pick_family(
        [EDITOR_CONTENT_FAMILY, "fnt2_24031", "fnt2_17443", "fnt0_24031"],
        quicksand=True,
        min_weight=400,
    )

    if not title_family and faces:
        title_family = max(faces, key=lambda f: f["weight"])["family"]
    if not content_family and faces:
        content_family = min(faces, key=lambda f: f["weight"])["family"]

    aliases: list[dict[str, Any]] = []
    if title_family and title_family in by_family:
        src = by_family[title_family]
        aliases.append(
            {
                "family": EDITOR_TITLE_FAMILY,
                "path": src["path"],
                "weight": src["weight"],
                "name": src["name"],
            }
        )
    if content_family and content_family in by_family:
        src = by_family[content_family]
        aliases.append(
            {
                "family": EDITOR_CONTENT_FAMILY,
                "path": src["path"],
                "weight": src["weight"],
                "name": src["name"],
            }
        )

    return {
        "faces": faces,
        "aliases": aliases,
        "titleFamily": title_family,
        "contentFamily": content_family,
    }


def resolve_font_path(package_root: Path, quiz_json: dict[str, Any], rel_path: str) -> Path | None:
    """Resolve font file path, with fallback for missing fnt5/fnt6 in older packages."""
    res_root = package_root / "res"
    if not res_root.is_dir():
        res_root = package_root

    normalized = rel_path.replace("\\", "/")
    direct = (res_root / normalized).resolve()
    root_resolved = res_root.resolve()
    if str(direct).startswith(str(root_resolved)) and direct.is_file():
        return direct

    filename = Path(normalized).name
    target_family = FONT_FILE_FALLBACKS.get(filename)
    if not target_family:
        return None

    manifest = extract_font_manifest(quiz_json, package_root)
    for alias in manifest.get("aliases", []):
        if alias.get("family") == target_family and alias.get("path"):
            candidate = (res_root / alias["path"]).resolve()
            if str(candidate).startswith(str(root_resolved)) and candidate.is_file():
                return candidate

    match = re.match(r"fnt(\d+)\.woff$", filename)
    if match:
        fallback_name = f"fnt{match.group(1)}.woff"
        for face in manifest.get("faces", []):
            if Path(face.get("path", "")).name == fallback_name:
                candidate = (res_root / face["path"]).resolve()
                if str(candidate).startswith(str(root_resolved)) and candidate.is_file():
                    return candidate

    return None