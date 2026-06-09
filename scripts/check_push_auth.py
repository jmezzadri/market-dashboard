#!/usr/bin/env python3
"""
check_push_auth.py — guardrail against the recurring "frozen data" bug.

Background
──────────
`main` is a protected branch. A workflow that commits data and pushes with the
default GITHUB_TOKEN is rejected (GH006) and its data silently freezes on the
site while the job still reports success. The fix is to check out + push with
the admin token (secrets.MACROTILT_BOT_PAT), which is exempt from the required
checks. This has bitten us repeatedly, one bot at a time.

This guard makes the rule enforceable: ANY workflow that runs `git push` MUST
reference MACROTILT_BOT_PAT. If a new (or edited) workflow forgets it, CI fails
here — before it can ship and freeze a feed weeks later.

Exit 0 = all good. Exit 1 = at least one offender (printed).
"""
import sys, pathlib, re

WF_DIR = pathlib.Path(".github/workflows")
offenders = []
for f in sorted(WF_DIR.glob("*.yml")) + sorted(WF_DIR.glob("*.yaml")):
    text = f.read_text()
    if re.search(r"\bgit\s+push\b", text) and "MACROTILT_BOT_PAT" not in text:
        offenders.append(f.name)

if offenders:
    print("PUSH-AUTH GUARD FAILED — these workflows run `git push` but do not use")
    print("the admin token (secrets.MACROTILT_BOT_PAT). They will be rejected by")
    print("branch protection (GH006) and silently freeze their data:\n")
    for o in offenders:
        print(f"  ✗ {o}")
    print("\nFix: add `token: ${{ secrets.MACROTILT_BOT_PAT }}` to the checkout step.")
    sys.exit(1)

print("push-auth guard: OK — every git-push workflow uses the admin token.")
sys.exit(0)
