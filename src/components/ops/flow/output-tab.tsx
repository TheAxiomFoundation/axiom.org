import { OUT_OF_PLAN, UNTAGGED, type AcceptedSeries, type AcceptedWeek, type ModuleLedger, type RouteCounts } from "@/lib/axiom/accepted-modules";
import styles from "./flow.module.css";

const PROGRAM_LABEL: Record<string, string> = {
  [OUT_OF_PLAN]: "Out of plan",
  [UNTAGGED]: "Untagged",
};

const programLabel = (p: string) => PROGRAM_LABEL[p] ?? p.toUpperCase().replace(/_/g, " ");
const n = (v: number) => v.toLocaleString("en-US");
const ZERO: RouteCounts = { pipeline: 0, dispatch: 0, dep: 0, hand: 0 };

/**
 * The /ops "Output" tab: accepted modules per week, by program and route,
 * with rework and the modules not measured beside them. The roadmap's flow
 * model and the monthly ramp report read the same numbers from
 * /api/ops/flow?accepted.
 */
export function OutputTab({ series, ledger, program }: { series: AcceptedSeries; ledger: ModuleLedger; program: string | null }) {
  const chosen = program && series.programs.includes(program) ? program : null;
  const accepted = (w: AcceptedWeek) => (chosen ? (w.programs[chosen] ?? ZERO) : w.total);
  const notMeasured = (w: AcceptedWeek) => (chosen ? (w.not_measured_programs[chosen] ?? ZERO) : w.not_measured);
  const weeks = [...series.weeks].reverse();
  const peak = Math.max(1, ...series.weeks.map((w) => accepted(w).pipeline + accepted(w).hand));
  const modules = ledger.accepted.filter((m) => !chosen || m.programs.includes(chosen)).slice(-25).reverse();
  const href = (p: string | null) => (p ? `/ops?tab=output&program=${encodeURIComponent(p)}` : "/ops?tab=output");

  return (
    <section aria-label="Output">
      <p className={styles.lede}>
        A module counts as accepted when it is merged into its repo&apos;s default branch, compiles in axiom-api&apos;s sweep and passes its tests on main with no active waiver.
        It counts once, in the week of the first merge that made it accepted; later merges of it are rework. A merged module with no compile or test result yet is not measured:
        neither accepted nor failed.
      </p>

      <nav className={styles.seg} aria-label="Program" style={{ marginTop: 16, flexWrap: "wrap" }}>
        {[null, ...series.programs].map((p) =>
          p === chosen ? (
            <span key={p ?? "all"} aria-current="page">
              {p ? programLabel(p) : "All programs"}
            </span>
          ) : (
            <a key={p ?? "all"} href={href(p)}>
              {p ? programLabel(p) : "All programs"}
            </a>
          )
        )}
      </nav>

      <h2 className={styles.sectionTitle}>Accepted modules per week{chosen ? `: ${programLabel(chosen)}` : ""}</h2>
      {weeks.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Accepted</th>
              <th scope="col">Dispatch</th>
              <th scope="col">Dep</th>
              <th scope="col">By hand</th>
              <th scope="col">Rework</th>
              <th scope="col">Not measured</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const a = accepted(w);
              const m = notMeasured(w);
              const total = a.pipeline + a.hand;
              return (
                <tr key={w.week}>
                  <th scope="row">{w.week}</th>
                  <td>
                    <span className={styles.outputBar} aria-hidden>
                      <span data-route="pipeline" style={{ width: `${(a.pipeline / peak) * 100}%` }} />
                      <span data-route="hand" style={{ width: `${(a.hand / peak) * 100}%` }} />
                    </span>
                    <b>{n(total)}</b>
                  </td>
                  <td>{n(a.dispatch)}</td>
                  <td>{n(a.dep)}</td>
                  <td>{n(a.hand)}</td>
                  <td>{chosen ? "–" : n(w.rework.pipeline + w.rework.hand)}</td>
                  <td>{n(m.pipeline + m.hand)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className={styles.note}>No module has been accepted yet.</p>
      )}
      <p className={styles.note}>
        Bars: <span className={styles.outputKey} data-route="pipeline" /> pipeline (dispatch and dep) · <span className={styles.outputKey} data-route="hand" /> merged by hand. Rework counts
        merges of modules already accepted, in all programs.
      </p>

      <h2 className={styles.sectionTitle}>By program, all time</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Program</th>
            <th scope="col">Accepted</th>
            <th scope="col">Dispatch</th>
            <th scope="col">Dep</th>
            <th scope="col">By hand</th>
            <th scope="col">Not measured</th>
          </tr>
        </thead>
        <tbody>
          {series.programs.map((p) => {
            const a = series.totals.programs[p] ?? ZERO;
            const m = series.totals.not_measured_programs[p] ?? ZERO;
            return (
              <tr key={p}>
                <th scope="row">
                  <a href={href(p)}>{programLabel(p)}</a>
                </th>
                <td>
                  <b>{n(a.pipeline + a.hand)}</b>
                </td>
                <td>{n(a.dispatch)}</td>
                <td>{n(a.dep)}</td>
                <td>{n(a.hand)}</td>
                <td>{n(m.pipeline + m.hand)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.note}>A module in several programs&apos; bundles counts in each program, so the rows can add up to more than the total.</p>

      <h2 className={styles.sectionTitle}>Not measured, by repo</h2>
      <p className={styles.note}>
        {Object.entries(series.totals.not_measured_by_repo)
          .sort((a, b) => b[1] - a[1])
          .map(([repo, count]) => `${repo} ${n(count)}`)
          .join(" · ") || "None."}{" "}
        A repo outside the <code>rulespec_files</code> index has no compile result for any of its modules.
      </p>

      <h2 className={styles.sectionTitle}>Latest accepted modules</h2>
      <ul className={styles.items}>
        {modules.map((m) => (
          <li key={m.key}>
            <a href={`/ops/journey?citation=${encodeURIComponent(m.citation)}`}>
              <code>{m.path}</code>
            </a>
            <span>
              {m.week} · {m.sub_route === "hand" ? "by hand" : m.sub_route} · {m.programs.map(programLabel).join(", ")}
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        For the flow model and the monthly report: <a href="/api/ops/flow?accepted">/api/ops/flow?accepted</a> (JSON). The definition is in{" "}
        <code>docs/operations/pipeline-flow.md</code>, &quot;Accepted modules&quot;.
      </p>
    </section>
  );
}
