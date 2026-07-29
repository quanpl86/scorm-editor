import json

path = "backend/data/sessions/f1893855-999b-4f50-a93f-a23d88bfbe17/package/quiz_data.json"
with open(path) as f:
    quiz_json = json.load(f)

filename = "img-fa7aee80e54cc8d161416ea0f7ffc0b544da5977.png"

mapped = quiz_json.get("rs", {}).get("i", {}).get(f"storage://images/{filename}")
if not mapped and "{" in filename:
    clean_rel = filename.split("{")[0]
    mapped = quiz_json.get("rs", {}).get("i", {}).get(f"storage://images/{clean_rel}")
    
# Wait! In the frontend, the filename doesn't have '{' anymore, because I stripped it in layout.py? NO I didn't strip it in layout.py, I just stripped it in resolve_asset_path. 
# BUT wait! If I stripped it in resolve_asset_path, does `filename` still have `{`?
# In LayoutCanvas, the frontend received `obj.image` from layout.py. `layout.py` calls `image_path_from_storage`, which DOES strip it? No, wait, image_path_from_storage returns the FULL string!

if not mapped:
    # Try finding it where the KEY has `{` but our string doesn't
    for k, v in quiz_json.get("rs", {}).get("i", {}).items():
        if k.startswith(f"storage://images/{filename}"):
            mapped = v
            break

print("Mapped:", mapped)
if mapped and isinstance(mapped, dict) and mapped.get("s"):
    real_name = mapped["s"].replace("\\", "/").split("/")[-1]
    print("Real name:", real_name)
