from __future__ import annotations

import json
import os
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

from app.excel_exporter import export_session_to_excel_zip
from app.excel_import import parse_excel_file, parse_quiz_settings
from app.main import merge_cms_config_into_editor_state
from app.scorm_parser import atomic_write_text, quiz_to_view
from app import session_manager


def test_merge_cms_configuration_back_into_editor_state():
    cms = {
        "title": "Round trip",
        "description": "Description",
        "subject": "Subject",
        "targetLesson": "Lesson",
        "difficultyLevel": "hard",
        "tags": ["one", "two"],
        "createdBy": "author",
        "createdByName": "Author",
        "isPublic": True,
        "duration": 900,
        "settings": {"shuffleQuestions": True, "attemptLimit": 3},
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-02T00:00:00Z",
        "coverImageUrl": "https://cdn.example.com/cover.png",
    }
    state = {"d": {"T": "Old", "sl": {"g": []}}, "_teky": {"title": "Old"}}

    restored = quiz_to_view(merge_cms_config_into_editor_state(cms, state))["tekyQuiz"]

    for key, value in cms.items():
        if key == "coverImageUrl":
            assert restored["coverImage"] == value
        else:
            assert restored[key] == value


def test_atomic_write_uses_unique_temp_files_under_concurrency(tmp_path):
    target = tmp_path / "quiz_data.json"
    errors: list[Exception] = []

    def write(index: int) -> None:
        try:
            atomic_write_text(target, json.dumps({"writer": index}))
        except Exception as exc:  # pragma: no cover - assertion below reports it
            errors.append(exc)

    with ThreadPoolExecutor(max_workers=20) as executor:
        list(executor.map(write, range(20)))

    assert not errors
    assert isinstance(json.loads(target.read_text())["writer"], int)
    assert not list(tmp_path.glob("*.tmp"))


def test_cleanup_uses_heartbeat_and_two_hour_idle_ttl(tmp_path, monkeypatch):
    monkeypatch.setattr(session_manager, "SESSION_IDLE_TTL_SECONDS", 2 * 3600)
    monkeypatch.setattr(session_manager, "SESSION_STORAGE_LIMIT_BYTES", 1024**3)
    root = tmp_path / "sessions"
    idle = root / "idle"
    active = root / "active"
    idle.mkdir(parents=True)
    active.mkdir(parents=True)
    (idle / "data.bin").write_bytes(b"idle")
    (active / "data.bin").write_bytes(b"active")
    now = time.time()
    os.utime(idle, (now - 3 * 3600, now - 3 * 3600))
    os.utime(active, (now - 3 * 3600, now - 3 * 3600))
    session_manager.touch_session(root, "active")

    report = session_manager.cleanup_sessions(root, now=now)

    assert report["removed"] == 1
    assert not idle.exists()
    assert active.exists()


def test_twenty_concurrent_writers_cannot_overbook_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(session_manager, "SESSION_STORAGE_LIMIT_BYTES", 1000)
    root = tmp_path / "sessions"
    accepted: list[int] = []
    rejected: list[int] = []

    def write(index: int) -> None:
        try:
            with session_manager.storage_write_lock():
                session_manager.ensure_storage_capacity(root, reserve_bytes=100)
                session_dir = root / f"user-{index}"
                session_dir.mkdir(parents=True)
                (session_dir / "data.bin").write_bytes(b"x" * 100)
                session_manager.ensure_storage_capacity(
                    root,
                    protected_ids={session_dir.name},
                )
                accepted.append(index)
        except session_manager.SessionStorageFullError:
            rejected.append(index)

    with ThreadPoolExecutor(max_workers=20) as executor:
        list(executor.map(write, range(20)))

    assert len(accepted) == 10
    assert len(rejected) == 10
    assert session_manager.sessions_size(root) <= 1000


class _ProjectSession:
    def __init__(self, root: Path):
        self.session_id = "project-test"
        self.root = root

    def asset_path(self, value: str) -> Path:
        path = self.root / Path(str(value).split("?")[0]).name
        if not path.exists():
            raise FileNotFoundError(value)
        return path

    def get_view(self):
        image = "question.png"
        return {
            "title": "Project Round Trip",
            "questionCount": 5,
            "tekyQuiz": {
                "title": "Project Round Trip",
                "description": "Full settings",
                "coverImage": image,
                "subject": "Subject",
                "targetLesson": "Lesson",
                "lessonCode": "SNLT-TEST",
                "difficultyLevel": "hard",
                "tags": ["roundtrip"],
                "createdBy": "tester",
                "createdByName": "Tester",
                "isPublic": True,
                "duration": 1200,
                "settings": {
                    "shuffleQuestions": True,
                    "shuffleAnswers": True,
                    "attemptLimit": 2,
                    "showResults": "after_submit",
                    "allowReview": True,
                },
            },
            "questions": [
                {
                    "type": "Hotspot",
                    "questionText": "Chọn vùng",
                    "choices": [{
                        "text": "Vùng đúng",
                        "image": image,
                        "isCorrect": True,
                        "rect": {"x": 1000, "y": 1000, "w": 4000, "h": 4000},
                    }],
                    "difficulty": "easy",
                    "points": 1,
                    "slideImages": [image],
                },
                {
                    "type": "TypeIn",
                    "questionText": "Nhập đáp án",
                    "typeInAnswers": ["A", "B"],
                    "difficulty": "medium",
                    "required": True,
                    "useRegex": True,
                },
                {
                    "type": "FillInTheBlank",
                    "questionText": "Điền ___",
                    "blankAnswers": [{"values": ["từ"]}],
                    "difficulty": "medium",
                },
                {
                    "type": "MultipleNumeric",
                    "questionText": "Hai số",
                    "typeInAnswers": ["2", "3"],
                    "difficulty": "hard",
                },
                {
                    "type": "WordBank",
                    "questionText": "Chọn từ",
                    "blankAnswers": [{"values": ["đúng"]}],
                    "wordBankWords": ["sai"],
                    "difficulty": "easy",
                },
            ],
        }


def test_source_project_excel_round_trips_types_settings_and_media(tmp_path):
    Image.new("RGB", (100, 100), "red").save(tmp_path / "question.png")
    session = _ProjectSession(tmp_path)
    zip_path, _ = export_session_to_excel_zip(session)
    try:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(tmp_path / "export")
            assert any(name.startswith("media/") for name in archive.namelist())
        workbook = next((tmp_path / "export").glob("*.xlsx"))
        rows = parse_excel_file(workbook)
        settings = parse_quiz_settings(workbook)

        assert len(rows) == 5
        assert not [row.errors for row in rows if row.errors]
        assert not [row.warnings for row in rows if row.warnings]
        assert settings["title"] == "Project Round Trip"
        assert settings["targetLesson"] == "Lesson"
        assert settings["duration"] == 1200
        assert settings["settings"]["shuffleQuestions"] is True
        assert rows[0].image == "media/Project Round Trip_1_IMG-ND1.png"
        assert rows[0].answers[0].image
    finally:
        Path(zip_path).unlink(missing_ok=True)
