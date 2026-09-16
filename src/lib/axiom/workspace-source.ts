import type { RuleReference } from "@/lib/supabase";

export interface WorkspaceSource {
  origin?: "official-live";
  citationPath: string;
  heading: string | null;
  officialUrl: string | null;
  effectiveDate: string | null;
  focusAnchor: string | null;
  truncated: boolean;
  blocks: Array<{ anchor: string; heading: string | null; body: string; citationPath: string; refs: RuleReference[] }>;
}

/** Corpus imports sometimes label untitled clauses with their opening sentence. */
export function sourceDisplayHeading(heading: string | null | undefined, body: string | null | undefined): string | null {
  const title = heading?.trim();
  if (!title) return null;
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const text = body?.trim() ?? "";
  const clauseText = text.replace(/^(?:\([a-z0-9]+\)\s*)+/i, "");
  const repeated = normalize(clauseText).startsWith(normalize(title));
  if (repeated && (clauseText !== text || title.split(/\s+/).length > 8)) return null;
  return title;
}
