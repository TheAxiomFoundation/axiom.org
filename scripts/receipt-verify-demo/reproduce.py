"""Re-prove every capture through the installed `receipt` console script.

capture.py drives the CLI in process, where a refusal that exits rather than
returns is still caught and recorded. The demo prints the command as `receipt
verify ...`, which is only honest if the console script in a real subprocess
writes the same bytes. This runs every captured invocation that way and diffs
stdout, stderr and the exit code.

The pull request's argument for the demo rests on the mismatch count this
prints, so a run that checked nothing must not be mistakable for a run that
checked everything: it refuses unless it re-ran exactly EXPECTED captures.
"""

from __future__ import annotations

import os
import pathlib
import shlex
import shutil
import subprocess
import sys

if len(sys.argv) < 3:
    raise SystemExit(
        "usage: reproduce.py <captures-dir> <installed receipt console script>\n"
        "README.md's recipe builds one at /tmp/receipt-venv/bin/receipt."
    )

CAPTURES = pathlib.Path(sys.argv[1]).resolve()
# shutil.which, not a bare path check: it accepts the README's absolute path and
# a name on PATH alike, and it refuses a file that is not executable — which is
# the failure this guard exists to name rather than leave to subprocess.
RECEIPT = shutil.which(sys.argv[2])
if RECEIPT is None:
    raise SystemExit(f"no executable receipt console script at {sys.argv[2]}")

# capture.py writes one file per run, 01-21: the eighteen the demo shows — six
# scenarios at three levels of auditor pinning — plus three runs of the pristine
# clone it does not show, `04-pristine-spec-pinned`, `05-pristine-fully-pinned`
# and `06-pristine-json`. Raise this alongside any run added there.
EXPECTED = 21

failures = 0
checked = 0
for capture in sorted(CAPTURES.glob("*.txt")):
    text = capture.read_text(encoding="utf-8")
    head, _, rest = text.partition("\n--- exit: ")
    argv = shlex.split(head[len("$ ") :])
    assert argv[:4] == ["python", "-m", "receipt.cli", "verify"], argv[:4]
    code, _, streams = rest.partition("\n--- stdout ---\n")
    expected_out, _, expected_err = streams.partition("--- stderr ---\n")

    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    done = subprocess.run(
        [RECEIPT, *argv[3:]], capture_output=True, text=True, env=environment
    )
    problems = []
    if done.returncode != int(code):
        problems.append(f"exit {done.returncode} != {code}")
    if done.stdout != expected_out:
        problems.append("stdout differs")
    if done.stderr != expected_err:
        problems.append("stderr differs")
    checked += 1
    if problems:
        failures += 1
        print(f"MISMATCH {capture.stem}: {'; '.join(problems)}")

print(
    f"{checked} captures re-run through the console script; "
    f"{failures} mismatch(es)"
)
if checked != EXPECTED:
    print(f"expected {EXPECTED} captures in {CAPTURES}, re-ran {checked}")
raise SystemExit(1 if failures or checked != EXPECTED else 0)
