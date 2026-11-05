import { describe, expect, it } from "vitest";
import { inPin, linkedRefs, linkKind, prLinks, refsToRead, versionAtLeast, type LinkNode } from "./pr-links";

const xref = (repo: string, number: number) => ({ source: { __typename: "PullRequest", number, repository: { name: repo } } });
const pr = (repo: string, number: number, extra: Partial<LinkNode> = {}): LinkNode => ({
  __typename: "PullRequest",
  number,
  url: `https://github.com/TheAxiomFoundation/${repo}/pull/${number}`,
  title: `PR ${number}`,
  state: "OPEN",
  isDraft: false,
  repository: { name: repo },
  files: { totalCount: 1, nodes: [{ path: "x.py" }] },
  ...extra,
});

describe("linkKind", () => {
  it("names an item by its repo and, in a rulespec repo, its files and title", () => {
    expect(linkKind(pr("axiom-encode", 1))).toBe("encoder");
    expect(linkKind(pr("axiom-corpus", 1))).toBe("corpus");
    expect(linkKind(pr("rulespec-us", 1, { files: { totalCount: 1, nodes: [{ path: ".axiom/workflow-toolchain.toml" }] } }))).toBe("pin");
    // More files than the query listed: not known to be the toolchain file alone.
    expect(linkKind(pr("rulespec-us", 1, { files: { totalCount: 2, nodes: [{ path: ".axiom/workflow-toolchain.toml" }] } }))).toBe("rulespec");
    expect(linkKind(pr("rulespec-us", 1, { title: "Add signed encoding manifest for us-az/x" }))).toBe("encoding");
    expect(linkKind({ ...pr("axiom-corpus", 1), __typename: "Issue" })).toBe("issue");
  });
});

describe("linkedRefs", () => {
  it("follows cross-references and full references in the body, not a bare #n or the item itself", () => {
    const node = pr("rulespec-us", 2022, {
      body: "Needs TheAxiomFoundation/axiom-encode#2059, https://github.com/TheAxiomFoundation/axiom-corpus/issues/972, rulespec-us#2022 and #973.",
      timelineItems: { nodes: [xref("rulespec-us", 2023), xref("axiom-encode", 2058), null] },
    });
    expect(linkedRefs(node).sort()).toEqual(["axiom-corpus#972", "axiom-encode#2058", "axiom-encode#2059", "rulespec-us#2023"]);
  });
});

describe("prLinks", () => {
  it("walks two steps out, the second only from an open item, with each one's kind, state and version", () => {
    const start = pr("rulespec-us", 2022, {
      latestReviews: { nodes: [{ author: { login: "MaxGhenis" }, state: "CHANGES_REQUESTED", submittedAt: "2026-11-04T06:19:01Z" }] },
      comments: { totalCount: 13, nodes: [{ createdAt: "2026-11-05T15:08:31Z", author: { login: "PavelMakarchuk" } }] },
      timelineItems: { nodes: [xref("rulespec-us", 2023), xref("axiom-encode", 2058)] },
    });
    const nodes = new Map<string, LinkNode>([
      [
        "rulespec-us#2023",
        pr("rulespec-us", 2023, {
          isDraft: true,
          reviewDecision: "CHANGES_REQUESTED",
          latestReviews: { nodes: [{ author: { login: "MaxGhenis" }, state: "CHANGES_REQUESTED", submittedAt: "2026-11-04T13:00:00Z" }] },
          files: { totalCount: 1, nodes: [{ path: ".axiom/workflow-toolchain.toml" }] },
          timelineItems: { nodes: [xref("axiom-encode", 2059), xref("rulespec-us", 2022)] },
        }),
      ],
      // Merged: what links to it is not followed.
      ["axiom-encode#2058", pr("axiom-encode", 2058, { state: "MERGED", mergedAt: "2026-11-04T08:23:13Z", mergeCommit: { oid: "a" }, timelineItems: { nodes: [xref("rulespec-nz", 1)] } })],
      ["axiom-encode#2059", pr("axiom-encode", 2059, { state: "MERGED", mergedAt: "2026-11-04T09:00:00Z", mergeCommit: { oid: "b" } })],
    ]);
    expect(refsToRead(start, nodes)).toEqual([]);
    const links = prLinks(start, nodes, "0.2.2248", new Map([["a", "0.2.2240"], ["b", "0.2.2308"]]), "2026-11-05T16:00:00Z");
    expect(links.review).toEqual({ by: "MaxGhenis", state: "changes_requested", at: "2026-11-04T06:19:01Z" });
    expect(links.comments).toEqual({ count: 13, lastAt: "2026-11-05T15:08:31Z", lastBy: "PavelMakarchuk" });
    expect(links.links.map((l) => [l.ref, l.kind, l.state, l.review, l.reviewer, l.version, l.step, l.via])).toEqual([
      ["rulespec-us#2023", "pin", "draft", "changes_requested", "MaxGhenis", null, 1, null],
      ["axiom-encode#2058", "encoder", "merged", null, null, "0.2.2240", 1, null],
      ["axiom-encode#2059", "encoder", "merged", null, null, "0.2.2308", 2, "rulespec-us#2023"],
    ]);
    expect(links.links.map((l) => inPin(l, links.pin))).toEqual([null, true, false]);
  });

  it("asks for the items the walk still needs", () => {
    const start = pr("rulespec-us", 1, { timelineItems: { nodes: [xref("rulespec-us", 2)] } });
    expect(refsToRead(start, new Map())).toEqual(["rulespec-us#2"]);
    const open = new Map([["rulespec-us#2", pr("rulespec-us", 2, { timelineItems: { nodes: [xref("axiom-encode", 3)] } })]]);
    expect(refsToRead(start, open)).toEqual(["axiom-encode#3"]);
  });
});

describe("versionAtLeast", () => {
  it("compares dotted versions part by part", () => {
    expect(versionAtLeast("0.2.2308", "0.2.2248")).toBe(true);
    expect(versionAtLeast("0.2.999", "0.2.2248")).toBe(false);
    expect(versionAtLeast("0.2.2248", "0.2.2248")).toBe(true);
  });
});
