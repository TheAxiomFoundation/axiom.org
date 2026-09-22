"use client";

import { useEffect, useState } from "react";

const APP = "https://www.policyengine.org/us/household";

/** PROTOTYPE (suite-mock): the live PolicyEngine app inside Axiom chrome,
 *  with the dual name and the citation guidance the cutover plan requires.
 *  The frame is the real app; nothing about it is re-skinned. */
export function SimulatorApp() {
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { if (!loaded) setBlocked(true); }, 12000);
    return () => clearTimeout(t);
  }, [loaded]);
  return (
    <>
      <section className="relative z-1 px-8 pb-8 pt-14">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-6">
          <div>
            <span className="kicker mb-4 inline-flex items-center">
              <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: "#2C7A7B" }} />
              Axiom Simulator &middot; household calculator
            </span>
            <h1 className="mt-2 font-display text-[clamp(1.8rem,3vw,2.6rem)] font-light leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]">
              Axiom Simulator <span className="serif-italic text-[0.6em] text-[var(--color-ink-secondary)]">formerly PolicyEngine</span>
            </h1>
            <p className="mt-3 max-w-[640px] font-body text-[0.98rem] leading-relaxed text-[var(--color-ink-secondary)]">
              Same model, same team, same license. Package names, imports, the API host and every URL are unchanged.
            </p>
          </div>
          <div className="card-edition max-w-[520px] p-4">
            <div className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">cite as</div>
            <div className="mt-1 font-body text-[0.9rem] text-[var(--color-ink)]">Axiom Simulator (formerly PolicyEngine), policyengine-us v2.x, run {new Date().toISOString().slice(0, 10)}.</div>
            <div className="mt-3 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">install</div>
            <div className="mt-1 font-mono text-[0.85rem] text-[var(--color-ink)]">pip install policyengine-us</div>
          </div>
        </div>
      </section>
      <section className="relative z-1 px-8 pb-16" style={{ borderTop: "3px solid #2C7A7B" }}>
        <div className="mx-auto max-w-[1280px] pt-6">
          <div className="relative overflow-hidden rounded border border-[var(--color-rule)] bg-white" style={{ height: 820 }}>
            {!blocked ? (
              <iframe title="The live PolicyEngine household calculator, framed by the prototype" src={APP} onLoad={() => setLoaded(true)} className="h-full w-full border-0" />
            ) : null}
            {(!loaded || blocked) ? (
              <div className="absolute inset-0 flex items-center justify-center p-8 text-center font-body text-[0.95rem] text-[var(--color-ink-secondary)]" style={{ background: "var(--color-paper)" }}>
                {blocked ? "The live app did not load inside this frame here. Open it at policyengine.org/us/household; in this universe it would answer at axiom.org/simulator." : "Loading the live app…"}
              </div>
            ) : null}
          </div>
          <p className="mt-4 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-[var(--color-ink-muted)]">prototype &middot; the frame shows the real policyengine.org app, unchanged &middot; only the chrome around it is the mock</p>
        </div>
      </section>
    </>
  );
}
