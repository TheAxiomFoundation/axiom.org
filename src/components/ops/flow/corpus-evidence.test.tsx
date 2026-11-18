import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CorpusView } from "@/lib/axiom/corpus-releases";
import { CorpusEvidence } from "./corpus-evidence";

const NOW = Date.parse("2026-10-30T12:00:00Z");

const view: CorpusView = {
  outOfSync: 2,
  openPrs: { count: 34, draft: 23, oldestAt: null, url: "https://github.com/x/pulls" },
  lastPublish: { conclusion: "success", at: "2026-10-29T10:00:00Z", url: "https://x" },
  readAt: "2026-10-30T11:50:00Z",
  jurisdictions: [
    {
      jurisdiction: "nz",
      name: "New Zealand",
      flags: ["newer_not_active"],
      serving: { release: "nz-rulespec-2026-07-25", since: "2026-07-25T00:00:00Z", releases: 1, scopes: 4, provisions: null },
      newest: { release: "nz-rulespec-2026-10-20", signedAt: "2026-10-20T00:00:00Z", scopes: 5 },
      next: { release: "nz-rulespec-2026-10-20", signedAt: "2026-10-20T00:00:00Z", scopes: 5, adds: 1 },
      other: null,
      encoder: { repo: "rulespec-nz", release: "nz-rulespec-2026-10-20", state: "signed", lacks: 0, extra: 1 },
      since: "2026-10-20T00:00:00Z",
    },
    {
      jurisdiction: "de",
      name: "Germany",
      flags: ["not_serving"],
      serving: null,
      newest: { release: "de-rulespec-2026-09-15", signedAt: "2026-09-15T00:00:00Z", scopes: 2 },
      next: null,
      other: null,
      encoder: { repo: "rulespec-de", release: "de-rulespec-2026-09-15", state: "signed", lacks: null, extra: null },
      since: null,
    },
    { jurisdiction: "fr", name: "France", flags: [], serving: null, newest: null, next: null, other: null, encoder: null, since: null },
  ],
};

describe("CorpusEvidence", () => {
  it("shows what serves, what waits for activation and since when, and what the encoder pins", () => {
    render(<CorpusEvidence view={view} referenceMs={NOW} />);
    const region = screen.getByRole("region", { name: "Corpus releases" });
    // France has no release and no pin: it is left out, and the count follows the rows shown.
    expect(region.textContent).toContain("2 of 2 out of sync");
    expect(region.textContent).toContain("34 open corpus PRs");
    expect(region.textContent).toContain("read 10m ago");
    const nz = within(region).getByRole("rowheader", { name: "New Zealand" }).closest("tr")!;
    expect(nz.textContent).toContain("nz-rulespec-2026-07-25");
    expect(nz.textContent).toContain("adds 1 scopes");
    expect(nz.textContent).toContain("10d");
    expect(nz.textContent).toContain("Newer release not activated");
    expect(within(region).queryByRole("rowheader", { name: "France" })).toBeNull();
    expect(within(region).getByRole("rowheader", { name: "Germany" }).closest("tr")!.textContent).toContain("none");
  });
});
