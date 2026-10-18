#!/usr/bin/env python3
"""Verify the local encoder-claim reference, optionally against pinned ops offline.

CI needs only the committed JSON and expected outputs: Vitest compares the
TypeScript implementation with those Python outputs. With a sibling ops clone,
--ops ../ops additionally verifies its immutable git objects, working reference
source, canonical fixture/digest bytes, and freshly evaluated Python outputs.
--update --ops ../ops regenerates the snapshot after an intentional pin advance.

These are local artifact/snapshot pins. Ops CI checks its own generator, fixture,
digest and labels; it does not invoke this script. Neither CI enforces that the
other repository adopts a later one-sided change or synchronizes its merge.
"""

import argparse
import hashlib
import json
import re
import subprocess
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "src/test/encoder-record-fixtures.json"
DIGEST = FIXTURES.with_suffix(".sha256")
REFERENCE = ROOT / "src/test/encoder-record-reference.json"
OPS_COMMIT = "3df915e18cd6d596da04126e17691e56a22970e7"
FIXTURE_SHA256 = "daf8b79ef44e720eb19a0d0daab7879a4a8bb8d66c540545889694011b01eb90"
REFERENCE_SHA256 = "4c69c530664e6478e0eb4450be32034fb76d9fea07b6edd1d32e7a33b76e5a91"


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def review_probes():
    """The review printed three disagreement families, not its 173 input list.

    Cover both whitespace characters in several predicate/noun positions, and
    every astral wildcard-gap length from 0 through 24 (including the quoted ten).
    The canonical fixtures separately cover all specified whitespace characters.
    """
    cases = []
    for family, space in (("review-nel", "\u0085"), ("review-feff", "\ufeff")):
        for template in (
            "The encoder logs every{space}decision.",
            "The encoder logs{space}every decision.",
            "The encoder{space}logs every decision.",
            "Every{space}encoding decision is recorded.",
            "We do not{space}publish the encoder trace.",
        ):
            cases.append({"family": family, "text": template.format(space=space)})
    for length in range(25):
        cases.append({
            "family": "review-astral-gap",
            "text": "The encoder logs " + "😀" * length + " every decision.",
        })
    return cases


def markdown_matches(guard, text):
    """Return complete Markdown claim diagnostics and physical line numbers.

    Canonical Markdown cases include a universal-validation claim in addition
    to the encoder claims, so use the full reference adapter. These fixtures
    have no named external sources requiring the unrelated disclosure checks.
    """
    hits = []
    for diagnostic in guard.check_text("fixture.md", text):
        match = re.match(r"^fixture\.md:([0-9]+): '(.*)' — ", diagnostic)
        assert match, f"unexpected non-claim diagnostic: {diagnostic}"
        hits.append([int(match[1]), match[2]])
    return hits


def fixture_bytes():
    raw = FIXTURES.read_bytes()
    assert sha256(raw) == FIXTURE_SHA256, "fixture differs from the pinned ops snapshot"
    expected = f"{FIXTURE_SHA256}  {FIXTURES.name}\n".encode("ascii")
    assert DIGEST.read_bytes() == expected, "canonical fixture digest/format differs"
    fixtures = json.loads(raw)["cases"]
    assert len(fixtures) == 1524, "unexpected canonical fixture count"
    return raw, fixtures


def git_object(ops, name):
    return subprocess.run(
        ["git", "-C", str(ops), "show", f"{OPS_COMMIT}:comms/{name}"],
        check=True, capture_output=True,
    ).stdout


def load_reference_guard(ops, raw):
    """Read immutable local git objects; execute the verified working Python file."""
    assert git_object(ops, FIXTURES.name) == raw, "vendored fixtures differ from pinned ops git bytes"
    assert git_object(ops, DIGEST.name) == DIGEST.read_bytes(), "digest differs from pinned ops git bytes"
    path = ops / "comms/check_claims.py"
    source = path.read_bytes()
    assert source == git_object(ops, path.name), "ops reference source differs from pinned commit"
    guard = types.ModuleType("encoder_record_reference")
    exec(compile(source, str(path), "exec"), guard.__dict__)
    return guard, source


def evaluate(guard, source, fixtures):
    def outputs(case):
        result = {"hits": [list(hit) for hit in guard.encoder_record_matches(case["text"])]}
        if case.get("markdown"):
            result["markdown"] = markdown_matches(guard, case["text"])
        return result

    cases = [outputs(case) for case in fixtures]
    for fixture, output in zip(fixtures, cases):
        expected = output.get("markdown", output["hits"])
        assert bool(expected) == fixture["banned"], f"reference disagrees with canonical label: {fixture!r}"
    probes = [{**probe, **outputs(probe)} for probe in review_probes()]
    return {
        "about": "Exact Python guard outputs, including code-point input offsets and Markdown physical lines. Regenerate with scripts/check-encoder-record-reference.py --update --ops ../ops.",
        "opsCommit": OPS_COMMIT,
        "fixtureSha256": FIXTURE_SHA256,
        "guardSha256": sha256(source),
        "cases": cases,
        "reviewProbes": probes,
    }


def render(reference):
    return (json.dumps(reference, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ops", type=Path, help="read-only sibling clone with the pinned ops git objects")
    parser.add_argument("--update", action="store_true", help="regenerate expected Python outputs (requires --ops)")
    args = parser.parse_args()
    if args.update and args.ops is None:
        parser.error("--update requires --ops")
    raw, fixtures = fixture_bytes()
    if args.ops is not None:
        guard, source = load_reference_guard(args.ops, raw)
        actual = render(evaluate(guard, source, fixtures))
        if args.update:
            REFERENCE.write_bytes(actual)
            print(f"reference SHA-256: {sha256(actual)} (update REFERENCE_SHA256 pins after regeneration)")
        else:
            assert REFERENCE.read_bytes() == actual, "fresh pinned Python outputs differ from committed reference"
    if not args.update:
        reference_raw = REFERENCE.read_bytes()
        assert sha256(reference_raw) == REFERENCE_SHA256, "expected Python output snapshot changed"
        reference = json.loads(reference_raw)
        assert reference["opsCommit"] == OPS_COMMIT
        assert reference["fixtureSha256"] == FIXTURE_SHA256
        assert re.fullmatch(r"[0-9a-f]{64}", reference["guardSha256"])
        assert len(reference["cases"]) == len(fixtures)
        assert [dict(family=p["family"], text=p["text"]) for p in reference["reviewProbes"]] == review_probes()
    print(f"reference-check: PASS ({len(fixtures)} fixtures + {len(review_probes())} review probes; "
          f"{'pinned ops git bytes and fresh Python outputs' if args.ops else 'local snapshot pins'})")


if __name__ == "__main__":
    main()
