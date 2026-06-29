"""Phase 5: Excel template download API + import summary."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.quiz_builder import IMPORT_TEMPLATE_DIR

client = TestClient(app)


def test_list_excel_templates():
    res = client.get("/api/import/excel/templates")
    assert res.status_code == 200
    templates = res.json()["templates"]
    ids = {t["id"] for t in templates}
    assert "sample" in ids
    assert all(t.get("downloadUrl") for t in templates)


def test_download_sample_template():
    res = client.get("/api/import/excel/templates/sample")
    assert res.status_code == 200
    assert "spreadsheet" in (res.headers.get("content-type") or "").lower() or res.content[:4] in (b"\xd0\xcf\x11\xe0", b"PK\x03\x04")


def test_import_summary_includes_media_warnings():
    sample = IMPORT_TEMPLATE_DIR / "Sample_import_template.xls"
    if not sample.exists():
        return
    from app.main import _create_quiz_from_excel

    view2 = _create_quiz_from_excel(
        sample,
        excel_dir=IMPORT_TEMPLATE_DIR,
        quiz_title="UX Quiz",
        group_title="UX Group",
    )
    summary = view2["importSummary"]
    assert summary["groupTitle"] == "UX Group"
    assert summary["quizTitle"] == "UX Quiz"
    assert "mediaWarnings" in summary
    assert isinstance(summary["mediaWarnings"], list)