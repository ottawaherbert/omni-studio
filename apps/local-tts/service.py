"""Manage only this workspace's MLX server; never kill an unknown port owner."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".local-tts"
PID_FILE = STATE / "server-process.json"
SERVER = STATE / "venv/bin/mlx_audio.server"
PYTHON = STATE / "venv/bin/python"
URL = "http://127.0.0.1:8033"


def process_info(pid):
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=,command="], capture_output=True, text=True)
    if result.returncode and result.stderr:
        raise RuntimeError(f"Cannot verify process ownership: {result.stderr.strip()}")
    return result.stdout.strip()


def listeners():
    result = subprocess.run(["lsof", "-nP", "-t", "-iTCP:8033", "-sTCP:LISTEN"], capture_output=True, text=True)
    return set(result.stdout.split())


def read_managed():
    if not PID_FILE.exists():
        return None
    data = json.loads(PID_FILE.read_text())
    current = process_info(data["pid"])
    if current and current != data["identity"]:
        raise RuntimeError("Stored PID belongs to a different process; refusing to signal it.")
    return data if current else None


def healthy():
    try:
        with urlopen(URL + "/openapi.json", timeout=2) as response:
            schema = json.load(response)
        return "/v1/audio/speech" in schema.get("paths", {})
    except Exception:
        return False


def status():
    data = read_managed()
    ports = listeners()
    if data and str(data["pid"]) in ports:
        ready = healthy()
        print(json.dumps({"status": "ready" if ready else "starting", "pid": data["pid"], "url": URL, "log": str(STATE / "server.log")}, ensure_ascii=False))
        return 0 if ready else 1
    if ports:
        print(json.dumps({"status": "unmanaged", "pids": sorted(ports), "url": URL}))
        return 2
    print(json.dumps({"status": "starting" if data else "stopped", "pid": data["pid"] if data else None}))
    return 1


def start():
    data = read_managed()
    if data:
        return status()
    if listeners():
        raise RuntimeError("Port 8033 is occupied by an unmanaged process; inspect it before using service.py adopt PID.")
    if not (STATE / "installed-model.json").exists():
        raise RuntimeError("Run sh apps/local-tts/install.sh before starting the offline server.")
    env = dict(os.environ, HF_HOME=str(STATE / "cache"), HF_HUB_OFFLINE="1", TOKENIZERS_PARALLELISM="false")
    with (STATE / "server.log").open("ab") as log:
        child = subprocess.Popen([str(PYTHON), str(SERVER), "--host", "127.0.0.1", "--port", "8033", "--tts-max-batch-size", "1"], cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    # Capture the real post-spawn command and start time to detect PID reuse.
    identity = process_info(child.pid)
    PID_FILE.write_text(json.dumps({"pid": child.pid, "identity": identity}, indent=2) + "\n")
    for _ in range(60):
        if child.poll() is not None:
            raise RuntimeError(f"Server exited ({child.returncode}); inspect {STATE / 'server.log'}")
        if str(child.pid) in listeners() and healthy():
            return status()
        time.sleep(0.5)
    raise RuntimeError(f"Server has not become ready in 30 seconds; inspect {STATE / 'server.log'}")


def stop():
    data = read_managed()
    if not data:
        if listeners():
            raise RuntimeError("Port 8033 has an unmanaged process; refusing to stop it.")
        print("Local speech server is already stopped.")
        return 0
    os.kill(data["pid"], signal.SIGTERM)
    for _ in range(60):
        if not process_info(data["pid"]):
            PID_FILE.unlink(missing_ok=True)
            print("Local speech server stopped.")
            return 0
        time.sleep(0.5)
    raise RuntimeError("Server is still shutting down after 30 seconds; no force-kill was sent. Retry status after active synthesis finishes.")


def adopt(pid):
    identity = process_info(pid)
    cwd = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"], capture_output=True, text=True).stdout
    # Explicit migration for the previous foreground launcher only.
    valid_command = str(PYTHON) in identity and (str(SERVER) in identity or " .local-tts/venv/bin/mlx_audio.server " in identity)
    if not valid_command or f"n{ROOT}\n" not in cwd or str(pid) not in listeners():
        raise RuntimeError("PID is not this workspace's listening MLX speech server; refusing adoption.")
    if read_managed():
        raise RuntimeError("A managed server is already recorded.")
    PID_FILE.write_text(json.dumps({"pid": pid, "identity": identity}, indent=2) + "\n")
    return status()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "restart", "status", "adopt"])
    parser.add_argument("pid", nargs="?", type=int)
    args = parser.parse_args()
    STATE.mkdir(exist_ok=True)
    with (STATE / "service.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == "adopt":
            if not args.pid:
                parser.error("adopt requires a verified PID")
            return adopt(args.pid)
        if args.action == "restart":
            stop()
            return start()
        return {"start": start, "stop": stop, "status": status}[args.action]()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
