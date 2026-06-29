from __future__ import annotations

import shutil
import ssl
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .excel_import import parse_excel_file
from .fonts import resolve_font_path
from .preview import build_preview_html, is_report_proxy_target_allowed, preview_res_root
from .quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from .scorm_parser import (
    SESSIONS_ROOT,
    ScormSession,
    find_index_html,
    get_package_root,
    get_session,
    resolve_asset_path,
)

app = FastAPI(title="SCORM Editor", version="1.0.0")

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SAMPLE_ZIP = PROJECT_ROOT / "samples" / "DGSA2025-HP05-B01.zip"
SAMPLE_DIR = PROJECT_ROOT / "samples" / "DGSA_Level5_Bai1"
EXCEL_SAMPLE = IMPORT_TEMPLATE_DIR / "Sample_import_template.xls"

EXCEL_SUFFIXES = {".xls", ".xlsx"}


class SavePayload(BaseModel):
    title: str | None = None
    passingScore: int | None = None
    reporting: dict | None = None
    introSlide: dict | None = None
    resultSlides: list[dict] = []
    questions: list[dict] = []


class ExportPayload(BaseModel):
    title: str | None = None


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/import")
async def import_scorm(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Vui lòng upload file .zip SCORM")

    temp_zip = SESSIONS_ROOT / f"upload_{file.filename}"
    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    temp_zip.write_bytes(content)
    try:
        session = ScormSession.create_from_source(temp_zip)
        return session.get_view()
    except Exception as exc:
        raise HTTPException(400, f"Không thể đọc gói SCORM: {exc}") from exc
    finally:
        if temp_zip.exists():
            temp_zip.unlink()


def _find_excel_file(root: Path) -> Path | None:
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in EXCEL_SUFFIXES:
            return path
    return None


def _create_quiz_from_excel(
    excel_path: Path,
    *,
    excel_dir: Path,
    quiz_title: str | None = None,
    group_title: str = "Imported Questions",
) -> dict:
    if not MASTER_SCORM.exists():
        raise HTTPException(
            500,
            f"Không tìm thấy SCORM mẫu để tạo quiz: {MASTER_SCORM}",
        )

    rows = parse_excel_file(excel_path)
    session = ScormSession.create_from_source(MASTER_SCORM)
    quiz_json, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=excel_dir,
        group_title=group_title,
        quiz_title=quiz_title,
    )
    session.quiz_json = quiz_json
    session.persist()
    view = session.get_view()
    view["importReport"] = report
    imported = sum(1 for r in report if r.get("status") == "imported")
    view["importSummary"] = {
        "total": len(report),
        "imported": imported,
        "errors": sum(1 for r in report if r.get("status") == "error"),
        "skipped": sum(1 for r in report if r.get("status") == "skipped"),
    }
    return view


@app.post("/api/import/excel")
async def import_excel(
    file: UploadFile = File(...),
    quiz_title: str | None = Form(None),
    group_title: str = Form("Imported Questions"),
):
    if not file.filename:
        raise HTTPException(400, "Thiếu tên file")

    name = file.filename.lower()
    content = await file.read()
    if not content:
        raise HTTPException(400, "File rỗng")

    temp_root = SESSIONS_ROOT / f"excel_upload_{file.filename}"
    temp_root.mkdir(parents=True, exist_ok=True)

    try:
        if name.endswith(".zip"):
            zip_path = temp_root / file.filename
            zip_path.write_bytes(content)
            extract_dir = temp_root / "extracted"
            extract_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_dir)
            excel_path = _find_excel_file(extract_dir)
            if not excel_path:
                raise HTTPException(400, "Zip không chứa file .xls hoặc .xlsx")
            excel_dir = excel_path.parent
        elif any(name.endswith(ext) for ext in EXCEL_SUFFIXES):
            excel_path = temp_root / Path(file.filename).name
            excel_path.write_bytes(content)
            excel_dir = excel_path.parent
        else:
            raise HTTPException(400, "Chỉ hỗ trợ .xls, .xlsx hoặc .zip (Excel + thư mục media)")

        return _create_quiz_from_excel(
            excel_path,
            excel_dir=excel_dir,
            quiz_title=quiz_title,
            group_title=group_title or "Imported Questions",
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Không thể import Excel: {exc}") from exc
    finally:
        if temp_root.exists():
            shutil.rmtree(temp_root, ignore_errors=True)


@app.post("/api/import/excel/sample")
def import_excel_sample(
    quiz_title: str | None = None,
    group_title: str = "Imported Questions",
):
    if not EXCEL_SAMPLE.exists():
        raise HTTPException(404, f"File mẫu không tồn tại: {EXCEL_SAMPLE}")
    try:
        return _create_quiz_from_excel(
            EXCEL_SAMPLE,
            excel_dir=IMPORT_TEMPLATE_DIR,
            quiz_title=quiz_title or "Sample Import Quiz",
            group_title=group_title,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Không thể import mẫu Excel: {exc}") from exc


@app.post("/api/import/sample")
def import_sample(source: str = "zip"):
    try:
        src = SAMPLE_ZIP if source == "zip" else SAMPLE_DIR
        if not src.exists():
            raise HTTPException(404, f"File mẫu không tồn tại: {src}")
        session = ScormSession.create_from_source(src)
        return session.get_view()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Không thể load mẫu: {exc}") from exc


@app.get("/api/session/{session_id}")
def get_session_view(session_id: str):
    try:
        return get_session(session_id).get_view()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.put("/api/session/{session_id}")
def save_session(session_id: str, payload: SavePayload):
    try:
        session = get_session(session_id)
        return session.save_view(payload.model_dump())
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Lỗi lưu: {exc}") from exc


@app.get("/api/session/{session_id}/asset/{filename}")
def get_asset(session_id: str, filename: str):
    try:
        path = resolve_asset_path(session_id, filename)
        return FileResponse(path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/session/{session_id}/asset/{filename}")
async def upload_asset(session_id: str, filename: str, file: UploadFile = File(...)):
    try:
        session = get_session(session_id)
        content = await file.read()
        saved = session.replace_image(filename, content)
        session.persist()
        return {"filename": saved, "url": f"/api/session/{session_id}/asset/{saved}"}
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/session/{session_id}/export")
def export_session(session_id: str, payload: ExportPayload | None = None):
    try:
        session = get_session(session_id)
        title = payload.title if payload else None
        zip_bytes = session.export_zip(title)
        safe_name = (title or session.quiz_json.get("d", {}).get("T", "scorm-export")).strip()
        safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_name)[:80]
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export: {exc}") from exc


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str):
    path = SESSIONS_ROOT / session_id
    if path.exists():
        shutil.rmtree(path)
    return {"deleted": True}


@app.get("/api/session/{session_id}/preview/player")
def preview_player(session_id: str):
    """Serve iSpring player with injected mock SCORM 1.2 API."""
    try:
        session = get_session(session_id)
        index_path = find_index_html(session.package_root)
        index_html = index_path.read_text(encoding="utf-8")
        html = build_preview_html(index_html, session_id)
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


def _proxy_urlopen(req: urllib.request.Request, *, timeout: int = 45):
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.URLError as exc:
        reason = str(getattr(exc, "reason", exc))
        if "CERTIFICATE_VERIFY_FAILED" not in reason:
            raise
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return urllib.request.urlopen(req, timeout=timeout, context=ctx)


@app.post("/api/session/{session_id}/preview/report-proxy")
async def preview_report_proxy(session_id: str, url: str, request: Request):
    """Forward iSpring quiz report POSTs server-side (avoids browser CORS in preview)."""
    try:
        session = get_session(session_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc

    target = unquote(url).strip()
    if not target.startswith(("http://", "https://")):
        raise HTTPException(400, "URL không hợp lệ")
    if not is_report_proxy_target_allowed(target, session.quiz_json):
        raise HTTPException(403, "URL báo cáo không được phép")

    body = await request.body()
    content_type = request.headers.get("content-type", "application/x-www-form-urlencoded")
    proxy_req = urllib.request.Request(target, data=body, method="POST")
    proxy_req.add_header("Content-Type", content_type)

    try:
        with _proxy_urlopen(proxy_req, timeout=45) as resp:
            payload = resp.read()
            return Response(content=payload, status_code=resp.status, media_type=resp.headers.get_content_type())
    except urllib.error.HTTPError as exc:
        detail = exc.read()
        return Response(content=detail, status_code=exc.code)
    except Exception as exc:
        raise HTTPException(502, f"Không gửi được báo cáo: {exc}") from exc


@app.get("/api/session/{session_id}/preview/res/{path:path}")
def preview_static(session_id: str, path: str):
    """Serve quiz package assets for preview iframe."""
    return _serve_package_res(session_id, path)


@app.get("/api/session/{session_id}/fonts")
def session_fonts(session_id: str):
    """Font manifest for canvas WYSIWYG (@font-face paths per package)."""
    try:
        session = get_session(session_id)
        return session.get_fonts()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/session/{session_id}/res/{path:path}")
def session_res_static(session_id: str, path: str):
    """Serve package assets (fonts, images) for canvas WYSIWYG."""
    return _serve_package_res(session_id, path)


def _serve_package_res(session_id: str, path: str) -> FileResponse:
    try:
        package_root = get_package_root(session_id)
        res_root = preview_res_root(package_root)
        file_path = (res_root / path).resolve()
        if not str(file_path).startswith(str(res_root.resolve())):
            raise HTTPException(403, "Invalid path")
        if not file_path.is_file():
            session = get_session(session_id)
            fallback = resolve_font_path(session.package_root, session.quiz_json, path)
            if fallback and fallback.is_file():
                file_path = fallback
            else:
                raise HTTPException(404, "File not found")
        return FileResponse(file_path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


def _setup_frontend() -> None:
    """Serve built React app from single server (no separate Vite dev server needed)."""
    if not FRONTEND_DIST.exists():
        return

    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    def serve_index():
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{path:path}")
    def serve_spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "API route not found")
        file_path = FRONTEND_DIST / path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")


_setup_frontend()