import json
from typing import Any
import re

def image_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    match = re.search(r"storage://images/(.+)", storage_uri)
    return match.group(1) if match else None

def extract_object_image(obj: dict[str, Any], slide: dict[str, Any]) -> str | None:
    if slide.get("tp") == "Hotspot" and obj.get("I") == "content":
        path = image_path_from_storage(slide.get("C", {}).get("i", ""))
        if path:
            return path

    if obj.get("tp") == "image" and obj.get("i"):
        path = image_path_from_storage(obj["i"])
        if path:
            return path

    if obj.get("tp") == "slidePicture":
        return None

    fill = obj.get("S", {}).get("b", {})
    if fill.get("f") == "pictureFill":
        pic = fill.get("p", {})
        path = image_path_from_storage(pic.get("i"))
        if path:
            return path
    return None

slide = json.loads(open("hotspot.json").read())
content = next((o for o in slide["a"]["o"] if o["I"] == "content"), None)
print("Hotspot image for content:", extract_object_image(content, slide))
