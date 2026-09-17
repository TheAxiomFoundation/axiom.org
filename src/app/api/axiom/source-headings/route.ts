import { NextResponse } from "next/server";
import { supabaseCorpus } from "@/lib/supabase";
import { sourceDisplayHeading } from "@/lib/axiom/workspace-source";

// Exact corpus headings only: never substitute rule names or ancestor headings.
export async function POST(request: Request) {
  let paths: unknown;
  try { ({ paths } = await request.json()); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!Array.isArray(paths) || !paths.length || paths.length > 40 || paths.some(path => typeof path !== "string" || path.length > 600 || !/^[a-z]{2}(?:-[a-z]{2})?\/[a-z]+\/[\w./()-]+$/i.test(path))) {
    return NextResponse.json({ error: "Invalid citation paths" }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseCorpus.from("current_provisions").select("citation_path,heading,body").in("citation_path", [...new Set(paths)]).abortSignal(AbortSignal.timeout(8000));
    if (error) throw error;
    const headings: Record<string, string | null> = Object.fromEntries(paths.map(path => [path, null]));
    for (const row of data ?? []) headings[row.citation_path] = sourceDisplayHeading(row.heading, row.body);
    return NextResponse.json({ headings });
  } catch { return NextResponse.json({ error: "Source headings unavailable" }, { status: 503 }); }
}
