"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatCompact, jurisdictionDisplay } from "./axiom-stats";
import {
  RULESPEC_COUNTRY_SLUGS,
  ruleSpecFamilyAppVisibility,
} from "@/lib/axiom/repo-map";

export type JurisdictionItem = {
  slug: string;
  label: string;
  count: number | null;
};

interface LayoutProps {
  items: JurisdictionItem[];
  onNavigateHref?: (href: string) => void;
}

/**
 * Display overrides for federal-tier slugs so the tab labels read as
 * plain country names rather than the seed's corpus-typed labels
 * ("US Federal" carries useful taxonomic meaning elsewhere on the
 * site but reads as an inconsistent third format next to country names
 * on the landing).
 */
const FEDERAL_COUNTRY_LABEL: Record<string, string> = {
  us: "United States",
  uk: "United Kingdom",
  be: "Belgium",
  ca: "Canada",
  nz: "New Zealand",
  il: "Israel",
};

function federalCountryLabel(item: JurisdictionItem): string {
  return FEDERAL_COUNTRY_LABEL[item.slug] ?? item.label;
}

/**
 * A country the repo map knows whose encodings the app deliberately
 * does not read yet — its ``rulespec-*`` repo carries
 * ``app_visibility = "experimental"``. It gets a real country tile
 * (not an anonymous "Other" chip) that says what is actually true:
 * encoding is under way, nothing is published to the app.
 */
function isPilotCountry(slug: string): boolean {
  return ruleSpecFamilyAppVisibility(slug) === "experimental";
}

/**
 * Why a country tile is showing no rules. Pilot countries are pending
 * *because encoding is in progress*; every other pending country is
 * waiting on corpus ingestion. Saying which is the difference between
 * an honest tile and a dead one.
 */
function pendingTooltip(label: string, slug: string): string {
  return isPilotCountry(slug)
    ? `${label} — pilot encoding in progress, not yet published to the app`
    : `${label} — pending ingestion`;
}

/**
 * Total rule count for a federal jurisdiction = the federal's own
 * rules plus every ingested child. Surfaced on the tab so the tab
 * communicates the country's reach, not just the federal slice (the
 * federal-only count stays on the SelectionPanel's corpus card).
 */
function totalRulesForFederal(
  parent: JurisdictionItem,
  children: JurisdictionItem[]
): number | null {
  const parentCount = parent.count;
  let total = parentCount === null ? 0 : parentCount;
  let anyKnown = parentCount !== null;
  for (const child of children) {
    if (child.count !== null) {
      total += child.count;
      anyKnown = true;
    }
  }
  return anyKnown ? total : null;
}

/**
 * Per-national child slug prefix. Belgium regions/communities and US
 * states/territories are nested under their country tabs; future
 * country families can be added here when ingestion lands. Keeping the
 * lookup explicit avoids the drift the previous layout had, where every
 * federal selection silently inherited the US states list.
 */
const CHILD_PREFIX: Record<string, string> = {
  us: "us-",
  be: "be-",
};

const FEDERAL_ORDER = RULESPEC_COUNTRY_SLUGS;

function partitionItems(items: JurisdictionItem[]) {
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  const federal: JurisdictionItem[] = [];
  for (const slug of FEDERAL_ORDER) {
    const item = bySlug.get(slug);
    if (item) federal.push(item);
  }
  const federalSlugSet = new Set(federal.map((f) => f.slug));
  const childrenByFederal = new Map<string, JurisdictionItem[]>();
  const other: JurisdictionItem[] = [];
  for (const item of items) {
    if (federalSlugSet.has(item.slug)) continue;
    let matchedParent: string | null = null;
    for (const [parent, prefix] of Object.entries(CHILD_PREFIX)) {
      if (item.slug.startsWith(prefix)) {
        matchedParent = parent;
        break;
      }
    }
    if (matchedParent) {
      const list = childrenByFederal.get(matchedParent) ?? [];
      list.push(item);
      childrenByFederal.set(matchedParent, list);
    } else {
      other.push(item);
    }
  }
  return { federal, childrenByFederal, other };
}

function statusFor(count: number | null) {
  if (count === null) return "loading" as const;
  if (count === 0) return "pending" as const;
  return "indexed" as const;
}

/**
 * Tile status for a jurisdiction. A pilot country is pending because
 * the app *registers* it that way, not because a count came back zero:
 * its encodings are deliberately unread, so no stats value — a missing
 * one included — can make it look open.
 *
 * Deriving the state from the count alone lost that whenever the stats
 * RPC failed or timed out. ``getAxiomStats`` resolves ``null`` on
 * error rather than throwing, and a missing landing count is ``null``,
 * which ``statusFor`` reads as "loading": Israel then rendered with a
 * "0 rules total" tooltip instead of the pilot one, and its corpus
 * card became an enabled link to ``/il``.
 */
function statusForCountry(slug: string, count: number | null) {
  return isPilotCountry(slug) ? ("pending" as const) : statusFor(count);
}

/**
 * Hero + scoped chips. The national/federal set acts as a tab
 * selector across the top — picking one scopes the chip wall underneath
 * to that jurisdiction family's sub-jurisdictions. Selecting a country
 * with no children shows an explicit empty state rather than letting the
 * US chip list drift across selections.
 *
 * Each federal tab also exposes an "Open" affordance inside the panel
 * so users can navigate straight into the federal corpus when they
 * want it instead of drilling into a sub-jurisdiction.
 */
export function HeroChips({ items, onNavigateHref }: LayoutProps) {
  const { federal, childrenByFederal, other } = useMemo(
    () => partitionItems(items),
    [items]
  );
  const federalSlugs = useMemo(() => federal.map((f) => f.slug), [federal]);
  // Default to the first federal that has children; fall back to the
  // first present federal otherwise so the selector always lands.
  const initialSelection: string | null = useMemo(() => {
    const withChildren = federalSlugs.find(
      (slug) => (childrenByFederal.get(slug)?.length ?? 0) > 0
    );
    return withChildren ?? federalSlugs[0] ?? null;
  }, [federalSlugs, childrenByFederal]);

  const [selected, setSelected] = useState<string | null>(initialSelection);

  // Keep the selection valid as the federal list hydrates from the
  // stats RPC (initial mount sees an empty seed before counts arrive).
  useEffect(() => {
    if (!selected && initialSelection) {
      setSelected(initialSelection);
      return;
    }
    if (selected && !federalSlugs.includes(selected) && initialSelection) {
      setSelected(initialSelection);
    }
  }, [selected, initialSelection, federalSlugs]);

  const selectedItem = federal.find((f) => f.slug === selected) ?? null;
  const children = selected
    ? (childrenByFederal.get(selected) ?? [])
    : [];
  const childrenAlpha = [...children].sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  return (
    <div className="space-y-8">
      {federal.length > 0 ? (
        <section>
          <div
            role="tablist"
            aria-label="Federal & national jurisdictions"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            {federal.map((item) => {
              const childrenForItem =
                childrenByFederal.get(item.slug) ?? [];
              const total = totalRulesForFederal(item, childrenForItem);
              return (
                <FederalTab
                  key={item.slug}
                  item={item}
                  total={total}
                  active={selected === item.slug}
                  onSelect={() => setSelected(item.slug)}
                />
              );
            })}
          </div>
        </section>
      ) : null}
      {selectedItem ? (
        <SelectionPanel
          parent={selectedItem}
          children={childrenAlpha}
          onNavigateHref={onNavigateHref}
        />
      ) : null}
      {other.length > 0 ? (
        <section>
          <HeroChipsSubheader title="Other" />
          <ul className="m-0 flex flex-wrap list-none gap-2 p-0">
            {other.map((item) => (
              <li key={item.slug}>
                <ChipPill item={item} onNavigateHref={onNavigateHref} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function HeroChipsSubheader({ title }: { title: string }) {
  return (
    <h3 className="mb-4 font-display text-base font-light tracking-tight text-[var(--color-ink)]">
      {title}
    </h3>
  );
}

function FederalTab({
  item,
  total,
  active,
  onSelect,
}: {
  item: JurisdictionItem;
  /** Federal + every ingested child; null while the RPC is loading. */
  total: number | null;
  active: boolean;
  onSelect: () => void;
}) {
  const status = statusForCountry(item.slug, total ?? item.count);
  const isPending = status === "pending";
  const countryLabel = federalCountryLabel(item);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      title={
        isPending
          ? pendingTooltip(countryLabel, item.slug)
          : `${countryLabel} — ${(total ?? 0).toLocaleString()} rules total`
      }
      className={`group flex h-full w-full flex-col items-start gap-3 rounded-md border p-4 text-left transition-all focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2 ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] shadow-sm"
          : "border-[var(--color-rule)] bg-[var(--color-paper-elevated)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-light)]"
      } ${isPending && !active ? "border-dashed" : ""}`}
    >
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="font-display text-lg font-light leading-tight text-[var(--color-ink)]">
          {countryLabel}
        </span>
        <StatusDot status={status} />
      </span>
      <span className="flex items-baseline gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="font-heading text-base tabular-nums text-[var(--color-ink)]">
          {isPending ? "—" : formatCompact(total ?? 0)}
        </span>
        {isPending
          ? isPilotCountry(item.slug)
            ? "pilot · pending"
            : "pending"
          : "rules total"}
      </span>
    </button>
  );
}

function SelectionPanel({
  parent,
  children,
  onNavigateHref,
}: {
  parent: JurisdictionItem;
  children: JurisdictionItem[];
  onNavigateHref?: (href: string) => void;
}) {
  const status = statusForCountry(parent.slug, parent.count);
  const isPending = status === "pending";
  const childLabel =
    parent.slug === "us" ? "states & territories" : "sub-jurisdictions";
  return (
    <section
      aria-live="polite"
      className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] md:gap-6"
    >
      {/* Left: the selected federal's own corpus, rendered as a real
          clickable card so users can navigate straight to its top-level
          tree without drilling into a state first. */}
      <FederalCorpusCard parent={parent} onNavigateHref={onNavigateHref} />
      {/* Right: the children chip wall (US states today, UK regions or
          Canadian provinces once they ingest). Falls back to an inline
          empty state when the selected federal has no children. */}
      <div className="min-w-0 space-y-3">
        {children.length > 0 ? (
          <>
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
              {children.length} {childLabel}
            </div>
            <ul className="m-0 flex flex-wrap list-none gap-2 p-0">
              {children.map((child) => (
                <li key={child.slug}>
                  <ChipPill item={child} onNavigateHref={onNavigateHref} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex h-full items-center rounded-md border border-dashed border-[var(--color-rule)] bg-transparent px-4 py-6 font-body text-sm text-[var(--color-ink-secondary)]">
            {isPending
              ? isPilotCountry(parent.slug)
                ? `${parent.label} is a pilot encoding in progress — nothing is published to the app yet.`
                : `${parent.label} has no indexed rules or ${childLabel} yet.`
              : `No ${childLabel} ingested for ${parent.label}.`}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Hero card representing the selected federal jurisdiction's own
 * corpus. Sits to the left of the children chip wall so the federal's
 * rules are the same kind of "box" target as a sub-jurisdiction chip,
 * not a header treatment that reads as decoration.
 */
function FederalCorpusCard({
  parent,
  onNavigateHref,
}: {
  parent: JurisdictionItem;
  onNavigateHref?: (href: string) => void;
}) {
  const status = statusForCountry(parent.slug, parent.count);
  const isPending = status === "pending";
  const href = `/${parent.slug}`;
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent)]">
          {jurisdictionDisplay(parent.slug)}
        </span>
        <StatusDot status={status} />
      </div>
      <div className="mt-3 font-display text-lg font-light leading-tight text-[var(--color-ink)]">
        {parent.label}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5 border-t border-[var(--color-rule)] pt-3">
        <span className="font-heading text-2xl tabular-nums text-[var(--color-ink)]">
          {isPending ? "—" : formatCompact(parent.count ?? 0)}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
          {isPending ? "pending" : "rules"}
        </span>
      </div>
      {!isPending && (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)] opacity-0 transition-opacity group-hover:opacity-100">
          Open ›
        </div>
      )}
    </>
  );
  if (isPending) {
    return (
      <div
        aria-disabled="true"
        title={pendingTooltip(parent.label, parent.slug)}
        className="rounded-md border border-dashed border-[var(--color-rule)] bg-transparent p-5 opacity-70"
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (!onNavigateHref) return;
        event.preventDefault();
        onNavigateHref(href);
      }}
      title={`${parent.label} — ${(parent.count ?? 0).toLocaleString()} rules`}
      className="group block self-start rounded-md border border-[var(--color-rule)] bg-[var(--color-paper-elevated)] p-5 !no-underline transition-all hover:-translate-y-px hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-light)] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2"
    >
      {body}
    </Link>
  );
}

function ChipPill({
  item,
  onNavigateHref,
}: {
  item: JurisdictionItem;
  onNavigateHref?: (href: string) => void;
}) {
  // Sub-jurisdiction chips take the same registered gate, so a pilot
  // family's child slug can never render as an open link either.
  const isPending = statusForCountry(item.slug, item.count) === "pending";
  const inner = (
    <>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)]">
        {jurisdictionDisplay(item.slug)}
      </span>
      <span className="text-[var(--color-ink)]">{item.label}</span>
      {!isPending && (
        <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
          {formatCompact(item.count ?? 0)}
        </span>
      )}
    </>
  );
  const className =
    "inline-flex items-baseline gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors";
  if (isPending) {
    return (
      <span
        aria-disabled="true"
        className={`${className} border-dashed border-[var(--color-rule)] bg-transparent opacity-50`}
      >
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={`/${item.slug}`}
      onClick={(event) => {
        if (!onNavigateHref) return;
        event.preventDefault();
        onNavigateHref(`/${item.slug}`);
      }}
      title={`${item.label} — ${(item.count ?? 0).toLocaleString()} rules`}
      className={`${className} border-[var(--color-rule)] bg-[var(--color-paper-elevated)] !no-underline hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-light)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2`}
    >
      {inner}
    </Link>
  );
}

function StatusDot({
  status,
}: {
  status: "indexed" | "pending" | "loading";
}) {
  const cls =
    status === "indexed"
      ? "bg-[var(--color-success)]"
      : status === "pending"
        ? "bg-[var(--color-rule-strong)]"
        : "bg-[var(--color-rule)]";
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 rounded-full transition-colors ${cls}`}
    />
  );
}
