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
    else if (declaredKind === undefined && module.status === "deferred") {
      // Explicit deferral is not a malformed identifier or an executable policy.
      // Contradictory rules/imports stay unknown for review rather than being
      // silently classified as an intentional non-executable document.
      if (Array.isArray(doc.raw.rules) && doc.raw.rules.length === 0
          && (doc.raw.imports === undefined
            || (Array.isArray(doc.raw.imports) && doc.raw.imports.length === 0))) {
        kind = "deferred";
      }
    } else if (declaredKind === undefined) kind = "provision";
  }
  return {
    execution_kind: kind,
    classification_yaml_sha256: digest,
  };
}
