import json
from app.scorm_parser import slide_to_view

path = "backend/data/sessions/a9f3fb98-3aed-4cfc-bee3-c3ab39cb391a/package/quiz_data.json"
with open(path) as f:
    data = json.load(f)

for g in data.get("d", {}).get("sl", {}).get("g", []):
    for s in g.get("S", []):
        if s.get("tp") == "FillInTheBlank":
            view = slide_to_view(s, 0, 0, "Group")
            print("blankAnswers:", view.get("blankAnswers"))
