import { NextResponse } from "next/server";
import { getSectionPageData, refsForChunk } from "@/lib/axiom/section-page";
import { sourceDisplayHeading, type WorkspaceSource } from "@/lib/axiom/workspace-source";
import { arizonaSource } from "@/lib/axiom/arizona-source";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.length < 3 || path.length > 30) return NextResponse.json({ error: "Invalid provision path" }, { status: 400 });
  try {
    const data = await getSectionPageData(path);
    if (!data) {
      const fallback = await arizonaSource(path);
      return fallback ? NextResponse.json(fallback) : NextResponse.json({ error: "Source provision unavailable" }, { status: 404 });
    }
    const blocks: WorkspaceSource["blocks"] = [];
    const addRoot = (anchor: string, heading: string | null, body: string) => blocks.push({ anchor, heading, body, citationPath: data.citationPath, refs: refsForChunk(data.rootRefs, body) });
    if (data.bodyChunks.length) {
      if (data.intro) addRoot("intro", null, data.intro);
      for (const chunk of data.bodyChunks) addRoot(chunk.anchor, chunk.designator, chunk.text);
    } else if (data.root.body) addRoot("source-root", null, data.root.body);
    for (const provision of data.provisions) {
      blocks.push({ anchor: provision.anchor, heading: sourceDisplayHeading(provision.rule.heading, provision.rule.body) ?? provision.designator, body: provision.rule.body ?? "", citationPath: provision.rule.citation_path ?? data.citationPath, refs: [] });
    }
    const source: WorkspaceSource = { citationPath: data.citationPath, heading: sourceDisplayHeading(data.root.heading, data.root.body), officialUrl: data.root.source_url ?? null, effectiveDate: data.root.effective_date ?? null, focusAnchor: data.focusAnchor, truncated: data.truncated, blocks };
    if (!blocks.some((block) => block.body.trim())) {
      const fallback = await arizonaSource(path);
      if (fallback) return NextResponse.json(fallback);
    }
    return NextResponse.json(source);
  } catch {
    return NextResponse.json({ error: "Could not load the source. Please try again." }, { status: 503 });
  }
}
