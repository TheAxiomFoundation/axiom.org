import { NextResponse } from "next/server";
import { supabaseEncodings } from "@/lib/supabase";

/** The exact published module, independent of the selected rule's law citation. */
export async function GET(request: Request) {
  const root = new URL(request.url).searchParams.get("root")?.split("#")[0] ?? "";
  const match = root.match(/^([a-z]{2}(?:-[a-z]{2,3})?):([\w./–-]{1,240})$/);
  if (!match || match[2].split("/").some(part => part === ".." || part === "." || !part)) {
    return NextResponse.json({ error: "invalid_root" }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseEncodings.from("rulespec_files")
      .select("file_path,raw_yaml")
      .eq("jurisdiction", match[1])
      .eq("file_path", `${match[2]}.yaml`)
      .limit(1)
      .abortSignal(AbortSignal.timeout(15_000));
    if (error) return NextResponse.json({ error: "encoding_unavailable" }, { status: 503 });
    const row = data?.[0];
    if (!row?.raw_yaml) return NextResponse.json({ error: "encoding_not_found" }, { status: 404 });
    return NextResponse.json({ root, filePath: row.file_path, content: row.raw_yaml }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "encoding_unavailable" }, { status: 503 });
  }
}
