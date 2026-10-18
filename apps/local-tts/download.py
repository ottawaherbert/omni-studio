"""Install a reproducible model snapshot without removing existing caches."""
import argparse
import json
import os
import re
from pathlib import Path

from huggingface_hub import snapshot_download

DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"
DEFAULT_REVISION = "41d3337e8b7f2843a75841595fc14e4b9a7a4b96"
parser = argparse.ArgumentParser()
parser.add_argument("--model", default=DEFAULT_MODEL)
parser.add_argument("--revision")
args = parser.parse_args()
revision = args.revision or (DEFAULT_REVISION if args.model == DEFAULT_MODEL else None)
if not revision or not re.fullmatch(r"[a-fA-F0-9]{40}", revision):
    parser.error("--revision must be a full immutable 40-character commit SHA for custom models")
revision = revision.lower()
snapshot = Path(snapshot_download(args.model, revision=revision))
# The offline server receives a repository ID from the app. Pin its default cache
# reference to this exact installed snapshot, so an upstream main update cannot
# silently change inference weights. Other snapshots remain untouched.
refs = snapshot.parent.parent / "refs"
refs.mkdir(exist_ok=True)


def write_atomic(path, content):
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(content)
    temporary.replace(path)


write_atomic(refs / "main", revision)
manifest = {"model": args.model, "revision": revision, "snapshot": str(snapshot)}
root = Path(__file__).resolve().parents[2]
write_atomic(root / ".local-tts" / "installed-model.json", json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
