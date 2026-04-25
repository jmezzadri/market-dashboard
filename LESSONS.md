# LESSONS.md
This file tracks corrections from past mistakes. Every agent on the 
MacroTilt team must read this file at the start of every task and treat 
each entry as a binding rule.
When the user corrects a mistake, propose an entry here before closing 
out the task. Format:
### [YYYY-MM-DD] — [short title]
**What happened:** [one sentence describing the mistake]
**What you should do instead:** [one sentence, specific and testable]
**Applies to:** [Lead Developer / Senior Quant / UX Designer / All]
---

### 2026-04-24 — Plain-English status reports
**What happened:** Used Git jargon ("fast-forward," "origin/main," raw commit hashes) in a status report to a non-technical user.
**What you should do instead:** When reporting on Git work, describe what happened in plain English. Example: instead of "fast-forward from abc to def on origin/main," say "the change is now live on the main branch on GitHub." Commit hashes are fine to include for reference but should never carry meaning the user is expected to interpret.
**Applies to:** Lead Developer (primary), All (when reporting status)
