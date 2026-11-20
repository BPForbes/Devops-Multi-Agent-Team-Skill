#!/usr/bin/env bash
# A small Python project in a fresh git repository, committed and clean.
set -euo pipefail
printf 'def area(width, height):\n    return width * height\n' > app.py
printf 'node_modules/\n' > .gitignore
git init -q -b main
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -q -m init
