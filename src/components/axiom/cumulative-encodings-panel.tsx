import growth from "@/data/rulespec-growth.json";

// Cumulative encodings across all rulespec-* repos, by day, split by kind:
// provisions of law (statutes + regulations, one encoding per provision path)
// vs composed policy modules (policies/ — ours, not provision-rooted). The
// public launch slide charts provisions only; this internal panel keeps both
// so the policy-module line can be watched as composition supersedes it.
// Data is git-mined and endpoint-verified (set-equality against live trees,
// mirror repos deduplicated) by scripts/rulespec-growth.py — rerun it to
// refresh; it hard-fails on any drift.

type KindPoint = { date: string; provision: number; policy: number; total: number };

const W = 1080;
const H = 300;
const PAD = { top: 14, right: 210, bottom: 30, left: 8 };

function makeX(x0: number, x1: number) {
  return (date: string) => {
    const t = new Date(`${date}T00:00:00Z`).getTime();
    return PAD.left + ((t - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  };
}

function stepPaths(
  pts: KindPoint[],
  value: (p: KindPoint) => number,
  x: (date: string) => number,
  yMax: number,
): { line: string; area: string } {
  const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
  let d = `M ${x(pts[0].date)} ${y(0)}`;
  let prev = 0;
  for (const p of pts) {
    const px = x(p.date);
    d += ` L ${px} ${y(prev)} L ${px} ${y(value(p))}`;
    prev = value(p);
  }
  d += ` L ${W - PAD.right} ${y(prev)}`;
  return { line: d, area: `${d} L ${W - PAD.right} ${y(0)} Z` };
}

export function CumulativeEncodingsPanel() {
  const data = growth as {
    generated_at: string;
    series_distinct_by_kind: KindPoint[];
    total_today_by_kind: { provision: number; policy: number };
  };
  const series = data.series_distinct_by_kind;
  const last = series[series.length - 1];
  const x0 = new Date(`${series[0].date}T00:00:00Z`).getTime() - 4 * 86400000;
  const x1 = new Date(`${last.date}T00:00:00Z`).getTime();
  const x = makeX(x0, x1);
  const yMax = Math.ceil(last.provision / 500) * 500 + 250;
  const yOf = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);

  const provision = stepPaths(series, (p) => p.provision, x, yMax);
  const policy = stepPaths(series, (p) => p.policy, x, yMax);

  const months: Array<[string, string]> = [
    ["2026-05-01", "May"],
    ["2026-06-01", "Jun"],
    ["2026-07-01", "Jul"],
  ];
  const endX = W - PAD.right;
  const yBase = H - PAD.bottom;

  return (
    <div className="mt-3 border border-[var(--color-rule)] rounded-md bg-[var(--color-paper-elevated)] p-5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Cumulative encodings by day, ${series[0].date} to ${last.date}: ${last.provision.toLocaleString()} provisions of law (statutes and regulations) and ${last.policy.toLocaleString()} composed policy modules.`}
      >
        {months.map(([d, label]) => (
          <g key={d}>
            <line
              x1={x(d)}
              y1={PAD.top}
              x2={x(d)}
              y2={yBase}
              stroke="var(--color-ink)"
              strokeWidth="0.6"
              opacity="0.12"
            />
            <text
              x={x(d)}
              y={H - 10}
              textAnchor="middle"
              fontSize="12"
              fill="var(--color-ink-muted)"
            >
              {label}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          y1={yBase}
          x2={endX}
          y2={yBase}
          stroke="var(--color-ink)"
          strokeWidth="1"
          opacity="0.3"
        />

        <path d={provision.area} fill="var(--color-accent)" opacity="0.12" />
        <path d={provision.line} fill="none" stroke="var(--color-accent)" strokeWidth="2.2" />
        <path
          d={policy.line}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1.4"
          opacity="0.4"
          strokeDasharray="5 4"
        />

        <circle cx={endX} cy={yOf(last.provision)} r="4" fill="var(--color-accent)" />
        <text
          x={endX + 12}
          y={yOf(last.provision) + 5}
          fontSize="16"
          fontWeight="600"
          fill="var(--color-accent)"
        >
          {last.provision.toLocaleString()} provisions
        </text>
        <circle cx={endX} cy={yOf(last.policy)} r="3" fill="var(--color-ink)" opacity="0.45" />
        <text
          x={endX + 12}
          y={yOf(last.policy) + 5}
          fontSize="13"
          fill="var(--color-ink)"
          opacity="0.55"
        >
          {last.policy.toLocaleString()} policy modules
        </text>
      </svg>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        Distinct encodings across all rulespec repos, mirrors deduplicated ·
        provisions = statutes + regulations, one per provision path · policy
        modules = composed by us, not provision-rooted (the public slide counts
        provisions only) · generated {data.generated_at.slice(0, 10)} by
        scripts/rulespec-growth.py, endpoint set-verified against live trees
      </p>
    </div>
  );
}
