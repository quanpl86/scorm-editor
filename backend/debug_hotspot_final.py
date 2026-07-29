import json
from pathlib import Path
from app.layout import extract_layout
from app.scorm_parser import slide_to_view

slide = json.loads(open("hotspot2.json").read())
view = slide_to_view(slide, 0, 0, "Group")

content = next((o for o in view["layout"]["objects"] if o["role"] == "content"), None)
print("Hotspot image in view['layout']['objects']:", content.get("image") if content else "NO CONTENT BLOCK")
