import json

path = "backend/data/sessions/f1893855-999b-4f50-a93f-a23d88bfbe17/package/quiz_data.json"
with open(path) as f:
    data = json.load(f)

def search(d, path):
    if isinstance(d, dict):
        for k, v in d.items():
            if "fa7aee" in k:
                print("Found at path:", path + "." + k)
            search(v, path + "." + k)
    elif isinstance(d, list):
        for i, v in enumerate(d):
            search(v, path + f"[{i}]")

search(data, "root")
