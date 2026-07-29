import json

path = "backend/data/sessions/f1893855-999b-4f50-a93f-a23d88bfbe17/package/quiz_data.json"
with open(path) as f:
    data = json.load(f)

for k, v in data.items():
    if isinstance(v, dict):
        for k2, v2 in v.items():
            if "fa7aee" in k2:
                print("Found in", k)
                print(json.dumps(v2, indent=2)[:500])

