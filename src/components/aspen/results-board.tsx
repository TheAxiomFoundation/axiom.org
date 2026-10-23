import { ifEligibleSentence, type Count, type RunSummary, type ScaleSummary } from "@/lib/aspen/results";
import { MINIMUM_BENEFIT, SOURCE_OF_TRUTH } from "@/lib/aspen/content";
import { formatValue } from "./client";
import { Bars, BlockHeading, Card, Part, Prompt, Stat } from "./ui";

/** The room's results: counts, the framed reveal and the scale averages. */

const VERDICT_TONE: Record<string, string> = {
  right: "text-[var(--color-success)]",
  unsure: "text-[var(--color-ink-muted)]",
  wrong: "text-[var(--color-error)]",
};

const VERDICT_LABEL: Record<string, string> = {
  right: "Looks right",
  unsure: "Not sure",
  wrong: "Looks wrong",
};

export function ResultsCounts({ summary }: { summary: RunSummary }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Stat value={summary.participants} label="people" />
      <Stat value={summary.prompts} label="questions" />
      <Stat value={summary.rated} label="answers rated" />
    </div>
  );
}

const any = (items: Count[]) => items.some((i) => i.count > 0);

/** The room's average score per category on one 1–5 scale. */
export function ScaleCard({ scale }: { scale: ScaleSummary }) {
  return (
    <Card className="flex flex-col gap-3">
      <Prompt>{scale.label}</Prompt>
      <div className="flex justify-between font-body font-medium text-[0.95rem] text-[var(--color-ink-muted)]">
        <span>1 · {scale.low}</span>
        <span>{scale.high} · 5</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {scale.categories.map((c) => (
          <li key={c.id} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_3.5rem]">
            {/* Labels wrap rather than truncate, so long ones ("Showed where the answer came from") read in full. */}
            <span className="font-body text-[1rem] leading-snug text-[var(--color-ink)]" title={c.label}>
              {c.label}
            </span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
              {c.average !== null && (
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent)] transition-[width] duration-500"
                  style={{ width: `${(c.average / 5) * 100}%` }}
                />
              )}
            </span>
            <span className="text-right font-mono text-[0.95rem] tabular-nums text-[var(--color-ink-secondary)]">
              {c.average !== null ? c.average.toFixed(1) : "—"}
              <span className="ml-1 text-[0.95rem] text-[var(--color-ink-muted)]">({c.count})</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Can anyone check an answer against the state's official rules today? */
export function SourceOfTruthCard({ counts }: { counts: Count[] }) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const no = counts.find((c) => c.id === "no")?.count ?? 0;
  const partly = counts.find((c) => c.id === "partly")?.count ?? 0;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <PanelLabel>{SOURCE_OF_TRUTH.title}</PanelLabel>
      <p className="m-0 font-display text-[1.3rem] font-light leading-snug text-[var(--color-ink)]">
        <strong className="font-normal tabular-nums">{no + partly}</strong> of{" "}
        <strong className="font-normal tabular-nums">{total}</strong>{" "}
        said a resident, a screener or an AI can&apos;t fully check an answer against their state&apos;s official
        rules today.
      </p>
      <SplitBar
        parts={counts.map((c) => ({
          label: c.label,
          count: c.count,
          color: { yes: GOOD, partly: MAYBE, no: BAD }[c.id] ?? MAYBE,
        }))}
      />
    </Card>
  );
}

/** Heads the room's results, after what this person contributed. */
function RoomHeading() {
  return <BlockHeading>Across the room</BlockHeading>;
}

/** A label inside a results panel: bold, so each panel says what it shows. */
function PanelLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`block font-body text-[1.08rem] font-semibold text-[var(--color-ink)] ${className ?? ""}`}>{children}</span>;
}

/** A single bar split into parts, with a legend underneath. */
export function SplitBar({ parts }: { parts: { label: string; count: number; color: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.count, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
        {parts.map((p) =>
          p.count > 0 ? (
            <span
              key={p.label}
              className="h-full transition-[width] duration-500"
              style={{ width: `${(100 * p.count) / Math.max(1, total)}%`, background: p.color }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-[0.95rem] text-[var(--color-ink-secondary)]">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="tabular-nums text-[var(--color-ink)]">{p.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const GOOD = "var(--color-success)";
export const BAD = "var(--color-error)";
export const MAYBE = "var(--color-rule-strong)";

function ViabilityPanel({ summary }: { summary: RunSummary }) {
  const v = summary.viability;
  const act = v.wouldAct + v.maybe;
  const ifEligible = ifEligibleSentence(v, "of those");
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="flex flex-col gap-5 p-5">
        <p className="m-0 font-display text-[1.6rem] font-light leading-snug text-[var(--color-ink)]">
          <strong className="font-normal tabular-nums">{v.right}</strong> of{" "}
          <strong className="font-normal tabular-nums">{v.rated}</strong> answers looked right. People would act on{" "}
          <strong className="font-normal tabular-nums">{act}</strong>.
        </p>
        <div>
          <Prompt className="mb-2">Did the answer look right?</Prompt>
          <SplitBar
            parts={[
              { label: "Looks right", count: v.right, color: GOOD },
              { label: "Not sure", count: v.unsure, color: MAYBE },
              { label: "Looks wrong", count: v.wrong, color: BAD },
            ]}
          />
        </div>
        <div>
          <Prompt className="mb-2">Would you act on it?</Prompt>
          <SplitBar
            parts={[
              { label: "Yes", count: v.wouldAct, color: "var(--color-ink)" },
              { label: "Maybe", count: v.maybe, color: MAYBE },
              { label: "No", count: v.wouldNot, color: "var(--color-rule)" },
            ]}
          />
        </div>
        {any(v.residentActions) && (
          <div>
            <Prompt className="mb-2">What would a resident do next?</Prompt>
            <SplitBar
              parts={v.residentActions.map((a) => ({
                label: a.label,
                count: a.count,
                color: { apply: GOOD, "not-apply": BAD, call: "var(--color-ink-secondary)", unsure: MAYBE }[a.id] ?? MAYBE,
              }))}
            />
          </div>
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card className={`flex flex-col gap-2 p-5 ${v.convincing > 0 ? "border-l-4 border-l-[var(--color-error)]" : ""}`}>
          <PanelLabel className={v.convincing > 0 ? "text-[var(--color-error)]" : undefined}>Wrong but convincing</PanelLabel>
          <span className="font-display text-[3rem] font-light leading-none tabular-nums text-[var(--color-ink)]">{v.convincing}</span>
          <p className="m-0 font-body text-[1.02rem] leading-relaxed text-[var(--color-ink-secondary)]">
            answers looked wrong or unsure, yet people would still act on them.
          </p>
        </Card>
        {any(v.residentActions) && (
          <Card className={`flex flex-col gap-2 p-5 ${v.wouldNotApply > 0 ? "border-l-4 border-l-[var(--color-error)]" : ""}`}>
            <PanelLabel className={v.wouldNotApply > 0 ? "text-[var(--color-error)]" : undefined}>Would not apply</PanelLabel>
            <span className="font-display text-[3rem] font-light leading-none tabular-nums text-[var(--color-ink)]">
              {v.wouldNotApply}
            </span>
            <p className="m-0 font-body text-[1.02rem] leading-relaxed text-[var(--color-ink-secondary)]">
              {v.wouldNotApply === 1 ? "answer" : "answers"} would lead a resident not to apply.
              {v.wouldNotApplyEligible > 0 &&
                ` ${v.wouldNotApplyEligible} of those households ${v.wouldNotApplyEligible === 1 ? "qualifies" : "qualify"} under the encoded rules.`}
              {ifEligible && ` ${ifEligible}`}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function BreakdownPanel({ summary }: { summary: RunSummary }) {
  const rows = summary.breakdown.filter((r) => r.rated > 0).slice(0, 8);
  const tagged = any(summary.wentWrong);
  const misread = any(summary.discussion.topics);
  return (
    <div className={`grid gap-4 ${tagged || misread ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}>
      <Card className="p-5">
        <PanelLabel className="mb-3">Share of answers that looked wrong</PanelLabel>
        {rows.length === 0 ? (
          <p className="m-0 font-body text-[1rem] text-[var(--color-ink-muted)]">Appears once answers are rated.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {rows.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4.5rem] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem]">
                <span className="truncate font-body text-[1rem] text-[var(--color-ink)]" title={r.label}>
                  {r.label}
                </span>
                <span className="flex h-2.5 overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
                  <span className="h-full" style={{ width: `${(100 * r.wrong) / r.rated}%`, background: BAD }} />
                  <span className="h-full" style={{ width: `${(100 * r.unsure) / r.rated}%`, background: MAYBE }} />
                </span>
                <span className="text-right font-mono text-[0.95rem] tabular-nums text-[var(--color-ink-secondary)]">
                  {r.wrong} of {r.rated}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {(tagged || misread) && (
        <div className="flex flex-col gap-4">
          {tagged && (
            <Card className="p-5">
              <PanelLabel className="mb-3">What went wrong</PanelLabel>
              <Bars items={summary.wentWrong} tone="bad" limit={6} />
            </Card>
          )}
          {misread && (
            <Card className="p-5">
              <PanelLabel className="mb-3">Rules the room says people misread</PanelLabel>
              <Bars items={summary.discussion.topics} limit={6} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

const REASON_LABEL: Record<string, string> = {
  convincing: "Wrong but convincing",
  "checked-wrong": "Wrong against the rules",
  wrong: "Looked wrong",
  unsure: "Not sure",
};

const WOULD_ACT_LABEL: Record<string, string> = { yes: "Would act on it", maybe: "Might act on it", no: "Would not act on it" };

function SpotlightList({ summary }: { summary: RunSummary }) {
  return (
    <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-2">
      {summary.spotlight.map((item) => (
        <li key={item.id}>
          <Card className="flex h-full flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 font-body font-medium text-[0.95rem] ${
                  item.reason === "unsure" ? "bg-[var(--color-rule-subtle)] text-[var(--color-ink-secondary)]" : "bg-[var(--color-error)] text-white"
                }`}
              >
                {REASON_LABEL[item.reason]}
              </span>
              <span className="font-body font-medium text-[0.95rem] text-[var(--color-ink-muted)]">
                {[item.household ?? "Own question", item.perspective].filter(Boolean).join(" · ")}
              </span>
            </div>
            {item.details.length > 0 && (
              <p className="m-0 font-body text-[0.95rem] text-[var(--color-ink-muted)]">With: {item.details.join(", ")}</p>
            )}
            <p className="m-0 font-body text-[1.02rem] font-medium leading-snug text-[var(--color-ink)]">{item.prompt}</p>
            {item.answer && (
              <p className="m-0 border-l-2 border-[var(--color-rule)] pl-3 font-body text-[1rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {item.answer}
              </p>
            )}
            <div className="mt-auto flex flex-col gap-1.5 pt-1">
              <span className="font-body text-[0.98rem]">
                <span className={VERDICT_TONE[item.verdict ?? ""] ?? ""}>{VERDICT_LABEL[item.verdict ?? ""] ?? "Not rated"}</span>
                {item.wouldAct && <span className="text-[var(--color-ink-secondary)]"> · {WOULD_ACT_LABEL[item.wouldAct] ?? item.wouldAct}</span>}
                {item.rulesAmount !== null && (
                  <span className="text-[var(--color-ink-secondary)]">
                    {" "}
                    · The rules say <strong className="text-[var(--color-accent)]">{formatValue(item.rulesAmount, "USD")}</strong>
                    {item.rulesIfEligible && " if eligible"}
                  </span>
                )}
              </span>
              {/* A saved check from rules that don't test eligibility (Arizona's) shows FY2026's $24 minimum; say so beside it. */}
              {item.rulesAmount === MINIMUM_BENEFIT.fy2026 && item.rulesIfEligible && (
                <p className="m-0 font-body text-[0.8rem] leading-relaxed text-[var(--color-ink-secondary)]">
                  ${MINIMUM_BENEFIT.fy2026} is the FY2026 minimum benefit. It rose to ${MINIMUM_BENEFIT.fy2027} on {MINIMUM_BENEFIT.effective}.
                </p>
              )}
              {item.wentWrong.length > 0 && (
                <span className="font-body text-[0.95rem] text-[var(--color-error)]">{item.wentWrong.join(" · ")}</span>
              )}
              {item.note && <q className="font-serif text-[1.05rem] italic text-[var(--color-ink)]">{item.note}</q>}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reveal, framed for discussion: could residents act on the answers,
 * where did they break down, which ones to talk about, how it felt, and
 * what people said.
 */
export function ResultsBoard({ summary }: { summary: RunSummary }) {
  const scales = summary.discussion.scales.filter((sc) => sc.categories.some((c) => c.count > 0));
  if (summary.rated === 0 && scales.length === 0 && !any(summary.sourceOfTruth)) {
    return (
      <div className="flex flex-col gap-5">
        <RoomHeading />
        <ResultsCounts summary={summary} />
        <p className="m-0 font-body text-[1.02rem] text-[var(--color-ink-muted)]">Answers appear here as people ask.</p>
      </div>
    );
  }
  // Parts number in the order they show; a part with nothing to show yet is skipped.
  const shown = [
    summary.rated > 0,
    summary.rated > 0,
    summary.spotlight.length > 0,
    scales.length > 0 || any(summary.wentWell) || any(summary.sourceOfTruth),
    summary.voices.length > 0,
  ];
  const n = (i: number) => shown.slice(0, i + 1).filter(Boolean).length;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <RoomHeading />
        <ResultsCounts summary={summary} />
      </div>
      {summary.rated > 0 && (
        <Part n={n(0)} title="Could a resident act on these answers?">
          <ViabilityPanel summary={summary} />
        </Part>
      )}
      {summary.rated > 0 && (
        <Part n={n(1)} title="Where the answers broke down">
          <BreakdownPanel summary={summary} />
        </Part>
      )}
      {summary.spotlight.length > 0 && (
        <Part n={n(2)} title="Answers worth discussing">
          <SpotlightList summary={summary} />
        </Part>
      )}
      {(scales.length > 0 || any(summary.wentWell) || any(summary.sourceOfTruth)) && (
        <Part n={n(3)} title="How it felt">
          <div className="grid gap-4 lg:grid-cols-2">
            {scales.map((sc) => (
              <ScaleCard key={sc.question} scale={sc} />
            ))}
            {any(summary.sourceOfTruth) && <SourceOfTruthCard counts={summary.sourceOfTruth} />}
            {any(summary.wentWell) && (
              <Card className="p-5">
                <PanelLabel className="mb-3">What went well</PanelLabel>
                <Bars items={summary.wentWell} tone="good" limit={5} />
              </Card>
            )}
          </div>
        </Part>
      )}
      {summary.voices.length > 0 && (
        <Part n={n(4)} title="In their words">
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {summary.voices.map((v, i) => (
              <li
                key={`${i}-${v.text}`}
                className={`rounded-lg border-l-2 bg-[var(--color-paper-elevated)] px-4 py-3 ${
                  v.verdict === "wrong" ? "border-[var(--color-error)]" : v.verdict === "right" ? "border-[var(--color-success)]" : "border-[var(--color-rule-strong)]"
                }`}
              >
                <q className="font-serif text-[1.08rem] italic leading-relaxed text-[var(--color-ink)]">{v.text}</q>
              </li>
            ))}
          </ul>
        </Part>
      )}
    </div>
  );
}
