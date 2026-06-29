"""Phase 4: layout reflow after Excel import."""

from __future__ import annotations

import re

import pytest

from app.excel_import import parse_excel_file
from app.layout import extract_layout
from app.quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from app.scorm_parser import ScormSession


@pytest.fixture
def sample_import():
    if not (IMPORT_TEMPLATE_DIR / "Sample_import_template.xls").exists():
        pytest.skip("Missing sample template")
    session = ScormSession.create_from_source(MASTER_SCORM)
    rows = parse_excel_file(IMPORT_TEMPLATE_DIR / "Sample_import_template.xls")
    quiz, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=IMPORT_TEMPLATE_DIR,
    )
    session.quiz_json = quiz
    return session, report


def _error_overlaps(slide):
    layout = extract_layout(slide)
    return [w for w in layout.get("overlaps", []) if w.get("severity") == "error"]


def test_imported_slides_have_no_layout_overlap_errors(sample_import):
    session, report = sample_import
    imported = [r for r in report if r["status"] == "imported"]
    assert len(imported) >= 6
    slides = session.quiz_json["d"]["sl"]["g"][0]["S"]
    for slide in slides:
        errors = _error_overlaps(slide)
        assert not errors, f"{slide['tp']} overlap: {errors}"


def test_true_false_has_two_columns_and_picture_frame(sample_import):
    session, _ = sample_import
    tf = next(s for s in session.quiz_json["d"]["sl"]["g"][0]["S"] if s["tp"] == "TrueFalse")
    assert tf.get("s", {}).get("cc") == 2
    layout = extract_layout(tf)
    assert layout.get("slidePicture")
    assert layout.get("choicePreview", {}).get("layout", {}).get("columns") == 2
    picture = next(o for o in layout["objects"] if o["role"] == "slidePicture")
    content = next(o for o in layout["objects"] if o["role"] == "content")
    assert picture["r"]["y"] + picture["r"]["h"] <= content["r"]["y"] + 1


def test_matching_pairs_layout_metrics(sample_import):
    session, _ = sample_import
    mg = next(s for s in session.quiz_json["d"]["sl"]["g"][0]["S"] if s["tp"] == "Matching")
    layout = extract_layout(mg)
    cp = layout["choicePreview"]
    assert len(cp.get("pairs", [])) >= 2
    metrics = cp.get("layout", {})
    assert metrics.get("columns") == 2
    assert metrics.get("premiseWidth")
    assert metrics.get("responseWidth")


def test_wordbank_blank_span_in_rich_html():
    templates = __import__("app.quiz_builder", fromlist=["load_slide_templates"]).load_slide_templates()
    wb_tpl = templates.get("WordBank")
    if not wb_tpl:
        pytest.skip("No WordBank template")
    from app.excel_import import ExcelQuestion, ParsedAnswer
    from app.quiz_builder import _apply_row_to_slide
    from pathlib import Path

    row = ExcelQuestion(
        row_index=1,
        excel_type="WB",
        ispring_type="WordBank",
        question_text="Tọa độ 3D là",
        answers=[ParsedAnswer(text="một dãy số", is_correct=True)],
    )
    slide = __import__("copy").deepcopy(wb_tpl)
    _apply_row_to_slide(
        slide,
        row,
        package_root=Path("/tmp"),
        excel_dir=IMPORT_TEMPLATE_DIR,
        fallback_media_dirs=[IMPORT_TEMPLATE_DIR],
    )
    rt = slide["C"]["rt"]
    assert re.search(r'id="qmWordBank\d+"', rt.get("h", ""))
    assert isinstance(rt.get("d"), list)
    assert any(isinstance(part, dict) and "id" in part for part in rt["d"])


def test_sequence_content_below_direction(sample_import):
    session, _ = sample_import
    seq = next(s for s in session.quiz_json["d"]["sl"]["g"][0]["S"] if s["tp"] == "Sequence")
    layout = extract_layout(seq)
    direction = next(o for o in layout["objects"] if o["role"] == "direction")
    content = next(o for o in layout["objects"] if o["role"] == "content")
    assert content["r"]["y"] >= direction["r"]["y"] + direction["r"]["h"]