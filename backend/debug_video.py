import json, glob
from pathlib import Path

# find the latest session dir
session_dir = sorted(Path("data/sessions").glob("*"), key=lambda p: p.stat().st_mtime)[-1]
quiz_data = session_dir / "package" / "quiz_data.json"
if not quiz_data.exists():
    # check index.html
    html_file = session_dir / "package" / "index.html"
    if html_file.exists():
        import re
        content = html_file.read_text()
        m = re.search(r'window\.quizData\s*=\s*"(.*?)";', content)
        if m:
            import base64
            from urllib.parse import unquote
            data = json.loads(unquote(base64.b64decode(m.group(1)).decode('utf-8')))
            for slide in data.get("d", {}).get("sl", {}).get("g", [])[0].get("S", []):
                for obj in slide.get("a", {}).get("o", []):
                    name = obj.get("I", "")
                    if "Video" in name or "video" in name:
                        print("FOUND VIDEO OBJ:", json.dumps(obj, indent=2))
