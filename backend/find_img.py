import json

path = "backend/data/sessions/a9f3fb98-3aed-4cfc-bee3-c3ab39cb391a/package/quiz_data.json"
with open(path) as f:
    data = json.load(f)

for g in data.get("d", {}).get("sl", {}).get("g", []):
    for s in g.get("S", []):
        if "fa7aee80e54cc8d161416ea0f7ffc0b544da5977" in json.dumps(s):
            print(json.dumps(s.get("at", {}), indent=2))
            print(json.dumps(s.get("C", {}), indent=2))
            break
