"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import CodeBlock from "@/components/code-block";

export function RuleSpecPreview({ root }: { root: string }) {
  const [file, setFile] = useState<{ filePath: string; content: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setFailed(false);
    void fetch(`/api/axiom/rulespec?root=${encodeURIComponent(root)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Encoding unavailable");
        const data = await response.json();
        if (typeof data.content !== "string" || typeof data.filePath !== "string") throw new Error("Invalid encoding");
        if (!controller.signal.aborted) setFile(data);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [root, attempt]);
  return <section className="workspace-rulespec" aria-label="RuleSpec file">
    <div className="workspace-source-toolbar"><h2>RuleSpec</h2><span>{file?.filePath ?? `${root.split(":").pop()}.yaml`}</span></div>
    {failed ? <p role="alert">Could not load the RuleSpec file. <button onClick={() => setAttempt(value => value + 1)}>Try again</button></p>
      : file ? <div className="workspace-rulespec-code" tabIndex={0} role="region" aria-label="RuleSpec YAML"><CodeBlock code={file.content} language="yaml" /></div>
      : <p className="workspace-source-loading" role="status"><LoaderCircle size={18} aria-hidden="true" />Loading RuleSpec file…</p>}
  </section>;
}
