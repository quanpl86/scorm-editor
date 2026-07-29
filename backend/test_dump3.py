import json
from app.quiz_builder import load_slide_templates
t = load_slide_templates()
slide = t.get("MultipleChoice")
feedback = slide.get("s", {}).get("F", {})
print(json.dumps(feedback, indent=2))
