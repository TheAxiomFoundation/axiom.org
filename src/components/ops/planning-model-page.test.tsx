import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PlanningModelPage,
  PLANNING_MODEL,
} from "./planning-model-page";

/**
 * Published cells round at intermediate steps of their arithmetic chains,
 * so end-to-end recomputation can differ by one unit in the last displayed
 * digit. A 3% relative guard proves the model stays coherent without
 * pinning the exact intermediate rounding the published values used.
 */
const REL_TOLERANCE = 0.03;

function parseMoney(cell: string): number {
  const value = Number(cell.replace(/[$k,]/g, ""));
  return cell.endsWith("k") ? value * 1_000 : value;
}

function expectClose(computed: number, published: number) {
  expect(Math.abs(computed / published - 1)).toBeLessThanOrEqual(
    REL_TOLERANCE,
  );
}

describe("PLANNING_MODEL arithmetic", () => {
  const m = PLANNING_MODEL;
  const attemptsWithHardFail =
    m.attemptsPerAccepted / m.firstPassAcceptance.high;

  it("keeps per-module token demand consistent with the tier tables", () => {
    const tokensPerModule = m.tokensPerPass * attemptsWithHardFail;
    for (const tier of m.tiers) {
      const direct = tier.modules * tokensPerModule;
      const published = Number(tier.directTokens.replace("B", "")) * 1e9;
      expectClose(direct, published);
      const system = direct * m.systemMultiplier;
      const publishedSystem =
        Number(tier.systemTokens.replace("B", "")) * 1e9;
      expectClose(system, publishedSystem);
    }
  });

  it("keeps $/module chains consistent with the model table", () => {
    for (const model of m.models) {
      const perPass =
        (m.mix.fresh * model.prices.input +
          m.mix.cachedRead * model.prices.cached +
          m.mix.output * model.prices.output) /
        1e6;
      const standard = perPass * attemptsWithHardFail;
      expectClose(standard, parseMoney(model.standard));
      const batch = standard * 0.5;
      expectClose(batch, parseMoney(model.batch));
      const system = batch * m.systemMultiplier;
      expectClose(system, parseMoney(model.system));
      const tierA = system * m.tiers[0].modules;
      expectClose(tierA, parseMoney(model.tierA));
      const tierB = system * m.tiers[1].modules;
      expectClose(tierB, parseMoney(model.tierB));
    }
  });

  it("keeps the development-usage rows footing exactly", () => {
    for (const row of m.devUsage) {
      expect(row.claude + row.codex).toBeCloseTo(row.total, 6);
    }
  });
});

describe("PlanningModelPage", () => {
  it("renders the headline, tables, and provenance legend", () => {
    render(<PlanningModelPage />);
    expect(
      screen.getByRole("heading", { name: "Compute planning model" }),
    ).toBeInTheDocument();
    // One row per coverage tier and per priced model
    expect(screen.getByText("A — oracle universe")).toBeInTheDocument();
    expect(screen.getByText("C — full statutory breadth")).toBeInTheDocument();
    expect(screen.getByText("Opus 4.8")).toBeInTheDocument();
    // Both vendors are first-class rows with production status
    expect(screen.getByText("gpt-5.6-terra")).toBeInTheDocument();
    expect(
      screen.getByText("encoder chosen in the July bake-off"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("OpenAI — native token units [M]"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Anthropic — constant-token normalization, ≈+30% pending a native count [A]",
      ),
    ).toBeInTheDocument();
    // $0.501 appears twice: Opus 4.8 standard and Fable 5 Batch
    expect(screen.getAllByText("$0.501")).toHaveLength(2);
    // Strict-accounting development-usage figures
    expect(screen.getByText("$176.9k")).toBeInTheDocument();
    expect(
      screen.getByText("Lifetime (since 2025-11-30)"),
    ).toBeInTheDocument();
    // Provenance badges render
    expect(screen.getAllByText("[M]").length).toBeGreaterThan(3);
    expect(screen.getAllByText("[D]").length).toBeGreaterThan(2);
    expect(screen.getAllByText("[A]").length).toBeGreaterThan(1);
  });

  it("maps the four slots where marginal compute plugs in", () => {
    render(<PlanningModelPage />);
    expect(
      screen.getByRole("heading", { name: "Where marginal compute plugs in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Generation waves — finish Tier A, then Tier B."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Encoder qualification — a planned quarterly bake-off."),
    ).toBeInTheDocument();
    expect(screen.getByText("Cross-family judging.")).toBeInTheDocument();
    expect(screen.getByText("The development fleet.")).toBeInTheDocument();
  });

  it("links example rule modules so the increment is concrete", () => {
    render(<PlanningModelPage />);
    expect(
      screen.getByRole("link", { name: "26 U.S.C. § 24" }),
    ).toHaveAttribute(
      "href",
      "https://axiom.org/us/statute/26/24",
    );
    expect(
      screen.getByRole("link", { name: "10 CCR 2506-1 § 4.110" }),
    ).toHaveAttribute(
      "href",
      "https://axiom.org/us-co/regulation/10-ccr-2506-1/4.110",
    );
  });

  it("states encoder, gate, judge and oracle-scope mechanics as the code shows them, with dates", () => {
    const { container } = render(<PlanningModelPage />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    // axiom-oracles conformance/scoreboard.json us-pe: 137 in scope at
    // b83f776f3 (2026-07-09, the last refresh before asOf), 127 at 522afa175.
    expect(PLANNING_MODEL.tiers[0].scope).toBe(
      "Policies checkable against an oracle: the 137 PolicyEngine-US policies in axiom-oracles' conformance scope as of 2026-07-11 (127 as of 2026-10-03), state income taxes across the 50 states and DC, state benefit manuals",
    );
    // axiom-encode 6f08e25c: the encode loop runs compile, companion tests,
    // literal grounding and import checks with oracle="none"; corpus
    // releases are Ed25519-signed.
    expect(text).toMatch(
      /reads the provision from a signed, hash-pinned corpus release, writes the module and its companion tests, runs deterministic checks \(rules-engine compile, the companion tests, grounding of numeric literals in the provisions each rule cites, and import resolution\), and retries with the failures as feedback\. Oracle comparisons run outside this loop, in axiom-oracles\./,
    );
    // Encoder defaults from axiom-encode constants.py history: b5b2c670
    // (2026-07-17) and 3689e83b (2026-09-24).
    expect(text).toMatch(
      /axiom-encode's default encoder moved to gpt-5\.6-terra on 2026-07-17 and to gpt-6-luna on 2026-09-24/,
    );
    expect(text).toMatch(
      /EncodeBench board has ranked candidate encoders by deterministic gate-pass rate on a fixed 16-case suite/,
    );
    // judges/client.py: Claude-only judges with a same-family guard; no
    // encode path imports the judges package.
    expect(text).toMatch(
      /Claude Haiku 4\.5, escalating low-confidence verdicts to Sonnet 4\.5, and refuse a judge from the generator's model family/,
    );
    expect(text).toMatch(/the encode command does not call them/);
    expect(text).toMatch(/As of 2026-10-03 none is scheduled in axiom-encode/);
    expect(
      screen.getByRole("columnheader", { name: "Role as of 2026-07-11" }),
    ).toBeInTheDocument();

    // Claims the code does not support.
    expect(text).not.toMatch(/137 programs currently scored/);
    expect(text).not.toMatch(/51 income-tax jurisdictions/);
    expect(text).not.toMatch(/citation resolution, dependency closure/);
    expect(text).not.toMatch(/oracle conformance where one exists/);
    expect(text).not.toMatch(/benchmark reputation/);
    expect(text).not.toMatch(/Every audit-logged encoder run is adjudicated/);
    expect(text).not.toMatch(/judging each other/);
    expect(text).not.toMatch(/standing quarterly bake-off/);
    expect(text).not.toMatch(/In production today/);
    expect(text).not.toMatch(/Today gpt-5\.6-terra is the pinned encoder/);
    for (const model of PLANNING_MODEL.models) {
      expect(model.today).not.toMatch(/cross-family|judge lane|judging/);
    }
    expect(
      PLANNING_MODEL.models.find((model) => model.name === "Haiku 4.5")?.today,
    ).toMatch(/^default judge model;/);
  });
});
