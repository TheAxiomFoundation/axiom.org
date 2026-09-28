# Execution availability and published schema audit

Checked 2026-09-13 against the hosted runtime and the published `encodings.rulespec_files` mirror.

## Fixed in the app

Run availability now uses `/runtime/root-inputs` (compile and inspect) rather than executing an empty household. Section 22 compiled and returned 24 input slots, while the old empty-household execution failed with missing `payment_received_as_pension_annuity_or_similar_allowance`. That failure incorrectly hid Run. Failed input-catalog responses are no longer cached; cold compilation gets 20 seconds. Network failure remains unknown instead of being persisted as a negative capability result.

## Remaining publication blockers

The read-only metadata audit checked 5,571 files. 491 contain incompatibilities with the serving engine's strict source metadata contract. Reverse import traversal identifies 618 files including these blockers and their importers. These are module counts, not node counts or a full execution failure census.

- `us:policies/usda/snap/fy-2026-cola/maximum-allotments`: unsupported `module.source_verification.values`; 38 affected modules including the blocker. Colorado 4.207.2 imports this file. The runtime's error identifies the root Colorado module, obscuring the imported source of the parse failure. Reproduced with the API's local vendored WASM engine and unchanged mirror YAML.
- `us:policies/irs/rev-proc-2025-32/earned-income-credit`: removed plural `corpus_citation_paths`, unsupported `values`, missing required singular citation; 3 affected modules including the blocker. Section 32 fails on this import.

Do not remove extra citations or arbitrarily pick the first citation. Multi-source provenance must be migrated to the encoding schema supported by the coordinated engine/source release, retaining attribution at the appropriate rule/source nodes. The local rulespec checkout already uses newer `source_claims` metadata in the SNAP module; publishing it with the older serving engine requires compatibility verification, not a blind mirror resync.

## Reproduction and release work

Run `bun scripts/audit-runtime-encodings.ts` for a fresh read-only report, including per-blocker affected modules. The report is `runtime-metadata-audit.json` beside this file. It checks only these metadata incompatibilities; passing it does not prove full compilability.

The remaining repair belongs in source publication and the runtime deployment: migrate source metadata, compile each affected import closure with the intended serving engine, run existing calculation fixtures, then publish the matching source/engine versions and rerun this audit. No database rows or deployed runtime were changed in this task. The website workspace does not have a mirror write credential.

## Follow-up: metadata-only repair tested on the existing engine

A complete nine-module published closure for Colorado 4.207.2 was tested with the API checkout's vendored engine 0.2.1, reproducing the hosted `values` rejection. Moving supplemental `source_verification.values` to module-level `source_values` in **both** FY2026 SNAP `maximum-allotments` and `deductions` allows the complete Colorado closure to compile on that same engine. The singular source citations remain in `source_verification`. All rule definitions, formulas, and parameter tables are unchanged. Supplemental metadata remains in the encoding YAML; it is not claimed to be retained in the compiled artifact.

The compiled Colorado `snap_days_in_application_month` node executed successfully for January 2026 (31) and February 2026 (28). This proves no engine upgrade is needed for this particular blocker, not that every scenario or all 491 incompatible files are repaired.

Reviewable patch: `snap-source-metadata-repair.patch`, based on the published mirror snapshots, not the newer local rulespec checkout. It must be applied to the matching source release and republished through the source pipeline; it has not been applied to production. Do not apply blindly to current main, which has already changed its provenance representation.

Reproduction: `bun scripts/verify-snap-metadata-repair.ts <engine-js> <original-modules.json> <repaired-modules.json>`. This verifies that exactly two files changed only by the metadata relocation, reproduces the original compiler failure, compiles the repaired closure, and asserts both calculation results. Session snapshots are `/private/tmp/co-modules.json` and `/private/tmp/co-repaired-modules.json`.

## Source repair PR (2026-09-14)

Opened https://github.com/TheAxiomFoundation/rulespec-us/pull/1363 from an isolated checkout of current source main. In addition to the two SNAP repairs, EITC now uses the verified IRS document citation `us/guidance/irs/rev-proc-2025-32` and retains both original page citations as individual `source_documents` records. All ten modules in the EITC section 32 closure compile with this replacement on engine 0.2.1. Four existing EITC parameter fixture cases were executed through temporary derived lookup wrappers; all 25 expected values match. The temporary wrappers are test-only and were not committed to source.

The source PR also adds a changed-encoding metadata check with four unit tests. It prevents the same malformed fields in changed files, but neither repairs nor certifies the remaining repository-wide backlog. No source PR merge, mirror mutation, or production runtime deployment has been performed.
