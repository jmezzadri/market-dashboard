"""Where every MacroTilt SMTP sender gets the Gmail app password.

2026-11-11 (bug #1280): Google revoked the app password and the only copy lived
in a GitHub Actions secret, which Joe does not use and the agents cannot write.
The password now lives in Supabase `ops_secrets` (name `smtp_app_password`),
which the agents can update with one SQL statement. The GitHub secret
SMTP_PASSWORD is only a fallback when the row is missing or unreadable.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

ROW = "smtp_app_password"


def smtp_password() -> str:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if url and key:
        try:
            q = urllib.parse.urlencode({"select": "value", "name": f"eq.{ROW}"})
            req = urllib.request.Request(f"{url}/rest/v1/ops_secrets?{q}",
                                         headers={"apikey": key, "Authorization": f"Bearer {key}"})
            with urllib.request.urlopen(req, timeout=20) as r:
                rows = json.loads(r.read().decode())
            if rows and (rows[0].get("value") or "").strip():
                return rows[0]["value"].replace(" ", "").strip()
        except Exception as e:  # never block a send on the lookup itself
            print(f"WARN: could not read {ROW} from ops_secrets ({type(e).__name__}); "
                  f"using SMTP_PASSWORD", file=sys.stderr)
    return os.environ.get("SMTP_PASSWORD", "")
