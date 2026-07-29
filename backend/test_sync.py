import json
from app.scorm_parser import apply_question_edit, extract_slide_images, quiz_to_view
from app.quiz_builder import load_slide_templates

templates = load_slide_templates()
slide = templates["MultipleChoice"]

edit = {
    "slideImages": ["https://s3-sgn10.fptcloud.com/teky-prod/teky-school/sticker1_1785213645820_69x563.png"]
}

apply_question_edit(slide, edit)

print("Slide Images from extraction:", extract_slide_images(slide))
print("Slide Attachment Image:", slide.get("at", {}).get("i", {}).get("i"))
print("Metadata slideImages:", slide.get("_metadata", {}).get("slideImages"))
