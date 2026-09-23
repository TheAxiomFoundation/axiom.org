import { createHash } from "node:crypto";

/** Classification describes the document type, never compile readiness. */
export function executionClassification(content, doc, bucket) {
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  let kind = "unknown";
  const module = doc?.raw?.module;
  const declaredKind = module && typeof module === "object" && !Array.isArray(module)
    ? module.kind
    : undefined;
  if (bucket === "programs" && typeof doc?.raw?.program === "string"
      && doc.parseErrors?.length === 0) {
    kind = "program";
  } else if (module && typeof module === "object" && !Array.isArray(module)
      && doc?.format === "rulespec/v1" && doc.parseErrors?.length === 0) {
    if (bucket === "programs") kind = "program";
    else if (declaredKind === "composition") kind = "composition";
    else if (declaredKind === undefined) kind = "provision";
  }
  return {
    execution_kind: kind,
    classification_yaml_sha256: digest,
  };
}
