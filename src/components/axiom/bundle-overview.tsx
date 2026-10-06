"use client";

import { useState } from "react";
import styles from "./bundle-overview.module.css";
import { formatShare, type BundleTierId, type TierCounts } from "@/lib/axiom/program-bundles";
import type { BundleSummary } from "@/lib/axiom/program-bundles-data";

const number = (value: number) => value.toLocaleString("en-US");

type Count = "documents" | "provisions";
type View = "program" | "jurisdiction";

interface Share {
  done: number;
  total: number;
}

const ZERO: Share = { done: 0, total: 0 };

/** A tier's headline, as its bundle page leads with it: documents complete, or provisions encoded. */
function shareOf(counts: TierCounts | undefined, count: Count): Share {
  if (!counts) return ZERO;
  if (count === "documents") {
    return { done: counts.byStatus.complete + counts.byStatus.unvalidated, total: counts.documents };
  }
  return { done: counts.byProvisionState.encoded + counts.byProvisionState.unvalidated, total: counts.provisions };
}

const add = (a: Share, b: Share): Share => ({ done: a.done + b.done, total: a.total + b.total });
const less = (a: Share, b: Share): Share => ({ done: a.done - b.done, total: a.total - b.total });
const ratio = (s: Share) => (s.total ? s.done / s.total : 0);
const percent = (s: Share) => formatShare(s.done, s.total);
/** A bar's width: its share, and at least a sliver when anything is done. */
const width = (s: Share) => `${s.done > 0 ? Math.max(ratio(s) * 100, 1.5) : 0}%`;

/** One share as a bar: encoded in green on a grey track, the exact count beside it. */
function Meter({ share, unit }: { share: Share; unit: string }) {
  return (
    <span className={styles.meter}>
      <span className={styles.track} aria-hidden>
        <span className={styles.fill} style={{ width: width(share) }} />
      </span>
      <strong className={styles.percent}>{percent(share)}</strong>
      <span className={styles.figure}>
        {number(share.done)} of {number(share.total)} {unit}
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
export function BundleOverview({ bundles }: { bundles: BundleSummary[] }) {
  const byId = new Map(bundles.map((b) => [b.id, b]));
  const programTitle = (p: string) =>
    byId.get(`us/${p}`)?.title.replace(/: federal law$/, "") ?? p.toUpperCase();
  // Everything in alphabetical order.
  const alphabetical = <T,>(items: T[], label: (item: T) => string) =>
    [...items].sort((a, b) => label(a).localeCompare(label(b)));
  const programs = alphabetical([...new Set(bundles.map((b) => b.program))], programTitle);
  const jurisdictions = [...new Set(bundles.map((b) => b.jurisdiction).filter((j) => j !== "us"))];
  const [view, setView] = useState<View>("program");
  const [count, setCount] = useState<Count>("documents");
  const [program, setProgram] = useState(programs.includes("snap") ? "snap" : programs[0]);
  const [jurisdiction, setJurisdiction] = useState("us");
  // The tier the left list summarizes.
  const [tier, setTier] = useState<BundleTierId>("screener");
  if (!bundles.length) return null;

  const stateName = (j: string) => {
    const any = bundles.find((b) => b.jurisdiction === j);
    return any ? any.title.replace(new RegExp(` ${programTitle(any.program)}$`), "") : j;
  };
  const unit = (t: BundleTierId) =>
    count === "documents" ? "documents" : t === "screener" ? "cited provisions" : "provisions";
  const verb = count === "documents" ? "complete" : "encoded";
  const link = (id: string) => `/ops/bundles/${id}${count === "provisions" ? "?count=provisions" : ""}`;

  // A bundle's share as its page shows it; a state's own layer is that less the federal law.
  const pageShare = (id: string, t: BundleTierId) => shareOf(byId.get(id)?.counts[t], count);
  const ownShare = (j: string, p: string, t: BundleTierId) =>
    j === "us"
      ? pageShare(`us/${p}`, t)
      : byId.has(`${j}/${p}`)
        ? less(pageShare(`${j}/${p}`, t), pageShare(`us/${p}`, t))
        : ZERO;
  const statesOf = (p: string) => bundles.filter((b) => b.program === p && b.jurisdiction !== "us");

  const groups: Group[] =
    view === "program"
      ? programs.map((p) => ({
          key: p,
          label: programTitle(p),
          share: (t) =>
            statesOf(p).reduce((sum, b) => add(sum, ownShare(b.jurisdiction, p, t)), pageShare(`us/${p}`, t)),
          note: `across the federal law and ${statesOf(p).length} states`,
        }))
      : [
          {
            key: "us",
            label: "Federal law",
            share: (t) => programs.reduce((sum, p) => add(sum, ownShare("us", p, t)), ZERO),
            note: `the federal law of ${programs.length} programs`,
          },
          ...jurisdictions
            .map((j) => ({
              key: j,
              label: stateName(j),
              share: (t: BundleTierId) => programs.reduce((sum, p) => add(sum, ownShare(j, p, t)), ZERO),
              note: `the state's own documents in ${programs.length} programs`,
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
            share: (t: BundleTierId) => pageShare(b.id, t),
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
              ? "Documents complete, as each bundle's page leads with them."
              : "Provisions encoded (Tier 1: the provisions PolicyEngine cites), as each bundle's page counts them."}{" "}
            {view === "program"
              ? "A state's bundle includes the program's federal law."
              : "By state, each jurisdiction counts only its own documents: the federal law has its own row."}
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
                    title={`${g.label}: ${number(whole.done)} of ${number(whole.total)} ${unit(tier)} ${verb}, ${g.note}`}
                  >
                    <span className={styles.programName}>{g.label}</span>
                    <span className={styles.track} aria-hidden>
                      <span className={styles.fill} style={{ width: width(whole) }} />
                    </span>
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
                <th scope="col">Tier 1 · screener parity</th>
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
                    <Meter share={row.share("screener")} unit={unit("screener")} />
                  </td>
                  <td>
                    <Meter share={row.share("full")} unit={unit("full")} />
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
