#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"
exec "$project_dir/.local-tts/venv/bin/python" "$project_dir/apps/local-tts/service.py" start "$@"
