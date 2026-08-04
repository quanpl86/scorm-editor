from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from app.cms_export import _convert_hotspot, quiz_to_cms_json
from app.fill_blank import align_blank_answers, normalize_blank_answers, normalize_question_prompt
from app.json_migration import cms_questions_to_excel_rows


def _quiz_view(question):
    return {
        "title": "Conversion",
        "tekyQuiz": {"title": "Conversion"},
        "questions": [question],
    }


def test_single_target_dnd_converts_to_multiple_response():
    question = {
        "id": "dnd-one",
        "type": "DND",
        "questionText": "Chọn ảnh thuộc nhóm 2D",
        "dndItems": [
            {"id": "a", "sourceText": "A", "sourceImage": "https://cdn.example.com/a.png", "targetId": "2d", "targetText": "2D", "isMapped": True},
            {"id": "b", "sourceText": "B", "sourceImage": "https://cdn.example.com/b.png", "targetId": "2d", "targetText": "2D", "isMapped": True},
            {"id": "c", "sourceText": "C", "sourceImage": "https://cdn.example.com/c.png", "targetId": "", "targetText": "", "isMapped": False},
        ],
    }

    result = quiz_to_cms_json(_quiz_view(question), "unused")
    converted = result["questions"][0]

    assert converted["type"] == "multiple_select"
    assert converted["correctAnswer"] == ["a", "b"]
    assert len(converted["options"]) == 3
    assert converted["conversionMetadata"]["sourceType"] == "DND"


def test_multi_target_dnd_converts_to_matching():
    question = {
        "id": "dnd-many",
        "type": "DND",
        "questionText": "Ghép ảnh vào nhóm",
        "dndItems": [
            {"id": "a", "sourceText": "Circle", "sourceImage": "https://cdn.example.com/a.png", "targetId": "2d", "targetText": "2D", "isMapped": True},
            {"id": "b", "sourceText": "Cube", "sourceImage": "https://cdn.example.com/b.png", "targetId": "3d", "targetText": "3D", "isMapped": True},
        ],
    }

    result = quiz_to_cms_json(_quiz_view(question), "unused")
    converted = result["questions"][0]

    assert converted["type"] == "matching"
    assert [(pair["left"], pair["right"]) for pair in converted["pairs"]] == [
        ("Circle", "2D"),
        ("Cube", "3D"),
    ]


def test_remote_single_hotspot_gets_crop_and_fallback_option(tmp_path, monkeypatch):
    image_buffer = io.BytesIO()
    Image.new("RGB", (100, 100), "red").save(image_buffer, format="PNG")
    package_root = tmp_path / "package"
    package_root.mkdir()
    monkeypatch.setattr("app.cms_export.get_package_root", lambda _sid: package_root)
    monkeypatch.setattr(
        "app.cms_export.fetch_remote_media",
        lambda _url: (image_buffer.getvalue(), ".png", "image/png"),
    )

    options, correct = _convert_hotspot(
        {
            "choices": [{
                "id": "hotspot-0",
                "text": "Vùng đúng",
                "image": "https://cdn.example.com/base.png",
                "rect": {"x": 1000, "y": 1000, "w": 3000, "h": 3000},
                "isCorrect": True,
            }]
        },
        "session",
        "",
        lambda filename: f"https://cdn.example.com/{filename}",
    )

    assert correct == ["hotspot-0"]
    assert len(options) == 2
    assert options[0]["imageUrl"].startswith("https://")
    assert options[1]["id"] == "hotspot-other"


def test_hotspot_export_records_conversion_strategy(tmp_path, monkeypatch):
    image_buffer = io.BytesIO()
    Image.new("RGB", (100, 100), "blue").save(image_buffer, format="PNG")
    package_root = tmp_path / "package"
    package_root.mkdir()
    monkeypatch.setattr("app.cms_export.get_package_root", lambda _sid: package_root)
    monkeypatch.setattr(
        "app.cms_export.fetch_remote_media",
        lambda _url: (image_buffer.getvalue(), ".png", "image/png"),
    )
    question = {
        "id": "hotspot",
        "type": "Hotspot",
        "questionText": "Chọn vùng đúng",
        "choices": [{
            "id": "region",
            "text": "Vùng đúng",
            "image": "https://cdn.example.com/base.png",
            "rect": {"x": 1000, "y": 1000, "w": 3000, "h": 3000},
            "isCorrect": True,
        }],
    }

    converted = quiz_to_cms_json(_quiz_view(question), "session")["questions"][0]

    assert converted["type"] == "multiple_choice"
    assert converted["conversionMetadata"] == {
        "sourceType": "Hotspot",
        "strategy": "cropped-regions-mc-mr",
    }


def test_fill_blank_exports_multiple_drag_holders_and_distractors():
    question = {
        "id": "fib-multi",
        "type": "FillInTheBlank",
        "questionText": "___ + ___ = 12",
        "blankAnswers": [
            {"id": "blank-1", "values": ["6"]},
            {"id": "blank-2", "values": ["6", "six"]},
        ],
        "wordBankWords": ["4", "8"],
    }

    converted = quiz_to_cms_json(_quiz_view(question), "unused")["questions"][0]

    assert converted["question"] == "[ô_trống] + [ô_trống] = 12"
    assert converted["correctAnswer"] == ["6", "6"]
    assert [blank["acceptedAnswers"] for blank in converted["blankAnswers"]] == [
        ["6"], ["6", "six"],
    ]
    assert converted["distractors"] == ["4", "8"]
    assert [option["text"] for option in converted["dragOptions"]] == ["4", "8"]
    assert [option["text"] for option in converted["options"]] == ["4", "8"]
    assert all(option["isDistractor"] for option in converted["dragOptions"])
    assert all(option["isDistractor"] for option in converted["options"])
    assert converted["responseMode"] == "drag_in_blank"


def test_fill_blank_never_exports_correct_values_as_distractor_options():
    question = {
        "id": "fib-filter-duplicate",
        "type": "FillInTheBlank",
        "questionText": "___ + ___ = ___",
        "blankAnswers": [
            {"id": "blank-1", "values": ["6"]},
            {"id": "blank-2", "values": ["6"]},
            {"id": "blank-3", "values": ["12"]},
        ],
        # Simulate a stale/invalid editor state containing correct cards in
        # the additional-word collection.
        "wordBankWords": ["6", "12", "4", "8", "10"],
    }

    converted = quiz_to_cms_json(_quiz_view(question), "unused")["questions"][0]

    assert converted["correctAnswer"] == ["6", "6", "12"]
    assert converted["distractors"] == ["4", "8", "10"]
    assert [option["text"] for option in converted["options"]] == ["4", "8", "10"]


def test_legacy_and_new_duplicate_prompt_become_one_drag_holder():
    prompt = (
        "Trong Figma, phần tử tái sử dụng được gọi là ___.\n\n"
        "Trong Figma, phần tử tái sử dụng được gọi là [ô_trống]."
    )
    normalized = normalize_question_prompt(prompt)
    blanks = align_blank_answers(normalized, normalize_blank_answers([
        {"id": "blank-1", "values": ["component", "Component"]},
        {"id": "blank-2", "values": []},
    ]))

    assert normalized == "Trong Figma, phần tử tái sử dụng được gọi là [ô_trống]."
    assert len(blanks) == 1
    assert blanks[0]["values"] == ["component", "Component"]


def test_single_fill_blank_keeps_legacy_correct_answer_shape():
    question = {
        "id": "fib-legacy",
        "type": "FillInTheBlank",
        "questionText": "Trình duyệt là ___.",
        "blankAnswers": [{"id": "blank-1", "values": ["Edge", "Microsoft Edge"]}],
    }

    converted = quiz_to_cms_json(_quiz_view(question), "unused")["questions"][0]

    assert converted["correctAnswer"] == ["Edge", "Microsoft Edge"]
    assert converted["question"] == "Trình duyệt là [ô_trống]."


def test_legacy_fill_blank_with_lost_mappings_exposes_empty_holders_for_repair():
    question = {
        "id": "fib-partial-legacy",
        "type": "FillInTheBlank",
        "questionText": "___ được dùng để xác định ___ trong ___.",
        "blankAnswers": [{"id": "blank-1", "values": ["tọa độ"]}],
    }

    converted = quiz_to_cms_json(_quiz_view(question), "unused")["questions"][0]

    assert len(converted["blankAnswers"]) == 3
    assert converted["blankAnswers"][1]["acceptedAnswers"] == []
    assert converted["correctAnswer"] == ["tọa độ", "", ""]


def test_json_migration_accepts_old_and_new_fill_blank_schema():
    rows = cms_questions_to_excel_rows({
        "questions": [
            {
                "type": "fill_blank",
                "question": "Legacy ___",
                "correctAnswer": ["Edge", "Microsoft Edge"],
            },
            {
                "type": "fill_blank",
                "question": "[ô_trống] + [ô_trống] = 12",
                "blankAnswers": [
                    {"id": "one", "acceptedAnswers": ["6"]},
                    {"id": "two", "acceptedAnswers": ["6"]},
                ],
                "distractors": ["4", "8"],
                "correctAnswer": ["6", "6"],
            },
        ],
    })

    assert rows[0].blank_answers == [{
        "id": "qmFillInTheBlank0",
        "values": ["Edge", "Microsoft Edge"],
    }]
    assert [blank["values"] for blank in rows[1].blank_answers] == [["6"], ["6"]]
    assert rows[1].distractors == ["4", "8"]
