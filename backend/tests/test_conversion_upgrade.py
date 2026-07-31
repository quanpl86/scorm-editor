from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from app.cms_export import _convert_hotspot, quiz_to_cms_json


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
