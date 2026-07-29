import json
from pathlib import Path
session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
print(f"Checking session: {session_dir}")
quiz_json = session_dir / "quiz.json"
if quiz_json.exists():
    data = json.loads(quiz_json.read_text())
    for q in data:
        if q.get("type") == "Hotspot":
            print(f"HOTSPOT QUIZ {q.get('id')}:")
            for obj in q.get("layout", {}).get("objects", []):
                print(f"  ROLE: {obj.get('role')} | IMAGE: {obj.get('image')}")
