"""Canonical multi-holder Fill in Blank model with legacy marker support."""

from __future__ import annotations

import re
from typing import Any


NEW_BLANK_TOKEN = "[ô_trống]"
BLANK_MARKER_RE = re.compile(
    r"(?:_{3,}|\[\s*(?:ô|o)[_\s-]*trống(?:[_\s-]*\d+)?\s*\])",
    re.IGNORECASE,
)


def normalize_question_prompt(text: str | None) -> str:
    """Canonicalize markers and collapse duplicate legacy/new prompt lines."""
    source = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not source:
        return ""
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_line in re.split(r"\n+", source):
        line = raw_line.strip()
        if not line:
            continue
        canonical = BLANK_MARKER_RE.sub(NEW_BLANK_TOKEN, line)
        key = re.sub(r"\s+", " ", BLANK_MARKER_RE.sub(" <blank> ", canonical)).strip().casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(canonical)
    return "\n".join(normalized)


def marker_count(text: str | None) -> int:
    source = normalize_question_prompt(text)
    matches = list(BLANK_MARKER_RE.finditer(source))
    if not matches:
        return 0
    count = 1
    for previous, current in zip(matches, matches[1:]):
        # Legacy authors sometimes wrote "___ ___ ___" to draw one long
        # textbox. Only markers separated by real content are distinct holders.
        if source[previous.end():current.start()].strip():
            count += 1
    return count


def normalize_blank_answers(
    entries: list[dict[str, Any]] | None,
    *,
    fallback: list[Any] | None = None,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(entries or []):
        raw_values = (
            entry.get("values")
            or entry.get("acceptedAnswers")
            or entry.get("correctAnswers")
            or entry.get("correctAnswer")
            or entry.get("answers")
            or entry.get("answer")
            or []
        )
        if not isinstance(raw_values, list):
            raw_values = [raw_values]
        values = [str(value).strip() for value in raw_values if str(value).strip()]
        normalized.append({
            "id": str(entry.get("id") or f"qmFillInTheBlank{index}"),
            "values": values,
        })
    if not normalized and fallback:
        values = [str(value).strip() for value in fallback if str(value).strip()]
        if values:
            normalized.append({"id": "qmFillInTheBlank0", "values": values})
    return normalized


def align_blank_answers(
    text: str | None,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Add explicit empty holders when legacy text contains more markers than mappings."""
    aligned = [dict(entry, values=list(entry.get("values") or [])) for entry in entries]
    detected = marker_count(text)
    last_meaningful = max(
        (index for index, entry in enumerate(aligned) if any(str(value).strip() for value in entry.get("values") or [])),
        default=-1,
    )
    target = max(1, detected, last_meaningful + 1)
    if len(aligned) > target:
        aligned = aligned[:target]
    while len(aligned) < target:
        aligned.append({"id": f"qmFillInTheBlank{len(aligned)}", "values": []})
    return aligned


def normalize_distractors(values: list[Any] | None) -> list[str]:
    normalized: list[str] = []
    for value in values or []:
        if isinstance(value, dict):
            value = value.get("text") or value.get("value") or value.get("label") or ""
        text = str(value).strip()
        if text:
            normalized.append(text)
    return normalized


def ensure_question_markers(
    text: str | None,
    blank_count: int,
    *,
    marker: str = NEW_BLANK_TOKEN,
) -> str:
    """Normalize old/new markers and ensure one visible holder per blank."""
    source = normalize_question_prompt(text)
    existing = marker_count(source)
    matches = list(BLANK_MARKER_RE.finditer(source))
    chunks: list[str] = []
    cursor = 0
    previous_end: int | None = None
    for match in matches:
        between = source[cursor:match.start()]
        if previous_end is None or source[previous_end:match.start()].strip():
            chunks.append(between)
            chunks.append(marker)
        else:
            # Keep one separating space while collapsing a legacy marker run.
            chunks.append(" " if between else "")
        cursor = match.end()
        previous_end = match.end()
    chunks.append(source[cursor:])
    normalized = "".join(chunks) if matches else source
    if blank_count <= existing:
        return normalized
    suffix = " ".join(marker for _ in range(blank_count - existing))
    return f"{normalized} {suffix}".strip()


def drag_options(
    blanks: list[dict[str, Any]],
    distractors: list[Any] | None,
) -> list[dict[str, Any]]:
    """Build stable drag components; repeated correct values remain separate cards."""
    options: list[dict[str, Any]] = []
    for index, blank in enumerate(blanks):
        values = blank.get("values") or []
        if values:
            options.append({
                "id": f"blank-option-{index}",
                "text": str(values[0]),
                "blankId": blank.get("id"),
                "isDistractor": False,
            })
    for index, value in enumerate(distractors or []):
        text = str(value).strip()
        if text:
            options.append({
                "id": f"distractor-{index}",
                "text": text,
                "blankId": None,
                "isDistractor": True,
            })
    return options
