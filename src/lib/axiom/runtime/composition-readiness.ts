import { load, CORE_SCHEMA } from "js-yaml";
import { supabaseEncodings } from "@/lib/supabase";
import { cachedCompose } from "./compose-cache";
import { classifyRelations, describeRelation, type RelationDecl } from "./relation-roles";

export type Readiness = "ready" | "roles_required" | "relationships_unsupported" | "unavailable";
export interface CompositionScope { readiness: Readiness; relations: RelationDecl[] }
const cache = new Map<string, {expires: number; value: CompositionScope}>();

/** Inspect source declarations because compose can omit relations. The
 * scenario editor supports one unit instance; a single typed Person–unit
 * relation runs under the membership convention, several need explicit
 * per-person roles, and anything else cannot be represented. */
// Verified through the live app payload: CDCC counts, Colorado household checks,
// and Massachusetts TANF child checks and conditional income sums.
export function sourceRelationships(content: string, fileLegalId = ""): RelationDecl[] {
  const doc = load(content, {schema: CORE_SCHEMA}) as {rules?: Array<Parameters<typeof describeRelation>[0] & {kind?: unknown}>};
  if (!doc || !Array.isArray(doc.rules)) throw new Error("Missing rule declarations");
  return doc.rules
    .filter(rule => rule.kind === "data_relation" || rule.data_relation != null)
    .map(rule => describeRelation(rule, fileLegalId));
}

/** The membership-convention test: at most one relation, and it supported. */
export function relationshipsSupported(relations: Array<{supported: boolean}>): boolean {
  return relations.length <= 1 && relations.every(relation => relation.supported);
}

export async function compositionScope(root: string): Promise<CompositionScope> {
  const existing = cache.get(root);
  if (existing && existing.expires > Date.now()) return existing.value;
  const unavailable: CompositionScope = {readiness: "unavailable", relations: []};
  try {
    const response = await cachedCompose(root);
    const data = (response.body as {data?: {files?: string[]; truncated?: boolean; graph?: {relations?: unknown[]}}})?.data;
    if (response.status !== 200 || !data || data.truncated || !data.files?.length) return unavailable;
    let value: CompositionScope = {readiness: data.graph?.relations?.length ? "relationships_unsupported" : "ready", relations: []};
    if (value.readiness === "ready") {
      const groups = new Map<string, Set<string>>();
      for (const id of new Set([root.split("#")[0]!, ...data.files])) {
        const colon = id.indexOf(":");
        if (colon < 0) return unavailable;
        const jurisdiction = id.slice(0, colon), path = id.slice(colon + 1).split("#")[0] + ".yaml";
        if (!groups.has(jurisdiction)) groups.set(jurisdiction, new Set());
        groups.get(jurisdiction)!.add(path);
      }
      const relations: RelationDecl[] = [];
      for (const [jurisdiction, paths] of groups) {
        const {data: rows, error} = await supabaseEncodings.from("rulespec_files").select("file_path,raw_yaml").eq("jurisdiction", jurisdiction).in("file_path", [...paths]).abortSignal(AbortSignal.timeout(15000));
        if (error || !rows || [...paths].some(path => !rows.some(row => row.file_path === path && row.raw_yaml))) return unavailable;
        for (const row of rows) {
          relations.push(...sourceRelationships(row.raw_yaml!, `${jurisdiction}:${row.file_path.replace(/\.yaml$/, "")}`));
        }
      }
      value = {readiness: classifyRelations(relations), relations};
    }
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(root, {value, expires: Date.now() + 60000});
    return value;
  } catch { return unavailable; }
}

export async function compositionReadiness(root: string): Promise<Readiness> {
  return (await compositionScope(root)).readiness;
}
