"use client";

import { useState } from "react";

import {
  CLONES,
  CORPUS,
  RECEIPT_VERSION,
  TRANSCRIPTS,
  type AttackId,
  type Pin,
} from "./verify-transcripts";

// The right-hand pane is a transcript, not a mock: every line of it is
// receipt's own output, captured from the released package over the receipt
// repository's signed corpus fixture and generated into verify-transcripts.ts
// by scripts/receipt-verify-demo. This file picks which run to show and
// colours it; it never writes a word the command did not.
//
// That also means the pass order is not simulated here — the transcripts
// carry it. `receipt verify` runs history (only when --base-ref is supplied)
// → custody → binding → declaration, stops at the first failure, prints
// `not reached` for the next pass and omits the rest, so a failing verdict
// never reports a later pass's result. The left-hand pane is the corpus each
// run was of, abridged to what the attack touched.

const ATTACKS: { id: AttackId; label: string; did: string }[] = [
  {
    id: "pristine",
    label: "pristine clone",
    did: "The corpus exactly as its producer published it: two witnessed releases over three rule files.",
  },
  {
    id: "rewrite",
    label: "hand-edit the fix",
    did: "The published rate was wrong, so someone corrected the file in place and committed it. The journal still binds the old bytes.",
  },
  {
    id: "reencode",
    label: "re-encode the fix",
    did: "The same correction, taken through the pipeline instead: a third release, appended to the journal, signed and witnessed.",
  },
  {
    id: "swapkey",
    label: "swap the signing key",
    did: "The producer's published public key is replaced with one whose private half the attacker holds. The spec pinning the real key is in the auditor's repo, not this one.",
  },
  {
    id: "rewitness",
    label: "regenerate everything",
    did: "The producer still holds its signing key, and rebuilds and re-stamps the entire chain over the same content. Nothing about the result is internally wrong.",
  },
  {
    id: "dropgate",
    label: "drop a gate declaration",
    did: "A corpus published without ever declaring rulespec/compile — the gate the auditor's spec requires. Custody and binding are impeccable.",
  },
];

// How much the auditor pinned before running. `--base-ref` alone is refused on
// the arguments in 0.6.0, after parsing them: a history to bind against means
// nothing until the revision under test is itself pinned.
const PINS: { id: Pin; next?: Pin; action?: string }[] = [
  {
    id: "none",
    next: "baseRef",
    action: "add --base-ref from the auditor's records",
  },
  { id: "baseRef", next: "pinned", action: "pin --expect-commit as well" },
  { id: "pinned", next: "none", action: "clear the auditor's pins" },
];

const PIN_NOTE: Record<Pin, string> = {
  none: "First contact: nothing but this clone and the auditor's own spec.",
  baseRef:
    "The auditor names a head it recorded earlier — but has not said which revision it is verifying.",
  pinned:
    "Both pinned, so a history pass runs first: every release object that existed at the recorded head must still be there, byte for byte.",
};

type Tone = "plain" | "ok" | "dim" | "fail" | "changed";

type Line = { text: string; tone?: Tone };

/** The abridged clone each attack hands to the command. */
function clone(attack: AttackId): Line[] {
  const { manifests } = CLONES[attack];
  const stems = manifests.map((name) => name.replace(/\.json$/, ""));
  const changed = (text: string): Line => ({ text, tone: "changed" });
  const plain = (text: string): Line => ({ text });

  const release = (stem: string, note?: string): Line[] => {
    const mark = note ? changed : plain;
    return [
      mark(`  ${stem}${note ? `  ${note}` : ""}`),
      mark("    .json .producer.sig"),
      mark("    .alpha.tsr .beta.tsr"),
    ];
  };

  const regenerated = attack === "rewitness";
  const corrected = attack === "rewrite" || attack === "reencode";

  return [
    plain("rules/"),
    corrected
      ? changed("  tax/rate.yaml          value: 0.17")
      : plain("  tax/rate.yaml          value: 0.15"),
    plain("  tax/rate.test.yaml"),
    plain("  benefit/amount.yaml"),
    plain(".axiom/"),
    plain("  toolchain.toml         attested, not content"),
    plain("receipt/"),
    plain("  corpus-journal.jsonl   append-only, witnessed"),
    attack === "dropgate"
      ? changed("    rulespec/compile     never declared")
      : plain("    rulespec/compile     outcome: pass"),
    plain("  immutable-prefix.json  sealed at genesis"),
    plain("releases/manifests/"),
    ...stems.slice(0, 2).flatMap((stem) =>
      release(stem, regenerated ? "re-witnessed" : undefined),
    ),
    ...stems.slice(2).flatMap((stem) => release(stem, "the correction")),
    plain("releases/anchors/"),
    attack === "swapkey"
      ? changed("  producer-ed25519.pub   substituted key")
      : plain("  producer-ed25519.pub"),
    plain("  alpha-root.pem"),
    plain("  beta-root.pem"),
  ];
}

/** The auditor's side: the pins a producer cannot reach. */
const AUDITOR: Line[] = [
  { text: "the auditor's own repo — out of the producer's reach", tone: "dim" },
  { text: "  spec.py", tone: "dim" },
  {
    text: `    producer SPKI ${CORPUS.producerSpki.slice(0, 16)}…`,
    tone: "dim",
  },
  { text: "    two RFC 3161 anchor roots, pinned", tone: "dim" },
  { text: `    sha256 ${CORPUS.specSha256.slice(0, 16)}…`, tone: "dim" },
];

/** Colour one transcript by the line shapes receipt itself prints. */
export function tones(lines: string[]): Tone[] {
  let marker: "ok" | "fail" | null = null;
  // The only block that recolours the indented prose under it: the header body
  // before any verdict and the "what this proves" tail after a passing one are
  // both dim, so a passing verdict leaves this alone.
  let block: "failed" | null = null;

  return lines.map((line) => {
    if (/^receipt \d/.test(line)) return "plain";
    // A refusal on the arguments, before any pass runs.
    if (/^receipt verify: /.test(line)) return "fail";
    if (/^ {2}\[ok {2}\] /.test(line)) {
      marker = "ok";
      return "ok";
    }
    if (/^ {2}\[FAIL\] /.test(line)) {
      marker = "fail";
      return "fail";
    }
    // A pass's detail line, indented past its marker.
    if (/^ {9}/.test(line)) return marker === "fail" ? "fail" : "dim";
    if (/^FAILED: /.test(line)) {
      block = "failed";
      return "fail";
    }
    if (/^VERDICT: FAIL/.test(line)) return "fail";
    if (/^VERDICT: PASS/.test(line)) return "plain";
    if (/^ {2}/.test(line)) return block === "failed" ? "fail" : "dim";
    // ESTABLISHED OFFLINE…, PASSES, DECLARED IN THE WITNESSED JOURNAL…
    return "plain";
  });
}

// The panes are terminals: the site styles every `pre` as a dark code block
// (tokens.css), so tones come from the code palette, not the page's ink scale
// — ink on the code background is invisible.
const TONE: Record<Tone, string> = {
  plain: "text-[var(--color-code-text)]",
  ok: "text-[var(--color-code-text)]",
  dim: "text-[var(--color-code-comment)]",
  fail: "text-[var(--color-code-keyword)]",
  changed: "text-[var(--color-code-keyword)]",
};

/** One console line, wrapping under its own indent rather than into the margin. */
function ConsoleLine({ text, tone }: Line) {
  const indent = text.length - text.trimStart().length;
  return (
    <div
      className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${TONE[tone ?? "plain"]}`}
      style={indent ? { paddingLeft: `${indent}ch` } : undefined}
    >
      {text.slice(indent) || " "}
    </div>
  );
}

export function VerifyDemo() {
  const [attack, setAttack] = useState<AttackId>("pristine");
  const [pin, setPin] = useState<Pin>("none");

  const pick = (next: AttackId) => {
    setAttack(next);
    setPin("none");
  };

  const run = TRANSCRIPTS[attack][pin];
  const lines = run.text.split("\n");
  const lineTones = tones(lines);
  const step = PINS.find((entry) => entry.id === pin);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {ATTACKS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={attack === a.id}
            onClick={() => pick(a.id)}
            className={
              "font-mono text-[0.7rem] uppercase tracking-[0.14em] " +
              (attack === a.id
                ? "text-[var(--color-ink)] underline underline-offset-4 decoration-[var(--color-accent)]"
                : "text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]")
            }
          >
            {a.label}
          </button>
        ))}
      </div>

      <p className="m-0 mb-5 max-w-[720px] font-body text-[0.95rem] leading-relaxed text-[var(--color-ink-secondary)]">
        {ATTACKS.find((a) => a.id === attack)?.did}
      </p>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,290px)_minmax(0,1fr)]">
        <div>
          <p className="m-0 mb-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            the clone
          </p>
          <pre className="m-0 font-mono text-[0.78rem] leading-relaxed">
            {clone(attack).map((line, i) => (
              <ConsoleLine key={i} {...line} />
            ))}
            <ConsoleLine text="" />
            {AUDITOR.map((line, i) => (
              <ConsoleLine key={`auditor-${i}`} {...line} />
            ))}
          </pre>
        </div>

        <div>
          <p className="m-0 mb-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            the verdict
          </p>
          <pre
            className="m-0 font-mono text-[0.78rem] leading-relaxed"
            aria-live="polite"
          >
            <ConsoleLine text={`$ ${run.command}`} tone="dim" />
            <ConsoleLine text="" />
            {lines.map((line, i) => (
              <ConsoleLine key={i} text={line} tone={lineTones[i]} />
            ))}
          </pre>
          <p className="mt-2 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            {`exit ${run.exitCode} \u00b7 receipt writes a refused verdict to stderr and a passing one to stdout; this one went to ${run.stream}`}
          </p>
          {step?.action && (
            <>
              <p className="mt-4 mb-2 max-w-[600px] font-body text-[0.9rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {PIN_NOTE[pin]}
              </p>
              <button
                type="button"
                onClick={() => step.next && setPin(step.next)}
                className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
              >
                {step.action}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-5 font-mono text-[0.72rem] uppercase tracking-wider text-[var(--color-ink-muted)]">
        every verdict line is receipt {RECEIPT_VERSION}&apos;s own output over
        the package&apos;s own signed corpus fixture &middot; amber marks what
        this clone differs in, and every refusal &middot; passes stop at the
        first failure
      </p>
    </div>
  );
}
