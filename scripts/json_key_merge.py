#!/usr/bin/env python3
"""Three-way, key-level merge of a shared JSON file (LESSONS 5.16 / 4.46).

public/indicator_history.json is ONE minified line written by several
producers (INDICATOR-REFRESH, MARKET-INDICATORS-EOD, BREADTH-DAILY, ...).
When two of them commit it inside the same few minutes, `git pull --rebase`
does not race -- it CONFLICTS, and the old `for _i in 1 2 3` retry loop then
exited 0 with the write lost (2026-11-05 22:19Z and 2026-11-06 01:12Z: the
settled DXY close for 11-05 was computed twice and never published).

Usage: json_key_merge.py BASE OURS TARGET
  BASE   the file as it was at our checkout (git show HEAD:<file>)
  OURS   the file our producer wrote
  TARGET the file as main holds it now (after `git reset --hard origin/main`);
         rewritten in place.

Rule: a top-level key our producer CHANGED (ours != base) is written onto
TARGET; every other key keeps main's value, so a series another producer
updated since our checkout is never reverted by our stale carried-forward
copy of it. A key we deleted is deleted. Prints what it applied.
"""
import json
import sys


def load(p):
    with open(p) as f:
        return json.load(f)


def main(argv):
    if len(argv) != 4:
        sys.exit("usage: json_key_merge.py BASE OURS TARGET")
    base, ours, target_path = load(argv[1]), load(argv[2]), argv[3]
    target = load(target_path)
    if not all(isinstance(x, dict) for x in (base, ours, target)):
        sys.exit("json_key_merge: all three files must be JSON objects")
    changed = [k for k in ours if base.get(k, None) != ours[k] or k not in base]
    deleted = [k for k in base if k not in ours]
    for k in changed:
        target[k] = ours[k]
    for k in deleted:
        target.pop(k, None)
    with open(target_path, "w") as f:
        json.dump(target, f, separators=(",", ":"))
    print(f"json_key_merge: applied {len(changed)} changed key(s)"
          + (f": {', '.join(sorted(changed)[:40])}" if changed else "")
          + (f"; removed {', '.join(deleted)}" if deleted else ""))


if __name__ == "__main__":
    main(sys.argv)
