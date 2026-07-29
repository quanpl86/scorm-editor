import json

path = "backend/data/sessions/f1893855-999b-4f50-a93f-a23d88bfbe17/package/quiz_data.json"
with open(path) as f:
    data = json.load(f)

for k, v in data.items():
    if isinstance(v, dict):
        for k2 in v:
            if "fa7aee" in k2:
                print(f"Found in key: {k}")
                break
