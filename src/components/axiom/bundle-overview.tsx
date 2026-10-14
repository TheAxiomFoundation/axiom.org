"use client";

import { useState } from "react";
import styles from "./bundle-overview.module.css";
import { ageLabel } from "@/lib/axiom/encoding-pipeline";
import { bundleHref, formatShare, type BundleTierId, type TierCounts } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";

const number = (value: number) => value.toLocaleString("en-US");

type Count = "documents" | "provisions";
type View = "program" | "jurisdiction";

interface Share {
  done: number;
  total: number;
  /** Done without resting on a validation waiver. */
  validated: number;
  /** Documents partly encoded: started, not done (always 0 when counting provisions). */
  partly: number;
  /** Documents the corpus does not hold yet (always 0 when counting provisions). */
  missing: number;
  /** A state layer with no documents of its own in the tier: its count is the federal law's, or nothing. */
  stateless?: boolean;
}

/** "50 states and DC": DC is not a state. */
function statesWords(jurisdictions: string[]): string {
  const states = jurisdictions.filter((j) => j !== "us-dc").length;
  return `${number(states)} ${states === 1 ? "state" : "states"}${jurisdictions.includes("us-dc") ? " and DC" : ""}`;
}

const ZERO: Share = { done: 0, total: 0, validated: 0, partly: 0, missing: 0 };

/** A tier's headline, as its bundle page leads with it: documents complete, or provisions encoded. */
function shareOf(counts: TierCounts | undefined, count: Count): Share {
  if (!counts) return ZERO;
  if (count === "documents") {
    return {
      done: counts.byStatus.complete + counts.byStatus.unvalidated,
      total: counts.documents,
      validated: counts.byStatus.complete,
      partly: counts.byStatus.partly,
      missing: counts.byStatus.not_in_corpus,
    };
  }
  return {
    done: counts.byProvisionState.encoded + counts.byProvisionState.unvalidated,
    total: counts.provisions,
    validated: counts.byProvisionState.encoded,
    partly: 0,
    missing: 0,
  };
}

const add = (a: Share, b: Share): Share => ({
  done: a.done + b.done,
  total: a.total + b.total,
  validated: a.validated + b.validated,
  partly: a.partly + b.partly,
  missing: a.missing + b.missing,
});
const less = (a: Share, b: Share): Share => ({
  done: a.done - b.done,
  total: a.total - b.total,
  validated: a.validated - b.validated,
  partly: a.partly - b.partly,
  missing: a.missing - b.missing,
});
const percent = (s: Share) => formatShare(s.done, s.total);
/** A segment's width: its part of the total, and at least a sliver when it is not empty. */
const width = (part: number, total: number) => `${part > 0 && total > 0 ? Math.max((part / total) * 100, 1.5) : 0}%`;

/** The bar: done in green, then partly done in a lighter green, on a grey track for the rest. */
function Bar({ share }: { share: Share }) {
  return (
    <span className={styles.track} aria-hidden>
      {share.done > 0 && <span className={styles.fill} style={{ width: width(share.done, share.total) }} />}
      {share.partly > 0 && <span className={styles.partly} style={{ width: width(share.partly, share.total) }} />}
    </span>
  );
}

/**
 * Documents by how far they got: "2 complete (1 validated) · 34 partly · 112
 * not started"; provisions as "47 of 217 Tier 1 provisions (31 validated)".
 * Validated is part of what is done, so it sits with it.
 */
function figure(share: Share, count: Count, unit: string): string {
  // A number and its word stay on one line.
  const part = (n: number, words: string) => `${number(n)}\u00a0${words.replace(/ /g, "\u00a0")}`;
  const validated = share.done > 0 ? ` (${part(share.validated, "validated")})` : "";
  if (count === "provisions") return `${number(share.done)} of ${part(share.total, unit)}${validated}`;
  const notStarted = share.total - share.done - share.partly - share.missing;
  return [
    part(share.done, "complete") + validated,
    share.partly > 0 ? part(share.partly, "partly") : null,
    notStarted > 0 ? part(notStarted, "not started") : null,
    share.missing > 0 ? part(share.missing, "not in the corpus") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One share as a bar, its percent done beside it, and what it counts under it. */
function Meter({ share, count, unit }: { share: Share; count: Count; unit: string }) {
  return (
    <span className={styles.meter}>
      <Bar share={share} />
      <strong className={styles.percent}>{percent(share)}</strong>
      <span className={styles.figure}>
        {share.stateless && !share.total
          ? "No state documents"
          : `${figure(share, count, unit)}${share.stateless ? " · no state documents" : ""}`}
      </span>
    </span>
  );
}

/** A left-hand row: a program, or a jurisdiction, with its completeness. */
interface Group {
  key: string;
  label: string;
  share: (tier: BundleTierId) => Share;
  note: string;
}

/** A right-hand row: one bundle (or one layer of it), with both tiers. */
interface Row {
  key: string;
  label: string;
  sub?: string;
  href: string;
  share: (tier: BundleTierId) => Share;
  pinned?: boolean;
}

/**
 * Every program bundle, in two steps, viewed by program or by jurisdiction.
 *
 * By program: the programs, each with its completeness (the federal law once
 * and each state's own documents once); then the chosen program's federal law
 * and each state's bundle as its page shows it (the state and the federal law).
 *
 * By state: the federal law and each state, each with the completeness of its
 * own documents across every program; then the chosen jurisdiction's own
 * documents in each program, so the federal and the state parts stay apart.
 */
export function BundleOverview({
  bundles,
  initialProgram,
  initialCount = "documents",
  referenceMs,
}: {
  bundles: BundleSummary[];
  /** The program to open on, as a bundle's "All program bundles" link names it. */
  initialProgram?: string;
  initialCount?: Count;
  /** The page's clock, for how old the numbers are. */
  referenceMs?: number;
}) {
  const byId = new Map(bundles.map((b) => [b.id, b]));
  const programTitle = (p: string) =>
    byId.get(`us/${p}`)?.title.replace(/: federal law$/, "") ?? p.toUpperCase();
  // Everything in alphabetical order.
  const alphabetical = <T,>(items: T[], label: (item: T) => string) =>
    [...items].sort((a, b) => label(a).localeCompare(label(b)));
  const programs = alphabetical([...new Set(bundles.map((b) => b.program))], programTitle);
  const jurisdictions = [...new Set(bundles.map((b) => b.jurisdiction).filter((j) => j !== "us"))];
  const [view, setView] = useState<View>("program");
  const [count, setCount] = useState<Count>(initialCount);
  const [program, setProgram] = useState(
    initialProgram && programs.includes(initialProgram) ? initialProgram : programs.includes("snap") ? "snap" : programs[0]
  );
  const [jurisdiction, setJurisdiction] = useState("us");
  // The tier the left list summarizes.
  const [tier, setTier] = useState<BundleTierId>("screener");
  if (!bundles.length) return null;

  const stateName = (j: string) => {
    const any = bundles.find((b) => b.jurisdiction === j);
    return any ? any.title.replace(new RegExp(` ${programTitle(any.program)}$`), "") : j;
  };
  const unit = (t: BundleTierId) =>
    count === "documents" ? "documents" : t === "screener" ? "Tier 1 provisions" : "provisions";
  const verb = count === "documents" ? "complete" : "encoded";
  const link = (id: string) => bundleHref(id, count);

  // A bundle's share as its page shows it; a state's own layer is that less the federal law.
  const pageShare = (id: string, t: BundleTierId) => shareOf(byId.get(id)?.counts[t], count);
  // A state layer holds no document of its own in a tier: its bundle's documents are all the federal law's.
  const stateless = (j: string, p: string, t: BundleTierId) => {
    const state = byId.get(`${j}/${p}`)?.counts[t];
    return j !== "us" && state != null && state.documents - (byId.get(`us/${p}`)?.counts[t]?.documents ?? 0) <= 0;
  };
  const ownShare = (j: string, p: string, t: BundleTierId): Share =>
    j === "us"
      ? pageShare(`us/${p}`, t)
      : byId.has(`${j}/${p}`)
        ? { ...less(pageShare(`${j}/${p}`, t), pageShare(`us/${p}`, t)), stateless: stateless(j, p, t) }
        : ZERO;
  // A jurisdiction's own documents across every program, each once, as the collector counted them;
  // before it did, the sum of the programs (a document two programs hold counts twice).
  const acrossPrograms = (j: string, t: BundleTierId): Share => {
    const counted = bundles.find((b) => b.jurisdiction === j && b.counts.jurisdiction?.[t])?.counts.jurisdiction?.[t];
    return counted ? shareOf(counted, count) : programs.reduce((sum, p) => add(sum, ownShare(j, p, t)), ZERO);
  };
  const distinct = bundles.some((b) => b.counts.jurisdiction);
  const statesOf = (p: string) => bundles.filter((b) => b.program === p && b.jurisdiction !== "us");
  const newest = bundles.reduce<string | null>(
    (latest, b) => (b.collected_at && (!latest || b.collected_at > latest) ? b.collected_at : latest),
    null
  );

  const groups: Group[] =
    view === "program"
      ? programs.map((p) => ({
          key: p,
          label: programTitle(p),
          share: (t) =>
            statesOf(p).reduce((sum, b) => add(sum, ownShare(b.jurisdiction, p, t)), pageShare(`us/${p}`, t)),
          note: `across the federal law and ${statesWords(statesOf(p).map((b) => b.jurisdiction))}`,
        }))
      : [
          {
            key: "us",
            label: "Federal law",
            share: (t) => acrossPrograms("us", t),
            note: `the federal law of ${programs.length} programs${distinct ? ", each document once" : ""}`,
          },
          ...jurisdictions
            .map((j) => ({
              key: j,
              label: stateName(j),
              share: (t: BundleTierId) => acrossPrograms(j, t),
              note: `the state's own documents in ${programs.length} programs${distinct ? ", each document once" : ""}`,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ];
  const selected = view === "program" ? program : jurisdiction;
  const select = (key: string) => (view === "program" ? setProgram(key) : setJurisdiction(key));

  const rows: Row[] =
    view === "program"
      ? [
          ...(byId.has(`us/${program}`)
            ? [
                {
                  key: `us/${program}`,
                  label: "Federal law",
                  sub: "shared by every state",
                  href: link(`us/${program}`),
                  share: (t: BundleTierId) => pageShare(`us/${program}`, t),
                  pinned: true,
                },
              ]
            : []),
          ...statesOf(program).map((b) => ({
            key: b.id,
            label: stateName(b.jurisdiction),
            href: link(b.id),
            share: (t: BundleTierId): Share => ({ ...pageShare(b.id, t), stateless: stateless(b.jurisdiction, program, t) }),
          })),
        ]
      : programs
          .filter((p) => byId.has(`${jurisdiction}/${p}`))
          .map((p) => ({
            key: `${jurisdiction}/${p}`,
            label: programTitle(p),
            href: link(`${jurisdiction}/${p}`),
            share: (t: BundleTierId) => ownShare(jurisdiction, p, t),
          }));
  // The federal law first, then the rest in alphabetical order.
  const ordered = [...rows.filter((r) => r.pinned), ...alphabetical(rows.filter((r) => !r.pinned), (r) => r.label)];
  const selectedLabel = groups.find((g) => g.key === selected)?.label ?? selected;

  return (
    <section className={styles.card} aria-labelledby="ops-bundles">
      <div className={styles.head}>
        <div>
          <h2 id="ops-bundles" className={styles.heading}>
            Program bundles
          </h2>
          <p className={styles.note}>
            {count === "documents"
              ? "Documents complete (dark green) and partly encoded (light green), as each bundle's page counts them."
              : "Provisions encoded, as each bundle's page counts them (Tier 1: the provisions of the plan's documents and those the reference model cites)."}{" "}
            {view === "program"
              ? "A state's bundle includes the program's federal law."
              : "By state, each jurisdiction counts only its own documents: the federal law has its own row."}{" "}
            Validated: done without resting on a validation waiver.
            {newest && referenceMs != null && ` Updated ${ageLabel(newest, referenceMs) ?? "just now"} ago.`}
          </p>
        </div>
        <div className={styles.switches}>
          <div className={styles.switch} role="radiogroup" aria-label="View by">
            {(["program", "jurisdiction"] as View[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                onClick={() => setView(value)}
              >
                {value === "program" ? "By program" : "By state"}
              </button>
            ))}
          </div>
          <div className={styles.switch} role="radiogroup" aria-label="Count">
            {(["documents", "provisions"] as Count[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={count === value} onClick={() => setCount(value)}>
                {value === "documents" ? "Documents" : "Provisions"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.programsPane}>
          <div className={styles.columnHead}>
            <span>{view === "program" ? "Program" : "State"}</span>
            <span className={styles.tierToggle} role="radiogroup" aria-label="Completeness, by tier">
              <span>Completeness</span>
              {(["screener", "full"] as BundleTierId[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={tier === value}
                  onClick={() => setTier(value)}
                >
                  {value === "screener" ? "Tier 1" : "Tier 2"}
                </button>
              ))}
            </span>
          </div>
          <ul
            className={`${styles.programs} ${view === "jurisdiction" ? styles.scrolling : ""}`}
            aria-label={view === "program" ? "Programs" : "Jurisdictions"}
          >
            {groups.map((g) => {
              const whole = g.share(tier);
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    aria-pressed={g.key === selected}
                    onClick={() => select(g.key)}
                    title={`${g.label}: ${number(whole.done)} of ${number(whole.total)} ${unit(tier)} ${verb}${
                      whole.partly > 0 ? `, ${number(whole.partly)} partly` : ""
                    } (${number(whole.validated)} validated), ${g.note}`}
                  >
                    <span className={styles.programName}>{g.label}</span>
                    <Bar share={whole} />
                    <span className={styles.programFigure}>{percent(whole)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={styles.states}>
          <table
            className={styles.table}
            aria-label={view === "program" ? `${selectedLabel} by state` : `${selectedLabel} by program`}
          >
            <thead>
              <tr>
                <th scope="col">{view === "program" ? "State" : "Program"}</th>
                <th scope="col">Tier 1 · screener-level parity</th>
                <th scope="col">Tier 2 · full bundle</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => (
                <tr key={row.key} className={row.pinned ? styles.federal : undefined}>
                  <th scope="row">
                    <a href={row.href}>{row.label}</a>
                    {row.sub && <span>{row.sub}</span>}
                  </th>
                  <td>
                    <Meter share={row.share("screener")} count={count} unit={unit("screener")} />
                  </td>
                  <td>
                    <Meter share={row.share("full")} count={count} unit={unit("full")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
