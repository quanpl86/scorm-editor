import io
import zipfile
from pathlib import Path
from typing import Any
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

from .scorm_parser import ScormSession

def clean_filename(path: str) -> str:
    if not path:
        return ""
    return Path(path).name.split("?")[0].split("#")[0]

def _media_kind_for_ext(ext: str) -> str:
    key = ext.lower().lstrip(".")
    if key in {"jpg", "jpeg", "png", "gif", "bmp", "webp"}:
        return "image"
    if key in {"mp3", "wav", "m4a", "ogg"}:
        return "audio"
    if key in {"mp4", "webm", "mov"}:
        return "video"
    return "unknown"

def export_session_to_excel_zip(session: ScormSession) -> bytes:
    view = session.get_view()
    safe_title = (view.get("title") or "Quiz").strip()
    safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in safe_title)

    buffer = io.BytesIO()
    wb = openpyxl.Workbook()
    
    # 1. Settings Sheet
    ws_settings = wb.active
    ws_settings.title = "Quiz Settings"
    ws_settings.append(["Field", "Value", "Description"])
    
    settings_data = [
        ("Quiz Title", view.get("title") or "", "Tên bài kiểm tra"),
        ("Lesson Code", view.get("lessonCode") or "", "Mã bài học"),
        ("Subject", view.get("subject") or "", "Môn học"),
        ("Difficulty Level", view.get("difficultyLevel") or "", "Độ khó"),
    ]
    for row in settings_data:
        ws_settings.append(row)
        
    # 2. Questions Sheet
    ws_questions = wb.create_sheet("Questions")
    
    headers = [
        "STT", "Question Type", "Question Text", "Image", "Video", "Audio",
        "Difficulty", "Topic", "Explanation", "Points"
    ]
    for i in range(1, 7):
        headers.extend([f"Answer {i}", f"Answer {i} Image", f"Answer {i} Left Image", f"Answer {i} Right Image"])
        
    ws_questions.append(headers)
    
    # Set header styles
    for col in range(1, len(headers) + 1):
        cell = ws_questions.cell(row=1, column=col)
        cell.font = Font(bold=True)
        cell.fill = PatternFill(start_color="DDDDDD", end_color="DDDDDD", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        
    # Prepare ZIP and Media tracking
    zf = zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED)
    
    added_names = set()
    
    def process_media(original_path: str, proposed_name: str) -> str:
        if not original_path:
            return ""
        if original_path.startswith("http://") or original_path.startswith("https://"):
            return original_path
            
        try:
            full_path = session.resolve_asset_path(original_path)
            ext = full_path.suffix
            final_name = f"{proposed_name}{ext}"
            
            # Avoid duplicate writes
            if final_name not in added_names:
                zf.write(full_path, f"media/{final_name}")
                added_names.add(final_name)
            
            return final_name
        except FileNotFoundError:
            return ""

    # Map SCORM types to Excel types
    TYPE_MAP = {
        "MultipleChoice": "MC",
        "MultipleResponse": "MR",
        "TrueFalse": "TF",
        "TypeIn": "SA",
        "Sequence": "SEQ",
        "Matching": "MG",
        "FillInTheBlank": "FIB",
        "WordBank": "WB",
        "InfoSlide": "IS",
        "Numeric": "NUM",
        "MultipleNumeric": "MNUM"
    }

    questions = view.get("questions", [])
    for q_idx, q in enumerate(questions):
        stt = q_idx + 1
        prefix = f"{safe_title}_{stt}"
        
        q_type = TYPE_MAP.get(q.get("type"), q.get("type"))
        q_text = q.get("text", "")
        
        q_image = ""
        q_video = ""
        q_audio = ""
        
        nd_img_idx = 1
        nd_vid_idx = 1
        nd_aud_idx = 1
        
        for obj in q.get("layout", {}).get("objects", []):
            img = obj.get("image")
            if img:
                pos = "ND" if nd_img_idx == 1 else f"ND{nd_img_idx}"
                q_image = process_media(img, f"{prefix}_IMG-{pos}")
                nd_img_idx += 1
            vid = obj.get("video")
            if vid:
                pos = "ND" if nd_vid_idx == 1 else f"ND{nd_vid_idx}"
                q_video = process_media(vid, f"{prefix}_VID-{pos}")
                nd_vid_idx += 1
            aud = obj.get("audio")
            if aud:
                pos = "ND" if nd_aud_idx == 1 else f"ND{nd_aud_idx}"
                q_audio = process_media(aud, f"{prefix}_AUD-{pos}")
                nd_aud_idx += 1
                
        for img in q.get("slideImages", []):
            if not q_image:
                pos = "ND" if nd_img_idx == 1 else f"ND{nd_img_idx}"
                q_image = process_media(img, f"{prefix}_IMG-{pos}")
                nd_img_idx += 1
                
        fb_correct_img = q.get("feedback", {}).get("correctImage")
        explanation = q.get("feedback", {}).get("correct", "")
        if fb_correct_img:
            fb_img_name = process_media(fb_correct_img, f"{prefix}_IMG-GT")
            explanation += f" [image={fb_img_name}]"
            
        row_data = [
            stt,
            q_type,
            q_text,
            q_image,
            q_video,
            q_audio,
            q.get("difficultyLevel", "medium"),
            q.get("topic", ""),
            explanation,
            q.get("points", 1.0)
        ]
        
        choices = q.get("choices", [])
        matching_pairs = q.get("matchingPairs", [])
        
        if q_type == "MG":
            for idx, pair in enumerate(matching_pairs):
                if idx >= 6: break
                premise = pair.get("premise", "")
                response = pair.get("response", "")
                ans_text = f"{premise} | {response}"
                
                left_img = process_media(pair.get("leftImage"), f"{prefix}_IMG-DA-Left{idx+1}")
                right_img = process_media(pair.get("rightImage"), f"{prefix}_IMG-DA-Right{idx+1}")
                
                row_data.extend([ans_text, "", left_img, right_img])
        else:
            for idx, choice in enumerate(choices):
                if idx >= 6: break
                text = choice.get("text", "")
                if choice.get("isCorrect") and q_type in ("MC", "MR", "WB", "TF"):
                    text = f"*{text}"
                
                ans_img = process_media(choice.get("image"), f"{prefix}_IMG-DA{idx+1}")
                row_data.extend([text, ans_img, "", ""])
                
        ws_questions.append(row_data)

    # Save workbook to memory and add to zip
    excel_buffer = io.BytesIO()
    wb.save(excel_buffer)
    excel_buffer.seek(0)
    
    zf.writestr(f"{safe_title}.xlsx", excel_buffer.read())
    zf.close()
    
    return buffer.getvalue(), safe_title
