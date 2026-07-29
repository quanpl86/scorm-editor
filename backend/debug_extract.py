import json
from pathlib import Path
import re
from typing import Any

def image_path_from_storage(storage_uri: str) -> str | None:
    if not storage_uri:
        return None
    match = re.search(r"storage://images/(.+)", storage_uri)
    return match.group(1) if match else None

def extract_object_image(obj: dict[str, Any], slide: dict[str, Any]) -> str | None:
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

obj = {
  "tp": "image",
  "I": "Picture 1",
  "k": True,
  "i": "storage://images/img-62e5a8b950b8a46b994eb455874e5d3f80feb1c9.png",
}

print("Result:", extract_object_image(obj, {}))
