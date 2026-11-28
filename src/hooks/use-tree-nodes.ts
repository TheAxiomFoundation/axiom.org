"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { TreeNode } from "@/lib/tree-data";
import { loadTreeNodes } from "@/lib/axiom/tree-node-loader";
import {
  treeNodesCacheKey,
  type InitialTreeNodesState,
} from "@/lib/axiom/tree-cache";
import type { Rule } from "@/lib/supabase";

interface CacheEntry {
  nodes: TreeNode[];
  hasMore: boolean;
  currentRule: Rule | null;
  leafRule: Rule | null;
}

interface UseTreeNodesResult {
  nodes: TreeNode[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  leafRule: Rule | null;
  currentRule: Rule | null;
  stale?: boolean;
}

const MAX_CACHE_ENTRIES = 20;

/**
 * Fetch tree nodes for a resolved jurisdiction.
 * Receives pre-resolved jurisdiction info — no longer dispatches on jurisdiction segments.
 */
export function useTreeNodes(
  dbJurisdictionId: string,
  ruleSegments: string[],
  hasCitationPaths: boolean,
  encodedOnly: boolean = false,
  initialState?: InitialTreeNodesState | null
): UseTreeNodesResult {
  const cacheKey = treeNodesCacheKey(
    dbJurisdictionId,
    ruleSegments,
    encodedOnly
  );
  const matchingInitialState =
    initialState?.cacheKey === cacheKey ? initialState : null;

  const [nodes, setNodes] = useState<TreeNode[]>(
    matchingInitialState?.nodes ?? []
  );
  const [loading, setLoading] = useState(!matchingInitialState);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(
    matchingInitialState?.hasMore ?? false
  );
  const [leafRule, setLeafRule] = useState<Rule | null>(
    matchingInitialState?.leafRule ?? null
  );
  const [currentRule, setCurrentRule] = useState<Rule | null>(
    matchingInitialState?.currentRule ?? null
  );

  const pageRef = useRef(0);
  const cache = useRef<Map<string, CacheEntry>>(
    matchingInitialState
      ? new Map([
          [
            cacheKey,
            {
              nodes: matchingInitialState.nodes,
              hasMore: matchingInitialState.hasMore,
              currentRule: matchingInitialState.currentRule,
              leafRule: matchingInitialState.leafRule,
            },
          ],
        ])
      : new Map()
  );
  // Encoded-paths set is jurisdiction-scoped — keyed so a navigation
  // from /us to /us-co doesn't keep filtering against US paths.
  const encodedPathsRef = useRef<{
    jurisdiction: string;
    paths: Set<string>;
  } | null>(null);
  // Incrementing token so a stale fetch (e.g. one issued before the
  // encoded-only filter flipped) cannot overwrite newer state. Any
  // fetch whose token no longer matches ``inflight.current`` is
  // silently dropped on resolution.
  const inflight = useRef(0);
  // Cache key whose initial load already got its one automatic
  // retry — prevents retry loops when the backend is genuinely down.
  const retriedKeyRef = useRef<string | null>(null);

  const [stateKey, setStateKey] = useState(
    matchingInitialState ? cacheKey : ""
  );

  useEffect(() => {
    // Invalidate any in-flight fetch for the previous cacheKey —
    // its result is no longer relevant.
    inflight.current += 1;

    const cached = cache.current.get(cacheKey);
    if (cached) {
      setNodes(cached.nodes);
      setHasMore(cached.hasMore);
      setCurrentRule(cached.currentRule);
      setLeafRule(cached.leafRule);
      setLoading(false);
      setError(null);
      setStateKey(cacheKey);
      pageRef.current = 0;
      return;
    }

    fetchNodes(ruleSegments, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  /* v8 ignore start -- async Supabase-dependent fetch logic */
  async function fetchNodes(
    segs: string[],
    pageNum: number,
    append: boolean
  ) {
    const token = ++inflight.current;
    setLoading(true);
    setError(null);

    try {
      // Intermediate data — don't touch React state until we've
      // confirmed the token is still current. Otherwise a fetch
      // issued before a filter toggle can blank setLeafRule / clear
      // setCurrentRule after the fresh fetch has already populated
      // them, which is exactly the "button lit but list unfiltered"
      // glitch users hit.
      let result: Awaited<ReturnType<typeof loadTreeNodes>>;
      if (shouldUseTreeApi()) {
        result = await fetchTreeNodesFromApi({
          dbJurisdictionId,
          ruleSegments: segs,
          hasCitationPaths,
          encodedOnly,
          page: pageNum,
        });
      } else {
        let encodedPaths: Set<string> | undefined;
        if (encodedPathsRef.current?.jurisdiction === dbJurisdictionId) {
          encodedPaths = encodedPathsRef.current.paths;
        }
        result = await loadTreeNodes({
          dbJurisdictionId,
          ruleSegments: segs,
          hasCitationPaths,
          encodedOnly,
          page: pageNum,
          encodedPaths,
        });
        if (result.encodedPaths) {
          encodedPathsRef.current = {
            jurisdiction: dbJurisdictionId,
            paths: result.encodedPaths,
          };
        }
      }

      // Drop the result if a newer fetch has been issued (e.g. the
      // user toggled "Encoded only" mid-flight, or navigated).
      if (token !== inflight.current) return;

      if (append) {
        setNodes((prev) => [...prev, ...result.nodes]);
      } else {
        setNodes(result.nodes);
      }
      // A later page that brings nothing (the level shrank since its first
      // page, so the page now starts past the end) names no rules of its
      // own; the level keeps the ones its first page named.
      if (!append || result.nodes.length > 0) {
        setLeafRule(result.leafRule ?? null);
        setCurrentRule(result.currentRule ?? null);
      }
      setHasMore(result.hasMore);
      setStateKey(cacheKey);
      pageRef.current = pageNum;

      if (!append) {
        // Evict oldest entries if cache is full
        if (cache.current.size >= MAX_CACHE_ENTRIES) {
          const firstKey = cache.current.keys().next().value;
          if (firstKey !== undefined) cache.current.delete(firstKey);
        }
        cache.current.set(cacheKey, {
          nodes: result.nodes,
          hasMore: result.hasMore,
          currentRule: result.currentRule ?? null,
          leafRule: result.leafRule ?? null,
        });
      }
    } catch (err) {
      if (token !== inflight.current) return;
      // One automatic retry on a fresh (non-append) load: the common
      // failure is a cold-start timeout that succeeds moments later,
      // and surfacing "temporarily unavailable" for that reads as
      // broken navigation.
      if (!append && retriedKeyRef.current !== cacheKey) {
        retriedKeyRef.current = cacheKey;
        setTimeout(() => {
          if (token === inflight.current) fetchNodes(segs, pageNum, append);
        }, 750);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to fetch");
      setStateKey(cacheKey);
    } finally {
      if (token === inflight.current) setLoading(false);
    }
  }
  /* v8 ignore stop */

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchNodes(ruleSegments, pageRef.current + 1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasMore, cacheKey]);

  const stale = stateKey !== cacheKey;

  return {
    nodes,
    loading: loading || stale,
    error: stale ? null : error,
    hasMore: stale ? false : hasMore,
    loadMore,
    leafRule,
    currentRule,
    stale,
  };
}

function shouldUseTreeApi(): boolean {
  return typeof window !== "undefined" && process.env.NODE_ENV !== "test";
}

async function fetchTreeNodesFromApi({
  dbJurisdictionId,
  ruleSegments,
  hasCitationPaths,
  encodedOnly,
  page,
}: {
  dbJurisdictionId: string;
  ruleSegments: string[];
  hasCitationPaths: boolean;
  encodedOnly: boolean;
  page: number;
}): Promise<Awaited<ReturnType<typeof loadTreeNodes>>> {
  const params = new URLSearchParams({
    jurisdiction: dbJurisdictionId,
    segments: ruleSegments.map(encodeURIComponent).join("/"),
    hasCitationPaths: hasCitationPaths ? "1" : "0",
    encodedOnly: encodedOnly ? "1" : "0",
    page: String(page),
  });
  const res = await fetch(`/api/axiom/tree?${params.toString()}`);
  const body = (await res.json()) as
    | Awaited<ReturnType<typeof loadTreeNodes>>
    | { error?: string };
  if (!res.ok) {
    throw new Error(
      "error" in body && body.error
        ? body.error
        : "Navigation data is temporarily unavailable."
    );
  }
  return body as Awaited<ReturnType<typeof loadTreeNodes>>;
}
