"""Drive `receipt verify` over every scenario the /receipt demo offers.

Builds the receipt package's own two-authority signed corpus fixture
(`tests/corpus_fixture.py` in the receipt repository at the tag under test).
Four scenarios mutate a private clone of it — a hand edit, a re-encode, a
substituted signing key, a wholesale regeneration; pristine is that clone left
alone; and the undeclared-gate corpus is not a clone at all but a second corpus
published from its own genesis under the same producer key and the same two
authorities. It captures stdout, stderr and the exit code of each `receipt
verify` run. Nothing the demo prints is written by hand; it all comes from here.

Two things a naive driver gets wrong, and this one does not:

  * The spec is the *auditor's* copy, held outside every tree under test, which
    is receipt's actual deployment story: trust anchors live in the consumer's
    committed code, so a producer who swaps the signing key cannot also move
    the pin that refuses it. The fixture emits the spec into the corpus for its
    own convenience; this moves it out before the first commit.
  * Every corpus variant reuses one producer keypair and one pair of timestamp
    authorities, so a single spec (one sha256) governs all six scenarios and
    the demo tells one corpus's story rather than six unrelated ones.

Usage:

    python capture.py <out-dir> <work-dir> [<receipt-src>/tests]

See README.md in this directory for the whole loop.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
from importlib.metadata import version

FIXTURE_TESTS = pathlib.Path(
    sys.argv[3] if len(sys.argv) > 3 else os.environ.get("RECEIPT_SRC", "/tmp/receipt-src") + "/tests"
).resolve()
sys.path.insert(0, str(FIXTURE_TESTS))

import corpus_fixture  # noqa: E402
from corpus_fixture import (  # noqa: E402
    _commit_fixture,
    ANCHOR_NAMES,
    ANCHOR_RELATIVE,
    JOURNAL_RELATIVE,
    MANIFEST_RELATIVE,
    PREFIX_RELATIVE,
    SCHEMA_VERSION,
    LocalTsa,
    append_release,
    build_corpus,
    created_at,
    sha256_bytes,
)
from receipt.canonical import canonical_bytes  # noqa: E402
from receipt.cli import main  # noqa: E402
from receipt.sign import generate_signing_keypair, sign_payload, spki_sha256  # noqa: E402

OUT = pathlib.Path(sys.argv[1]).resolve()
WORK = pathlib.Path(sys.argv[2]).resolve()
AUDITOR = WORK / "auditor"
SPEC = AUDITOR / "spec.py"
RATE = "rules/tax/rate.yaml"
PUBLISHED_RATE = "name: rate\nvalue: 0.15\n"
CORRECTED_RATE = "name: rate\nvalue: 0.17\n"
REVIEWED_TESTS = {"rules/tax/rate.test.yaml": "cases: []\n# reviewed\n"}


def git(repo: pathlib.Path, *args: str) -> str:
    environment = os.environ.copy()
    for name in tuple(environment):
        if name.startswith("GIT_"):
            environment.pop(name)
    environment.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_SYSTEM": os.devnull,
            "GIT_AUTHOR_NAME": "Receipt CLI Fixture",
            "GIT_AUTHOR_EMAIL": "receipt-cli@example.invalid",
            "GIT_COMMITTER_NAME": "Receipt CLI Fixture",
            "GIT_COMMITTER_EMAIL": "receipt-cli@example.invalid",
        }
    )
    done = subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True,
        env=environment,
    )
    return done.stdout.strip()


def commit(repo: pathlib.Path, message: str) -> str:
    git(repo, "add", "-A")
    git(repo, "commit", "--quiet", "-m", message)
    return git(repo, "rev-parse", "--verify", "HEAD")


def capture(name: str, repo: pathlib.Path, *extra: str) -> str:
    """Run one `receipt verify` invocation and write its whole console record."""

    argv = ["verify", "--spec", str(SPEC), "--root", str(repo), *extra]
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = main(argv)
        except SystemExit as refusal:  # a refusal that exits rather than returns
            code = refusal.code
    body = (
        # shlex.join, not ' '.join: reproduce.py reads this line back with
        # shlex.split, so a work directory whose path contains whitespace has to
        # round-trip to the same argv rather than splitting into more tokens.
        f"$ python -m receipt.cli {shlex.join(argv)}\n"
        f"--- exit: {code}\n"
        f"--- stdout ---\n{out.getvalue()}"
        f"--- stderr ---\n{err.getvalue()}"
    )
    (OUT / f"{name}.txt").write_text(body, encoding="utf-8")
    print(f"[{name}] exit={code} stdout={len(out.getvalue())}B stderr={len(err.getvalue())}B")
    return out.getvalue() + err.getvalue()


# --- one producer key and one pair of authorities for every variant ---------


def reuse_producer_key(origin_workspace: pathlib.Path, origin_repo: pathlib.Path):
    private_pem = (origin_workspace / "producer.key").read_bytes()
    public_pem = (origin_repo / ANCHOR_RELATIVE / "producer-ed25519.pub").read_bytes()

    def generate() -> tuple[bytes, bytes]:
        return private_pem, public_pem

    return generate


def reuse_authorities(origin_workspace: pathlib.Path):
    def build(directory: pathlib.Path, name: str, policy_oid: str) -> LocalTsa:
        shutil.copytree(origin_workspace / name, directory, dirs_exist_ok=True)
        certificate_sha256, spki_sha256 = corpus_fixture._signer_pins(directory)
        return LocalTsa(
            name=name,
            directory=directory,
            root_pem=directory / f"{name}-root.pem",
            policy_oid=policy_oid,
            signer_certificate_sha256=certificate_sha256,
            signer_spki_sha256=spki_sha256,
        )

    return build


def regenerate_chain(repo: pathlib.Path, workspace: pathlib.Path) -> None:
    """Rebuild the whole manifest chain over the same journal: same key, new tokens.

    This is the producer holding the signing key and re-witnessing its own
    history. Content and journal are untouched; every manifest is re-derived
    from them and re-stamped, so the chain a first-contact verifier meets is
    internally perfect and it has nothing earlier to compare it against.

    The split between the two releases is read back out of the sealed immutable
    prefix, so release 0 covers exactly the genesis rows and release 1 appends
    exactly the rest — the shape the chain verifier requires.
    """

    manifests = repo / MANIFEST_RELATIVE
    for stale in sorted(manifests.iterdir()):
        stale.unlink()

    journal_bytes = (repo / JOURNAL_RELATIVE).read_bytes()
    prefix_bytes = (repo / PREFIX_RELATIVE).read_bytes()
    prefix = json.loads(prefix_bytes.decode("utf-8"))
    genesis_line_count = prefix["prefixLineCount"]

    lines = journal_bytes.decode("utf-8").split("\n")[:-1]
    genesis_bytes = "".join(f"{line}\n" for line in lines[:genesis_line_count]).encode()
    appended_bytes = "".join(f"{line}\n" for line in lines[genesis_line_count:]).encode()
    private_pem = (workspace / "producer.key").read_bytes()

    states = [
        (genesis_bytes, genesis_line_count, None),
        (
            journal_bytes,
            len(lines),
            {
                "previousLineCount": genesis_line_count,
                "appendedRowCount": len(lines) - genesis_line_count,
                "appendedBytesSha256": sha256_bytes(appended_bytes),
            },
        ),
    ]

    previous_digest = None
    for index, (state_bytes, line_count, append) in enumerate(states):
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "releaseIndex": index,
            "previousManifestSha256": previous_digest,
            "state": {
                "path": JOURNAL_RELATIVE,
                "jsonlSha256": sha256_bytes(state_bytes),
                "lineCount": line_count,
                "immutablePrefixSha256": sha256_bytes(prefix_bytes),
            },
            "append": append,
            "createdAtUtc": created_at(90 - index * 30),
            "producer": {"repo": "TheAxiomFoundation/receipt", "branch": "test"},
        }
        manifest_bytes = canonical_bytes(manifest) + b"\n"
        digest = sha256_bytes(manifest_bytes)
        stem = f"{index:04d}-{digest[:16]}"
        (manifests / f"{stem}.json").write_bytes(manifest_bytes)
        (manifests / f"{stem}.producer.sig").write_bytes(
            sign_payload(private_pem, manifest_bytes, domain=b"")
        )
        for anchor in ANCHOR_NAMES:
            directory = workspace / anchor
            LocalTsa(
                name=anchor,
                directory=directory,
                root_pem=directory / f"{anchor}-root.pem",
                policy_oid="",
                signer_certificate_sha256="",
                signer_spki_sha256="",
            ).stamp(digest, manifests / f"{stem}.{anchor}.tsr")
        previous_digest = digest


def clone_facts(repo: pathlib.Path) -> dict[str, object]:
    """What the tree pane beside a transcript has to state truthfully."""

    return {
        "commit": git(repo, "rev-parse", "--verify", "HEAD"),
        "tree": git(repo, "rev-parse", "HEAD^{tree}"),
        "manifests": sorted(
            path.name for path in (repo / MANIFEST_RELATIVE).glob("*.json")
        ),
    }


def fresh(name: str) -> tuple[pathlib.Path, pathlib.Path]:
    """A private copy of the published corpus and of the producer's workspace.

    Every scenario's clone is named ``<scenario>/corpus`` so the ``root`` line
    receipt prints says which attack the transcript is of.
    """

    scenario = WORK / name
    if scenario.exists():
        shutil.rmtree(scenario)
    repo = scenario / "corpus"
    workspace = scenario / "producer-workspace"
    shutil.copytree(WORK / "published" / "corpus", repo, symlinks=True)
    shutil.copytree(WORK / "published" / "producer-workspace", workspace, symlinks=True)
    return repo, workspace


# --- the published corpus the demo's story is about -------------------------

def hand_the_spec_to_the_auditor(repo: pathlib.Path) -> None:
    """Move the emitted spec module out of the producer's tree entirely.

    The fixture writes the consumer-side spec into the corpus repository for
    its own convenience. Receipt's design principle is the opposite: the
    anchors live in the consumer's committed code, where a producer who swaps
    a signing key cannot also move the pin that refuses it. Relocating the
    module before the first commit makes every transcript below a run of that
    arrangement rather than of the fixture's shortcut.
    """

    AUDITOR.mkdir(parents=True, exist_ok=True)
    emitted = repo / "verification/spec.py"
    if SPEC.exists():
        # Every variant emits byte-identical anchors, so the auditor keeps one.
        assert emitted.read_bytes() == SPEC.read_bytes(), "spec drifted between variants"
    else:
        shutil.copy2(emitted, SPEC)
    shutil.rmtree(repo / "verification")


origin = WORK / "published"
origin_repo = origin / "corpus"
origin_repo.mkdir(parents=True)
origin_workspace = origin / "producer-workspace"
build_corpus(origin_repo, origin_workspace, commit=False)
hand_the_spec_to_the_auditor(origin_repo)
genesis = _commit_fixture(origin_repo, "publish corpus release 0000", initialize=True)
published = append_release(origin_repo, origin_workspace, content=REVIEWED_TESTS)
spec_sha256 = sha256_bytes(SPEC.read_bytes())

corpus_fixture.generate_signing_keypair = reuse_producer_key(origin_workspace, origin_repo)
corpus_fixture.build_local_tsa = reuse_authorities(origin_workspace)

clones: dict[str, object] = {}
facts: dict[str, object] = {
    "receipt": version("receipt"),
    # The installed distribution's version, which is the fixture's tag only
    # because the README's recipe pins both to $version: the fixture directory
    # itself is a free argument, and this does not go and check it. A literal
    # here would be worse — it would outlive the release it was written for.
    "fixture": f"TheAxiomFoundation/receipt @ v{version('receipt')} tests/corpus_fixture.py",
    "genesis_commit": genesis,
    "published_commit": published,
    "published_tree": git(origin_repo, "rev-parse", "HEAD^{tree}"),
    "spec_sha256": spec_sha256,
    "producer_spki": spki_sha256(
        (origin_repo / ANCHOR_RELATIVE / "producer-ed25519.pub").read_bytes()
    ),
    "clones": clones,
}

# --- 1. pristine clone ------------------------------------------------------

pristine, _ = fresh("pristine")
clones["pristine"] = clone_facts(pristine)
capture("01-pristine", pristine, "--commit", "HEAD")
capture("02-pristine-base-ref", pristine, "--commit", "HEAD",
        "--expect-commit", published, "--base-ref", genesis)
capture("03-base-ref-without-expect-commit", pristine, "--commit", "HEAD",
        "--base-ref", genesis)
capture("04-pristine-spec-pinned", pristine, "--commit", "HEAD",
        "--expect-spec-sha256", spec_sha256)
capture("05-pristine-fully-pinned", pristine, "--commit", "HEAD",
        "--expect-spec-sha256", spec_sha256,
        "--expect-commit", published,
        "--expect-tree", str(facts["published_tree"]),
        "--verify-objects")
capture("06-pristine-json", pristine, "--commit", "HEAD", "--json")

# --- 2. hand-edit the fix ---------------------------------------------------

rewrite, _ = fresh("hand-edit")
(rewrite / RATE).write_text(CORRECTED_RATE)
rewrite_head = commit(rewrite, "hand-edit the published rate")
clones["rewrite"] = clone_facts(rewrite)
capture("07-rewrite", rewrite, "--commit", "HEAD")
capture("08-rewrite-base-ref", rewrite, "--commit", "HEAD",
        "--expect-commit", rewrite_head, "--base-ref", genesis)

# --- 3. re-encode the fix (a third witnessed release) -----------------------

reencode, reencode_workspace = fresh("re-encode")
reencode_head = append_release(reencode, reencode_workspace, content={RATE: CORRECTED_RATE})
clones["reencode"] = clone_facts(reencode)
capture("09-reencode", reencode, "--commit", "HEAD")
capture("10-reencode-base-ref", reencode, "--commit", "HEAD",
        "--expect-commit", reencode_head, "--base-ref", genesis)

# --- 4. swap the signing key ------------------------------------------------

swapkey, _ = fresh("swapped-key")
_, substitute_public = generate_signing_keypair()
(swapkey / ANCHOR_RELATIVE / "producer-ed25519.pub").write_bytes(substitute_public)
swapkey_head = commit(swapkey, "substitute the producer key")
clones["swapkey"] = clone_facts(swapkey)
capture("11-swapkey", swapkey, "--commit", "HEAD")
capture("12-swapkey-base-ref", swapkey, "--commit", "HEAD",
        "--expect-commit", swapkey_head, "--base-ref", genesis)

# --- 5. regenerate everything (re-signed, re-witnessed chain) ---------------

rewitness, rewitness_workspace = fresh("regenerated")
regenerate_chain(rewitness, rewitness_workspace)
rewitness_head = commit(rewitness, "regenerate and re-witness the whole chain")
clones["rewitness"] = clone_facts(rewitness)
capture("13-rewitness", rewitness, "--commit", "HEAD")
capture("14-rewitness-base-ref", rewitness, "--commit", "HEAD",
        "--expect-commit", rewitness_head, "--base-ref", genesis)

# --- 6. never declare a required gate ---------------------------------------

dropgate = WORK / "undeclared-gate"
dropgate_repo = dropgate / "corpus"
dropgate_repo.mkdir(parents=True)
dropgate_workspace = dropgate / "producer-workspace"
build_corpus(
    dropgate_repo,
    dropgate_workspace,
    commit=False,
    gates=[
        {
            "gateId": "oracle/licensed-parity",
            "tier": "restricted",
            "outcome": "pass",
            "evidence": {"restrictedInput": "licensed bundle"},
        },
        {
            "gateId": "ci/repository-checks",
            "tier": "ci-attested",
            "outcome": "pass",
            "evidence": {"workflow": "repository-checks.yml"},
        },
    ],
)
hand_the_spec_to_the_auditor(dropgate_repo)
dropgate_genesis = _commit_fixture(
    dropgate_repo, "publish corpus release 0000", initialize=True
)
dropgate_head = append_release(dropgate_repo, dropgate_workspace, content=REVIEWED_TESTS)
facts["dropgate_genesis"] = dropgate_genesis
clones["dropgate"] = clone_facts(dropgate_repo)
capture("15-dropgate", dropgate_repo, "--commit", "HEAD")
capture("16-dropgate-base-ref", dropgate_repo, "--commit", "HEAD",
        "--expect-commit", dropgate_head, "--base-ref", dropgate_genesis)

# --- the new 0.6.0 argument rule, per scenario ------------------------------
#
# `--base-ref` names a history to bind against, which is only meaningful once
# the revision under test is pinned; 0.6.0 refuses the pair on the arguments,
# after parsing them, rather than verifying against a moving target. Captured
# per scenario rather than assumed identical.

for name, repo_path, base in (
    ("17-hand-edit-base-ref-unpinned", rewrite, genesis),
    ("18-re-encode-base-ref-unpinned", reencode, genesis),
    ("19-swapped-key-base-ref-unpinned", swapkey, genesis),
    ("20-regenerated-base-ref-unpinned", rewitness, genesis),
    ("21-undeclared-gate-base-ref-unpinned", dropgate_repo, dropgate_genesis),
):
    capture(name, repo_path, "--commit", "HEAD", "--base-ref", base)

(OUT / "facts.json").write_text(json.dumps(facts, indent=2) + "\n", encoding="utf-8")
print(json.dumps(facts, indent=2))
print("done")
