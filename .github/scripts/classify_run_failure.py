#!/usr/bin/env python3
"""Classify a failed GitHub Actions run as a REAL failure or infra noise.

Context (2026-08-06, bug: three false "PAPER-PORTFOLIO-EOD-DAILY FAILED"
emails in one morning). The 2026-05-06 suppression rule only caught the
ALL-CANCELLED shape of a runner shortage. GitHub has a second shape: the job
is assigned a runner, "Set up job" hangs waiting for the image, and after a
few minutes GitHub marks THAT STEP failed and ends the job with
conclusion=failure. Job-level conclusion is identical to a genuine code
failure, so `any(job.conclusion == 'failure')` alerted on pure infra noise.

Discriminator: which STEP failed. When a runner never provisions, the only
step present is the implicit setup/teardown scaffolding ("Set up job",
"Set up runner", "Complete job") — the workflow's own steps never appear,
because checkout never ran. A genuine failure always has at least one failed
step that the workflow author wrote.

Reads the /actions/runs/{id}/jobs payload on stdin.
Prints one of: real | infra_cancelled | infra_setup | ambiguous
"""
import json
import sys

# Steps GitHub injects itself. A failure confined to these means the runner
# never came up; it is not our code. Matched case-insensitively.
SCAFFOLD_STEPS = {
    "set up job",
    "set up runner",
    "complete job",
    "post job cleanup",
}


def failed_real_steps(job):
    """Failed steps that the workflow author actually wrote."""
    return [
        s.get("name", "")
        for s in (job.get("steps") or [])
        if s.get("conclusion") == "failure"
        and (s.get("name") or "").strip().lower() not in SCAFFOLD_STEPS
    ]


def main():
    data = json.load(sys.stdin)
    jobs = data.get("jobs") or []

    if not jobs:
        # No job records at all — cannot prove infra noise, err toward visibility.
        print("ambiguous", file=sys.stdout)
        return

    failed = [j for j in jobs if j.get("conclusion") == "failure"]

    if failed:
        real = []
        for j in failed:
            steps = failed_real_steps(j)
            if steps:
                real.append("%s -> %s" % (j.get("name"), ", ".join(steps)))
        if real:
            print("real")
            print("\n".join(real), file=sys.stderr)
            return
        # Every failed job failed only in GitHub's own scaffolding.
        print("infra_setup")
        print(
            "\n".join(
                "%s: no author-written step failed; steps=%s"
                % (
                    j.get("name"),
                    [
                        (s.get("name"), s.get("conclusion"))
                        for s in (j.get("steps") or [])
                    ],
                )
                for j in failed
            ),
            file=sys.stderr,
        )
        return

    if all(j.get("conclusion") == "cancelled" for j in jobs):
        print("infra_cancelled")
        return

    print("ambiguous")


if __name__ == "__main__":
    main()
