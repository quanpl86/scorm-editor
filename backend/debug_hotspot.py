import json, re
from pathlib import Path
session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
print(f"Checking session: {session_dir}")
quiz_data = session_dir / "package" / "quiz_data.json"
if quiz_data.exists():
    data = json.loads(quiz_data.read_text())
    for group in data.get("d", {}).get("sl", {}).get("g", []):
        for slide in group.get("S", []):
            if slide.get("tp") == "Hotspot":
                print(f"HOTSPOT SLIDE:")
                for obj in slide.get("a", {}).get("o", []):
                    print("OBJECT:", json.dumps(obj, indent=2))
