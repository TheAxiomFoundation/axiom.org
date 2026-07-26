"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal, RevealGroup, RevealItem } from "./reveal";

interface TerminalLine {
  content: React.ReactNode;
  delay: number;
}

/**
 * Every line below is a real record, not a dramatisation.
 *
 * The run: rulespec-us `us/.axiom/encoding-manifests/statutes/26/32/c/2.json`
 * — run_id ac6c2c0a, `tool: axiom-encode encode --apply`, 2026-06-29. Its
 * recorded sha256 for statutes/26/32/c/2.yaml matches the file on
 * rulespec-us main byte-for-byte, so this manifest describes what currently
 * ships. The import on 26 USC 112 and the four test cases come from the
 * applied files themselves.
 *
 * The oracle record: axiom-oracles `conformance/detail/us-pe.json`, suite
 * `fiit-ecps`. It is deliberately rendered as a separate, labelled block —
 * the suite is the standing federal income tax comparison covering twelve
 * policies (EITC among them), NOT output of this encode run, and NOT an
 * EITC-only measurement. Per axiom-oracles `scoreboard.py`, a policy row
 * inherits its suite report's totals, so attributing 3,881,635 to EITC alone
 * would misstate what was measured.
 *
 * If these artifacts move, update this transcript or drop it. Do not let it
 * drift into an illustration.
 */
const LINES: TerminalLine[] = [
  {
    delay: 0,
    content: (
      <>
        <span className="text-[#86efac]">$ </span>
        <span className="text-[#fafaf9] font-medium">
          axiom-encode encode &quot;26 USC 32(c)(2)&quot; --apply
        </span>
      </>
    ),
  },
  {
    delay: 0.4,
    content: <span className="text-[rgba(255,255,255,0.35)]">&nbsp;</span>,
  },
  {
    delay: 0.6,
    content: (
      <>
        <span className="font-semibold text-[#fbbf24]">[axiom]</span>
        <span className="text-[#a8a29e]">
          {" "}26 USC 32(c)(2){" "}
        </span>
        <span className="text-[#fafaf9] font-medium">
          &mdash; definition of &ldquo;earned income&rdquo;
        </span>
      </>
    ),
  },
  {
    delay: 0.9,
    content: (
      <>
        <span className="font-semibold text-[#fdba74]">[encode]</span>
        <span className="text-[#a8a29e]">
          {" "}drafting RuleSpec from corpus text
        </span>
      </>
    ),
  },
  {
    delay: 1.2,
    content: (
      <>
        <span className="font-semibold text-[#fdba74]">[encode]</span>
        <span className="text-[#a8a29e]">
          {" "}import resolved{" "}
        </span>
        <span className="text-[#fafaf9] font-medium">
          us:statutes/26/112
        </span>
        <span className="text-[rgba(255,255,255,0.35)]">
          {" "}&mdash; combat-zone pay election
        </span>
      </>
    ),
  },
  {
    delay: 1.6,
    content: <span className="text-[rgba(255,255,255,0.35)]">&nbsp;</span>,
  },
  {
    delay: 1.8,
    content: (
      <>
        <span className="font-semibold text-[#a78bfa]">[apply]</span>
        <span className="text-[#a8a29e]"> </span>
        <span className="text-[#fafaf9] font-medium">
          statutes/26/32/c/2.yaml
        </span>
      </>
    ),
  },
  {
    delay: 2.0,
    content: (
      <>
        <span className="font-semibold text-[#a78bfa]">[apply]</span>
        <span className="text-[#a8a29e]"> </span>
        <span className="text-[#fafaf9] font-medium">
          statutes/26/32/c/2.test.yaml
        </span>
        <span className="text-[rgba(255,255,255,0.35)]">
          {" "}&mdash; 4 cases
        </span>
      </>
    ),
  },
  {
    delay: 2.3,
    content: (
      <>
        <span className="font-semibold text-[#a78bfa]">[apply]</span>
        <span className="text-[#a8a29e]"> proof validation required, signed </span>
        <span className="text-[#fafaf9] font-medium">hmac-sha256</span>
      </>
    ),
  },
  {
    delay: 2.6,
    content: (
      <>
        <span className="font-semibold text-[#86efac]">[done]</span>
        <span className="text-[#86efac]">
          {" "}run ac6c2c0a &mdash; 2 files written to{" "}
        </span>
        <span className="text-[#fafaf9] font-medium">rulespec-us</span>
      </>
    ),
  },
];

/**
 * Rendered under a rule, with its own heading, so it can never read as the
 * encode run's output. See the block comment above LINES.
 */
const ORACLE_LINES: TerminalLine[] = [
  {
    delay: 3.1,
    content: (
      <>
        <span className="font-semibold text-[#a78bfa]">[oracles]</span>
        <span className="text-[#a8a29e]"> PolicyEngine </span>
        <span className="text-[#fafaf9] font-medium">3,881,635</span>
        <span className="text-[#a8a29e]"> comparisons</span>
      </>
    ),
  },
  {
    delay: 3.4,
    content: (
      <>
        <span className="font-semibold text-[#a78bfa]">[oracles]</span>
        <span className="text-[#a8a29e]"> raw match </span>
        <span className="text-[#86efac]">99.5159%</span>
      </>
    ),
  },
  {
    delay: 3.7,
    content: (
      <>
        <span className="font-semibold text-[#a78bfa]">[oracles]</span>
        <span className="text-[#a8a29e]"> unexplained </span>
        <span className="text-[#86efac]">0</span>
        <span className="text-[rgba(255,255,255,0.35)]">
          {" "}&mdash; 16,660 attributed upstream
        </span>
      </>
    ),
  },
];

function Terminal() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.2 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="max-w-[760px] mx-auto" ref={ref}>
      <div className="bg-[#0c0c0c] rounded-md border border-[var(--color-rule)] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.5),0_0_40px_var(--color-accent-light)]">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[rgba(255,255,255,0.06)]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <span className="font-mono text-[0.7rem] text-[rgba(255,255,255,0.3)] ml-2">
            axiom &mdash; zsh
          </span>
        </div>
        <div
          data-testid="encoder-terminal"
          className="px-5 py-4 font-mono text-[0.82rem] leading-[1.8] overflow-x-auto min-h-[320px]"
        >
          {LINES.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre"
              style={
                visible
                  ? {
                      opacity: 0,
                      animation: `terminal-reveal 0.3s var(--ease-out) ${line.delay}s forwards`,
                    }
                  : { opacity: 0 }
              }
            >
              {line.content}
            </div>
          ))}

          {/*
            The oracle record is a separate artifact from the run above: the
            standing federal income tax suite comparison, not this encode's
            output. The rule and caption keep that distinction on screen.
          */}
          <div
            className="mt-5 pt-3 border-t border-[rgba(255,255,255,0.1)]"
            style={
              visible
                ? {
                    opacity: 0,
                    animation: `terminal-reveal 0.3s var(--ease-out) 2.9s forwards`,
                  }
                : { opacity: 0 }
            }
          >
            <span className="text-[rgba(255,255,255,0.4)] text-[0.72rem] tracking-wide">
              standing oracle record &mdash; federal income tax suite
              (fiit-ecps), covering EITC among 12 policies
            </span>
          </div>

          {ORACLE_LINES.map((line, i) => (
            <div
              key={`oracle-${i}`}
              className="whitespace-pre"
              style={
                visible
                  ? {
                      opacity: 0,
                      animation: `terminal-reveal 0.3s var(--ease-out) ${line.delay}s forwards`,
                    }
                  : { opacity: 0 }
              }
            >
              {line.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EncoderSection() {
  return (
    <section
      id="encoder"
      className="section-tint-cream relative z-1 py-32 px-8"
    >
      <div className="max-w-[1280px] mx-auto">
        <Reveal className="text-center mb-16">
          <span className="kicker mb-6 inline-flex">
            <span className="kicker-mark">&sect;</span>
            III &middot; The encoder
          </span>
          <h2 className="heading-section mb-6 mt-2">
            Statutes, encoded automatically. Verified before they ship.
          </h2>
          {/*
            No human sign-off clause here. The pipeline has no human review
            gate — the gates are deterministic checks, independent oracle
            cross-checks, and AI judges. The heading above already carries
            "before they ship"; naming a human approver would describe a
            step that does not exist.
          */}
          <p className="font-body text-lg text-[var(--color-ink-secondary)] max-w-[640px] mx-auto leading-relaxed">
            An AI-driven pipeline reads a statute, encodes it section by
            section, and runs the result against oracles like PolicyEngine
            and TAXSIM.
          </p>
        </Reveal>

        <Terminal />

        <RevealGroup
          className="mt-20 grid gap-6 md:grid-cols-3 max-w-[960px] mx-auto"
          staggerChildren={0.1}
        >
          {[
            {
              n: "01",
              label: "Read",
              body:
                "Pull the statute. Walk the subsection tree. Resolve the citations each subsection depends on.",
            },
            {
              n: "02",
              label: "Encode",
              body:
                "An agent per subsection drafts the encoding, citing the section it came from. The pipeline logs every conflict and retry.",
            },
            {
              n: "03",
              label: "Verify",
              body:
                "Continuous Integration checks, comparison against independent oracles, reviewer agents that explain any discrepancy.",
            },
          ].map((step) => (
            <RevealItem
              key={step.n}
              className="card-edition p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="flex items-baseline justify-between mb-4">
                <span className="serial">Step {step.n}</span>
                <span className="serif-italic text-[1rem] text-[var(--color-ink-muted)]">
                  {step.label.toLowerCase()}
                </span>
              </div>
              <h3 className="font-body text-base font-medium text-[var(--color-ink)] mb-2">
                {step.label}
              </h3>
              <p className="font-body text-[0.88rem] text-[var(--color-ink-secondary)] leading-relaxed m-0">
                {step.body}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal
          as="p"
          className="mt-14 text-center font-body text-[0.95rem] text-[var(--color-ink-muted)] max-w-[640px] mx-auto leading-relaxed"
        >
          The encoder logs every decision.{" "}
          <span className="serif-italic text-[var(--color-ink-secondary)]">
            Disagreements get explained, not erased.
          </span>
        </Reveal>
      </div>
    </section>
  );
}
