# LESSONS.md — MacroTilt

Binding behavioral rules for the agent council (UX Designer · Senior Quant ·
Lead Developer · Data Steward) working on MacroTilt. Read at the start of
every task per the Pre-Flight Checklist in project instructions.

## Format

Each rule is dated and structured:

```
## YYYY-MM-DD — short title

**What happened:** one sentence describing the failure mode.

**What you should do instead:** one sentence, specific and testable.
```

Older rules also live in agent auto-memory. The auto-memory and this file
serve the same purpose; this file is the one Joe controls and version-controls.
When Joe corrects a mistake, propose a new entry here before closing the task.

---

## 2026-04-30 — Self-monitor context window; offer a handoff before bogging down

**What happened:** Long multi-turn sessions accumulate context, which
slows responses and degrades quality (re-reading files, repeating proposed
fixes, longer / more diagnostic / less-actionable replies). The agent did
not proactively surface a handoff suggestion; Joe noticed the slowdown
himself and asked for one. The "should we hand off?" decision should not
require Joe to notice — it's the agent's job to monitor and offer.

**What you should do instead:** At the **start** of constructing each
response, check for these six bog signals:

1. Thrashing on the same problem for 4+ tool calls (stuck loop).
2. Responses getting longer / more diagnostic / less actionable (context heavy).
3. Re-reading files already read this session (working memory failing).
4. Proposing fixes already proposed and rejected (context truncating).
5. A turn takes >2 minutes when earlier turns were fast (response slowdown).
6. UAT-by-claim diverges from UAT-by-look — claiming code works, then
   actually loading the result and finding it doesn't (context-stale assumptions).

**Triggers:** if 2+ signals fire, OR signal #5 alone, the agent must offer
a handoff. Offer it **inline** in the response, not as a meta-comment —
produce a self-contained markdown block, copy-pastable, containing:

  - (a) What we were just trying to do
  - (b) Current branch + last 5 commits on main
  - (c) What's working / what's broken
  - (d) The immediate next action for the new session
  - (e) Any decisions made this session not yet in LESSONS.md
  - (f) Any pending merges (PRs awaiting Joe's approval)
  - (g) Any uncommitted state in `/tmp` worktrees (branch + what's pending)

**Frequency cap:** if Joe declined a handoff offer last turn, do not offer
again next turn unless a NEW signal fires.

**When NOT to offer:** mid-irreversible-action — workflow dispatched and
polling for completion, production deploy in flight, migration applying.
Finish the action first. A fresh session cannot pick up cleanly mid-action.

---
