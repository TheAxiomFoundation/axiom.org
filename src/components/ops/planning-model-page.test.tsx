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
      screen.getByText("passed the July bake-off"),
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

  it("reports the SNAP QC replay as it stands and discloses the PolicyEngine tie", () => {
    const { container } = render(<PlanningModelPage />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    expect(text).toMatch(
      /all 856 Colorado FY 2024 cases match the benefit Mathematica computes for USDA from each case record/,
    );
    expect(text).toMatch(/eligibility is untested/);
    expect(text).toMatch(/Max Ghenis is CEO of both Axiom and PolicyEngine/);
    expect(text).toMatch(/TAXSIM executable that PolicyEngine packages/);
    // The July first run (816 of 856) is superseded, and FSBEN is a
    // computed benefit rather than a determination. axiom-encode's judge-*
    // commands are standalone (cli.py registers and dispatches them as their
    // own subcommands; nothing else in src imports the judges package, as of
    // axiom-encode 13bd0ded), and judges/client.py refuses any non-Claude
    // judge, so no claim that cross-family judges review every run.
    expect(text).not.toMatch(/95\.3%/);
    expect(text).not.toMatch(/quality-control determinations/i);
    expect(text).not.toMatch(/independent oracle/i);
    expect(text).not.toMatch(/judge models review every/i);
    expect(PLANNING_MODEL.tiers[0].scope).not.toMatch(/independent/i);
  });

  it("states the SOUTHMOD result with its three caveats", () => {
    const { container } = render(<PlanningModelPage />);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");

    // axiom-oracles main merged the SOUTHMOD suites (#205 through #260) on
    // 2026-10-04: 40 suites under comparisons/{gh,ug,zm,et,rw}-*.yaml, whose
    // committed reports (dashboard/public/data/axiom-euromod-*.json, all
    // generated 2026-10-04 with run_kind "manual") sum to 245 comparisons,
    // 242 matches and 3 mismatches, each dispositioned upstream_engine_gap
    // (dispositions/et-business-mat.yaml, gh-income-tax-rate-schedule.yaml).
    // The configs name SOUTHMOD_A4.0 and EM_Executable 1.0.0, the version
    // details the Adhesion Agreement's clause 2 asks outputs to state.
    expect(text).toMatch(
      /Against SOUTHMOD A4\.0, UNU-WIDER's models for Ghana, Uganda, Zambia, Ethiopia and Rwanda run on EUROMOD EM_Executable 1\.0\.0, 242 of 245 comparisons match as of 2026-10-04/,
    );
    expect(text).toMatch(/the other 3 are recorded as gaps in those models/);
    // The dashboard's SOUTHMOD record carries the full acknowledgement
    // (axiom-oracles dashboard/src/utils/suites.js southmodAcknowledgement).
    expect(
      screen.getByRole("link", { name: "SOUTHMOD A4.0" }),
    ).toHaveAttribute("href", "https://axiom.org/oracles?oracle=southmod");

    // (a) Every SOUTHMOD suite declares `ci: manual`: Adhesion Agreement
    // clause 4 bars providing SOUTHMOD or its input datasets to any third
    // party, so no shared CI runner can hold the bundle.
    expect(text).toMatch(
      /the runs are manual, on our licensed machine rather than in CI, because the license bars giving the model or its data to third parties/,
    );
    // (b) In rulespec-gh, -ug, -zm and -et every compared module's
    // .axiom/encoding-manifests entry has backend "manual" and runner
    // "manual-attestation" (axiom-encode sign-applied-files), not
    // `encode --apply`; rulespec-rw has no encoding manifests at all.
    expect(text).toMatch(
      /the compared rule modules are not encoder output \(Rwanda's carry no encoding record, and the other four countries' carry manual attestations\)/,
    );
    // (c) Every suite runs `population: synthetic`; GHAMOD, UGAMOD,
    // MicroZAMOD and ETMOD read only their dataset's variable list, and the
    // bundle ships no Rwandan microdata (rw-*.yaml build a header-only file).
    expect(text).toMatch(
      /every compared household is synthetic, with no microdata at all for Rwanda/,
    );

    // The pre-#297 unqualified mention stays retired.
    expect(text).not.toMatch(/SOUTHMOD country models, plus state administrative/);
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
    // State income taxes are rows inside that scope, so they are not listed
    // as a separate count.
    expect(PLANNING_MODEL.tiers[0].scope).toBe(
      "Policies checkable against an oracle: the 137 PolicyEngine-US policies in axiom-oracles' conformance scope as of 2026-07-11 (127 as of 2026-10-03), state income taxes among them, plus state benefit manuals",
    );
    // axiom-encode 6f08e25c: encode runs compile, companion tests, literal
    // grounding and import checks with oracle="none"; corpus releases are
    // Ed25519-signed; validator-rejected candidates retry (b5b2c670).
    expect(text).toMatch(
      /As of 2026-10-03, each rule module is produced by an agentic encoder loop: the agent reads the provision from a signed, hash-pinned corpus release and writes the module and its companion tests, then the harness runs deterministic checks, including rules-engine compile, the companion tests, grounding of numeric literals in the cited source text, and import resolution\./,
    );
    expect(text).toMatch(
      /the encoder retries with the failures as feedback, by default making up to two attempts on its default model and up to two more on an escalation model \(retries since 2026-07-17\)/,
    );
    expect(text).toMatch(
      /Oracle comparisons run outside this loop: in axiom-oracles, and in axiom-encode's separate validate and eval-suite commands\./,
    );
    // Encoder defaults from axiom-encode constants.py history: b5b2c670
    // (2026-07-17) and 3689e83b (2026-09-24).
    expect(text).toMatch(
      /axiom-encode's default encoder moved from gpt-5\.5 to gpt-5\.6-terra on 2026-07-17; on 2026-09-24 it moved to gpt-6-luna, which that bake-off did not include/,
    );
    expect(text).toMatch(
      /EncodeBench board can rank candidate encoders by deterministic gate-pass rate on a fixed suite of 16 UK cases/,
    );
    // evals.py: the encode path runs the generalist reviewer unless
    // --skip-reviewers; judges/client.py: Claude-only judges with a
    // same-family guard, escalating below 0.6 confidence.
    expect(text).toMatch(
      /As of 2026-10-03, the encode command by default also asks an LLM reviewer \(the Claude CLI's opus alias, or Codex where Claude is not installed\) to score each candidate that passes the deterministic checks; the score does not block apply\./,
    );
    expect(text).toMatch(
      /Since 2026-07-08, separate judge commands, run by an operator, have defaulted to Claude Haiku 4\.5; they re-ask Sonnet 4\.5 once when a verdict's confidence is below 0\.6 and refuse a judge outside the Claude family or from the generator's family\./,
    );
    expect(text).toMatch(
      /As of 2026-10-03, axiom-encode's judge commands default to Claude Haiku 4\.5/,
    );
    expect(text).toMatch(/the encode command does not call them/);
    expect(text).toMatch(
      /gpt-5\.5 produced 3,289 of the 3,582 measured runs, all of which predate the retry loop/,
    );
    expect(text).toMatch(
      /After a bake-off of 8 US citations on 4 models on 2026-07-10/,
    );
    expect(text).toMatch(/from any vendor whose model passes an encoder bake-off/);
    expect(text).toMatch(
      /each section's attempts run in order, and separate sections run as staged waves/,
    );
    expect(text).toMatch(
      /Cost per accepted module for the models we ran as of 2026-07-11 and the ones we could/,
    );
    expect(text).toMatch(/As of 2026-10-03 none is scheduled in axiom-encode/);
    expect(
      screen.getByRole("columnheader", { name: "Role as of 2026-07-11" }),
    ).toBeInTheDocument();

    // Claims the code does not support.
    for (const retired of [
      /137 programs currently scored/,
      /51 income-tax jurisdictions/,
      /50 states and DC/,
      /citation resolution, dependency closure/,
      /oracle conformance where one exists/,
      /benchmark reputation/,
      /Every audit-logged encoder run is adjudicated/,
      /judging each other/,
      /standing quarterly bake-off/,
      /clears the bake-off/,
      /Results are publishable either way/,
      /empirical gate between the price table/,
      /In production today/,
      /pinned production encoder/,
      /Today gpt-5\.6-terra is the pinned encoder/,
      /board has ranked/,
      /each pass is an independent request/,
      /each section is an independent request/,
      /models we run today/,
      /encoder chosen in the July bake-off/,
      /signed CI applies skip/,
    ]) {
      expect(text).not.toMatch(retired);
    }
    for (const model of PLANNING_MODEL.models) {
      expect(model.today).not.toMatch(/cross-family|judge lane|judging/);
    }
    const role = (name: string) =>
      PLANNING_MODEL.models.find((model) => model.name === name)?.today;
    expect(role("Haiku 4.5")).toMatch(/^default judge model;/);
    expect(role("gpt-5.5")).toBe(
      "default encoder until 2026-07-17; 3,289 of the 3,582 measured runs",
    );
  });
});
