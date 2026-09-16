"use client";
import { useMemo } from "react";
import { load, dump } from "js-yaml";
import CodeBlock from "@/components/code-block";
export function RuleSpecPreview({ content, nodeId }: { content: string; nodeId: string }) {
  const node = useMemo(() => {
    try {
      const module = load(content) as { rules?: Array<{ name?: string }> };
      const name = nodeId.split("#").at(-1);
      const matches = module?.rules?.filter(rule => rule.name === name) ?? [];
      return matches.length === 1 ? dump(matches[0], { lineWidth: -1, noRefs: true }) : null;
    } catch { return null; }
  }, [content, nodeId]);
  return <section className="workspace-rulespec" aria-label="Selected node definition">
    {node ? <div className="workspace-rulespec-code" tabIndex={0} role="region" aria-label="RuleSpec YAML"><CodeBlock code={node} language="yaml" /></div> : <p>No standalone definition is available for this node in its encoding file.</p>}
  </section>;
}
