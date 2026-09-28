/**
 * The app-side half of the index-sync visibility gate.
 *
 * ``discoverRoots()`` refuses a repo whose own ``.axiom/registry.toml``
 * says ``app_visibility = "experimental"``, and that check fails OPEN
 * on purpose: a GitHub hiccup must not blank a live country. The cost
 * of failing open is that ONE unreachable ``raw.githubusercontent.com``
 * request during a six-hourly crawl is enough to index a gated pilot
 * repo — and once its rows are in ``encodings.rulespec_files`` the app's
 * database-backed readers, not the GitHub readers, decide what is
 * served. The drift job runs separately and cannot undo an index write.
 *
 * So the sync applies a second, synchronous gate: a family the app
 * itself registers ``app_visibility = "experimental"`` in
 * ``repo-map.ts`` is never indexed, whatever the marker read returned.
 * No network, so it cannot fail open.
 *
 * This lives here rather than inside ``discoverRoots`` because
 * ``check-rulespec-drift.mjs`` needs discovery to keep yielding exactly
 * the case this drops — a repo that went public upstream while the app
 * still registers it experimental is the drift the job exists to
 * report. Gating discovery itself would make that check unfireable.
 */
import {
  ruleSpecFamilyAppVisibility,
  ruleSpecRepoAppVisibility,
} from "../../src/lib/axiom/repo-map.ts";

/**
 * Whether the app registers this root's repo, or the family its
 * jurisdiction belongs to, as a gated pilot. Both are checked: the
 * repo marker catches ``rulespec-il``, and the family marker also
 * catches a gated family's directory appearing inside some other repo.
 */
export function isAppGatedRoot(root) {
  return (
    ruleSpecRepoAppVisibility(root.repo) === "experimental" ||
    ruleSpecFamilyAppVisibility(root.jurisdiction) === "experimental"
  );
}

/**
 * The roots the index sync may write. ``onSkip(root)`` is called for
 * each refused root so the run log says why a repo went missing —
 * silence here reads as "the repo has no encodings", which is a
 * different and much more alarming thing.
 *
 * A root whose family the repo map does not know at all is KEPT: the
 * index is meant to pick up a new country before anyone edits
 * ``repo-map.ts`` (the ``gh``/``ng`` gap), and ``check-rulespec-drift``
 * reports the missing registration separately.
 */
export function indexableRoots(roots, onSkip) {
  const kept = [];
  for (const root of roots) {
    if (isAppGatedRoot(root)) {
      onSkip?.(root);
      continue;
    }
    kept.push(root);
  }
  return kept;
}
