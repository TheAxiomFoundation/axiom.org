import { describe, expect, it } from "vitest";
import { moduleFacts, outputPath, sourceTextPath, waivedModules } from "./program-bundles-modules";

const row = (citation_path: string, raw_yaml: string, file_path = "x.yaml") => ({
  citation_path,
  jurisdiction: citation_path.split("/")[0],
  file_path,
  raw_yaml,
  source_citation_paths: null,
});

describe("sourceTextPath", () => {
  it("reads a US Code or CFR citation as a corpus path", () => {
    expect(sourceTextPath("7 CFR 273.9(a)(1)")).toBe("us/regulation/7/273/9/a/1");
    expect(sourceTextPath("7 U.S.C. 2014(e)(6)(A)")).toBe("us/statute/7/2014/e/6/A");
    expect(sourceTextPath("7 USC 2012(j)")).toBe("us/statute/7/2012/j");
    expect(sourceTextPath("26 U.S.C. § 3401(a)")).toBe("us/statute/26/3401/a");
    expect(sourceTextPath("Arizona DES FAA5 manual")).toBeNull();
  });
});

describe("outputPath", () => {
  it("reads a module output as a corpus path", () => {
    expect(outputPath("us:statutes/26/3401/a#wages")).toBe("us/statute/26/3401/a");
    expect(outputPath("us:regulations/7-cfr/273/9/b#earned_income")).toBe("us/regulation/7/273/9/b");
    expect(outputPath("us:policies/usda/snap/x#y")).toBeNull();
  });
});

describe("moduleFacts", () => {
  it("cites what its rules' sources and fine proof atoms name, not whole sections", () => {
    const facts = moduleFacts(
      row(
        "us/statute/7/2015/d/2/C",
        `
module:
  summary: Students
rules:
  - name: exemption
    kind: derived
    source: 7 U.S.C. 2015(d)(2)(C)
    metadata:
      proof:
        atoms:
          - kind: condition
            source: { corpus_citation_path: us/statute/7/2015 }
          - kind: condition
            source: { corpus_citation_path: us/statute/7/2015/e/1 }
          - kind: import
            source: { corpus_citation_path: us/statute/7/2014/a }
`
      ),
      [],
      new Set()
    );
    expect(facts.cited.sort()).toEqual(["us/statute/7/2015/d/2/C", "us/statute/7/2015/e/1"]);
    expect(facts).toMatchObject({ rules: 1, deferred: [], waived: false });
  });

  it("defers a deferred module's source and its deferred outputs", () => {
    const deferred = moduleFacts(
      row(
        "us/statute/26/3401/a",
        `
module:
  status: deferred
  deferred_outputs:
    - output: "us:statutes/26/3401/a#wages"
      reason: Not yet encoded
rules: []
`
      ),
      [],
      new Set()
    );
    expect(deferred).toMatchObject({ cited: [], deferred: ["us/statute/26/3401/a"], rules: 0 });
    const branch = moduleFacts(
      row(
        "us/regulation/7/273/9",
        `
module:
  deferred_outputs:
    - output: "us:regulations/7-cfr/273/9/d/6#sua"
rules:
  - name: earned
    source: 7 CFR 273.9(b)(1)
`
      ),
      [],
      new Set()
    );
    expect(branch).toMatchObject({ cited: ["us/regulation/7/273/9/b/1"], deferred: ["us/regulation/7/273/9/d/6"] });
  });

  it("keeps a policy module's non-law sources, falls back to them, and marks waived files", () => {
    const facts = moduleFacts(
      row("us-az/policy/des/faa5/x", "rules:\n  - name: r\n    source: FAA5 block 3\n", "policies/des/faa5/x.yaml"),
      ["us-az/manual/des/faa5/x/block-3", "us/statute/26/1402"],
      waivedModules("validate_failures:\n  us-az/policies/des/faa5/x.yaml: [schema]\n")
    );
    // Its rule names its source in prose, so the module's own source stands in.
    expect(facts).toMatchObject({
      sources: ["us-az/manual/des/faa5/x/block-3"],
      cited: ["us-az/manual/des/faa5/x/block-3"],
      waived: true,
    });
  });
});
