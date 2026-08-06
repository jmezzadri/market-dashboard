"""Tests for .github/scripts/classify_run_failure.py

Fixtures are REAL /actions/runs/{id}/jobs payloads captured from
jmezzadri/market-dashboard on 2026-08-06, the day a GitHub Actions runner
capacity event produced three false "Workflow FAILED" emails.

Run: python3 -m pytest tests/test_classify_run_failure.py -q
"""
import json
import pathlib
import subprocess
import sys

SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / ".github"
    / "scripts"
    / "classify_run_failure.py"
)


def classify(payload):
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout.strip().splitlines()[0]


# --- Real captured payloads -------------------------------------------------

# Run 31116873789 — PAPER-PORTFOLIO-EOD-DAILY, 2026-08-06T15:39:51Z.
# A runner WAS assigned; "Set up job" hung for 5m15s and GitHub failed it.
# Our code never ran (no checkout). This emailed Joe. It must not.
RUNNER_SETUP_FAILURE = {
    "total_count": 1,
    "jobs": [
        {
            "id": 92668592993,
            "name": "eod",
            "status": "completed",
            "conclusion": "failure",
            "started_at": "2026-08-06T15:40:24Z",
            "completed_at": "2026-08-06T15:45:51Z",
            "steps": [
                {
                    "name": "Set up job",
                    "status": "completed",
                    "conclusion": "failure",
                    "number": 1,
                }
            ],
        }
    ],
}

# Run 31114532783 — same workflow, same shape, 29 minutes earlier.
RUNNER_SETUP_FAILURE_2 = {
    "total_count": 1,
    "jobs": [
        {
            "name": "eod",
            "conclusion": "failure",
            "steps": [{"name": "Set up job", "conclusion": "failure", "number": 1}],
        }
    ],
}

# Run 31126987714 — SCAN_330PM_WEEKDAYS. Never got a runner at all.
# Already suppressed by the 2026-05-06 rule; must stay suppressed.
ALL_CANCELLED = {
    "total_count": 1,
    "jobs": [{"name": "scan", "conclusion": "cancelled", "steps": []}],
}

# Shape of a genuine failure: setup succeeded, an author-written step blew up.
REAL_FAILURE = {
    "total_count": 1,
    "jobs": [
        {
            "name": "eod",
            "conclusion": "failure",
            "steps": [
                {"name": "Set up job", "conclusion": "success", "number": 1},
                {"name": "Check out market-dashboard", "conclusion": "success", "number": 2},
                {"name": "Set up Python", "conclusion": "success", "number": 3},
                {"name": "Install dependencies", "conclusion": "success", "number": 4},
                {
                    "name": "Run EOD phase (translator + freshness gate + submitter)",
                    "conclusion": "failure",
                    "number": 5,
                },
                {"name": "Complete job", "conclusion": "success", "number": 6},
            ],
        }
    ],
}

# One job dies on infra, a sibling job genuinely fails. Must alert.
MIXED_REAL_AND_INFRA = {
    "total_count": 2,
    "jobs": [
        {
            "name": "setup-only",
            "conclusion": "failure",
            "steps": [{"name": "Set up job", "conclusion": "failure", "number": 1}],
        },
        {
            "name": "real",
            "conclusion": "failure",
            "steps": [
                {"name": "Set up job", "conclusion": "success", "number": 1},
                {"name": "Run producer", "conclusion": "failure", "number": 2},
            ],
        },
    ],
}

# Neither failed nor all-cancelled (skipped + timed_out). Err toward alerting.
AMBIGUOUS = {
    "total_count": 2,
    "jobs": [
        {"name": "a", "conclusion": "skipped", "steps": []},
        {"name": "b", "conclusion": "timed_out", "steps": []},
    ],
}

EMPTY = {"total_count": 0, "jobs": []}


# --- Tests ------------------------------------------------------------------


def test_runner_setup_failure_is_suppressed():
    """The 2026-08-06 false alarm. This is the regression this fix exists for."""
    assert classify(RUNNER_SETUP_FAILURE) == "infra_setup"
    assert classify(RUNNER_SETUP_FAILURE_2) == "infra_setup"


def test_all_cancelled_still_suppressed():
    """The 2026-05-06 rule must not regress."""
    assert classify(ALL_CANCELLED) == "infra_cancelled"


def test_real_failure_still_alerts():
    """A step the workflow author wrote failed — Joe must hear about it."""
    assert classify(REAL_FAILURE) == "real"


def test_mixed_alerts():
    """One genuine failed job is enough, even alongside infra noise."""
    assert classify(MIXED_REAL_AND_INFRA) == "real"


def test_ambiguous_errs_toward_visibility():
    assert classify(AMBIGUOUS) == "ambiguous"
    assert classify(EMPTY) == "ambiguous"


def test_scaffold_matching_is_case_and_space_insensitive():
    payload = {
        "jobs": [
            {
                "name": "x",
                "conclusion": "failure",
                "steps": [{"name": "  SET UP JOB ", "conclusion": "failure"}],
            }
        ]
    }
    assert classify(payload) == "infra_setup"


def test_step_named_like_ours_is_not_scaffold():
    """Guard against over-suppression: only GitHub's own step names count."""
    payload = {
        "jobs": [
            {
                "name": "x",
                "conclusion": "failure",
                "steps": [
                    {"name": "Set up job", "conclusion": "success"},
                    {"name": "Set up Python", "conclusion": "failure"},
                ],
            }
        ]
    }
    assert classify(payload) == "real"


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print("PASS", fn.__name__)
        except Exception:
            failed += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print("\n%d/%d passed" % (len(fns) - failed, len(fns)))
    sys.exit(1 if failed else 0)
