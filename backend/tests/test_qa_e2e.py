"""Phase 6: QA matrix import × save × export + preview + regression."""

from __future__ import annotations

import json
import io
import tempfile
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM
from app.scorm_parser import (
    SESSIONS_ROOT,
    ScormSession,
    decode_quiz_data,
    find_index_html,
    strip_html,
)
from tests.qa_helpers import (
    count_questions,
    import_excel_into_session,
    slide_types_in_quiz,
    validate_scorm_zip,
    view_to_save_payload,
)

client = TestClient(app)

QA_MATRIX = [
    pytest.param(
        "sample",
        IMPORT_TEMPLATE_DIR / "Sample_import_template.xls",
        {
            "imported_min": 8,
            "types": {
                "TrueFalse", "MultipleChoice", "MultipleResponse", "TypeIn",
                "Matching", "Sequence", "InfoSlide", "Numeric",
            },
            "has_media": True,
        },
        id="sample-full",
    ),
    pytest.param(
        "media",
        IMPORT_TEMPLATE_DIR / "Media_import_sample.xlsx",
        {
            "imported_min": 4,
            "types": {"MultipleChoice", "TrueFalse", "InfoSlide"},
            "has_media": True,
        },
        id="media-audio-video",
    ),
    pytest.param(
        "fib-wb",
        IMPORT_TEMPLATE_DIR / "FIB_WB_import_sample.xlsx",
        {
            "imported_min": 3,
            "types": {"FillInTheBlank", "WordBank", "Numeric"},
            "has_media": False,
        },
        id="fib-wb-numeric",
    ),
]


@pytest.fixture(scope="module")
def master_available():
    if not MASTER_SCORM.exists():
        pytest.skip(f"Missing MASTER SCORM: {MASTER_SCORM}")


@pytest.mark.parametrize("label,excel_path,expect", QA_MATRIX)
def test_qa_matrix_import_save_export(label, excel_path, expect, master_available):
    if not excel_path.is_file():
        pytest.skip(f"Missing {excel_path}")

    session, report = import_excel_into_session(
        excel_path,
        excel_dir=IMPORT_TEMPLATE_DIR,
        master_source=MASTER_SCORM,
        quiz_title=f"QA {label}",
        group_title=f"QA Group {label}",
    )

    imported = sum(1 for r in report if r["status"] == "imported")
    assert imported >= expect["imported_min"]

    view = session.get_view()
    assert view["questionCount"] >= expect["imported_min"]

    types = slide_types_in_quiz(session.quiz_json)
    assert expect["types"].issubset(types), f"Missing types: {expect['types'] - types}"

    if expect["has_media"]:
        rs = session.quiz_json.get("rs", {})
        has_assets = any(rs.get(k) for k in ("i", "a", "v"))
        assert has_assets, "Expected media registry entries"

    saved_view = session.save_view(view_to_save_payload(view))
    assert saved_view["questionCount"] == view["questionCount"]

    zip_bytes = session.export_zip(f"QA Export {label}")
    validated = validate_scorm_zip(zip_bytes)

    assert count_questions(validated["quiz_json"]) >= expect["imported_min"]
    assert validated["manifest"]["schemaVersion"] == "1.2"

    if validated["quiz_saved"]:
        assert count_questions(validated["quiz_saved"]) >= expect["imported_min"]


def test_regression_edit_after_import_persists_through_export(master_available):
    excel = IMPORT_TEMPLATE_DIR / "Sample_import_template.xls"
    if not excel.is_file():
        pytest.skip("Missing sample template")

    session, _ = import_excel_into_session(
        excel,
        excel_dir=IMPORT_TEMPLATE_DIR,
        master_source=MASTER_SCORM,
    )
    view = session.get_view()
    target = next(q for q in view["questions"] if q["type"] == "MultipleChoice")
    new_text = "QA regression — câu đã chỉnh sửa sau import"
    new_points = 3.5

    payload = view_to_save_payload(view)
    for q in payload["questions"]:
        if q["id"] == target["id"]:
            q["questionText"] = new_text
            q["points"] = new_points

    session.save_view(payload)
    zip_bytes = session.export_zip("Regression Export")
    validated = validate_scorm_zip(zip_bytes)

    quiz = validated["quiz_saved"] or validated["quiz_json"]
    edited = None
    for group in quiz.get("d", {}).get("sl", {}).get("g", []):
        for slide in group.get("S", []):
            if slide.get("i") == target["id"]:
                edited = slide
                break
    assert edited is not None
    assert new_text in strip_html(edited.get("D", {}).get("h", ""))
    assert edited.get("s", {}).get("e", {}).get("pt") == new_points


def test_api_save_and_export_endpoints(master_available):
    excel = IMPORT_TEMPLATE_DIR / "FIB_WB_import_sample.xlsx"
    if not excel.is_file():
        pytest.skip("Missing FIB_WB sample")

    from app.main import _create_quiz_from_excel

    view = _create_quiz_from_excel(
        excel,
        excel_dir=IMPORT_TEMPLATE_DIR,
        quiz_title="API QA Quiz",
        group_title="API QA Group",
    )
    session_id = view["sessionId"]

    save_res = client.put(
        f"/api/session/{session_id}",
        json={
            "title": "API QA Quiz Updated",
            "passingScore": 70,
            "questions": [
                {"id": q["id"], "questionText": q.get("questionText"), "points": q.get("points")}
                for q in view["questions"]
            ],
        },
    )
    assert save_res.status_code == 200
    assert save_res.json()["title"] == "API QA Quiz Updated"

    export_res = client.post(
        f"/api/session/{session_id}/export",
        json={"title": "API QA Export"},
    )
    assert export_res.status_code == 200
    assert "zip" in (export_res.headers.get("content-type") or "").lower()
    validate_scorm_zip(export_res.content)


def test_preview_player_serves_mock_scorm_api(master_available):
    excel = IMPORT_TEMPLATE_DIR / "Media_import_sample.xlsx"
    if not excel.is_file():
        pytest.skip("Missing media sample")

    session, _ = import_excel_into_session(
        excel,
        excel_dir=IMPORT_TEMPLATE_DIR,
        master_source=MASTER_SCORM,
    )

    res = client.get(f"/api/session/{session.session_id}/preview/player")
    assert res.status_code == 200
    html = res.text
    assert "API" in html or "scorm" in html.lower()
    assert "ispring" in html.lower() or "quiz" in html.lower()


def test_exported_zip_reopens_as_new_session(master_available):
    excel = IMPORT_TEMPLATE_DIR / "Sample_import_template.xls"
    if not excel.is_file():
        pytest.skip("Missing sample")

    session, _ = import_excel_into_session(
        excel,
        excel_dir=IMPORT_TEMPLATE_DIR,
        master_source=MASTER_SCORM,
        quiz_title="Reopen Test",
    )
    exported_zip = session.export_zip("Reopen Test")

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / "reopen.zip"
        zip_path.write_bytes(exported_zip.read_bytes())
        reopened = ScormSession.create_from_source(zip_path)
        view = reopened.get_view()
        assert view["questionCount"] >= 8
        index = find_index_html(reopened.package_root)
        quiz = decode_quiz_data(index.read_text(encoding="utf-8"))
        assert count_questions(quiz) >= 8


def test_reporting_settings_survive_save_export(master_available):
    excel = IMPORT_TEMPLATE_DIR / "FIB_WB_import_sample.xlsx"
    if not excel.is_file():
        pytest.skip("Missing FIB_WB sample")

    session, _ = import_excel_into_session(
        excel,
        excel_dir=IMPORT_TEMPLATE_DIR,
        master_source=MASTER_SCORM,
    )
    view = session.get_view()
    payload = view_to_save_payload(view)
    payload["reporting"] = {
        "sendToServer": {"enabled": True, "url": "https://s4.ispringsolutions.com/quiz_results"},
        "adminEmail": {"enabled": True, "emails": "qa@example.com", "filter": "passedAndFailed"},
        "studentEmail": {"enabled": False, "filter": "passed"},
    }
    session.save_view(payload)
    zip_bytes = session.export_zip("Reporting QA")
    validated = validate_scorm_zip(zip_bytes)
    quiz = validated["quiz_saved"] or validated["quiz_json"]
    reporting = quiz.get("d", {}).get("s", {}).get("r", {})
    assert reporting.get("ss", {}).get("e") is True
    assert reporting.get("ads", {}).get("em") == "qa@example.com"


def test_cms_json_download_deletes_completed_session(master_available, monkeypatch):
    monkeypatch.setattr("app.s3_service.upload_file_to_s3", lambda _path: None)
    session = ScormSession.create_from_source(MASTER_SCORM)
    session.persist()
    session_dir = SESSIONS_ROOT / session.session_id
    assert session_dir.is_dir()

    response = client.post(f"/api/session/{session.session_id}/export-cms-json")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert isinstance(response.json(), list)
    assert not session_dir.exists()


def test_cms_json_export_rejects_empty_quiz_without_deleting_session(master_available, monkeypatch):
    monkeypatch.setattr("app.s3_service.upload_file_to_s3", lambda _path: None)
    session = ScormSession.create_from_source(MASTER_SCORM)
    session.quiz_json.setdefault("d", {}).setdefault("sl", {})["g"] = [
        {"T": "Imported Questions", "S": []}
    ]
    session.persist()
    session_dir = SESSIONS_ROOT / session.session_id

    response = client.post(f"/api/session/{session.session_id}/export-cms-json")

    assert response.status_code == 400
    assert "không có câu hỏi" in response.json()["detail"]
    assert session_dir.is_dir()


def test_save_new_fill_blank_into_empty_question_group(master_available):
    session = ScormSession.create_from_source(MASTER_SCORM)
    session.quiz_json.setdefault("d", {}).setdefault("sl", {})["g"] = [
        {"T": "Imported Questions", "S": []}
    ]
    session.persist()

    saved = session.save_view({
        "title": "New FIB",
        "questions": [{
            "id": "new_fib",
            "isNew": True,
            "type": "FillInTheBlank",
            "questionText": "[ô_trống] + [ô_trống] = 12",
            "blankAnswers": [
                {"id": "qmFillInTheBlank0", "values": ["6"]},
                {"id": "qmFillInTheBlank1", "values": ["6"]},
            ],
            "wordBankWords": ["4", "8"],
            "points": 1,
        }],
    })

    assert saved["questionCount"] == 1
    assert saved["questions"][0]["type"] == "FillInTheBlank"
    assert [item["values"] for item in saved["questions"][0]["blankAnswers"]] == [["6"], ["6"]]
    assert saved["questions"][0]["wordBankWords"] == ["4", "8"]


def test_legacy_cms_json_without_editor_state_is_migrated(master_available):
    legacy = {
        "title": "Legacy CMS",
        "description": "Recovered without raw state",
        "difficultyLevel": "hard",
        "duration": 600,
        "questions": [
            {
                "id": "legacy-mc",
                "type": "multiple_choice",
                "question": "Chọn đáp án",
                "imageUrl": "https://cdn.example.com/question.png",
                "options": [
                    {"id": "a", "text": "A", "imageUrl": "https://cdn.example.com/a.png"},
                    {"id": "b", "text": "B"},
                ],
                "correctAnswer": ["a"],
                "points": 1,
            },
            {
                "id": "legacy-short",
                "type": "short_answer",
                "question": "Nhập SDK",
                "correctAnswer": ["Software Development Kit"],
                "useRegex": False,
            },
        ],
    }

    response = client.post(
        "/api/import/json",
        files={"file": ("legacy.json", json.dumps([legacy]), "application/json")},
    )

    assert response.status_code == 200
    view = response.json()
    assert view["questionCount"] == 2
    assert view["tekyQuiz"]["description"] == legacy["description"]
    assert view["tekyQuiz"]["difficultyLevel"] == "hard"
    assert view["questions"][0]["slideImages"][0] == legacy["questions"][0]["imageUrl"]
    assert view["importSummary"]["legacyMigration"] is True


def test_json_import_recovers_cms_questions_when_embedded_state_is_empty(master_available):
    payload = {
        "title": "Recover stale state",
        "questions": [{
            "id": "fib-1",
            "type": "fill_blank",
            "question": "[ô_trống] + [ô_trống] = 12",
            "correctAnswer": ["6", "6"],
            "blankAnswers": [
                {"id": "blank-1", "acceptedAnswers": ["6"]},
                {"id": "blank-2", "acceptedAnswers": ["6"]},
            ],
            "distractors": ["4", "8"],
        }],
        "_scormEditorState": {
            "d": {"T": "Stale", "sl": {"g": [{"T": "Imported Questions", "S": []}]}},
        },
    }

    response = client.post(
        "/api/import/json",
        files={"file": ("stale.json", json.dumps([payload]), "application/json")},
    )

    assert response.status_code == 200
    view = response.json()
    assert view["questionCount"] == 1
    assert view["questions"][0]["type"] == "FillInTheBlank"
    assert len(view["questions"][0]["blankAnswers"]) == 2
    assert view["importSummary"]["legacyMigration"] is True


def test_json_import_rejects_unrecoverable_empty_export():
    payload = {
        "title": "Broken empty export",
        "questions": [],
        "_scormEditorState": {
            "d": {"T": "Broken", "sl": {"g": [{"T": "Imported Questions", "S": []}]}},
        },
    }

    response = client.post(
        "/api/import/json",
        files={"file": ("empty.json", json.dumps([payload]), "application/json")},
    )

    assert response.status_code == 400
    assert "không chứa câu hỏi" in response.json()["detail"]


def test_tsv_zip_passes_embedded_media_to_publisher(monkeypatch, tmp_path):
    captured = {}

    def fake_publish(_code, _settings, _questions, **kwargs):
        media = kwargs.get("template_media")
        captured["media"] = media
        assert media and (media / "custom.png").read_bytes() == b"custom-image"
        return {
            "lessonCode": "SNLT-ZIP-MEDIA",
            "lessonDir": str(tmp_path),
            "excelPath": str(tmp_path / "lesson.xlsx"),
            "mediaDir": str(tmp_path / "media"),
            "questionCount": 1,
            "warnings": [],
        }

    monkeypatch.setattr("app.main.publish_lesson_package", fake_publish)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("lesson/quiz_settings.tsv", "Field\tValue\ntitle\tZIP Media\n")
        archive.writestr(
            "lesson/quiz_questions.tsv",
            "Question Type\tQuestion Text\tAnswer 1\tAnswer 2\tImage\n"
            "MC\tQuestion?\t*Yes\tNo\tmedia/custom.png\n",
        )
        archive.writestr("lesson/media/custom.png", b"custom-image")

    response = client.post(
        "/api/import/tsv-zip-to-lesson",
        files={"file": ("lesson.zip", buffer.getvalue(), "application/zip")},
        data={"lessonCode": "SNLT-ZIP-MEDIA", "openInEditor": "false"},
    )

    assert response.status_code == 200
    assert response.json()["package"]["questionCount"] == 1
    assert captured["media"].name == "media"
