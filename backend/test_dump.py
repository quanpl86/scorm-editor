import json
from app.quiz_builder import load_slide_templates
t = load_slide_templates()
slide = t.get("MultipleChoice")
if slide:
    if "a" in slide and "o" in slide["a"]:
        for o in slide["a"]["o"]:
            if o.get("tp") == "slidePicture":
                print(json.dumps(o, indent=2))
