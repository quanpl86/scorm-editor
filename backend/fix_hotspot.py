lines = open("hotspot.json").readlines()
open("hotspot2.json", "w").write("".join(lines[1:]))
