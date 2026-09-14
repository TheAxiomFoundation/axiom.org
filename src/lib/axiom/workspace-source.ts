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
