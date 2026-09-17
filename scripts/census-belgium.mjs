// Belgian corpus census: extend the committed census snapshot
// (src/lib/axiom/corpus-subtrees.json) with real sizes and true
// intra-module structure for every Belgian subtree the live mirror
// serves. Mirrors census v2 semantics per module:
//   ruleCount        — rules declared in the focus file
//   linkedRuleCount  — own rules with any dep edge (in or out)
//   importCount      — distinct other files the own rules depend on
//   graph {n, e, p}  — own-rule dep edges + a layered 0..1 layout
//
// Usage: node scripts/census-belgium.mjs [base-url]
// Reads the live compose endpoint per subtree; writes the snapshot
// in place, replacing any previous be* entries (US census untouched).

import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "https://axiom.org";
const SNAPSHOT = new URL(
  "../src/lib/axiom/corpus-subtrees.json",
  import.meta.url,
);

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

function layeredLayout(count, edges) {
  // Longest-path layering over the own-rule DAG; dependencies sit in
  // earlier layers, terminal rules in the last — rendered top-down.
  const depsOf = Array.from({ length: count }, () => []);
  for (const [from, to] of edges) depsOf[from].push(to);
  const layer = new Array(count).fill(0);
  const visiting = new Set();
  const assign = (index) => {
    if (visiting.has(index)) return 0; // cycle guard — flat is fine
    if (layer[index] > 0) return layer[index];
    visiting.add(index);
    let depth = 0;
    for (const dep of depsOf[index]) depth = Math.max(depth, assign(dep));
    visiting.delete(index);
    layer[index] = depth + 1;
    return layer[index];
  };
  for (let i = 0; i < count; i += 1) assign(i);
  const maxLayer = Math.max(...layer, 1);
  const byLayer = new Map();
  layer.forEach((value, index) => {
    const list = byLayer.get(value) ?? [];
    list.push(index);
    byLayer.set(value, list);
  });
  const positions = new Array(count);
  for (const [value, members] of byLayer) {
    members.forEach((index, i) => {
      const x =
        members.length === 1
          ? 0.5
          : 0.05 + (0.9 * i) / (members.length - 1);
      const y =
        maxLayer === 1 ? 0.5 : 0.05 + (0.9 * (maxLayer - value)) / (maxLayer - 1);
      positions[index] = [Number(x.toFixed(3)), Number(y.toFixed(3))];
    });
  }
  return positions;
}

function moduleFromCompose(target, jurisdiction, bucket, graph) {
  const prefix = `${target}#`;
  const own = graph.rules.filter((rule) => rule.legalId.startsWith(prefix));
  const indexOf = new Map(own.map((rule, index) => [rule.legalId, index]));
  const edges = [];
  const linked = new Set();
  const importFiles = new Set();
  own.forEach((rule, from) => {
    for (const dep of rule.ruleDeps ?? []) {
      const to = indexOf.get(dep);
      if (to !== undefined) {
        edges.push([from, to]);
        linked.add(from);
        linked.add(to);
      } else {
        importFiles.add(dep.split("#")[0]);
        linked.add(from);
      }
    }
  });
  // Headline: a terminal own rule (nothing else in the file depends on
  // it), the one with the deepest own subtree first.
  const dependedOn = new Set(edges.map(([, to]) => to));
  const terminals = own
    .map((rule, index) => ({ rule, index }))
    .filter(({ index }) => !dependedOn.has(index));
  const outDegree = new Map();
  for (const [from] of edges) outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
  terminals.sort(
    (a, b) => (outDegree.get(b.index) ?? 0) - (outDegree.get(a.index) ?? 0),
  );
  const headline = terminals[0]?.rule.name ?? own[0]?.name;
  const entry = {
    target,
    jurisdiction,
    bucket,
    ruleCount: own.length,
    linkedRuleCount: linked.size,
    importCount: importFiles.size,
    imports: [...importFiles].sort(),
  };
  if (headline) entry.headlineRule = headline;
  if (own.length >= 2) {
    entry.graph = {
      n: own.length,
      e: edges,
      p: layeredLayout(own.length, edges),
    };
  }
  return entry;
}

const subtrees = (await getJson("/api/axiom/corpus/subtrees")).data.subtrees;
const belgian = subtrees.filter((item) => /^be(-|$)/.test(item.jurisdiction));
console.log(`census over ${belgian.length} Belgian subtrees`);

const modules = [];
for (const subtree of belgian) {
  const focus = encodeURIComponent(subtree.target);
  try {
    const composed = await getJson(`/api/axiom/graph/compose?focus=${focus}&v=2`);
    modules.push(
      moduleFromCompose(
        subtree.target,
        subtree.jurisdiction,
        subtree.bucket,
        composed.data.graph,
      ),
    );
  } catch (error) {
    console.warn(`skip ${subtree.target}: ${error.message}`);
  }
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
snapshot.modules = snapshot.modules
  .filter((module) => !/^be(-|$)/.test(module.jurisdiction))
  .concat(modules);
snapshot.clean_subtrees = snapshot.modules.length;
snapshot.generated_from += `; Belgian census ${new Date().toISOString().slice(0, 10)} (compose-derived)`;
writeFileSync(SNAPSHOT, JSON.stringify(snapshot));
console.log(`wrote ${modules.length} Belgian modules into the snapshot`);
