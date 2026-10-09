import type { Count, RunSummary, ScaleSummary } from "@/lib/aspen/results";
import { SOURCE_OF_TRUTH } from "@/lib/aspen/content";
import { formatValue } from "./client";
import { Bars, Card, Eyebrow, Stat } from "./ui";

/** The room's results: counts, the framed reveal, the scale averages and the live question feed. */

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
      <Eyebrow>{scale.label}</Eyebrow>
      <div className="flex justify-between font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
        <span>1 · {scale.low}</span>
        <span>{scale.high} · 5</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {scale.categories.map((c) => (
          <li key={c.id} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3.5rem]">
            <span className="truncate font-body text-[0.88rem] text-[var(--color-ink)]" title={c.label}>
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
            <span className="text-right font-mono text-[0.8rem] tabular-nums text-[var(--color-ink-secondary)]">
              {c.average !== null ? c.average.toFixed(1) : "—"}
              <span className="ml-1 text-[0.66rem] text-[var(--color-ink-muted)]">({c.count})</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The room's results; a card appears once it has something to show. */
/** Before tonight: can anyone check an answer against the state's official rules? */
export function SourceOfTruthCard({ counts }: { counts: Count[] }) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const no = counts.find((c) => c.id === "no")?.count ?? 0;
  const partly = counts.find((c) => c.id === "partly")?.count ?? 0;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <Eyebrow>{SOURCE_OF_TRUTH.title}</Eyebrow>
      <p className="m-0 font-display text-[1.3rem] font-light leading-snug text-[var(--color-ink)]">
        <strong className="font-normal tabular-nums">{no + partly}</strong> of{" "}
        <strong className="font-normal tabular-nums">{total}</strong> said a resident, a screener or an AI can&apos;t
        fully check an answer against their state&apos;s official rules today.
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

/** One framed part of the reveal: a heading and the question it puts to the room. */
function Section({ title, prompt, children }: { title: string; prompt?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="heading-sub m-0">{title}</h2>
        {prompt && (
          <p className="m-0 mt-1.5 font-body text-[0.95rem] text-[var(--color-ink-secondary)]">
            <span className="mr-2 font-mono text-[0.6rem] uppercase tracking-[0.16em] text-[var(--color-accent)]">Ask the room</span>
            {prompt}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/** A single bar split into parts, with a legend underneath. */
function SplitBar({ parts }: { parts: { label: string; count: number; color: string }[] }) {
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-body text-[0.82rem] text-[var(--color-ink-secondary)]">
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

const GOOD = "var(--color-success)";
const BAD = "var(--color-error)";
const MAYBE = "var(--color-rule-strong)";

function ViabilityPanel({ summary }: { summary: RunSummary }) {
  const v = summary.viability;
  const act = v.wouldAct + v.maybe;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="flex flex-col gap-5 p-5">
        <p className="m-0 font-display text-[1.5rem] font-light leading-snug text-[var(--color-ink)]">
          <strong className="font-normal tabular-nums">{v.right}</strong> of{" "}
          <strong className="font-normal tabular-nums">{v.rated}</strong> answers looked right. People would act on{" "}
          <strong className="font-normal tabular-nums">{act}</strong>.
        </p>
        <div>
          <Eyebrow className="mb-2">Did the answer look right?</Eyebrow>
          <SplitBar
            parts={[
              { label: "Looks right", count: v.right, color: GOOD },
              { label: "Not sure", count: v.unsure, color: MAYBE },
              { label: "Looks wrong", count: v.wrong, color: BAD },
            ]}
          />
        </div>
        <div>
          <Eyebrow className="mb-2">Would you act on it?</Eyebrow>
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
            <Eyebrow className="mb-2">What would a resident do next?</Eyebrow>
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
          <Eyebrow className={v.convincing > 0 ? "text-[var(--color-error)]" : undefined}>Wrong but convincing</Eyebrow>
          <span className="font-display text-[3rem] font-light leading-none tabular-nums text-[var(--color-ink)]">{v.convincing}</span>
          <p className="m-0 font-body text-[0.92rem] leading-relaxed text-[var(--color-ink-secondary)]">
            answers looked wrong or unsure, yet people would still act on them. These are the answers that send a
            resident the wrong way.
          </p>
        </Card>
        {any(v.residentActions) && (
          <Card className={`flex flex-col gap-2 p-5 ${v.wouldNotApply > 0 ? "border-l-4 border-l-[var(--color-error)]" : ""}`}>
            <Eyebrow className={v.wouldNotApply > 0 ? "text-[var(--color-error)]" : undefined}>Would not apply</Eyebrow>
            <span className="font-display text-[3rem] font-light leading-none tabular-nums text-[var(--color-ink)]">
              {v.wouldNotApply}
            </span>
            <p className="m-0 font-body text-[0.92rem] leading-relaxed text-[var(--color-ink-secondary)]">
              answers would lead a resident not to apply.
              {v.wouldNotApplyEligible > 0 &&
                ` ${v.wouldNotApplyEligible} of those households qualify under the encoded rules.`}
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
        <Eyebrow className="mb-3">Share of answers that looked wrong</Eyebrow>
        {rows.length === 0 ? (
          <p className="m-0 font-body text-[0.88rem] text-[var(--color-ink-muted)]">Appears once answers are rated.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {rows.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4.5rem] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem]">
                <span className="truncate font-body text-[0.88rem] text-[var(--color-ink)]" title={r.label}>
                  {r.label}
                </span>
                <span className="flex h-2.5 overflow-hidden rounded-full bg-[var(--color-rule-subtle)]">
                  <span className="h-full" style={{ width: `${(100 * r.wrong) / r.rated}%`, background: BAD }} />
                  <span className="h-full" style={{ width: `${(100 * r.unsure) / r.rated}%`, background: MAYBE }} />
                </span>
                <span className="text-right font-mono text-[0.78rem] tabular-nums text-[var(--color-ink-secondary)]">
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
              <Eyebrow className="mb-3">What went wrong</Eyebrow>
              <Bars items={summary.wentWrong} tone="bad" limit={6} />
            </Card>
          )}
          {misread && (
            <Card className="p-5">
              <Eyebrow className="mb-3">Rules the room says people misread</Eyebrow>
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
                className={`rounded-full px-2.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] ${
                  item.reason === "unsure" ? "bg-[var(--color-rule-subtle)] text-[var(--color-ink-secondary)]" : "bg-[var(--color-error)] text-white"
                }`}
              >
                {REASON_LABEL[item.reason]}
              </span>
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">
                {[item.household ?? "Own question", item.perspective].filter(Boolean).join(" · ")}
              </span>
            </div>
            {item.details.length > 0 && (
              <p className="m-0 font-body text-[0.8rem] text-[var(--color-ink-muted)]">With: {item.details.join(", ")}</p>
            )}
            <p className="m-0 font-body text-[0.92rem] font-medium leading-snug text-[var(--color-ink)]">{item.prompt}</p>
            {item.answer && (
              <p className="m-0 border-l-2 border-[var(--color-rule)] pl-3 font-body text-[0.86rem] leading-relaxed text-[var(--color-ink-secondary)]">
                {item.answer}
              </p>
            )}
            <div className="mt-auto flex flex-col gap-1.5 pt-1">
              <span className="font-body text-[0.84rem]">
                <span className={VERDICT_TONE[item.verdict ?? ""] ?? ""}>{VERDICT_LABEL[item.verdict ?? ""] ?? "Not rated"}</span>
                {item.wouldAct && <span className="text-[var(--color-ink-secondary)]"> · {WOULD_ACT_LABEL[item.wouldAct] ?? item.wouldAct}</span>}
                {item.rulesAmount !== null && (
                  <span className="text-[var(--color-ink-secondary)]">
                    {" "}
                    · The rules say <strong className="text-[var(--color-accent)]">{formatValue(item.rulesAmount, "USD")}</strong>
                  </span>
                )}
              </span>
              {item.wentWrong.length > 0 && (
                <span className="font-body text-[0.8rem] text-[var(--color-error)]">{item.wentWrong.join(" · ")}</span>
              )}
              {item.note && <q className="font-serif text-[0.95rem] italic text-[var(--color-ink)]">{item.note}</q>}
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
export function ResultsBoard({ summary, wide = false }: { summary: RunSummary; wide?: boolean }) {
  const scales = summary.discussion.scales.filter((sc) => sc.categories.some((c) => c.count > 0));
  if (summary.rated === 0 && scales.length === 0 && !any(summary.sourceOfTruth)) {
    return (
      <div className="flex flex-col gap-5">
        <ResultsCounts summary={summary} />
        <p className="m-0 font-body text-[0.92rem] text-[var(--color-ink-muted)]">Answers appear here as people ask.</p>
      </div>
    );
  }
  return (
    <div className={`flex flex-col ${wide ? "gap-10" : "gap-12"}`}>
      <ResultsCounts summary={summary} />
      {summary.rated > 0 && (
        <Section title="Could a resident act on these answers?" prompt="Would you let a resident act on what they got?">
          <ViabilityPanel summary={summary} />
        </Section>
      )}
      {summary.rated > 0 && (
        <Section title="Where the answers broke down" prompt="Which situations broke it, and why those?">
          <BreakdownPanel summary={summary} />
        </Section>
      )}
      {summary.spotlight.length > 0 && (
        <Section title="Answers worth discussing" prompt="What would a resident do next with this answer?">
          <SpotlightList summary={summary} />
        </Section>
      )}
      {(scales.length > 0 || any(summary.wentWell) || any(summary.sourceOfTruth)) && (
        <Section title="How it felt" prompt="Does this match what your agency sees, with residents and with staff?">
          <div className="grid gap-4 lg:grid-cols-2">
            {scales.map((sc) => (
              <ScaleCard key={sc.question} scale={sc} />
            ))}
            {any(summary.sourceOfTruth) && <SourceOfTruthCard counts={summary.sourceOfTruth} />}
            {any(summary.wentWell) && (
              <Card className="p-5">
                <Eyebrow className="mb-3">What went well</Eyebrow>
                <Bars items={summary.wentWell} tone="good" limit={5} />
              </Card>
            )}
          </div>
        </Section>
      )}
      {summary.voices.length > 0 && (
        <Section title="In their words">
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {summary.voices.map((v, i) => (
              <li
                key={`${i}-${v.text}`}
                className={`rounded-lg border-l-2 bg-[var(--color-paper-elevated)] px-4 py-3 ${
                  v.verdict === "wrong" ? "border-[var(--color-error)]" : v.verdict === "right" ? "border-[var(--color-success)]" : "border-[var(--color-rule-strong)]"
                }`}
              >
                <q className="font-serif text-[1rem] italic leading-relaxed text-[var(--color-ink)]">{v.text}</q>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function AnswerFeed({ summary, limit = 8 }: { summary: RunSummary; limit?: number }) {
  if (summary.feed.length === 0) {
    return (
      <p className="m-0 font-body text-[0.92rem] text-[var(--color-ink-muted)]">
        Answers appear here as people ask.
      </p>
    );
  }
  return (
    <div>
      <Eyebrow className="mb-3">Latest answers</Eyebrow>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {summary.feed.slice(0, limit).map((item) => (
          <li key={item.id}>
            <Card className="flex h-full flex-col gap-2">
              <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                {[item.perspective, item.household].filter(Boolean).join(" · ") || "Question"}
              </span>
              <p className="m-0 font-body text-[0.9rem] font-medium leading-snug text-[var(--color-ink)]">
                {item.prompt}
              </p>
              {item.answer && (
                <p className="m-0 font-body text-[0.85rem] leading-relaxed text-[var(--color-ink-secondary)]">
                  {item.answer}
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 font-body text-[0.8rem]">
                {item.verdict && (
                  <span className={VERDICT_TONE[item.verdict] ?? ""}>{VERDICT_LABEL[item.verdict] ?? item.verdict}</span>
                )}
                {item.rulesAmount !== null && (
                  <span className="text-[var(--color-ink-secondary)]">
                    The rules say{" "}
                    <strong className="text-[var(--color-accent)]">{formatValue(item.rulesAmount, "USD")}</strong>
                  </span>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
