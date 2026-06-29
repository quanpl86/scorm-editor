"""Shared helpers for Phase 6 QA: import → save → export → validate SCORM."""

from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from app.excel_import import parse_excel_file
from app.quiz_builder import build_quiz_from_excel
from app.scorm_parser import (
    ScormSession,
    decode_quiz_data,
    ensure_media_registry,
    extract_scorm_package,
    find_index_html,
    parse_manifest_meta,
)


def import_excel_into_session(
    excel_path: Path,
    *,
    excel_dir: Path,
    master_source: Path,
    quiz_title: str | None = None,
    group_title: str = "QA Import",
) -> tuple[ScormSession, list[dict[str, Any]]]:
    session = ScormSession.create_from_source(master_source)
    rows = parse_excel_file(excel_path)
    quiz_json, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=excel_dir,
        group_title=group_title,
        quiz_title=quiz_title,
    )
    ensure_media_registry(quiz_json, session.package_root)
    session.quiz_json = quiz_json
    session.persist()
    return session, report


def view_to_save_payload(view: dict[str, Any]) -> dict[str, Any]:
    """Minimal save payload mirroring frontend buildSavePayload."""
    questions = []
    for q in view.get("questions") or []:
        if q.get("deleted"):
            continue
        entry: dict[str, Any] = {
            "id": q["id"],
            "questionText": q.get("questionText"),
            "points": q.get("points"),
        }
        if q.get("choices"):
            entry["choices"] = q["choices"]
        if q.get("typeInAnswers"):
            entry["typeInAnswers"] = q["typeInAnswers"]
        if q.get("wordBankWords"):
            entry["wordBankWords"] = q["wordBankWords"]
        if q.get("layout"):
            entry["layout"] = q["layout"]
        if q.get("feedback"):
            entry["feedback"] = q["feedback"]
        questions.append(entry)

    return {
        "title": view.get("title"),
        "passingScore": view.get("passingScore"),
        "reporting": view.get("reporting"),
        "introSlide": view.get("introSlide"),
        "resultSlides": view.get("resultSlides") or [],
        "questions": questions,
    }


def validate_scorm_zip(zip_bytes: bytes) -> dict[str, Any]:
    """Extract exported zip and verify LMS-ready SCORM 1.2 structure."""
    if len(zip_bytes) < 1024:
        raise AssertionError("Export zip quá nhỏ")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "export.zip"
        zip_path.write_bytes(zip_bytes)

        with zipfile.ZipFile(zip_path, "r") as zf:
            names = zf.namelist()
            if not names:
                raise AssertionError("Zip rỗng")
            bad = [n for n in names if ".." in n]
            if bad:
                raise AssertionError(f"Zip có path không hợp lệ: {bad[:3]}")

        pkg_root = tmp_path / "package"
        extract_scorm_package(zip_path, pkg_root)

        manifest = pkg_root / "imsmanifest.xml"
        if not manifest.is_file():
            found = list(pkg_root.rglob("imsmanifest.xml"))
            if not found:
                raise AssertionError("Thiếu imsmanifest.xml")
            manifest = found[0]

        index_path = find_index_html(pkg_root)
        index_html = index_path.read_text(encoding="utf-8")
        if "quiz" not in index_html.lower() and "ispring" not in index_html.lower():
            raise AssertionError("index.html không chứa dữ liệu quiz iSpring")

        meta = parse_manifest_meta(manifest)
        if meta.get("schemaVersion") != "1.2":
            raise AssertionError(f"Không phải SCORM 1.2: {meta.get('schemaVersion')}")

        quiz_json = decode_quiz_data(index_html)
        saved = pkg_root / "quiz_data.json"
        if saved.is_file():
            import json

            quiz_saved = json.loads(saved.read_text(encoding="utf-8"))
        else:
            quiz_saved = None

        return {
            "package_root": pkg_root,
            "manifest": meta,
            "quiz_json": quiz_json,
            "quiz_saved": quiz_saved,
            "index_path": index_path,
        }


def slide_types_in_quiz(quiz_json: dict[str, Any]) -> set[str]:
    types: set[str] = set()
    for group in quiz_json.get("d", {}).get("sl", {}).get("g", []):
        for slide in group.get("S", []):
            tp = slide.get("tp")
            if tp:
                types.add(tp)
    return types


def count_questions(quiz_json: dict[str, Any]) -> int:
    return sum(
        len(g.get("S", []))
        for g in quiz_json.get("d", {}).get("sl", {}).get("g", [])
    )