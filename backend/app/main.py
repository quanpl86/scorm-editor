from __future__ import annotations

import shutil
import ssl
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .cms_export import quiz_to_cms_json
from .excel_import import parse_excel_file, parse_quiz_settings
from .fonts import resolve_font_path
from .preview import build_preview_html, is_report_proxy_target_allowed, preview_res_root
from .quiz_builder import IMPORT_TEMPLATE_DIR, MASTER_SCORM, build_quiz_from_excel
from .scorm_parser import (
    SESSIONS_ROOT,
    ScormSession,
    ensure_media_registry,
    find_index_html,
    get_package_root,
    get_session,
    quiz_to_view,
    resolve_asset_path,
)
from .tsv_snlt_publish import (
    TsvPublishError,
    publish_lesson_package,
    split_combined_tsv,
)

app = FastAPI(title="SCORM Editor", version="1.0.0")

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
JSON_EXPORT_DIR = IMPORT_TEMPLATE_DIR.parent / "JSON-EXPORT"
SAMPLE_ZIP = PROJECT_ROOT / "samples" / "DGSA2025-HP05-B01.zip"
SAMPLE_DIR = PROJECT_ROOT / "samples" / "DGSA_Level5_Bai1"
EXCEL_SAMPLE = IMPORT_TEMPLATE_DIR / "Sample_import_template.xls"
EXCEL_MEDIA_SAMPLE = IMPORT_TEMPLATE_DIR / "Media_import_sample.xlsx"
EXCEL_FIB_WB_SAMPLE = IMPORT_TEMPLATE_DIR / "FIB_WB_import_sample.xlsx"

EXCEL_TEMPLATES: dict[str, dict[str, str]] = {
    "full": {
        "path": str(IMPORT_TEMPLATE_DIR / "Full_quiz_9_types_teky_lms.zip"),
        "label": "Full_quiz_9_types_teky_lms.zip",
        "description": "Gói chuẩn Teky LMS: Excel cấu hình quiz/question + đầy đủ media",
    },
    "sample": {
        "path": str(EXCEL_SAMPLE),
        "label": "Sample_import_template.xls",
        "description": "Mẫu đầy đủ MC/MR/TF/TI/MG/SEQ/IS/NUMG",
    },
    "media": {
        "path": str(EXCEL_MEDIA_SAMPLE),
        "label": "Media_import_sample.xlsx",
        "description": "Mẫu audio/video mầm non",
    },
    "fib-wb": {
        "path": str(EXCEL_FIB_WB_SAMPLE),
        "label": "FIB_WB_import_sample.xlsx",
        "description": "Mẫu FIB, Word Bank, Numeric",
    },
}

EXCEL_SUFFIXES = {".xls", ".xlsx"}


class SavePayload(BaseModel):
    title: str | None = None
    passingScore: int | None = None
    tekyQuiz: dict | None = None
    reporting: dict | None = None
    introSlide: dict | None = None
    resultSlides: list[dict] = []
    questions: list[dict] = []


class ExportPayload(BaseModel):
    title: str | None = None


class TsvLessonPublishPayload(BaseModel):
    """Dán TSV → tạo gói ImportTemplate/{lessonCode}/ + (tuỳ chọn) mở Editor."""

    lessonCode: str
    settingsTsv: str = ""
    questionsTsv: str = ""
    combinedTsv: str | None = None
    overwrite: bool = False
    seedMediaFromTemplate: bool = False
    openInEditor: bool = True
    quizTitle: str | None = None
    groupTitle: str = "Imported Questions"


@app.get("/api/health")
def health():
    return {"status": "ok"}


def cleanup_old_sessions():
    import time
    try:
        now = time.time()
        if not SESSIONS_ROOT.exists(): return
        # 1. Xóa các session cũ hơn 4 giờ
        for item in SESSIONS_ROOT.iterdir():
            try:
                if now - item.stat().st_mtime > 4 * 3600:
                    if item.is_dir():
                        shutil.rmtree(item, ignore_errors=True)
                    elif item.is_file():
                        item.unlink(missing_ok=True)
            except Exception:
                pass
                
        # 2. Kiểm tra dung lượng ổ đĩa, nếu > 70% thì xóa bớt phân nửa session cũ nhất
        usage = shutil.disk_usage(SESSIONS_ROOT)
        if usage.used / usage.total > 0.70:
            items = []
            for item in SESSIONS_ROOT.iterdir():
                try:
                    items.append((item.stat().st_mtime, item))
                except Exception:
                    pass
            
            # Sắp xếp từ cũ nhất đến mới nhất
            items.sort(key=lambda x: x[0])
            
            # Xóa một nửa số session cũ nhất để giải phóng
            for _, item in items[:len(items)//2 + 1]:
                try:
                    if item.is_dir():
                        shutil.rmtree(item, ignore_errors=True)
                    elif item.is_file():
                        item.unlink(missing_ok=True)
                except Exception:
                    pass
    except Exception:
        pass

@app.post("/api/import/json")
def import_cms_json(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    background_tasks.add_task(cleanup_old_sessions)
    if not file.filename.endswith(".json"):
        raise HTTPException(400, "Vui lòng chọn file .json CMS")
    
    import json
    content = file.file.read()
    try:
        data = json.loads(content)
        # Handle both single object or array
        if isinstance(data, list) and len(data) > 0:
            quiz_obj = data[0]
        elif isinstance(data, dict):
            quiz_obj = data
        else:
            raise HTTPException(400, "Cấu trúc JSON không hợp lệ.")
            
        editor_state = quiz_obj.get("_scormEditorState")
        if not editor_state:
            raise HTTPException(400, "File JSON không chứa dữ liệu gốc của SCORM Editor (thiếu _scormEditorState). Vui lòng dùng tính năng Import TSV/Excel nếu đây là file từ nguồn khác.")
        
        if "d" not in editor_state or "sl" not in editor_state.get("d", {}):
            raise HTTPException(400, "File JSON này thuộc phiên bản Beta (lưu trữ dưới dạng View) không tương thích để phục hồi. Vui lòng sử dụng bản Export mới nhất.")

        # Create a new stateless session
        session_id = str(uuid.uuid4())
        session_dir = SESSIONS_ROOT / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        package_dir = session_dir / "package"
        package_dir.mkdir(parents=True, exist_ok=True)
        
        # Save the stateless editor state as quiz_data.json
        with open(package_dir / "quiz_data.json", "w", encoding="utf-8") as f:
            json.dump(editor_state, f, ensure_ascii=False)
            
        session = get_session(session_id)
        view = session.get_view()
        view["importSummary"] = {"imported": len(view.get("questions", [])), "total": len(view.get("questions", []))}
        return view
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(400, f"Lỗi đọc file JSON: {str(e)}")

@app.post("/api/import")
def import_scorm(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    background_tasks.add_task(cleanup_old_sessions)
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Vui lòng upload file .zip SCORM")

    temp_zip = SESSIONS_ROOT / f"upload_{uuid.uuid4().hex[:8]}_{file.filename}"
    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    with temp_zip.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
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


def _sanitize_filename_part(value: str | None) -> str:
    """Keep Unicode (VN) letters; strip path-illegal characters."""
    import re

    s = (value or "").strip()
    for ch in '\\/:*?"<>|\n\r\t':
        s = s.replace(ch, "_")
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s


def build_cms_export_filename(
    lesson_code: str | None,
    target_lesson: str | None,
    title: str | None = None,
) -> str:
    """
    Chuẩn tên file export JSON:
      [SNLT-HP01-B04] Ôn tập 1.json
    = [{Tên Bài học / lessonCode}] {Tên bài học / targetLesson}.json
    """
    code = _sanitize_filename_part(lesson_code) or "QUIZ"
    lesson = _sanitize_filename_part(target_lesson) or _sanitize_filename_part(title) or "export"
    if lesson.lower().endswith(".json"):
        lesson = lesson[: -len(".json")].rstrip()
    # Cap length for filesystem friendliness
    if len(code) > 64:
        code = code[:64].rstrip()
    if len(lesson) > 120:
        lesson = lesson[:120].rstrip()
    return f"[{code}] {lesson}.json"


def _create_quiz_from_excel(
    excel_path: Path,
    *,
    excel_dir: Path,
    quiz_title: str | None = None,
    group_title: str = "Imported Questions",
    lesson_code: str | None = None,
) -> dict:
    if not MASTER_SCORM.exists():
        raise HTTPException(
            500,
            f"Không tìm thấy SCORM mẫu để tạo quiz: {MASTER_SCORM}",
        )

    rows = parse_excel_file(excel_path)
    teky_quiz = parse_quiz_settings(excel_path)
    media_fallback_dirs: list[Path] = []
    matching_workbooks = [
        candidate
        for candidate in IMPORT_TEMPLATE_DIR.rglob(excel_path.name)
        if candidate.is_file()
    ]
    if len(matching_workbooks) == 1:
        media_fallback_dirs.append(matching_workbooks[0].parent)
    lesson_dir = IMPORT_TEMPLATE_DIR / excel_path.stem
    if lesson_dir.is_dir() and lesson_dir not in media_fallback_dirs:
        media_fallback_dirs.append(lesson_dir)
    # Quiz IDs are system-owned, just like question IDs. Generate once per
    # import, persist in the editor session, and reuse for every export.
    teky_quiz["id"] = f"quiz_{uuid.uuid4().hex}"
    # Persist lesson package code for export filename: [SNLT-HP01-B04] …
    resolved_lesson_code = (lesson_code or teky_quiz.get("lessonCode") or "").strip()
    if not resolved_lesson_code:
        # ImportTemplate/SNLT-HP01-B04/SNLT-HP01-B04.xlsx → SNLT-HP01-B04
        if excel_path.parent.name == excel_path.stem:
            resolved_lesson_code = excel_path.stem
        else:
            resolved_lesson_code = excel_path.stem
    if resolved_lesson_code:
        teky_quiz["lessonCode"] = resolved_lesson_code
    session = ScormSession.create_from_source(MASTER_SCORM)
    quiz_json, report = build_quiz_from_excel(
        session.quiz_json,
        rows,
        package_root=session.package_root,
        excel_dir=excel_dir,
        group_title=group_title,
        quiz_title=quiz_title,
        teky_quiz=teky_quiz,
        additional_media_dirs=media_fallback_dirs,
    )
    session.quiz_json = quiz_json
    ensure_media_registry(session.quiz_json, session.package_root)
    session.persist()
    view = session.get_view()
    view["importReport"] = report
    imported = sum(1 for r in report if r.get("status") == "imported")
    media_warnings: list[dict[str, Any]] = []
    for row in report:
        quiz_warnings = set(row.get("quizWarnings") or [])
        for warning in row.get("warnings") or []:
            is_quiz_warning = warning in quiz_warnings
            media_warnings.append({
                "row": None if is_quiz_warning else row.get("row"),
                "type": "QUIZ" if is_quiz_warning else row.get("type"),
                "slideId": None if is_quiz_warning else row.get("slideId"),
                "scope": "quiz" if is_quiz_warning else "question",
                "message": warning,
            })

    view["importSummary"] = {
        "total": len(report),
        "imported": imported,
        "errors": sum(1 for r in report if r.get("status") == "error"),
        "skipped": sum(1 for r in report if r.get("status") == "skipped"),
        "warnings": len(media_warnings),
        "mediaWarnings": media_warnings,
        "groupTitle": group_title,
        "quizTitle": quiz_title or teky_quiz.get("title") or view.get("title"),
    }
    return view


@app.get("/api/import/excel/templates")
def list_excel_templates():
    items = []
    for key, meta in EXCEL_TEMPLATES.items():
        path = Path(meta["path"])
        if path.is_file():
            items.append({
                "id": key,
                "filename": meta["label"],
                "description": meta["description"],
                "downloadUrl": f"/api/import/excel/templates/{key}",
            })
    return {"templates": items}


@app.get("/api/import/excel/templates/{template_id}")
def download_excel_template(template_id: str):
    meta = EXCEL_TEMPLATES.get(template_id)
    if not meta:
        raise HTTPException(404, f"Không có template: {template_id}")
    path = Path(meta["path"])
    if not path.is_file():
        raise HTTPException(404, f"File template không tồn tại: {meta['label']}")
    return FileResponse(path, filename=meta["label"])


@app.get("/api/import/excel/templates/zip/{lesson_code}")
def download_lesson_template_zip(lesson_code: str):
    import io
    import zipfile
    from fastapi.responses import StreamingResponse

    safe_code = _sanitize_filename_part(lesson_code)
    if not safe_code:
        raise HTTPException(400, "Mã bài học không hợp lệ")

    lesson_dir = IMPORT_TEMPLATE_DIR / safe_code
    if not lesson_dir.is_dir():
        raise HTTPException(404, f"Không tìm thấy thư mục của bài học: {safe_code}")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in lesson_dir.rglob("*"):
            if file_path.is_file() and file_path.name != ".DS_Store":
                arcname = file_path.relative_to(lesson_dir).as_posix()
                # Wrap inside a root folder named after the lesson
                zf.write(file_path, f"{safe_code}/{arcname}")

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_code}.zip"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@app.post("/api/import/tsv-to-lesson")
def import_tsv_to_lesson(payload: TsvLessonPublishPayload):
    """
    Dán TSV (settings + questions) → tạo
    ImportTemplate/{lessonCode}/{lessonCode}.xlsx + media/
    rồi (mặc định) import vào Editor session.
    """
    settings_tsv = (payload.settingsTsv or "").strip()
    questions_tsv = (payload.questionsTsv or "").strip()
    if payload.combinedTsv and payload.combinedTsv.strip():
        try:
            settings_tsv, questions_tsv = split_combined_tsv(payload.combinedTsv)
        except TsvPublishError as exc:
            raise HTTPException(400, str(exc)) from exc
    if not settings_tsv or not questions_tsv:
        raise HTTPException(
            400,
            "Cần settingsTsv + questionsTsv, hoặc combinedTsv có marker "
            "### quiz_settings.tsv / ### quiz_questions.tsv",
        )

    try:
        package = publish_lesson_package(
            payload.lessonCode,
            settings_tsv,
            questions_tsv,
            overwrite=payload.overwrite,
            seed_media_from_template=payload.seedMediaFromTemplate,
        )
    except TsvPublishError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Không thể tạo gói bài học: {exc}") from exc

    excel_path = Path(package["excelPath"])
    lesson_dir = Path(package["lessonDir"])
    response: dict[str, Any] = {
        "ok": True,
        "package": package,
        "message": (
            f"Đã tạo ImportTemplate/{package['lessonCode']}/"
            f"{package['lessonCode']}.xlsx và media/"
        ),
    }

    if not payload.openInEditor:
        return response

    try:
        view = _create_quiz_from_excel(
            excel_path,
            excel_dir=lesson_dir,
            quiz_title=payload.quizTitle,
            group_title=payload.groupTitle or "Imported Questions",
            lesson_code=package["lessonCode"],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            400,
            f"Đã tạo Excel/media nhưng import Editor thất bại: {exc}. "
            f"Gói nằm tại {package.get('relativeExcel')}",
        ) from exc

    view["tsvPublish"] = package
    view["importSummary"] = {
        **(view.get("importSummary") or {}),
        "lessonCode": package["lessonCode"],
        "lessonDir": package["lessonDir"],
        "excelPath": package["excelPath"],
        "mediaDir": package["mediaDir"],
        "tsvQuestionCount": package.get("questionCount"),
        "tsvWarnings": package.get("warnings") or [],
    }
    return view


@app.post("/api/import/tsv-zip-to-lesson")
def import_tsv_zip_to_lesson(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    lessonCode: str = Form(...),
    overwrite: bool = Form(False),
    seedMediaFromTemplate: bool = Form(False),
    openInEditor: bool = Form(True),
    quizTitle: str | None = Form(None),
    groupTitle: str = Form("Imported Questions"),
):
    import zipfile
    import tempfile
    import os

    background_tasks.add_task(cleanup_old_sessions)

    fd, temp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        with zipfile.ZipFile(temp_path) as zf:
            settings_tsv = ""
            questions_tsv = ""
            
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename.lower()
                if name.endswith("quiz_settings.tsv"):
                    settings_tsv = zf.read(info.filename).decode("utf-8")
                elif name.endswith("quiz_questions.tsv"):
                    questions_tsv = zf.read(info.filename).decode("utf-8")
                    
            if not settings_tsv or not questions_tsv:
                raise HTTPException(400, "File ZIP phải chứa quiz_settings.tsv và quiz_questions.tsv")
                
            payload = TsvLessonPublishPayload(
                lessonCode=lessonCode,
                settingsTsv=settings_tsv,
                questionsTsv=questions_tsv,
                overwrite=overwrite,
                seedMediaFromTemplate=seedMediaFromTemplate,
                openInEditor=openInEditor,
                quizTitle=quizTitle,
                groupTitle=groupTitle,
            )
            return import_tsv_to_lesson(payload)
    except zipfile.BadZipFile:
        raise HTTPException(400, "File không phải là định dạng ZIP hợp lệ")
    except UnicodeDecodeError:
        raise HTTPException(400, "File TSV phải được mã hóa bằng UTF-8")
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)

@app.post("/api/import/excel")
def import_excel(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    quiz_title: str | None = Form(None),
    group_title: str = Form("Imported Questions"),
):
    if not file.filename:
        raise HTTPException(400, "Thiếu tên file")

    name = file.filename.lower()
    background_tasks.add_task(cleanup_old_sessions)
    temp_root = SESSIONS_ROOT / f"excel_upload_{file.filename}"
    temp_root.mkdir(parents=True, exist_ok=True)
    temp_file = temp_root / Path(file.filename).name

    with temp_file.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    if temp_file.stat().st_size == 0:
        raise HTTPException(400, "File rỗng")

    try:
        if name.endswith(".zip"):
            extract_dir = temp_root / "extracted"
            extract_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(temp_file, "r") as zf:
                zf.extractall(extract_dir)
            excel_path = _find_excel_file(extract_dir)
            if not excel_path:
                raise HTTPException(400, "Zip không chứa file .xls hoặc .xlsx")
            excel_dir = excel_path.parent
        elif any(name.endswith(ext) for ext in EXCEL_SUFFIXES):
            excel_path = temp_file
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


@app.post("/api/import/excel/fib-wb-sample")
def import_excel_fib_wb_sample(
    quiz_title: str | None = None,
    group_title: str = "FIB / WB / Numeric",
):
    """Import mẫu Fill-in-the-Blank, Word Bank và Numeric."""
    if not EXCEL_FIB_WB_SAMPLE.exists():
        raise HTTPException(404, f"File mẫu không tồn tại: {EXCEL_FIB_WB_SAMPLE}")
    try:
        return _create_quiz_from_excel(
            EXCEL_FIB_WB_SAMPLE,
            excel_dir=IMPORT_TEMPLATE_DIR,
            quiz_title=quiz_title or "Mẫu FIB / WB / Numeric",
            group_title=group_title,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Không thể import mẫu FIB/WB: {exc}") from exc


@app.post("/api/import/excel/media-sample")
def import_excel_media_sample(
    quiz_title: str | None = None,
    group_title: str = "Media Test (Mầm non)",
):
    """Import mẫu audio + video cho nội dung mầm non (voice, video bài học)."""
    if not EXCEL_MEDIA_SAMPLE.exists():
        raise HTTPException(404, f"File mẫu media không tồn tại: {EXCEL_MEDIA_SAMPLE}")
    try:
        return _create_quiz_from_excel(
            EXCEL_MEDIA_SAMPLE,
            excel_dir=IMPORT_TEMPLATE_DIR,
            quiz_title=quiz_title or "Mẫu Audio Video (Mầm non)",
            group_title=group_title,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Không thể import mẫu media Excel: {exc}") from exc


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
        session = get_session(session_id)
        path = session.asset_path(filename)
        return FileResponse(path)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/session/{session_id}/asset/{filename}")
async def upload_asset(session_id: str, filename: str, s3: bool = False, file: UploadFile = File(...)):
    try:
        session = get_session(session_id)
        content = await file.read()
        saved = session.replace_image(filename, content)
        session.persist()

        s3_warning = None
        if s3:
            try:
                from .s3_service import upload_file_to_s3

                local_path = session.asset_path(saved)
                if local_path:
                    s3_url = upload_file_to_s3(str(local_path))
                    if s3_url:
                        return {
                            "filename": s3_url,
                            "url": s3_url,
                            "storage": "s3",
                        }
                    s3_warning = "Không upload được FPT S3; đang dùng bản local."
            except Exception as exc:
                # The editor must keep the uploaded file even when optional S3
                # dependencies or credentials are not available in this runtime.
                s3_warning = f"FPT S3 chưa sẵn sàng ({exc}); đang dùng bản local."

        result = {
            "filename": saved,
            "url": f"/api/session/{session_id}/asset/{saved}",
            "storage": "local",
        }
        if s3_warning:
            result["warning"] = s3_warning
        return result
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/session/{session_id}/export")
def export_session(session_id: str, payload: ExportPayload | None = None):
    try:
        session = get_session(session_id)
        title = payload.title if payload else None
        temp_zip_path = session.export_zip(title)
        safe_name = (title or session.quiz_json.get("d", {}).get("T", "scorm-export")).strip()
        safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_name)[:80]
        return FileResponse(
            path=temp_zip_path,
            filename=f"{safe_name}.zip",
            media_type="application/zip",
            background=BackgroundTask(temp_zip_path.unlink, missing_ok=True)
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export: {exc}") from exc


def _generate_cms_json(session_id: str, request: Request):
    """
    Export all questions from SCORM quiz as Teky-school JSON (same schema as scorm-cvt)
    and save directly to JSON-EXPORT/ beside ImportTemplate/ in the project.
    Output is wrapped in an array: [quiz] — matching scorm-cvt file format.
    """
    import json as _json
    from pathlib import Path

    try:
        session = get_session(session_id)
        base = str(request.base_url).rstrip("/")
        quiz_view = quiz_to_view(session.quiz_json)

        from .s3_service import upload_file_to_s3
        upload_cache: dict[str, str | None] = {}

        def _local_asset_candidates(filename: str) -> list[Path]:
            """Resolve filename to local package files (images folder + basename)."""
            raw = (filename or "").strip().replace("\\", "/")
            name = Path(raw).name
            found: list[Path] = []
            tried: set[str] = set()
            for cand in (raw, name, raw.split("/")[-1]):
                if not cand or cand in tried:
                    continue
                tried.add(cand)
                try:
                    p = session.asset_path(cand)
                    if p and Path(p).exists():
                        found.append(Path(p))
                except FileNotFoundError:
                    pass
            for folder in ("res/data/images", "data/images", "images"):
                p = session.package_root / folder / name
                if p.is_file():
                    found.append(p)
            # de-dupe
            uniq: list[Path] = []
            seen: set[str] = set()
            for p in found:
                key = str(p.resolve())
                if key not in seen:
                    seen.add(key)
                    uniq.append(p)
            return uniq

        def handle_s3_upload(filename: str) -> str | None:
            if filename in upload_cache:
                return upload_cache[filename]
            for local_path in _local_asset_candidates(filename):
                s3_url = upload_file_to_s3(str(local_path))
                if s3_url:
                    upload_cache[filename] = s3_url
                    return s3_url
            upload_cache[filename] = None
            return None

        # Recover cover if cleared at import (media was missing) but file now in package
        teky = quiz_view.setdefault("tekyQuiz", {}) or {}
        if not (teky.get("coverImage") or "").strip():
            for folder in ("res/data/images", "data/images", "images"):
                d = session.package_root / folder
                if not d.is_dir():
                    continue
                for pattern in ("*quiz_cover*", "*cover*"):
                    hits = sorted(d.glob(pattern))
                    if hits:
                        teky["coverImage"] = hits[0].name
                        quiz_view["tekyQuiz"] = teky
                        break
                if (teky.get("coverImage") or "").strip():
                    break

        quiz_obj = quiz_to_cms_json(quiz_view, session_id, base_url=base, s3_uploader=handle_s3_upload)

        import copy
        stateless_json = copy.deepcopy(session.quiz_json)

        # Upload ALL images referenced in stateless_json that aren't in upload_cache yet
        import re as _re
        _raw = json.dumps(stateless_json, ensure_ascii=False)
        for _m in _re.finditer(r'storage://images/([^"\'\\>\s]+)', _raw):
            _fname = _m.group(1)
            # Strip iSpring JSON metadata suffix e.g. "file.png{...}"
            _clean = _fname.split("{")[0] if "{" in _fname else _fname
            if _clean not in upload_cache:
                try:
                    handle_s3_upload(_clean)
                except Exception:
                    pass
        for _m in _re.finditer(r'storage://sounds/([^"\'\\>\s]+)', _raw):
            _fname = _m.group(1).split("{")[0]
            if _fname not in upload_cache:
                try:
                    handle_s3_upload(_fname)
                except Exception:
                    pass
        for _m in _re.finditer(r'storage://videos/([^"\'\\>\s]+)', _raw):
            _fname = _m.group(1).split("{")[0]
            if _fname not in upload_cache:
                try:
                    handle_s3_upload(_fname)
                except Exception:
                    pass

        def _replace_s3_urls(obj):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if isinstance(v, str):
                        new_v = v
                        for filename, s3_url in upload_cache.items():
                            if s3_url and filename in new_v:
                                new_v = new_v.replace(f"storage://images/{filename}", s3_url)
                                new_v = new_v.replace(f"storage://sounds/{filename}", s3_url)
                                new_v = new_v.replace(f"storage://videos/{filename}", s3_url)
                                new_v = new_v.replace(filename, s3_url)
                        obj[k] = new_v
                    else:
                        _replace_s3_urls(v)
            elif isinstance(obj, list):
                for i in range(len(obj)):
                    v = obj[i]
                    if isinstance(v, str):
                        new_v = v
                        for filename, s3_url in upload_cache.items():
                            if s3_url and filename in new_v:
                                new_v = new_v.replace(f"storage://images/{filename}", s3_url)
                                new_v = new_v.replace(f"storage://sounds/{filename}", s3_url)
                                new_v = new_v.replace(f"storage://videos/{filename}", s3_url)
                                new_v = new_v.replace(filename, s3_url)
                        obj[i] = new_v
                    else:
                        _replace_s3_urls(v)
        
        _replace_s3_urls(stateless_json)
        quiz_obj["_scormEditorState"] = stateless_json

        cover_url = quiz_obj.get("coverImageUrl") or ""
        export_warnings: list[str] = []
        if not cover_url:
            export_warnings.append(
                "Thiếu coverImageUrl — kiểm tra coverImage (media/quiz_cover.jpg) "
                "và file trong media/ khi import; Save rồi export lại."
            )
        elif not str(cover_url).startswith("http"):
            export_warnings.append(
                f"coverImageUrl đang là path tương đối ({cover_url}) — CMS LMS "
                "cần URL HTTPS (S3). Kiểm tra cấu hình S3 và upload khi export."
            )

        # Wrap in array — same format as scorm-cvt saves to output/
        cms_content = _json.dumps([quiz_obj], ensure_ascii=False, indent=2)

        # Filename: [Tên Bài học] Tên bài học (Target Lesson).json
        # e.g. [SNLT-HP01-B04] Ôn tập 1.json
        teky_meta = quiz_view.get("tekyQuiz") or {}
        lesson_code = (
            teky_meta.get("lessonCode")
            or (quiz_obj.get("lessonCode") if isinstance(quiz_obj, dict) else None)
            or ""
        )
        target_lesson = (
            teky_meta.get("targetLesson")
            or quiz_obj.get("targetLesson")
            or ""
        )
        filename = build_cms_export_filename(
            lesson_code,
            target_lesson,
            quiz_view.get("title") or quiz_obj.get("title"),
        )
        
        return cms_content, filename, quiz_obj, quiz_view, cover_url, export_warnings, lesson_code, target_lesson
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export Teky JSON: {exc}") from exc

@app.post("/api/session/{session_id}/export-cms-json-local")
def export_cms_json_local(session_id: str, request: Request):
    """
    Export all questions from SCORM quiz as Teky-school JSON (same schema as scorm-cvt)
    and save directly to JSON-EXPORT/ beside ImportTemplate/ in the project.
    """
    from pathlib import Path
    
    try:
        cms_content, filename, quiz_obj, quiz_view, cover_url, export_warnings, lesson_code, target_lesson = _generate_cms_json(session_id, request)

        target_dir = JSON_EXPORT_DIR
        target_dir.mkdir(parents=True, exist_ok=True)

        target_file = target_dir / filename
        target_file.write_text(cms_content, encoding="utf-8")

        q_count = len(quiz_obj.get("questions", []))
        return {
            "success": True,
            "path": str(target_file),
            "filename": filename,
            "questionCount": q_count,
            "title": quiz_view.get("title", ""),
            "lessonCode": lesson_code or None,
            "targetLesson": target_lesson or None,
            "coverImageUrl": cover_url or None,
            "warnings": export_warnings,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export Teky JSON: {exc}") from exc

@app.post("/api/session/{session_id}/export-project")
def export_session_project(session_id: str):
    """
    Export the current session as a complete Project ZIP (Excel + Media).
    This reverse-parses the current SCORM session JSON and builds a standard Teky LMS Excel file,
    along with a media folder containing all referenced assets.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session không tồn tại")
    
    from .excel_exporter import export_session_to_excel_zip
    try:
        temp_zip_path, safe_title = export_session_to_excel_zip(session)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Lỗi tạo Excel Project: {str(e)}")

    return FileResponse(
        path=temp_zip_path,
        filename=f"{safe_title}_Project.zip",
        media_type="application/zip",
        background=BackgroundTask(temp_zip_path.unlink, missing_ok=True)
    )

@app.post("/api/session/{session_id}/export-cms-json")
def export_cms_json(session_id: str, request: Request):
    """
    Export all questions from SCORM quiz as Teky-school JSON and download it.
    """
    try:
        cms_content, filename, quiz_obj, quiz_view, cover_url, export_warnings, lesson_code, target_lesson = _generate_cms_json(session_id, request)
        
        from urllib.parse import quote
        safe_filename = quote(filename.encode("utf-8"))
        
        return Response(
            content=cms_content.encode("utf-8"),
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
                "X-Export-Filename": safe_filename,
                "Access-Control-Expose-Headers": "X-Export-Filename"
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export Teky JSON: {exc}") from exc




@app.post("/api/session/{session_id}/export-media")
def export_session_media(session_id: str):
    try:
        session = get_session(session_id)
        temp_zip_path = session.export_media_zip()
        safe_name = (session.quiz_json.get("d", {}).get("T", "media-export")).strip()
        safe_name = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_name)[:80]
        return FileResponse(
            path=temp_zip_path,
            filename=f"{safe_name}_media.zip",
            media_type="application/zip",
            background=BackgroundTask(temp_zip_path.unlink, missing_ok=True)
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export media: {exc}") from exc


@app.post("/api/session/{session_id}/export-media-local")
def export_session_media_local(session_id: str):
    try:
        session = get_session(session_id)
        path = session.export_media_local()
        return {"success": True, "path": path}
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export media local: {exc}") from exc


class SingleMediaExportPayload(BaseModel):
    filename: str
    target_name: str

@app.post("/api/session/{session_id}/export-single-media-local")
def export_single_media_local(session_id: str, payload: SingleMediaExportPayload):
    import shutil
    from pathlib import Path
    try:
        session = get_session(session_id)
        view = session.get_view()
        safe_title = (view.get("title") or "Quiz").strip()
        safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_title)

        target_dir = Path.home() / "Downloads" / "SNLT-CHECKQUIZ" / safe_title
        target_dir.mkdir(parents=True, exist_ok=True)

        clean_filename = payload.filename
        if "{" in clean_filename:
            clean_filename = clean_filename.split("{")[0]

        source_path = session.asset_path(clean_filename)
        if not source_path.is_file():
            raise HTTPException(404, "Không tìm thấy file nguồn")

        ext = source_path.suffix.lower()
        final_name = f"{payload.target_name}{ext}"
        target_file = target_dir / final_name

        shutil.copy2(source_path, target_file)
        return {"success": True, "path": str(target_file)}
    except FileNotFoundError as exc:
        raise HTTPException(404, f"Không tìm thấy ảnh/file này trong gói SCORM gốc ({exc}). Có thể iSpring đã tối ưu hóa hoặc loại bỏ file này.") from exc
    except Exception as exc:
        raise HTTPException(400, f"Lỗi export single media local: {exc}") from exc


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
