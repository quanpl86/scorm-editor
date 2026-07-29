import json
from pathlib import Path
from app.scorm_parser import slide_to_view

session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
quiz_data = session_dir / "package" / "quiz_data.json"
data = json.loads(quiz_data.read_text())

group = data["d"]["sl"]["g"][0]
slide = group["S"][6] # index 6 is Cau 7
view = slide_to_view(slide, 0, 0, "Group")

content = next((o for o in view["layout"]["objects"] if o["role"] == "content"), None)
print("Content image:", content.get("image") if content else None)
