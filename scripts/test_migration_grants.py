#!/usr/bin/env python3
"""Every migration that creates a table in public also grants on it.

Bug #1275 (2026-10-21): from 2026-10-30 Supabase no longer grants Data API
access to NEW public tables automatically. The live project carries an event
trigger (20261021_grant_new_public_relations.sql) as a safety net, but a
preview branch or a local `supabase db reset` replays the migrations from the
start, where that trigger does not exist yet — so the GRANT has to be in the
migration that creates the table, exactly as Supabase's notice says.

Scope: migrations dated on or after 2026-10-21 (the ones written after the
rule). Older files relied on the default privileges that still cover them.
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(os.path.dirname(HERE), "supabase", "migrations")
SINCE = "20261021"

CREATE = re.compile(r"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?", re.I)
GRANT = re.compile(r"grant\s+[a-z, ]+\s+on\s+(?:table\s+)?(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?", re.I)
GRANT_ALL_IN_SCHEMA = re.compile(r"grant\s+[a-z, ]+\s+on\s+all\s+tables\s+in\s+schema\s+public", re.I)


def strip_comments(sql):
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    # string literals too: 'CREATE TABLE AS' inside an event-trigger tag list
    # is not a table named "as"
    return re.sub(r"'(?:[^']|'')*'", "''", sql, flags=re.S)


def check(path):
    sql = strip_comments(open(path, encoding="utf-8").read())
    created = set(m.group(1).lower() for m in CREATE.finditer(sql))
    if not created:
        return []
    if GRANT_ALL_IN_SCHEMA.search(sql):
        return []
    granted = set(m.group(1).lower() for m in GRANT.finditer(sql))
    return sorted(created - granted)


def main():
    bad = []
    for p in sorted(glob.glob(os.path.join(MIG, "*.sql"))):
        stem = os.path.basename(p)[:8]
        if not stem.isdigit() or stem < SINCE:
            continue
        missing = check(p)
        if missing:
            bad.append((os.path.basename(p), missing))
    if bad:
        print("FAIL — migrations that create a public table without granting on it (bug #1275):")
        for f, tables in bad:
            print(f"  {f}: {', '.join(tables)}")
        print("Add to the same file: grant select on public.<t> to anon; "
              "grant select, insert, update, delete on public.<t> to authenticated, service_role;")
        return 1
    print(f"OK — every migration since {SINCE} that creates a public table grants on it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
