import { load, CORE_SCHEMA } from "js-yaml";
import { supabaseEncodings } from "@/lib/supabase";
import { cachedCompose } from "./compose-cache";

type Readiness = "ready" | "relationships_unsupported" | "unavailable";
const cache = new Map<string, {expires: number; value: Readiness}>();

/** Inspect source declarations because compose can omit relations. The current
 * scenario editor supports one verified unit containing all submitted people; it
 * cannot assign arbitrary links or distinguish multiple membership roles. */
// Verified through the live app payload: CDCC counts, Colorado household checks,
// and Massachusetts TANF child checks and conditional income sums.
const SUPPORTED_PERSON_UNITS = new Set(["TaxUnit", "Household", "TanfUnit"]);

export function sourceRelationships(content: string): Array<{name: string; supported: boolean}> {
  const doc = load(content, {schema: CORE_SCHEMA}) as {rules?: Array<{
    name?: string; kind?: string;
    data_relation?: {arity?: number; arguments?: unknown[]};
  }>};
  if (!doc || !Array.isArray(doc.rules)) throw new Error("Missing rule declarations");
  return doc.rules.filter(rule => rule.kind === "data_relation" || rule.data_relation != null).map(rule => {
    const relation = rule.data_relation;
    const args = relation?.arguments?.map(argument =>
      typeof argument === "string" ? argument :
        argument && typeof argument === "object" && "entity" in argument ? argument.entity : null,
    );
    return {
      name: rule.name ?? "",
      supported: Boolean(rule.name && relation?.arity === 2 && Array.isArray(args) &&
        args.length === 2 && args.filter(entity => entity === "Person").length === 1 &&
        args.some(entity => typeof entity === "string" && SUPPORTED_PERSON_UNITS.has(entity))),
    };
  });
}

export function relationshipsSupported(relations: Array<{name: string; supported: boolean}>): boolean {
  return relations.length <= 1 && relations.every(relation => relation.supported);
}

export async function compositionReadiness(root: string): Promise<Readiness> {
  const existing = cache.get(root);
  if (existing && existing.expires > Date.now()) return existing.value;
  try {
    const response = await cachedCompose(root);
    const data = (response.body as {data?: {files?: string[]; truncated?: boolean; graph?: {relations?: unknown[]}}})?.data;
    if (response.status !== 200 || !data || data.truncated || !data.files?.length) return "unavailable";
    let value: Readiness = data.graph?.relations?.length ? "relationships_unsupported" : "ready";
    if (value === "ready") {
      const groups = new Map<string, Set<string>>();
      for (const id of new Set([root.split("#")[0]!, ...data.files])) {
        const colon = id.indexOf(":");
        if (colon < 0) return "unavailable";
        const jurisdiction = id.slice(0, colon), path = id.slice(colon + 1).split("#")[0] + ".yaml";
        if (!groups.has(jurisdiction)) groups.set(jurisdiction, new Set());
        groups.get(jurisdiction)!.add(path);
      }
      const relations: Array<{name: string; supported: boolean}> = [];
      for (const [jurisdiction, paths] of groups) {
        const {data: rows, error} = await supabaseEncodings.from("rulespec_files").select("file_path,raw_yaml").eq("jurisdiction", jurisdiction).in("file_path", [...paths]).abortSignal(AbortSignal.timeout(15000));
        if (error || !rows || [...paths].some(path => !rows.some(row => row.file_path === path && row.raw_yaml))) return "unavailable";
        for (const row of rows) relations.push(...sourceRelationships(row.raw_yaml!));
      }
      if (!relationshipsSupported(relations)) value = "relationships_unsupported";
    }
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(root, {value, expires:Date.now() + 60000});
    return value;
  } catch { return "unavailable"; }
}
