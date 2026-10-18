#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project_dir"
export UV_CACHE_DIR="$project_dir/.local-tts/uv-cache"
export HF_HOME="$project_dir/.local-tts/cache"
# HTTP downloads are resumable and avoid excessive Xet connections through a
# local proxy. Override with HF_HUB_DISABLE_XET=0 if Xet works well on your network.
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
if [ -x .local-tts/venv/bin/python ]; then
  .local-tts/venv/bin/python -c 'import sys; assert sys.version_info[:2] == (3, 12), "Existing TTS environment must use Python 3.12"'
elif [ -e .local-tts/venv ]; then
  echo 'Existing .local-tts/venv is incomplete; preserve it and repair or move it before installing.' >&2
  exit 1
else
  uv venv --python 3.12 .local-tts/venv
fi
uv pip install --python .local-tts/venv/bin/python -r apps/local-tts/requirements.lock.txt
exec .local-tts/venv/bin/python apps/local-tts/download.py "$@"
