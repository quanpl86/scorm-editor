"""Test media on answer choices and correct/incorrect feedback."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.excel_import import parse_excel_file, parse_media_brackets
from app.quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from app.scorm_parser import ScormSession, ensure_media_registry, extract_choices, get_feedback

MEDIA_EXCEL = IMPORT_TEMPLATE_DIR / "Media_import_sample.xlsx"


def test_parse_media_brackets_answer_and_feedback():
    ans = parse_media_brackets("Heo [audio=media\\voice.mp3] [image=media\\a.jpg]")
    assert ans.text == "Heo"
    assert ans.audio == "media\\voice.mp3"
    assert ans.image == "media\\a.jpg"

    fb = parse_media_brackets("Giỏi! [audio=media\\ok.mp3] [image=media\\pic.png]")
    assert fb.text == "Giỏi!"
    assert fb.audio.endswith(".mp3")
    assert fb.image.endswith(".jpg") or fb.image.endswith(".png")


@pytest.fixture
def media_import_session():
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


def test_first_mc_has_choice_and_feedback_audio(media_import_session):
    session, report = media_import_session
    assert report[0]["status"] == "imported"
    slides = session.quiz_json["d"]["sl"]["g"][0]["S"]
    mc = slides[0]
    choices = extract_choices(mc)
    assert any(c.get("audio") for c in choices)
    assert any(c.get("image") for c in choices)

    fb = get_feedback(mc)
    assert fb.get("correctAudio")
    assert fb.get("incorrectAudio")
    assert fb.get("incorrectImage")

    assert mc["C"]["chs"][0].get("f", {}).get("a", {}).get("i", "").startswith("storage://sounds/")
    assert mc["s"]["F"]["c"].get("a", {}).get("i", "").startswith("storage://sounds/")
    assert mc["s"]["F"]["i"].get("v", {}).get("r")