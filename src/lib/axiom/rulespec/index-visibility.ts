/**
 * Registered ``app_visibility`` gate for the **database-backed**
 * encoding readers — everything that reads ``encodings.rulespec_files``
 * / ``encodings.rule_citations`` instead of GitHub.
 *
 * ``rulespec/visibility.ts`` gates the *GitHub* readers by resolving a
 * jurisdiction to a repo location and refusing gated repos. The index
 * readers have no location to resolve: they query rows keyed by
 * ``citation_path`` / ``jurisdiction`` and hand back whatever the table
 * holds. So a row for a gated pilot repo — left behind by a sync that
 * ran before the repo was gated, or admitted by a sync whose upstream
 * marker read failed — was searchable and servable even though
 * ``getRuleSpecRepoLocation`` returned ``null`` for the same slug.
 *
 * The gate here is a **deny-list on registered ``experimental``**, not
 * an allow-list on registered ``public``. The allow-list form
 * (``isAppReadableJurisdiction``) is right where a repo location is
 * required, but wrong for index rows: the index deliberately carries
 * jurisdictions that have no ``RULESPEC_FAMILIES`` entry at all, and an
 * allow-list would silently blank them — a bug the discovery side
 * already shipped once (see the ``gh``/``ng`` note on
 * ``isJurisdictionSegment`` in ``scripts/lib/rulespec-discovery.mjs``).
 * Denying exactly the families the app registers as gated is also the
 * shape of the GitHub search gate in ``search.ts::rootsFromRepo``.
 *
 * It fails CLOSED for a registered family: the answer comes from the
 * frozen ``RULESPEC_FAMILIES`` table with no network call, so a GitHub
 * outage, a rate limit, or a stale index row cannot open a pilot repo.
 */
import {
  RULESPEC_FAMILIES,
  ruleSpecFamilyAppVisibility,
} from "@/lib/axiom/repo-map";

/**
 * Country-level slugs whose family the app registers
 * ``app_visibility = "experimental"``.
 */
export const GATED_FAMILY_SLUGS: readonly string[] = Object.freeze(
  RULESPEC_FAMILIES.filter(
    (family) => family.appVisibility === "experimental"
  ).map((family) => family.slug)
);

/**
 * Whether the app registers this jurisdiction's family as a gated
 * pilot. Sub-jurisdictions inherit their family's marker
 * (``il-tlv`` → ``il``); a slug no family claims is NOT gated, which is
 * the deliberate deny-list behaviour documented above.
 */
export function isGatedJurisdiction(
  jurisdiction: string | null | undefined
): boolean {
  if (!jurisdiction) return false;
  return ruleSpecFamilyAppVisibility(jurisdiction) === "experimental";
}

/** The jurisdiction segment of a citation path (``us/statute/26/32`` → ``us``). */
export function jurisdictionOfCitationPath(
  citationPath: string | null | undefined
): string | null {
  if (!citationPath) return null;
  return citationPath.split("/")[0] || null;
}

/** ``isGatedJurisdiction`` for a row identified by its citation path. */
export function isGatedCitationPath(
  citationPath: string | null | undefined
): boolean {
  return isGatedJurisdiction(jurisdictionOfCitationPath(citationPath));
}

/**
 * Drop rows homed in a gated family. ``citationPathOf`` reads whichever
 * column carries the row's home path — ``citation_path`` for index
 * files, ``module_citation_path`` for materialized rule citations.
 */
export function withoutGatedRows<T>(
  rows: readonly T[],
  citationPathOf: (row: T) => string | null | undefined
): T[] {
  return rows.filter((row) => !isGatedCitationPath(citationPathOf(row)));
}

/**
 * A jurisdiction hint set with gated families removed. ``null`` means
 * every hint was gated — the caller has nothing it is allowed to look
 * for and must answer empty rather than widening the query to every
 * jurisdiction.
 */
export function readableJurisdictionHints(
  hints: Iterable<string>
): string[] | null {
  const all = [...hints];
  if (all.length === 0) return [];
  const readable = all.filter((slug) => !isGatedJurisdiction(slug));
  return readable.length > 0 ? readable : null;
}

/** The minimum a PostgREST builder must expose to be narrowed here. */
interface NotFilterable {
  not(column: string, operator: string, value: unknown): this;
}

/**
 * Exclude gated families inside the query, so their rows cannot eat a
 * bounded result window and starve rows the reader may return.
 * Filtering afterwards alone would leave a gated pilot able to push
 * real results out of a ``limit``.
 *
 * Matched on the citation path rather than the ``jurisdiction`` column
 * on purpose: ``citation_path`` is the index's conflict key and so
 * never null, while a ``not.`` predicate on a nullable column also
 * drops the null rows. Two patterns per family cover the country
 * itself (``il/statute/…``) and its sub-jurisdictions (``il-tlv/…``).
 * Always paired with a client-side ``withoutGatedRows`` pass — this is
 * the optimisation, that is the guarantee.
 */
export function excludeGatedRows<B extends NotFilterable>(
  builder: B,
  column = "citation_path"
): B {
  let next = builder;
  for (const slug of GATED_FAMILY_SLUGS) {
    next = next.not(column, "like", `${slug}/%`);
    next = next.not(column, "like", `${slug}-%`);
  }
  return next;
}
