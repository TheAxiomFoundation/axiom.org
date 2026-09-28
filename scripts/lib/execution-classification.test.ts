import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parseRuleSpec } from "../../src/lib/axiom/rulespec/doc";
import { executionClassification } from "./execution-classification.mjs";

function classify(yaml: string, bucket = "policies") {
  return executionClassification(yaml, parseRuleSpec(yaml), bucket);
}

describe("mirror execution classification", () => {
  it("distinguishes compositions without inferring from names", () => {
    expect(classify("format: rulespec/v1\nmodule: {kind: composition}\nrules: []\n").execution_kind).toBe("composition");
    expect(classify("format: rulespec/v1\nmodule: {summary: A composition example}\nrules: []\n").execution_kind).toBe("provision");
  });
  it("marks program paths separately", () => {
    expect(classify("program: uk/universal-credit\nperiod: 2026-04\noutputs: []\n", "programs").execution_kind).toBe("program");
    expect(classify("format: rulespec/v1\nmodule: {}\nrules: []\n", "programs").execution_kind).toBe("program");
  });
  it.each([
    "format: unexpected\nmodule: {}\nrules: []\n",
    "format: rulespec/v1\nmodule: {kind: unexpected}\nrules: []\n",
    "format: rulespec/v1\nmodule: {kind: 1}\nrules: []\n",
    "format: rulespec/v1\nrules: invalid\n",
    "broken: [",
    "format: rulespec/v1\nrules: []\n",
    "format: rulespec/v1\nmodule: invalid\nrules: []\n",
  ])("leaves malformed or unsupported documents unknown", (yaml) => {
    expect(classify(yaml).execution_kind).toBe("unknown");
  });
  it("binds the exact UTF-8 bytes, including whitespace", () => {
    const yaml = "format: rulespec/v1\nmodule: {summary: Québec}\nrules: []\n";
    expect(classify(yaml).classification_yaml_sha256).toBe(createHash("sha256").update(yaml).digest("hex"));
    expect(classify(yaml + "\n").classification_yaml_sha256).not.toBe(classify(yaml).classification_yaml_sha256);
  });
});
