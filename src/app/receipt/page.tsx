import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { VerifyDemo } from "./verify-demo";
import { SITE_URL } from "@/lib/urls";

export const metadata: Metadata = {
  title: "receipt — verifiable custody of agent-produced records",
  description:
    "Anyone can verify, offline, that an agent-produced record was never changed, backdated, or deleted. One command over a clone; trust anchors live in the verifier's own code.",
  alternates: { canonical: `${SITE_URL}/receipt` },
  // Without a page-level block, shares inherit the root layout's
  // generic brand card; give the package its own title and description.
  openGraph: {
    title: "receipt — verifiable custody of agent-produced records",
    description:
      "Anyone can verify, offline, that an agent-produced record was never changed, backdated, or deleted. One command over a clone; trust anchors live in the verifier's own code.",
    url: `${SITE_URL}/receipt`,
  },
};

// The package homepage — receipt is an auxiliary open-source package for
// anyone shipping agent-produced records, not an Axiom-internal tool. Axiom's
// own usage appears once, as provenance. Copy stays close to the package
// README (the claims are its claims); no version numbers in the page's own
// copy, so nothing drifts between releases — the one version it shows is the
// demo's, and that comes out of the captured run itself.
//
// The list follows the package docstring's own three groups: modules that
// arrived by extraction behind a byte-equivalence gate, the two the docstring
// calls "also shipped" (composition over those, adding no cryptography and no
// anchors of their own), and machinery still pending extraction.
const provides: {
  mod: string;
  what: string;
  status?: "pending" | "composed";
}[] = [
  {
    mod: "receipt.release_chain",
    what: "Append-only hash-chained manifests over record sets: enumerated genesis, content-addressed links, immutable-prefix verification.",
  },
  {
    mod: "receipt.canonical",
    what: "ECMAScript-compatible canonical JSON: one byte stream per record, so producer and verifier hash and sign identical bytes.",
  },
  {
    mod: "receipt.append_gate",
    what: "Append-only enforcement for governed record trees: a candidate state must extend committed history exactly, verified against trust anchors in the consumer's own code.",
  },
  {
    mod: "receipt.tsa",
    what: "RFC 3161 dual-witness time verification against trust bundles committed in the consumer's repo, with explicit unavailable-witness outcomes.",
  },
  {
    mod: "receipt.sign",
    what: "Ed25519 producer signatures verified against fingerprints pinned in the consumer's own committed code; N-of-M keyrings with legacy generations — retired keys verify immutable history only.",
  },
  {
    mod: "receipt.attest",
    what: "Workflow-provenance verification with self-anchoring enforcement epochs and a full-history sweep over every protected-tree commit.",
  },
  {
    mod: "receipt.corpus",
    status: "composed",
    what: "Closed-world binding of a record tree to its witnessed journal: every content file present is bound, and every bound file is present.",
  },
  {
    mod: "receipt.verify",
    status: "composed",
    what: "The spanning command behind receipt verify: history, custody, binding and declaration over the tree one commit names, stopping at the first refusal.",
  },
  {
    mod: "receipt.ratchet",
    status: "pending",
    what: "Shrink-only exception registries recomputed from live state; an excused failure that starts passing is an error until removed.",
  },
  {
    mod: "receipt.chronology",
    status: "pending",
    what: "Record-vs-event ordering tiers: does witnessed time prove the record existed before the event it predicts or observes?",
  },
];

export default function ReceiptPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="mx-auto max-w-[960px]">
        <Reveal className="mb-14 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            receipt
          </span>
          <p className="m-0 mb-4 font-mono text-[0.72rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
            This is the software package. Looking for Axiom&apos;s own
            receipts?{" "}
            <a href="/receipts" className="text-[var(--color-accent)] hover:underline">
              axiom.org/receipts
            </a>
          </p>
          <h1 className="heading-page mb-6 mt-2">
            Verifiable custody of agent-produced records
          </h1>
          <p className="font-body text-[1.2rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty">
            Agents produce records faster than any human can witness them —
            encoded law, signed rule corpora, release histories. The receipt
            package writes receipts for those records, and{" "}
            <code>receipt verify</code> is what happens when someone asks to
            see them: a clone, commodity tools, one offline, fail-closed
            verdict.
          </p>
        </Reveal>

        {/* Install — the whole adoption story is two commands */}
        <Reveal as="section" className="mb-16">
          <pre className="m-0 rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-5 font-mono text-[0.9rem] leading-relaxed text-[var(--color-ink)] overflow-x-auto">
            {"pip install receipt\nreceipt verify --spec verification/spec.py --commit HEAD"}
          </pre>
          <p className="mt-3 font-mono text-[0.72rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
            on PyPI as{" "}
            <a
              href="https://pypi.org/project/receipt/"
              className="text-[var(--color-accent)] hover:underline"
            >
              receipt
            </a>{" "}
            · source at{" "}
            <a
              href="https://github.com/TheAxiomFoundation/receipt"
              className="text-[var(--color-accent)] hover:underline"
            >
              github.com/TheAxiomFoundation/receipt
            </a>{" "}
            ·{" "}
            <a
              href="/receipt/api/"
              className="text-[var(--color-accent)] hover:underline"
            >
              API reference
            </a>{" "}
            ·{" "}
            <a
              href="/receipt/paper"
              className="text-[var(--color-accent)] hover:underline"
            >
              Working paper
            </a>
          </p>
        </Reveal>

        {/* The fail-closed behavior, touchable: pick an attack, watch the
            first check that fails stop the run. Refusal strings are the
            package's own. */}
        <Reveal as="section" className="mb-16">
          <h2 className="heading-section m-0 mb-6">Try to slip one past it</h2>
          <p className="m-0 mb-6 max-w-[720px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            When an encoding is wrong, the discipline is to fix the pipeline
            and re-encode — never edit the published file by hand. The record
            shows which path a change took: pick one below and read the
            verdict. It is a verdict about the tree the named commit carries,
            never about whatever a working directory happens to hold.
          </p>
          <VerifyDemo />
        </Reveal>

        <Reveal as="section" className="mb-16">
          <h2 className="heading-section m-0 mb-6">What it provides</h2>
          <div className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {provides.map((item) => (
              <div
                key={item.mod}
                className="grid grid-cols-[220px_minmax(0,1fr)] gap-6 py-5 max-md:grid-cols-1 max-md:gap-2"
              >
                <p className="m-0 font-mono text-[0.85rem] text-[var(--color-ink)]">
                  {item.mod}
                  {item.status && (
                    <span className="ml-2 font-mono text-[0.62rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
                      {item.status === "pending"
                        ? "pending extraction"
                        : "composed, not extracted"}
                    </span>
                  )}
                </p>
                <p className="m-0 font-body text-[0.92rem] leading-relaxed text-[var(--color-ink-secondary)]">
                  {item.what}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal as="section" className="mb-16 max-w-[760px]">
          <h2 className="heading-section mb-3">The design principle</h2>
          <p className="font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Trust anchors live in the consumer&apos;s committed code, never in
            runtime configuration a producer could swap. The package ships
            machinery; consumers pin roots. Retiring or rotating a key is a
            reviewed change to the consumer&apos;s repository — not a setting.
          </p>
        </Reveal>

        <Reveal as="section" className="max-w-[760px]">
          <h2 className="heading-section mb-3">Where it comes from</h2>
          <p className="font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            The machinery arrives by extraction from three production systems
            that each built it independently — a signed statute corpus,
            pre-registered forecast records, and an observation-ledger release
            chain —
            behind a byte-equivalence gate: the extracted verifier must
            reproduce the source verifier&apos;s verdict, pass and fail alike,
            on the live production chain before any system consumes the
            package. What <code>receipt verify</code> adds on top is
            composition, not a fourth extraction: it spans those modules and
            reports their verdicts, contributing no cryptography and no trust
            anchors of its own. The observation ledger runs on it in
            production today, with differential harnesses re-proving
            equivalence on every package change; adoption by the Axiom corpus
            is underway. We built it because we needed it. We publish it
            because everyone shipping agent-produced records will.
          </p>
          <p className="mt-4 font-mono text-[0.72rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
            Axiom&apos;s own records carry them:{" "}
            <a href="/receipts" className="text-[var(--color-accent)] hover:underline">
              axiom.org/receipts
            </a>
          </p>
        </Reveal>
      </div>
    </div>
  );
}
