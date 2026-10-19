import type { Metadata } from "next";
import { Reveal } from "@/components/landing/reveal";
import { waiverCoverageClause, sourceCitationClause } from "@/lib/verification-evidence";
import { SITE_URL } from "@/lib/urls";

export const metadata: Metadata = {
  title: "Receipts — Axiom Foundation",
  description:
    "Everything Axiom publishes carries the evidence to re-verify it, offline, without asking us. Trust anchors live in the verifier's own committed code, never in configuration we could swap.",
  alternates: { canonical: `${SITE_URL}/receipts` },
};

// Every row links a PUBLIC surface — the receipt is only a receipt if a
// stranger can follow it. (ops is private; the certified ledger is public
// at /api/axiom/certified, which proxies axiom-api's ledger read.)
const receipts = [
  {
    name: "The receipt package",
    what:
      "The machinery that writes them: append-only hash-chained manifests, dual RFC 3161 time witnesses, pinned Ed25519 signatures, and one offline fail-closed command — receipt verify. An open-source package anyone can adopt; it has its own page.",
    href: "/receipt",
    label: "axiom.org/receipt",
  },
  {
    name: "The working paper",
    what:
      "What an offline check of agent-produced records establishes and refuses to establish, why trust anchors live in the verifier's own code, and the four evidence classes behind the package. Manuscript, PDF, and the code it describes.",
    href: "/receipt/paper",
    label: "axiom.org/receipt/paper",
  },
  {
    name: "Releases",
    what:
      "Engine releases ship checksums and build attestations. Verify the binary you downloaded against the attestation log with commodity tools before you run it.",
    href: "https://github.com/TheAxiomFoundation/axiom-rules-engine/releases",
    label: "axiom-rules-engine/releases",
  },
  {
    name: "Encodings",
    what:
      `${sourceCitationClause()}. Modules carry companion tests, and CI runs selected modules' tests, except for active entries on the public waiver list. ${waiverCoverageClause()}. The repositories publish the citations, tests, waiver list, and their history.`,
    href: "https://github.com/TheAxiomFoundation/rulespec-us",
    label: "rulespec-us",
  },
  {
    name: "Validation",
    what:
      "Encodings are compared with other calculators and datasets in the open, and the disagreements are recorded.",
    href: "https://github.com/TheAxiomFoundation/axiom-oracles",
    label: "axiom-oracles",
  },
  {
    name: "Certification",
    what:
      "A program certifies only when axiom-oracles computes all four premises — conformant, exercised, closed, executable — true with zero open defects, and no flag is set by hand. The API serves a rule as certified only when it is in the certified ledger, where every entry names its claim — computed by a verifier, or attested by a human signature — and pins its evidence.",
    href: "/api/axiom/certified",
    label: "the certified ledger",
  },
];

export default function ReceiptsPage() {
  return (
    <div className="relative z-1 pt-32 pb-24 px-8">
      <div className="mx-auto max-w-[960px]">
        <Reveal className="mb-14 max-w-[760px]">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            Receipts
          </span>
          <p className="m-0 mb-4 font-mono text-[0.72rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
            These are Axiom&apos;s records. Looking for the receipt software
            package?{" "}
            <a href="/receipt" className="text-[var(--color-accent)] hover:underline">
              axiom.org/receipt
            </a>
          </p>
          <h1 className="heading-page mb-6 mt-2">We show our receipts</h1>
          <p className="font-body text-[1.2rem] leading-relaxed text-[var(--color-ink-secondary)] text-pretty">
            Everything Axiom publishes carries the evidence to re-verify it,
            offline, without asking us. Trust anchors live in the
            verifier&apos;s own committed code, never in configuration we could
            swap.
          </p>
        </Reveal>

        <Reveal as="section" className="mb-20">
          <div className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {receipts.map((item) => (
              <div
                key={item.name}
                className="grid grid-cols-[200px_minmax(0,1fr)] gap-6 py-6 max-md:grid-cols-1 max-md:gap-2"
              >
                <div>
                  <p className="m-0 font-mono text-[0.85rem] text-[var(--color-ink)]">
                    {item.name}
                  </p>
                  <a
                    href={item.href}
                    className="font-mono text-[0.72rem] text-[var(--color-accent)] hover:underline"
                  >
                    {item.label}
                  </a>
                </div>
                <p className="m-0 font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">
                  {item.what}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal as="section">
          <h2 className="heading-section mb-3">What the records establish</h2>
          <p className="max-w-[720px] font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
            Signed manifests record how files were applied: some record encoder
            apply runs and others manual attestations. A signature alone does
            not establish that the encoder authored a file. You can inspect an{" "}
            <a href="https://github.com/TheAxiomFoundation/rulespec-us/blob/d8511cca76b060e40fba90ae8af7f7643e6edf11/.axiom/encoding-manifests/policies/irs/rev-proc-2025-32/alternative-minimum-tax.json">encoder apply record</a>{" "}
            and a{" "}
            <a href="https://github.com/TheAxiomFoundation/rulespec-us/blob/d8511cca76b060e40fba90ae8af7f7643e6edf11/.axiom/encoding-manifests/programs/us/us-tariff-schedule/ch01.json">manual attestation</a>.
          </p>
        </Reveal>
      </div>
    </div>
  );
}
