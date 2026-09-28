import { supabaseEncodings } from "@/lib/supabase";
import {
  excludeGatedRows,
  readableJurisdictionHints,
  withoutGatedRows,
} from "@/lib/axiom/rulespec/index-visibility";

/**
 * Read side of the encodings.rulespec_files search index (populated by
 * scripts/sync-rulespec-index.mjs).
 *
 * Returns candidate encoding files for a token set in a single indexed
 * query — including the raw YAML, so the caller can score rule symbols
 * locally without any GitHub round-trips. Returns null when the index
 * cannot answer (table missing, query error, or not yet populated);
 * the caller then falls back to crawling GitHub at request time.
 *
 * Rows homed in a family the app registers ``app_visibility =
 * "experimental"`` are refused here — in the query and again on the
 * way out (``rulespec/index-visibility.ts``). The GitHub fallback has
 * had that gate since ``rootsFromRepo``; without it here, a leaked or
 * pre-gating index row made a pilot repo searchable, which is the one
 * thing the registry marker is supposed to prevent.
 */
export interface IndexedRuleSpecFile {
  filePath: string;
  citationPath: string;
  bucket: string;
  jurisdiction: string;
  rawYaml: string | null;
}

const CANDIDATE_LIMIT = 400;

export async function fetchIndexedRuleSpecCandidates(
  tokens: string[],
  hintedJurisdictions: Set<string>,
  bucket: string | null
): Promise<IndexedRuleSpecFile[] | null> {
  if (tokens.length === 0) return [];
  // Every hinted jurisdiction is gated — the search is scoped to
  // something the app must not read, so it is genuinely empty. Answer
  // ``[]`` rather than ``null``: ``null`` means "index can't answer"
  // and would send the caller off to crawl GitHub for the same rows.
  const readableHints = readableJurisdictionHints(hintedJurisdictions);
  if (readableHints === null) return [];
  try {
    let builder = excludeGatedRows(
      supabaseEncodings
        .from("rulespec_files")
        .select("file_path, citation_path, bucket, jurisdiction, raw_yaml")
        // OR of sanitised single terms — tokens come from tokenise(), so
        // they are lowercase alphanumerics safe to splice into a tsquery.
        .textSearch("search_tsv", tokens.join(" | "))
        .limit(CANDIDATE_LIMIT)
    );
    if (readableHints.length > 0) {
      builder = builder.in("jurisdiction", readableHints);
    }
    if (bucket) builder = builder.eq("bucket", bucket);
    const { data, error } = await builder;
    if (error) return null;

    if (!data || data.length === 0) {
      // Distinguish "no match" from "index not populated yet" — asked of
      // the rows this reader may actually return, so an index holding
      // nothing but gated rows still reads as unpopulated and the caller
      // falls back rather than answering an authoritative empty.
      const { count, error: countError } = await excludeGatedRows(
        supabaseEncodings
          .from("rulespec_files")
          .select("citation_path", { count: "exact", head: true })
      );
      if (countError || !count) return null;
      return [];
    }

    return withoutGatedRows(
      data,
      (row) => row.citation_path as string | null
    ).map((row) => ({
      filePath: row.file_path as string,
      citationPath: row.citation_path as string,
      bucket: row.bucket as string,
      jurisdiction: row.jurisdiction as string,
      rawYaml: (row.raw_yaml as string | null) ?? null,
    }));
  } catch {
    return null;
  }
}
