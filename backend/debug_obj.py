import json, re
from pathlib import Path
session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
print(f"Checking session: {session_dir}")
quiz_data = session_dir / "package" / "quiz_data.json"
if quiz_data.exists():
    data = json.loads(quiz_data.read_text())
    # loop all slides
    for group in data.get("d", {}).get("sl", {}).get("g", []):
        for slide in group.get("S", []):
            for obj in slide.get("a", {}).get("o", []):
                raw = json.dumps(obj)
                if "video" in raw.lower() or "video" in obj.get("I", "").lower() or "media" in raw.lower():
                    print(f"FOUND IN SLIDE {slide.get('I', 'tp: ' + slide.get('tp'))}:")
                    print(json.dumps(obj, indent=2))
