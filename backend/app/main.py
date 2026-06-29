from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .fonts import resolve_font_path
from .preview import build_preview_html, preview_res_root
from .scorm_parser import SESSIONS_ROOT, ScormSession, find_index_html, get_session

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


class SavePayload(BaseModel):
    title: str | None = None
    passingScore: int | None = None
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
        path = get_session(session_id).asset_path(filename)
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
        session = get_session(session_id)
        res_root = preview_res_root(session.package_root)
        file_path = (res_root / path).resolve()
        if not str(file_path).startswith(str(res_root.resolve())):
            raise HTTPException(403, "Invalid path")
        if not file_path.is_file():
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