import json
from app.quiz_builder import load_slide_templates
t = load_slide_templates()
slide = t.get("MultipleChoice")
raw = json.dumps(slide, ensure_ascii=False)
import re
print("Found matches:")
for match in re.finditer(r"storage://images/[^\"]+", raw):
    print(match.group())

# Let's find WHERE it is in the dict
def find_keys(d, target, path=""):
    if isinstance(d, dict):
        for k, v in d.items():
            find_keys(v, target, path + f"[{repr(k)}]")
    elif isinstance(d, list):
        for i, v in enumerate(d):
            find_keys(v, target, path + f"[{i}]")
    elif isinstance(d, str) and target in d:
        print(f"Found at: {path} = {d}")

find_keys(slide, "img-7148")
