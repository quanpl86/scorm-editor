import json
from pathlib import Path
session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
quiz_data = session_dir / "package" / "quiz_data.json"
if quiz_data.exists():
    data = json.loads(quiz_data.read_text())
    for group in data.get("d", {}).get("sl", {}).get("g", []):
        for slide in group.get("S", []):
            if slide.get("tp") == "Hotspot":
                print(f"HOTSPOT SLIDE {slide.get('I')}:")
                print(json.dumps(slide, indent=2))
                break
