import { NextResponse } from "next/server";
import { conflictsForCitationPaths } from "@/lib/axiom/source-conflicts";
import {
  MAX_CONFLICT_PATHS,
  MAX_CONFLICT_PATHS_PARAM,
  parseConflictPathsParam,
} from "@/lib/axiom/source-conflicts-normalize";

/** The source conflicts that touch each citation path (the path, under it or above it). */
export async function GET(request: Request) {
  const paths = parseConflictPathsParam(new URL(request.url).searchParams.get("paths"));
  if (!paths) {
    return NextResponse.json(
      {
        error: `paths must be 1 to ${MAX_CONFLICT_PATHS} comma-separated citation paths, at most ${MAX_CONFLICT_PATHS_PARAM} characters`,
      },
      { status: 400 }
    );
  }
  const conflicts = await conflictsForCitationPaths(paths);
  return NextResponse.json({ conflicts }, { headers: { "cache-control": "public, max-age=300" } });
}
