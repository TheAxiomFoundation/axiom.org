/**
 * Data behind /verify.
 *
 * Every row here must be checkable by someone who does not work here. If a
 * claim has no `check`, it does not belong on this page — move it to /stack or
 * cut it. If a check is known to fail today, it goes in `openIssues` with the
 * error text, not into a softer adjective in the table above.
 *
 * The tier definitions live here and on /verify. The July 2026 rationale sits in
 * the archived launch repo (Launch-Scope.md), which is a record, not a source.
 */

export type Tier = "verified" | "preview" | "demo" | "blocked";

export const tierLabel: Record<Tier, string> = {
  verified: "Verified",
  preview: "Developer preview",
  demo: "Demo",
  blocked: "Not yet executable",
};

export const tierNote: Record<Tier, string> = {
  verified:
    "You can check it without us. Download, recompute the hash, verify the attestation, run it.",
  preview:
    "Live and usable today. Interfaces and limits may change; there is no service commitment yet.",
  demo: "Shows what the layer enables. Bounded, and the bounds are named.",
  blocked:
    "Written, published, and currently failing. The error and the fix are below.",
};

export const launchScopeNote =
  "The corpus includes other jurisdictions, but this launch reports US verification only.";

export interface Surface {
  id: string;
  name: string;
  tier: Tier;
  claim: string;
  check: string;
  expect: string;
  limit: string;
}

export const surfaces: Surface[] = [
  {
    id: "engine",
    name: "Rules engine v0.1.1",
    tier: "verified",
    claim:
      "The binary you download is the one our release workflow built, from the commit it says — and it executes the published program artifacts.",
    check:
      "gh attestation verify axiom-rules-engine-aarch64-apple-darwin.tar.xz \\\n  --repo TheAxiomFoundation/axiom-rules-engine\n./axiom-rules-engine run-compiled --artifact us-co-snap.compiled.json < request.json",
    expect:
      "Checksum and SLSA provenance verify on anonymous download; the engine loads the current artifact release and returns a determination with its citation trace.",
    limit:
      "v0.1.1 restores execution after v0.1.0 could not load any published artifact. Capability introspection (a capabilities subcommand and check-artifact) is merged but not yet in a release, so contract-vs-binary checks still need a run attempt.",
  },
  {
    id: "artifacts",
    name: "Program artifacts",
    tier: "verified",
    claim:
      "Each published program is content-addressed, and the manifest declares the hash before you download it.",
    check:
      "shasum -a 256 us-co-snap.compiled.json\n# compare against manifest.json → programs[].artifact_sha256",
    // Program-artifacts releases roll several times a day, so this points at
    // the manifest rather than freezing a tag that goes stale by tomorrow.
    expect:
      "The two hashes match. Each program in the manifest carries its spec path, spec hash, artifact hash, and declared outputs.",
    limit:
      "Hash and attestation prove origin, not correctness. Correctness is the oracle row.",
  },
  {
    id: "corpus",
    name: "US corpus and RuleSpec encodings",
    tier: "verified",
    claim:
      "Every encoded US value cites the provision it came from, and releases are pinned and publicly mirrored.",
    check:
      "Fetch a US corpus release from the public mirror and recompute its canonical sha256.",
    expect: "Recomputed hash matches the published manifest.",
    limit:
      "Coverage is per-program and partial. The programs list is the coverage claim; there is no blanket one.",
  },
  {
    id: "oracles",
    name: "US validation against independent evidence",
    tier: "verified",
    claim:
      "Where a policy is covered, every disagreement with the reference calculator is classified with evidence: reconciled arithmetically, traced to a bug in the other engine, or attributed to the comparison harness itself (bridge artifacts) — a bounded class we disclose rather than blend in.",
    check:
      "git clone https://github.com/TheAxiomFoundation/axiom-oracles\ncat conformance/scoreboard.json\nuv run scripts/apply_dispositions.py --check",
    expect:
      "The scoreboard's own predicate: covered == in_scope, unexplained == 0, Axiom-attributed == 0. The dispositions check recomputes every classification's arithmetic from the committed evidence.",
    limit:
      "Coverage is evidence-set specific. Agreement only shows two implementations agree; where both misread a provision the same way, it shows nothing.",
  },
  {
    id: "api",
    name: "Hosted API",
    tier: "preview",
    claim:
      "Mint a trial key with no signup and run a determination in one request.",
    check:
      "curl -s -X POST https://api.axiom.org/v1/keys/trial \\\n  -H 'content-type: application/json' -d '{\"label\":\"first key\"}'",
    expect: "A key, an expiry, and a compute-unit quota. Only its hash is stored.",
    limit:
      "Developer preview, not Launched. There is no service commitment, and the golden-household rounding divergence is tracked below.",
  },
  {
    id: "mcp",
    name: "MCP server",
    tier: "preview",
    claim: "Agent clients get search, read, and execute over the same rules.",
    check: "npx -y @axiom-foundation/mcp",
    expect: "Initializes over stdio and lists its tools.",
    limit: "Same preview terms as the API.",
  },
  {
    id: "playground",
    name: "Playground",
    tier: "demo",
    claim:
      "Compiler and evaluator run as WebAssembly in the page. Your inputs do not leave the tab.",
    check: "Open the network panel and run a determination.",
    expect: "No network requests after the engine loads.",
    limit:
      "Runs a small loaded program, not the full published artifact. What is loaded is named on the page.",
  },
];

/**
 * Conformance is a predicate, not a match rate:
 *
 *   conformant = covered == in_scope
 *             && unexplained_total == 0
 *             && axiom_attributed_open == 0
 *
 * A raw match rate is the wrong number to publish, because it counts a residual
 * we have chased to a documented bug in the other engine the same as one we
 * cannot account for. Every mismatch is classified, with evidence, into one of
 * five kinds — and `axiom_encoding_gap` and `unexplained` never count as
 * explained.
 */
export const conformancePredicate = `conformant = covered == in_scope
          && unexplained == 0
          && axiom_attributed_open == 0`;

export interface UsEvidenceRow {
  id: string;
  check: string;
  reference: string;
  scale: string;
  result: string;
  href: string;
  linkLabel: string;
}

export const usEvidenceRows: UsEvidenceRow[] = [
  {
    id: "co-snap-conformance",
    check: "Colorado SNAP conformance",
    reference: "PolicyEngine",
    scale: "2,144 comparisons",
    result: "100% of mismatches explained under the conformance predicate.",
    href: "https://github.com/TheAxiomFoundation/axiom-oracles",
    linkLabel: "Open conformance evidence",
  },
  {
    id: "co-snap-qc",
    check: "Colorado SNAP QC reality check",
    reference: "USDA SNAP QC",
    scale: "856 real FY 2024 administrative cases",
    result:
      "All cases reproduce the federal computation exactly, case by case and stage by stage.",
    href: "/reports/colorado-snap-qc-fy2024",
    linkLabel: "Read the QC report",
  },
  {
    id: "fiit",
    check: "Federal income tax (fiit)",
    reference: "PolicyEngine",
    scale: "3,881,635 distinct comparisons",
    result: "A comparison count, not a match-rate claim.",
    href: "https://github.com/TheAxiomFoundation/axiom-oracles",
    linkLabel: "Open comparison evidence",
  },
];

export const goldenHousehold = {
  releasedPair: "engine v0.1.1 x program-artifacts-59a10dab866e",
  reproducibility: "Stranger-path reproducible",
  tuple: [
    ["snap_eligible", "holds"],
    ["snap_allotment", "478"],
    ["snap_net_income", "226"],
  ] as const,
  certificate:
    "certified: 0 — certification is automatic when the harness computes completeness and fidelity green; we expect no current encoding passes yet.",
};

export const closurePredicate =
  "repo_closed = every section is encoded or excluded with a stated reason, and pending == 0";

export interface ClosureMetric {
  label: string;
  value: string;
}

export interface ClosureRoot {
  root: string;
  status: "Closed" | "Published debt";
  detail: string;
  metrics?: ClosureMetric[];
  placeholder?: string;
}

export const closureRoots: ClosureRoot[] = [
  {
    root: "10 CCR 2506-1",
    status: "Closed",
    detail:
      "Colorado's rule manual is closed. The exclusions are container headings, each with a stated reason.",
    metrics: [
      { label: "Sections", value: "289" },
      { label: "Encoded", value: "281" },
      { label: "Excluded", value: "8" },
      { label: "Pending", value: "0" },
    ],
  },
  {
    root: "7 CFR 273",
    status: "Published debt",
    detail:
      "Content-level review counts a module as encoded only when it computes its section — seven modules declare deferred outputs and stay pending. Every pending provision is a named row.",
    metrics: [
      { label: "Provisions", value: "39" },
      { label: "Encoded", value: "2" },
      { label: "Excluded", value: "14" },
      { label: "Pending", value: "23" },
    ],
  },
  {
    root: "7 USC ch. 51",
    status: "Published debt",
    detail:
      "Most of chapter 51 is retailer, EBT, and state-plan administration, excluded with content-grounded reasons. Every pending provision is a named row.",
    metrics: [
      { label: "Provisions", value: "827" },
      { label: "Encoded", value: "16" },
      { label: "Excluded", value: "544" },
      { label: "Pending", value: "267" },
    ],
  },
];

export const closureMeaning = {
  repo:
    "Repo closure is the completeness predicate for the law in a declared root. It is not program closure, and it does not claim that a composed program is complete.",
  program:
    "The composed Colorado SNAP program consults a subset of the declared roots and declares",
  declaration: "acknowledged_incomplete: snap_eligible",
  ledgerHref:
    "https://github.com/TheAxiomFoundation/axiom-oracles/tree/main/closure/universes/us-co-snap",
};

/** What stops a classification from being an excuse. */
export const enforcement = [
  "Evidence is mandatory. A disposition needs a stated mechanism plus arithmetic that reconciles or an upstream citation. Classifications must reconcile numerically, not assert.",
  "The arithmetic is checked. Expressions are evaluated in CI and must equal the claimed value within tolerance.",
  "Citations cannot dangle. Non-URL sources are repo paths and must exist.",
  "Dispositions expire with their sources. When a mismatch moves or disappears, its disposition stops applying rather than silently relabelling a new residual.",
  "The ratchet only turns one way. Covered may rise; unexplained and Axiom-attributed may only fall. CI refuses regressions.",
  "Coverage is gated separately: every executable output must be mapped to an oracle concept and covered by companion tests, or the build fails.",
];

export interface OpenIssue {
  id: string;
  title: string;
  status: string;
  detail: string;
  evidence?: string;
  fix: string;
}

/**
 * This section is the point of the page. A claim we cannot currently back is
 * more useful to a reader than one we can — it tells them what our labels are
 * worth. Entries leave only when the check passes, not when the copy improves.
 */
export const openIssues: OpenIssue[] = [
  {
    id: "api-rounding",
    title:
      "The hosted API returns un-rounded net income; the published artifact applies the statutory whole-dollar election",
    status: "Open — found 2026-07-27",
    detail:
      "The released golden household is stranger-path reproducible on engine v0.1.1 x program-artifacts-59a10dab866e: snap_eligible = holds, snap_allotment = 478, and snap_net_income = 226. The hosted API is Developer preview, not Launched, and still returns the un-rounded 226.5, so the cross-surface parity leg remains open.",
    evidence:
      "[PASS   ] local  outputs={'snap_eligible': 'holds', 'snap_allotment': '478', 'snap_net_income': '226'}\n[FAIL   ] cross-surface: api.snap_net_income=226.5 != local.snap_net_income=226",
    fix: "The API's serving path applies the same whole-dollar elections the artifact does (axiom-api#115); the parity gate's cross-surface leg is the acceptance test.",
  },
  {
    id: "compat",
    title: "The published compatibility contract still lacks its gating dimension",
    status: "Narrowed — checked 2026-07-26",
    detail:
      "requires_engine.min_version says \"0.1.0\", which cannot express the artifact-format boundary that actually decides loadability — a reader comparing version strings reaches the wrong verdict. An artifact_format_version floor exists as a prototyped, unmerged change to the build tool, and the release gate computes the third-party verdict from the published contract and fails when it disagrees with reality. Every manifest a stranger downloads today still carries the misleading floor; this entry closes when the emission merges, ships in a release, and the gate goes green on it.",
    evidence:
      '"requires_engine": {"min_version": "0.1.0", "capabilities": []}\n// loadability is decided by artifact_format_version, absent above',
    fix: "Merge the floor emission, republish artifacts with it, and keep the contract-versus-reality gate so the two can never diverge silently again.",
  },
];

/** Depth ladder — stated so a reader can choose how far to go. */
export const ladder = [
  {
    depth: "Five minutes",
    what: "How the system is put together, layer by layer.",
    href: "/stack",
    label: "The stack",
  },
  {
    depth: "Thirty minutes and a terminal",
    what: "Run the checks on this page yourself.",
    href: "#check",
    label: "Check it yourself",
  },
  {
    depth: "Everything",
    what: "The code, the encodings, the release history, the open issues.",
    href: "https://github.com/TheAxiomFoundation",
    label: "GitHub",
  },
];
