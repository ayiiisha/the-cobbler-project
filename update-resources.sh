#!/bin/bash
# Makes the copy of the default resources that pages opened by double-clicking
# (file://) read, from default-resources-cobbler-project.csv at the top of the app.
# Only needed for opening pages that way: a web server or GitHub Pages reads the CSV itself.
cd "$(dirname "$0")" || exit 1
python3 - <<'PY'
import json
text = open("default-resources-cobbler-project.csv", encoding="utf-8-sig").read()
with open("resources/data/default-resources-cobbler-project.js", "w", encoding="utf-8") as out:
    out.write("// Made by update-resources.sh from default-resources-cobbler-project.csv. Don't edit: change the CSV.\n")
    out.write("window.DEFAULT_RESOURCES_CSV = " + json.dumps(text, ensure_ascii=False) + ";\n")
PY
echo "Updated resources/data/default-resources-cobbler-project.js"
