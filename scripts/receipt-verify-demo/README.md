# receipt verify demo transcripts

`src/app/receipt/verify-transcripts.ts` holds every `receipt verify` run the
interactive demo on `/receipt` shows. It is generated, never hand-written: the
page's whole claim is that a reader is looking at the command's real output, so
the transcripts come out of a real run of the released package over a real
signed corpus.

## Regenerating after a receipt release

```bash
version=0.6.0

uv venv --clear /tmp/receipt-venv
uv pip install --python /tmp/receipt-venv/bin/python "receipt==$version"
rm -rf /tmp/receipt-src
git clone --depth 1 --branch "v$version" \
  https://github.com/TheAxiomFoundation/receipt /tmp/receipt-src

rm -rf /tmp/receipt-demo /tmp/receipt-captures
mkdir -p /tmp/receipt-demo /tmp/receipt-captures
/tmp/receipt-venv/bin/python scripts/receipt-verify-demo/capture.py \
  /tmp/receipt-captures /tmp/receipt-demo /tmp/receipt-src/tests
/tmp/receipt-venv/bin/python scripts/receipt-verify-demo/reproduce.py \
  /tmp/receipt-captures /tmp/receipt-venv/bin/receipt
/tmp/receipt-venv/bin/python scripts/receipt-verify-demo/generate.py \
  /tmp/receipt-captures "$PWD/src/app/receipt/verify-transcripts.ts"

bun run test:run
```

`openssl` and `git` must be on `PATH`: the fixture issues two real certificate
authorities and stamps real RFC 3161 tokens with them, and it builds the corpus
inside a fresh git repository.

## What each script does

- **`capture.py`** builds the published corpus, then a private clone per attack
  that mutates one — a hand edit, a re-encode, a substituted signing key, a
  wholesale regeneration — plus the pristine clone, left alone, and a second
  corpus published from its own genesis under the same producer key and the same
  two authorities that never declares a required gate. It runs `receipt verify`
  over each at three levels of auditor pinning: nothing, `--base-ref` alone, and
  `--base-ref` with `--expect-commit`, and writes one capture file per run. Six
  scenarios at three levels is eighteen runs, the ones the demo shows; it
  captures three more of the pristine clone that it does not —
  `04-pristine-spec-pinned` (`--expect-spec-sha256`), `05-pristine-fully-pinned`
  (spec, commit and tree pinned, with `--verify-objects`) and `06-pristine-json`
  (`--json`) — for 21 in all, the count `reproduce.py` requires.
- **`reproduce.py`** re-runs every captured invocation through the installed
  `receipt` console script in a real subprocess and requires byte-identical
  stdout, stderr and exit code. `capture.py` runs the CLI in-process, where a
  refusal that exits rather than returns is still caught and recorded; this
  proves the demo may print the command as `receipt verify …`.
- **`generate.py`** emits the TypeScript module, each transcript as a template
  literal holding the stream's exact text.

The capture files themselves are working evidence, not source. The recipe above
writes them under `/tmp` for that reason; quote them in the pull request rather
than committing them. A root `captures/` is gitignored as well, so pointing the
scripts at the working tree still cannot leave them staged.

## When the output shape changes

`verify-demo.tsx` classifies each line for colour — pass markers, refusals, the
header block, the "what this proves" tail — by matching receipt's own line
shapes. A release that renames `[ok  ]`, `VERDICT:` or `FAILED:` needs that
classifier updated alongside the regenerated transcripts; `verify-demo.test.tsx`
asserts the tones that matter.
