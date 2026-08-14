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
    expect(screen.getByText("pinned production encoder")).toBeInTheDocument();
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
    expect(screen.getByText("$334.4k")).toBeInTheDocument();
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
      screen.getByText("Encoder qualification — the standing quarterly bake-off."),
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
      "https://app.axiom-foundation.org/us/statute/26/24",
    );
    expect(
      screen.getByRole("link", { name: "10 CCR 2506-1 § 4.110" }),
    ).toHaveAttribute(
      "href",
      "https://app.axiom-foundation.org/us-co/regulation/10-ccr-2506-1/4.110",
    );
  });
});
