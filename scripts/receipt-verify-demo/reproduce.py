"""Re-prove every capture through the installed `receipt` console script.

capture.py captures in-process (so an argparse SystemExit is catchable). The demo
prints the command as `receipt verify ...`, which is only honest if the console
script in a real subprocess writes the same bytes. This runs every captured
invocation that way and diffs stdout, stderr and the exit code.

The pull request's argument for the demo rests on the mismatch count this
prints, so a run that checked nothing must not be mistakable for a run that
checked everything: it refuses unless it re-ran exactly EXPECTED captures.
"""

from __future__ import annotations

import os
import pathlib
import shlex
import subprocess
import sys

CAPTURES = pathlib.Path(sys.argv[1]).resolve()
RECEIPT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/receipt060/bin/receipt")
# capture.py writes one file per run: 01-21, six scenarios plus the per-scenario
# `--base-ref` refusals. Raise this alongside any scenario added there.
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
        [str(RECEIPT), *argv[3:]], capture_output=True, text=True, env=environment
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
