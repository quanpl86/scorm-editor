import json
from pathlib import Path
from app.layout import extract_layout
from app.scorm_parser import slide_to_view

session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
quiz_data = session_dir / "package" / "quiz_data.json"
data = json.loads(quiz_data.read_text())

for group in data.get("d", {}).get("sl", {}).get("g", []):
    for slide in group.get("S", []):
        if slide.get("tp") == "Hotspot":
            view = slide_to_view(slide, 0, 0, "Group")
            content = next((o for o in view["layout"]["objects"] if o["role"] == "content"), None)
            print(f"HOTSPOT {slide.get('I')}:")
            print(f"  Content Image: {content.get('image') if content else 'NO CONTENT BLOCK'}")
            print(f"  Slide.C.i: {slide.get('C', {}).get('i')}")
