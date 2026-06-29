"""E2E test: Excel import with audio + video (kindergarten / voice content)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.excel_import import parse_excel_file
from app.quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from app.scorm_parser import ScormSession, ensure_media_registry

MEDIA_EXCEL = IMPORT_TEMPLATE_DIR / "Media_import_sample.xlsx"
MEDIA_DIR = IMPORT_TEMPLATE_DIR / "media"


@pytest.fixture
def media_session():
    if not MEDIA_EXCEL.exists():
        pytest.skip(f"Missing {MEDIA_EXCEL}")
    session = ScormSession.create_from_source(MASTER_SCORM)
    rows = parse_excel_file(MEDIA_EXCEL)
    quiz_json, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=IMPORT_TEMPLATE_DIR,
    )
    ensure_media_registry(quiz_json, session.package_root)
    session.quiz_json = quiz_json
    return session, report


def test_media_sample_imports_all_rows(media_session):
    _, report = media_session
    assert len(report) == 4
    assert sum(1 for r in report if r["status"] == "imported") == 4
    assert sum(1 for r in report if r["status"] == "error") == 0
    assert sum(len(r.get("warnings") or []) for r in report) == 0


def test_media_files_copied_to_package(media_session):
    session, _ = media_session
    pkg = session.package_root
    assert len(list((pkg / "res/data/audios").glob("snd-import-*.mp3"))) >= 2
    assert len(list((pkg / "res/data/videos").glob("vid-import-*.mp4"))) >= 1
    assert len(list((pkg / "res/data/images").glob("img-import-*"))) >= 2


def test_media_registry_populated(media_session):
    session, _ = media_session
    rs = session.quiz_json.get("rs", {})
    assert any("snd-import" in k for k in rs.get("a", {}))
    assert any("vid-import" in k for k in rs.get("v", {}))
    assert any("img-import" in k for k in rs.get("i", {}))


def test_slides_have_audio_and_video_attachments(media_session):
    session, _ = media_session
    slides = session.quiz_json["d"]["sl"]["g"][0]["S"]

    mc_voice = next(s for s in slides if s["tp"] == "MultipleChoice" and "a" in s.get("at", {}))
    assert mc_voice["at"]["a"]["i"].startswith("storage://sounds/snd-import-")

    tf_audio = next(s for s in slides if s["tp"] == "TrueFalse")
    assert tf_audio["at"]["a"]["i"].startswith("storage://sounds/")

    info_video = next(s for s in slides if s["tp"] == "InfoSlide")
    assert info_video["at"]["v"]["i"].startswith("storage://videos/vid-import-")
    assert info_video["at"]["v"]["pi"].startswith("storage://images/")

    mc_full = next(
        s for s in slides
        if s["tp"] == "MultipleChoice" and "v" in s.get("at", {})
    )
    assert "a" in mc_full["at"]
    assert "v" in mc_full["at"]
    obj_types = {o["tp"] for o in mc_full.get("a", {}).get("o", [])}
    assert "slideAudio" in obj_types
    assert "slideVideo" in obj_types


def test_source_media_files_exist():
    for name in (
        "voice_question.mp3",
        "voice_feedback.mp3",
        "sample_lesson.mp4",
    ):
        assert (MEDIA_DIR / name).is_file(), f"Missing media fixture: {name}"