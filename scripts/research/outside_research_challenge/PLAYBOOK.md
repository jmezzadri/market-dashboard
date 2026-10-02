# Outside research watch — scheduled-session playbook

**Who runs this:** the "Macro Ops research watch" scheduled task, weekday
mornings at 5:23 AM ET.

**What it is for (Joe, 2026-10-02):** *"I don't want to publish this as
COMPETING RESEARCH. I want it to improve our research and trade ideas. I want
you to challenge yourself with their analysis. Not simply look at their calls
vs ours and run a comparison."* And the day before: one article he shares is an
example of the intelligence he wants watched, not a request to build a feature
from it.

**The stored task prompt predates that correction.** It asks for a digest of
their views, an attributed line in the brief, a governed feed and a
call-by-call comparison. Those parts are superseded by this file: nothing is
published, nothing is attributed on the site, and a comparison is not the
output. Do not re-flag the mismatch to Joe.

## Hard limits

- Public pages only: `https://macro-ops.com/research/` and the posts it links.
  Never a member login, a paywalled section, or a mirrored copy.
- Our words only. Never their sentences, charts or in-house gauge readings.
- **Nothing here reaches the site, the brief or a note under their name.** The
  brief contract refuses it. What we learn shows up as a better-tested claim in
  our own voice, from our own numbers.
- Their conviction is not evidence (LESSONS 6.19).

## Each run

1. **Read the index.** Compare with `processed_posts.json`. Nothing new:
   update `last_checked` only if a commit is being made anyway; otherwise stop
   and send nothing.
2. **Read each new post for METHOD, not for calls.** What are they measuring
   that we are not? What do they do at entry, at exit, in sizing? What evidence
   do they treat as decisive that we ignore — and the reverse?
3. **Turn it into a question about our own work.** Start with the open calls
   and the playbook's list of tested edges: where would their analysis say we
   are wrong, lazy or lucky? A view that agrees with us is the least useful
   thing in the post.
4. **Test it on our data, in this directory.** A script, committed, with an
   unconditional baseline, expanding-window percentiles, independent episodes
   and the sample stated. "Too thin to say" is a result; write it down so the
   next run does not repeat it. Check `CHALLENGE_LOG.md` "Not yet tested" first.
5. **Change something, or say why nothing changes.** A corrected row in the
   Trade Idea playbook, a new contract rule, a candidate handed to the Trade
   Idea session with its backtest, a claim for the weekly thesis review to
   re-measure, a brief habit to drop. Candidates still need 20% over the
   horizon, twice the loss at the stop, under 0.60 correlation with a live
   call, and Joe's restricted-ticker list checked.
6. **Write the entry** at the top of `CHALLENGE_LOG.md` in the five-part form,
   add the posts to `processed_posts.json`, ship through `ops-code-commit`.
7. **Tell Joe only what changed in our work** — three sentences, plain
   English. Not what they said.
