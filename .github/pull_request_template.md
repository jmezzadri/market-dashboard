## What this changes (plain English)

<!-- One or two sentences a non-coder could follow. -->

## Council sign-offs
<!-- Name the leading specialist and any consulted. Required per project rules. -->
- Lead Developer:
- (UX Designer — required if this touches any page/component/style)
- (Senior Quant — required if this touches any calculation, indicator, or score)
- (Data Steward — required if this touches any feed, schedule, manifest, or freshness)

## Deletion checklist (required if this PR deletes any file)
- [ ] Greped the whole repo for the basename WITH and WITHOUT extension, plus module-style references
- [ ] Confirmed nothing live (entry points, scheduled jobs, other scripts) references it
- [ ] Pasted the grep evidence below

## Data blast-radius (required if this PR touches any data element)
- [ ] Source-to-target map for every element touched
- [ ] Producers, consumers, surfaces, docs walked (not from memory)
- [ ] Admin·Data, All Indicators, Methodology updated to match
- [ ] Checked `killed_elements.json` — this change does NOT revive a retired concept

## Verification (how I confirmed it works)
<!-- Loaded the live page? Ran the job? Read the result? Say what you observed. -->
