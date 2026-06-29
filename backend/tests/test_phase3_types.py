"""Phase 3: FIB, WordBank, Numeric import + skip types."""

from __future__ import annotations

import re

import pytest

from app.excel_import import parse_excel_file
from app.layout import extract_layout
from app.quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from app.scorm_parser import ScormSession, slide_to_view


FIB_WB_SAMPLE = IMPORT_TEMPLATE_DIR / "FIB_WB_import_sample.xlsx"
SAMPLE_XLS = IMPORT_TEMPLATE_DIR / "Sample_import_template.xls"


@pytest.fixture
def fib_wb_session():
    if not FIB_WB_SAMPLE.exists():
        pytest.skip(f"Missing {FIB_WB_SAMPLE}")
    session = ScormSession.create_from_source(MASTER_SCORM)
    rows = parse_excel_file(FIB_WB_SAMPLE)
    quiz, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=IMPORT_TEMPLATE_DIR,
    )
    session.quiz_json = quiz
    return session, report


def test_fib_wb_sample_imports_all_rows(fib_wb_session):
    _, report = fib_wb_session
    assert len(report) == 3
    assert sum(1 for r in report if r["status"] == "imported") == 3
    assert sum(1 for r in report if r["status"] == "error") == 0


def test_fib_blank_answer_in_rt_r(fib_wb_session):
    session, _ = fib_wb_session
    fib = next(
        s for s in session.quiz_json["d"]["sl"]["g"][0]["S"]
        if s["tp"] == "FillInTheBlank"
    )
    rt = fib["C"]["rt"]
    assert re.search(r'id="qmFillInTheBlank\d+"', rt["h"])
    assert rt["r"][0]["data"]["v"] == ["6"]
    layout = extract_layout(fib)
    assert layout["choicePreview"]["richHtml"]
    assert layout["choicePreview"]["blankKind"] == "fillin"


def test_wordbank_correct_and_extra_words(fib_wb_session):
    session, _ = fib_wb_session
    wb = next(
        s for s in session.quiz_json["d"]["sl"]["g"][0]["S"]
        if s["tp"] == "WordBank"
    )
    assert wb["C"]["ew"] == ["đỏ", "vàng"]
    rt = wb["C"]["rt"]
    assert rt["r"][0]["data"]["v"] == "xanh"
    view = slide_to_view(wb, 0, 1, "test")
    assert view["wordBankWords"] == ["đỏ", "vàng"]


def test_numeric_import_from_sample_xls():
    if not SAMPLE_XLS.exists():
        pytest.skip("Missing sample xls")
    session = ScormSession.create_from_source(MASTER_SCORM)
    rows = parse_excel_file(SAMPLE_XLS)
    quiz, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=IMPORT_TEMPLATE_DIR,
    )
    numg = next(r for r in report if r["type"] == "NUMG")
    assert numg["status"] == "imported"
    slide = next(
        s for s in quiz["d"]["sl"]["g"][0]["S"]
        if s["tp"] == "Numeric"
    )
    assert slide["C"]["chs"][0]["t"] == "5"
    view = slide_to_view(slide, 0, 0, "test")
    assert view["typeInAnswers"] == ["5"]


def test_fib_wb_numeric_in_fib_wb_sample(fib_wb_session):
    session, _ = fib_wb_session
    types = {s["tp"] for s in session.quiz_json["d"]["sl"]["g"][0]["S"]}
    assert types == {"FillInTheBlank", "WordBank", "Numeric"}


def test_skip_dnd_excel_type():
    import pandas as pd
    from pathlib import Path
    import tempfile
    import openpyxl

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "dnd.xlsx"
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Question Type", "Question Text", "Answer 1"])
        ws.append(["DND", "Drag items", "a|b"])
        wb.save(path)

        session = ScormSession.create_from_source(MASTER_SCORM)
        rows = parse_excel_file(path)
        _, report = build_quiz_from_excel(
            session.quiz_json,
            rows,
            package_root=session.package_root,
            excel_dir=path.parent,
        )
        assert report[0]["status"] == "skipped"
        assert "DND" in report[0]["errors"][0]