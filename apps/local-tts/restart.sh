#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
exec "$project_dir/.local-tts/venv/bin/python" "$project_dir/apps/local-tts/service.py" restart "$@"
