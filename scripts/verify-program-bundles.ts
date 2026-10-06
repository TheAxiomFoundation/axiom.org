#!/usr/bin/env bun
/**
 * Check every number and share the bundle pages and the /ops overview show,
 * recomputed from the document rows of a collector dry run:
 *
 *   bun scripts/collect-program-bundles.mjs --out /tmp/bundles.json
 *   bun scripts/verify-program-bundles.ts /tmp/bundles.json
 *
 * It checks that each tier's header equals the stored counts, that states and
 * statuses add up to the totals, that the matrix cells add up to the header,
 * that Tier 2 never shows fewer provisions, encoded provisions or complete
 * documents than Tier 1, that each program's completeness counts every
 * document once, and that shares never round into a wrong impression. It
 * exits 1 on any failure.
 */
import { readFileSync } from "node:fs";
import {
  formatShare,
  measuredByPart,
  tierCounts,
  type BundleDocumentRow,
  type BundleRow,
} from "../src/lib/axiom/program-bundles";
const data = JSON.parse(readFileSync(process.argv[2], "utf8")) as { bundles: BundleRow[]; documents: BundleDocumentRow[] };
const rowsOf = new Map<string, BundleDocumentRow[]>();
for (const d of data.documents) rowsOf.set(d.bundle_id, [...(rowsOf.get(d.bundle_id) ?? []), d]);
const done = (c: { byProvisionState: Record<string, number> }) => c.byProvisionState.encoded + c.byProvisionState.unvalidated;
const fail: string[] = [];
let checks = 0;
const check = (ok: boolean, what: string) => { checks++; if (!ok && fail.length < 15) fail.push(what); if (!ok) failures++; };
let failures = 0;
for (const b of data.bundles) {
  const [j, p] = b.id.split("/");
  const rows = j === "us" ? (rowsOf.get(b.id) ?? []) : [...(rowsOf.get(`us/${p}`) ?? []), ...(rowsOf.get(b.id) ?? [])];
  for (const tier of ["screener", "full"] as const) {
    const inScope = rows.filter((r) => r.tier === tier && r.scope === "in");
    const page = tierCounts(rows.filter((r) => r.tier === tier));
    // 1. The header (computed on the page) equals the stored counts (the overview and snapshots).
    check(JSON.stringify(page) === JSON.stringify(b.counts?.[tier]), `header vs stored ${b.id} ${tier}`);
    // 2. Provisions by state add up to the total, missing included.
    const states = Object.values(page.byProvisionState).reduce((a, n) => a + n, 0);
    const missing = inScope.reduce((a, r) => a + [...measuredByPart(r).values()].reduce((x, m) => x + m.missing, 0), 0);
    check(states + missing === page.provisions, `states+missing ${states}+${missing} vs ${page.provisions} ${b.id} ${tier}`);
    // 3. Documents by status add up to the documents.
    check(Object.values(page.byStatus).reduce((a, n) => a + n, 0) === page.documents, `statuses vs documents ${b.id} ${tier}`);
    // 4. The matrix cells (provisions) add up to the header, total and done.
    let cellsTotal = 0, cellsDone = 0;
    for (const r of inScope) for (const m of measuredByPart(r).values()) { cellsTotal += m.total; cellsDone += m.byState.encoded + m.byState.unvalidated; }
    check(cellsTotal === page.provisions && cellsDone === done(page), `cells ${cellsDone}/${cellsTotal} vs header ${done(page)}/${page.provisions} ${b.id} ${tier}`);
    // 5. The matrix cells (documents) add up to the documents.
    check(inScope.length === page.documents, `document cells ${b.id} ${tier}`);
  }
  // 6. Tier 2 holds Tier 1: never fewer provisions, encoded provisions or complete documents.
  const s = b.counts!.screener!, f = b.counts!.full!;
  check(f.provisions >= s.provisions && done(f) >= done(s), `tier 2 provisions below tier 1 ${b.id}`);
  check(f.byStatus.complete + f.byStatus.unvalidated >= s.byStatus.complete + s.byStatus.unvalidated, `tier 2 documents below tier 1 ${b.id}`);
}
// 7. The overview's program completeness (federal + each state's own) equals every document row counted once.
for (const p of [...new Set(data.bundles.map((b) => b.program))]) {
  for (const tier of ["screener", "full"] as const) {
    const all = data.documents.filter((d) => d.bundle_id.endsWith(`/${p}`) && d.tier === tier);
    const direct = tierCounts(all);
    const fed = data.bundles.find((b) => b.id === `us/${p}`)!.counts![tier]!;
    let total = fed.provisions, dn = done(fed);
    for (const b of data.bundles.filter((b) => b.program === p && b.jurisdiction !== "us")) {
      total += b.counts![tier]!.provisions - fed.provisions; dn += done(b.counts![tier]!) - done(fed);
    }
    check(total === direct.provisions && dn === done(direct), `overview completeness ${p} ${tier}: ${dn}/${total} vs ${done(direct)}/${direct.provisions}`);
  }
}
// 8. The share formatter never rounds into a wrong impression.
check(formatShare(1, 1160) === "<1%" && formatShare(999, 1000) === ">99%" && formatShare(0, 5) === "0%" && formatShare(5, 5) === "100%" && formatShare(0, 0) === "—", "formatShare");
console.log(`${checks} checks, ${failures} failures`);
if (failures) {
  console.log(fail.join("\n"));
  process.exit(1);
}
