"""Load ~/.config/market-dashboard.env into os.environ (dotenv-style, bash-safe)."""
from __future__ import annotations

import os


def _resolve_home() -> str:
    home = (os.environ.get("HOME") or "").strip()
    if home and os.path.isdir(home):
        return home
    try:
        import pwd

        return pwd.getpwuid(os.getuid()).pw_dir
    except Exception:
        return os.path.expanduser("~")


def load_market_dashboard_env() -> None:
    """Merge keys from ~/.config/market-dashboard.env if missing or empty in the environment."""
    path = os.path.join(_resolve_home(), ".config", "market-dashboard.env")
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8-sig") as f:
            lines = f.readlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if not key:
            continue
        if (os.environ.get(key) or "").strip():
            continue
        os.environ[key] = val
