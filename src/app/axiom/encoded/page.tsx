import Link from "next/link";
import { jurisdictionLabel } from "@/lib/axiom/jurisdictions-seed";
import {
  getRuleSpecRepoLocation,
  ruleSpecRepoTreeUrl,
} from "@/lib/axiom/repo-map";
import {
  listEncodedFiles,
  listRuleSpecJurisdictions,
  type EncodedFile,
} from "@/lib/axiom/rulespec/repo-listing";

export const dynamic = "force-static";
export const revalidate = 600;

interface JurisdictionGroup {
  slug: string;
  label: string;
  /** Display label for the source, e.g. ``rulespec-us/us-ca``. */
  repoLabel: string;
  /** Link to the jurisdiction's directory within its monorepo. */
  repoUrl: string;
  files: EncodedFile[];
}

function labelForSlug(slug: string): string {
  return jurisdictionLabel(slug);
}

async function loadGroups(): Promise<JurisdictionGroup[]> {
  // Discover which jurisdiction directories actually exist in the
  // monorepos, then list each — rather than probing every seed slug.
  const slugs = await listRuleSpecJurisdictions();
  const settled = await Promise.all(
    slugs.map(async (slug) => {
      const location = getRuleSpecRepoLocation(slug);
      const files = await listEncodedFiles(slug);
      return {
        slug,
        label: labelForSlug(slug),
        repoLabel: location
          ? location.prefix
            ? `${location.repo}/${location.prefix}`
            : location.repo
          : slug,
        repoUrl: ruleSpecRepoTreeUrl(slug) ?? "",
        files,
      };
    })
  );
  return settled
    .filter((g) => g.files.length > 0)
    .sort((a, b) => b.files.length - a.files.length);
}

export default async function EncodedRulesIndexPage() {
  const groups = await loadGroups();
  const total = groups.reduce((sum, g) => sum + g.files.length, 0);
  return (
    <div className="px-8 py-10 max-w-[1100px] mx-auto">
      <header className="mb-10">
        <div className="eyebrow mb-3">Encoded rules</div>
        <h1
          className="heading-section text-[var(--color-ink)] m-0"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {total} {total === 1 ? "rule" : "rules"} encoded across{" "}
          {groups.length}{" "}
          {groups.length === 1 ? "jurisdiction" : "jurisdictions"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-secondary)] max-w-[60ch]">
          Every RuleSpec encoding currently checked into a{" "}
          <code className="font-mono text-xs text-[var(--color-accent)]">
            rulespec-*
          </code>{" "}
          repository. This view is fetched directly from GitHub and reflects
          the canonical repo state — independent of the corpus database&apos;s
          encoding flag, which is still being backfilled.
        </p>
      </header>

      {groups.length === 0 ? (
        <div className="py-16 text-center text-[var(--color-ink-muted)]">
          No encodings found in any rulespec-* repo.
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map((g) => (
            <JurisdictionSection key={g.slug} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function JurisdictionSection({ group }: { group: JurisdictionGroup }) {
  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 flex-wrap mb-4 pb-2 border-b border-[var(--color-rule)]">
        <h2
          className="m-0 text-lg text-[var(--color-ink)]"
          style={{ fontFamily: "var(--f-serif)" }}
        >
          {group.label}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono uppercase tracking-wider text-[var(--color-ink-muted)]">
            {group.files.length}{" "}
            {group.files.length === 1 ? "rule" : "rules"}
          </span>
          <a
            href={group.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[var(--color-accent)] no-underline hover:underline"
          >
            {group.repoLabel}
          </a>
        </div>
      </header>
      <ul className="m-0 p-0 list-none divide-y divide-[var(--color-rule-subtle)]">
        {group.files.map((f) => (
          <li key={f.citationPath}>
            <Link
              href={`/encoded/${f.citationPath}`}
              className="flex items-baseline justify-between gap-4 px-2 py-2 no-underline text-[var(--color-ink)] hover:bg-[var(--color-paper-elevated)]"
            >
              <span className="font-mono text-xs break-all">
                {f.citationPath}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)] shrink-0">
                {f.bucket}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
