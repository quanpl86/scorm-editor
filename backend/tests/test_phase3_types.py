"""Phase 3: FIB, WordBank, Numeric import + skip types."""

from __future__ import annotations

import re

import pytest

from app.excel_import import parse_excel_file
from app.layout import extract_layout
from app.quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from app.scorm_parser import ScormSession, apply_question_edit, slide_to_view


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


def test_short_answer_edit_keeps_primary_answer_and_synonyms():
    slide = {
        "tp": "TypeIn",
        "D": {"h": "<p>Câu hỏi</p>"},
        "C": {"chs": [{"i": "old-1", "t": "A"}, {"i": "old-2", "t": "B"}]},
    }

    apply_question_edit(slide, {"typeInAnswers": ["HTML", "html"]})

    assert slide["C"]["chs"] == [
        {"i": "ans-0", "t": "HTML"},
        {"i": "ans-1", "t": "html"},
    ]


def test_question_edit_prefers_new_text_when_client_html_is_stale():
    slide = {
        "i": "question-1",
        "tp": "MultipleChoice",
        "D": {
            "h": "<p><span>Câu hỏi ban đầu</span></p>",
        },
        "C": {"chs": []},
    }

    apply_question_edit(
        slide,
        {
            "questionText": "Câu hỏi đã hiệu chỉnh",
            "questionHtml": "<p><span>Câu hỏi ban đầu</span></p>",
        },
    )

    view = slide_to_view(slide, 0, 0, "Nhóm")
    assert view["questionText"] == "Câu hỏi đã hiệu chỉnh"


def test_choice_edit_prefers_new_text_when_client_html_is_stale():
    slide = {
        "i": "question-1",
        "tp": "MultipleChoice",
        "D": {"h": "<p>Câu hỏi</p>"},
        "C": {
            "chs": [
                {
                    "i": "choice-1",
                    "t": {
                        "h": "<p><span>Đáp án ban đầu</span></p>",
                    },
                    "c": True,
                },
            ],
        },
    }

    apply_question_edit(
        slide,
        {
            "choices": [
                {
                    "id": "choice-1",
                    "text": "Đáp án đã hiệu chỉnh",
                    "html": "<p><span>Đáp án ban đầu</span></p>",
                    "isCorrect": True,
                },
            ],
        },
    )

    view = slide_to_view(slide, 0, 0, "Nhóm")
    assert view["choices"][0]["text"] == "Đáp án đã hiệu chỉnh"


def test_required_and_regex_settings_round_trip_in_question_view():
    slide = {
        "i": "question-1",
        "tp": "TypeIn",
        "D": {"h": "<p>Câu hỏi</p>"},
        "C": {"chs": [{"i": "old-1", "t": "HTML"}]},
        "s": {"e": {"pt": 1}},
        "a": {"b": {"f": "pictureFill", "p": {"p": "fill", "i": ""}}, "o": []},
    }

    apply_question_edit(slide, {"required": True, "useRegex": True})
    view = slide_to_view(slide, 0, 0, "Nhóm")

    assert view["required"] is True
    assert view["useRegex"] is True


def test_fill_blank_edit_keeps_multiple_holders_synonyms_and_legacy_marker():
    slide = {
        "tp": "FillInTheBlank",
        "D": {"h": "<p>Trình duyệt mặc định là ___.</p>"},
        "C": {
            "rt": {
                "h": '<p><span id="qmFillInTheBlank0"></span></p>',
                "r": [
                    {
                        "id": "qmFillInTheBlank0",
                        "type": "qmFillInTheBlank",
                        "data": {"v": ["Edge", "Microsoft Edge"]},
                    },
                ],
            },
        },
    }

    apply_question_edit(
        slide,
        {
            "questionText": "Trình duyệt mặc định là ___.",
            "blankAnswers": [
                {"id": "qmFillInTheBlank0", "values": ["Edge", "Microsoft Edge"]},
                {"id": "qmFillInTheBlank1", "values": ["Chrome"]},
            ],
            "wordBankWords": ["Firefox", "Safari"],
        },
    )

    assert len(slide["C"]["rt"]["r"]) == 2
    assert slide["C"]["rt"]["r"][0]["data"]["v"] == ["Edge", "Microsoft Edge"]
    assert slide["C"]["rt"]["r"][1]["data"]["v"] == ["Chrome"]
    assert 'id="qmFillInTheBlank0"' in slide["C"]["rt"]["h"]
    assert 'id="qmFillInTheBlank1"' in slide["C"]["rt"]["h"]
    assert "___" not in slide["C"]["rt"]["h"]
    assert slide["C"]["ew"] == ["Firefox", "Safari"]
    view = slide_to_view(slide, 0, 0, "Nhóm")
    assert view["blankDistractors"] == ["Firefox", "Safari"]


def test_fill_in_blank_view_collapses_legacy_duplicate_question_and_content():
    sentence = (
        "Trong cú pháp UDim2.new(xScale, xOffset, yScale, yOffset), "
        "tham số đứng ngay sau xScale là ___."
    )
    blank_id = "qmFillInTheBlank26"
    slide = {
        "i": "fib-duplicate",
        "tp": "FillInTheBlank",
        "D": {"h": f"<p>{sentence}\n\n{sentence}</p>"},
        "C": {
            "rt": {
                "h": (
                    "<p>Trong cú pháp UDim2.new(xScale, xOffset, yScale, yOffset), "
                    f'tham số đứng ngay sau xScale là <span id="{blank_id}"></span>.'
                    f"\n\n{sentence}</p>"
                ),
                "a": f"<p>{sentence}</p>",
                "r": [{"id": blank_id, "data": {"v": ["xOffset"]}}],
            }
        },
        "a": {"o": []},
        "s": {"e": {"pt": 1}},
    }

    view = slide_to_view(slide, 0, 0, "Test")

    assert view["questionText"] == sentence
    assert view["subtitleText"] == ""


def test_type_in_view_collapses_legacy_duplicate_question():
    sentence = "SDK là viết tắt của cụm từ nào?"
    slide = {
        "i": "typein-duplicate",
        "tp": "TypeIn",
        "D": {"h": f"<p>{sentence} {sentence}</p>"},
        "C": {"chs": [{"t": {"h": "<p>Software Development Kit</p>"}}]},
        "a": {"o": []},
        "s": {"e": {"pt": 1}},
    }

    view = slide_to_view(slide, 0, 0, "Test")

    assert view["questionText"] == sentence
