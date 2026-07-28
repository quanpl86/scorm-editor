from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
import pandas as pd

from app.cms_export import quiz_to_cms_json
from app.excel_import import parse_excel_file, parse_quiz_settings
from app.main import _create_quiz_from_excel, app


PROJECT_ROOT = Path(__file__).resolve().parents[3]
TEKY_TEMPLATE = (
    PROJECT_ROOT
    / "ImportTemplate"
    / "Full_quiz_9_types_sample"
    / "Full_quiz_9_types_teky_lms_system_ids.xlsx"
)
TEKY_PACKAGE = PROJECT_ROOT / "ImportTemplate" / "Full_quiz_9_types_teky_lms.zip"
client = TestClient(app)


def test_canonical_teky_excel_contains_quiz_settings_and_all_question_types():
    settings = parse_quiz_settings(TEKY_TEMPLATE)
    questions = parse_excel_file(TEKY_TEMPLATE)

    assert "id" not in settings
    assert settings["title"] == "Bài Kiểm Tra Tổng Hợp 9 Dạng Câu Hỏi"
    assert settings["coverImage"] == "media/quiz_cover.jpg"
    assert settings["subject"] == "Công nghệ thông tin"
    assert settings["tags"] == ["Sample", "Testing", "LMS"]
    assert settings["isPublic"] is True
    assert settings["duration"] == 2700
    assert settings["settings"] == {
        "shuffleQuestions": True,
        "shuffleAnswers": True,
        "attemptLimit": 3,
        "showResults": "after_submit",
        "allowReview": True,
    }

    assert len(questions) == 10
    assert not [q for q in questions if q.errors or q.warnings]
    assert {q.excel_type for q in questions} == {
        "MC", "MR", "TF", "MG", "SEQ", "FIB", "TI", "NUM", "MNUM", "WB",
    }
    columns = pd.read_excel(TEKY_TEMPLATE, sheet_name="Quiz Questions", nrows=0).columns
    assert "Question ID" not in columns
    assert "Cover Image" not in columns


def test_excel_to_teky_json_round_trip_preserves_quiz_config_and_generates_unique_ids():
    view = _create_quiz_from_excel(
        TEKY_TEMPLATE,
        excel_dir=TEKY_TEMPLATE.parent,
        group_title="Teky LMS Questions",
    )
    assert view["questionCount"] == 10
    assert view["tekyQuiz"]["id"].startswith("quiz_")
    assert view["tekyQuiz"]["coverImage"].startswith("img-import-")

    result = quiz_to_cms_json(view, view["sessionId"])
    assert result["id"] == view["tekyQuiz"]["id"]
    assert result["coverImageUrl"].startswith("images/img-import-")
    published = quiz_to_cms_json(
        view,
        view["sessionId"],
        s3_uploader=lambda filename: f"https://s3-sgn10.fptcloud.com/teky-prod/{filename}",
    )
    assert published["coverImageUrl"].startswith(
        "https://s3-sgn10.fptcloud.com/teky-prod/img-import-"
    )
    assert result["title"] == "Bài Kiểm Tra Tổng Hợp 9 Dạng Câu Hỏi"
    assert result["description"].startswith("Bài thi mẫu")
    assert result["subject"] == "Công nghệ thông tin"
    assert result["difficultyLevel"] == "medium"
    assert result["tags"] == ["Sample", "Testing", "LMS"]
    assert result["createdBy"] == "admin"
    assert result["createdByName"] == "Hệ thống LMS"
    assert result["isPublic"] is True
    assert result["duration"] == 2700
    assert result["settings"] == {
        "shuffleQuestions": True,
        "shuffleAnswers": True,
        "attemptLimit": 3,
        "showResults": "after_submit",
        "allowReview": True,
    }

    assert len(result["questions"]) == 10
    assert {q["type"] for q in result["questions"]} == {
        "multiple_choice",
        "multiple_select",
        "true_false",
        "matching",
        "ordering",
        "fill_blank",
        "short_answer",
        "numeric",
        "multiple_numeric",
    }
    short_answer = next(q for q in result["questions"] if q["type"] == "short_answer")
    fill_blank = next(q for q in result["questions"] if q["type"] == "fill_blank")
    assert short_answer["correctAnswer"] == ["Margaret Mitchell", "Margaret"]
    assert fill_blank["correctAnswer"] == ["Nữ thần Tự do", "nu than tu do"]

    question_ids = [q["id"] for q in result["questions"]]
    assert all(question_ids)
    assert len(question_ids) == len(set(question_ids))

    second_view = _create_quiz_from_excel(
        TEKY_TEMPLATE,
        excel_dir=TEKY_TEMPLATE.parent,
        group_title="Teky LMS Questions",
    )
    second_result = quiz_to_cms_json(second_view, second_view["sessionId"])
    assert second_result["id"] != result["id"]
    second_ids = [q["id"] for q in second_result["questions"]]
    assert set(question_ids).isdisjoint(second_ids)


def test_canonical_zip_imports_through_public_api_with_media():
    with TEKY_PACKAGE.open("rb") as handle:
        response = client.post(
            "/api/import/excel",
            files={"file": (TEKY_PACKAGE.name, handle, "application/zip")},
        )
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["questionCount"] == 10
    assert view["importSummary"]["imported"] == 10
    assert view["importSummary"]["warnings"] == 0
    assert view["tekyQuiz"]["id"].startswith("quiz_")
    assert view["tekyQuiz"]["coverImage"].startswith("img-import-")
