import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgramBundle } from "./program-bundle";
import {
  measureDocument,
  type BundleFileDocument,
  type BundleRow,
  type ModuleFacts,
  type TierCounts,
} from "@/lib/axiom/program-bundles";

/** A tier's stored counts with this many documents (and as many provisions). */
const tierCountsOf = (documents: number): TierCounts => ({
  documents,
  excluded: 0,
  byStatus: { complete: 0, unvalidated: 0, partly: 0, not_started: documents, not_in_corpus: 0 },
  provisions: documents,
  byProvisionState: { encoded: 0, unvalidated: 0, partly: 0, deferred: 0, in_progress: 0, failed: 0, not_started: documents },
  units: 0,
  byUnitState: { encoded: 0, unvalidated: 0, partly: 0, deferred: 0, in_progress: 0, failed: 0, not_encoded: 0, not_in_corpus: 0 },
});

const AT = "2026-10-06T12:00:00Z";
const NOW = Date.parse("2026-10-06T12:30:00Z");

const bundle: BundleRow = {
  id: "us-az/snap",
  title: "Arizona SNAP",
  program: "snap",
  jurisdiction: "us-az",
  as_of: "2026-10-06",
  parts: [],
  tiers: [
    {
      id: "screener",
      title: "Screener-level parity",
      definition: "Every PolicyEngine-cited document.",
      membership: {
        rule: "The plan's documents and PolicyEngine's references",
        policyengine_us_version: "2.29.11",
        policyengine_us_commit: "4c900b6d3d808c4a9cf56d11afcedad9898f732f",
        reference_count: 448,
        fiscal_year: 2027,
      },
    },
    {
      id: "full",
      title: "Full document bundle",
      definition: "Every relevant document.",
      membership: { rule: "The screener tier, the federal law and the state's sources", known_sources: 12 },
    },
  ],
  source: "local",
  parity: {
    suite: "az-snap-ecps",
    report_url: "https://github.com/TheAxiomFoundation/axiom-oracles/blob/main/dashboard/public/data/r.json",
    generated_at: "2026-07-28T22:20:39Z",
    run_kind: "manual",
    reemitted: false,
    policyengine_us: "1.767.3",
    rulespec_sha: "c13cdf7",
    households: 1341,
    households_matching: 1035,
    eligible_policyengine: 0.2789,
    eligible_axiom: 0,
    eligible_matching: 0,
    mismatches: 597,
    axiom_errors: 597,
    by_disposition: { axiom_encoding_gap: 597 },
    issues: [{ url: "https://github.com/TheAxiomFoundation/rulespec-us/issues/1116", mismatches: 597 }],
    outputs: [
      { concept: "us:statutes/7/2014/o#snap_eligible", description: "SNAP eligibility", mismatches: 306 },
      { concept: "us:statutes/7/2014/u#snap_benefit", description: "SNAP benefit amount", mismatches: 291 },
    ],
  },
  policyengine_latest: "2.29.10",
  collected_at: AT,
};

const doc = (overrides: Partial<BundleFileDocument>): BundleFileDocument => ({
  key: "us/statute/7/2014",
  name: "7 USC 2014",
  layer: "federal",
  part: "Income",
  citation_path: "us/statute/7/2014",
  source_url: null,
  sources: ["plan"],
  scope: "in",
  ...overrides,
});

const nodes = [
  { path: "us/statute/7/2014", child_count: 2 },
  { path: "us/statute/7/2014/a", child_count: 0 },
  { path: "us/statute/7/2014/b", child_count: 0 },
];
const module = (path: string, facts: Partial<ModuleFacts> = {}): ModuleFacts => ({
  module: path,
  sources: [path],
  cited: [path],
  broad: [],
  deferred: [],
  rules: 1,
  waived: false,
  ...facts,
});

const documents = [
  measureDocument(
    "us-az/snap",
    "screener",
    doc({
      cited: [
        { path: "us/statute/7/2014/a", references: 2, part: "Income" },
        { path: "us/statute/7/2014/b", references: 1, part: "Deductions" },
      ],
    }),
    // (a) is encoded; a module with no rules defers (b).
    {
      nodes,
      modules: [module("us/statute/7/2014/a"), module("us/statute/7/2014/b", { cited: [], deferred: ["us/statute/7/2014/b"], rules: 0 })],
      attempts: [],
    },
    AT
  ),
  measureDocument(
    "us-az/snap",
    "screener",
    doc({
      key: "https://www.fns.usda.gov/x",
      name: "FNS FY2019 table",
      citation_path: null,
      source_url: "https://www.fns.usda.gov/x",
      scope: "excluded",
      reason: "Back-year table: not current law",
    }),
    null,
    AT
  ),
  measureDocument(
    "us-az/snap",
    "full",
    doc({
      key: "us-az/manual/des/faa5/x",
      name: "FAA5 page",
      layer: "state",
      part: "Benefit determination",
      citation_path: "us-az/manual/des/faa5/x",
    }),
    { nodes: [], modules: [], attempts: [] },
    AT
  ),
];

describe("ProgramBundle", () => {
  const withParts = { ...bundle, parts: ["Income", "Deductions", "Benefit determination"] };

  it("counts documents in both tiers by default, a row per part, each cell its own share", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    expect(screen.getByRole("heading", { name: "Arizona SNAP" })).toBeInTheDocument();
    // The page sits in the /ops bundles tab; its back link returns to the grid on its program.
    expect(screen.getByRole("link", { name: "All program bundles" })).toHaveAttribute("href", "/ops?tab=bundles&program=snap");
    const matrix = screen.getByRole("table", { name: "Parts of the program by tier" });
    const headers = within(matrix).getAllByRole("columnheader");
    // Both tiers lead with how much is encoded; under the screener tier's, its comparison run.
    expect(headers[1]).toHaveTextContent(
      /Screener-level parity\?0 of 1 document complete0%0 complete and validated · 0%\?Screener-level parity run/
    );
    // The comparison run is a result, and says why it is 0%.
    expect(headers[1]).toHaveTextContent(
      "0% of eligible households matchAxiom finds no household eligible: held by rulespec-us#1116597 mismatched outputs in 306 households, 597 to fix in Axiom · run Jul 28, 2026, 9w ago (over 30 days old) · run against reference version 1.767.3 (newest 2.29.10)"
    );
    expect(headers[2]).toHaveTextContent(/Full document bundle.*0 of 1 document complete0%/);
    // Rows in the bundle's order of parts.
    expect(within(matrix).getAllByRole("rowheader").map((h) => h.textContent)).toEqual([
      "Income",
      "Benefit determination",
      "Documents?",
      "Provisions?",
    ]);
    expect(
      within(matrix).getByRole("button", { name: "Income, Screener-level parity: 0 of 1 document complete" })
    ).toHaveTextContent("0 of 10%");
  });

  it("switches every cell to provisions, counting documents the corpus lacks apart", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("radio", { name: "Provisions" }));
    const matrix = screen.getByRole("table", { name: "Parts of the program by tier" });
    const headers = within(matrix).getAllByRole("columnheader");
    // Tier 1 is screener-level parity: it counts the provisions that parity needs, each in its own part.
    expect(headers[1]).toHaveTextContent(/1 of 2 Tier 1 provisions encoded50%/);
    expect(
      within(matrix).getByRole("button", { name: "Income, Screener-level parity: 1 of 1 Tier 1 provision encoded" })
    ).toHaveTextContent("1 of 1100%");
    expect(
      within(matrix).getByRole("button", { name: "Deductions, Screener-level parity: 0 of 1 Tier 1 provision encoded" })
    ).toHaveTextContent("0 of 10%");
    // A document the corpus does not hold counts once, as not in the corpus.
    expect(
      within(matrix).getByRole("button", { name: "Benefit determination, Full document bundle: 0 of 1 provision encoded" })
    ).toHaveTextContent("0 of 10%");
  });

  it("opens in the count the /ops grid showed", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} initialCount="provisions" />);
    expect(screen.getByRole("radio", { name: "Provisions" })).toHaveAttribute("aria-checked", "true");
    const headers = within(screen.getByRole("table", { name: "Parts of the program by tier" })).getAllByRole("columnheader");
    expect(headers[1]).toHaveTextContent(/1 of 2 Tier 1 provisions encoded50%/);
  });

  it("counts each tier's documents and provisions exactly", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    const matrix = screen.getByRole("table", { name: "Parts of the program by tier" });
    const cells = within(matrix).getAllByRole("cell");
    // One line per state, in the same order in every tier; excluded documents sit apart.
    expect(cells.at(-4)).toHaveTextContent(
      "1 in scopeComplete0Complete, not validated0Partly encoded1Not started0Not in the corpus0Excluded1"
    );
    expect(within(cells.at(-4)!).getByRole("button", { name: "1 excluded" })).toBeEnabled();
    expect(within(cells.at(-4)!).getByRole("button", { name: "0 complete" })).toBeDisabled();
    expect(cells.at(-2)).toHaveTextContent(
      "2 in Tier 1Encoded1Encoded, not validated0Partly encoded0Deferred1In progress0Failed0Not started0Not in the corpus0"
    );
  });

  it("opens a cell's documents, and the screener-level parity drawer", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Income, Screener-level parity: 0 of 1 document complete" }));
    const cell = screen.getByRole("complementary", { name: "Part of the program" });
    expect(within(cell).getByRole("heading", { name: "Income" })).toBeInTheDocument();
    fireEvent.click(within(cell).getByRole("button", { name: /7 USC 2014/ }));
    const document = screen.getByRole("complementary", { name: "Document" });
    expect(within(document).getByText("Encoded").parentElement).toHaveTextContent("Encoded1");
    fireEvent.click(screen.getByRole("button", { name: /0% of eligible households match/ }));
    const parity = screen.getByRole("complementary", { name: "Screener-level parity" });
    expect(within(parity).getByRole("heading", { name: "0% of eligible households match" })).toBeInTheDocument();
    expect(parity).toHaveTextContent("Eligible householdsReference 28% · Axiom 0%");
    expect(parity).toHaveTextContent("Axiom errors to fix597 of 597 mismatched outputs");
    expect(within(parity).getByRole("link", { name: "rulespec-us#1116" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-us/issues/1116"
    );
    expect(parity).toHaveTextContent("Tier 1 provisions1 of 2 encoded");
    fireEvent.click(within(parity).getByRole("button", { name: /7 USC 2014 \/b/ }));
    const unit = screen.getByRole("complementary", { name: "Tier 1 provision" });
    expect(within(unit).getByRole("link", { name: "us/statute/7/2014/b" })).toHaveAttribute("href", "/us/statute/7/2014/b");
    expect(within(unit).getByText("Deductions")).toBeInTheDocument();
    expect(within(unit).getByText("Deferred by us/statute/7/2014/b.")).toBeInTheDocument();
  });

  it("groups the documents by type, or by part, each group closed with its provisions at a glance, and sorts every column", () => {
    const moreDocuments = [
      ...documents,
      measureDocument(
        "us-az/snap",
        "screener",
        doc({ key: "us/statute/7/2017", name: "7 USC 2017", citation_path: "us/statute/7/2017" }),
        {
          nodes: [
            { path: "us/statute/7/2017", child_count: 3 },
            { path: "us/statute/7/2017/a", child_count: 0 },
            { path: "us/statute/7/2017/b", child_count: 0 },
            { path: "us/statute/7/2017/c", child_count: 0 },
          ],
          modules: [],
          attempts: [],
        },
        AT
      ),
      measureDocument(
        "us-az/snap",
        "screener",
        doc({ key: "us/statute/7/2015", name: "7 USC 2015", citation_path: "us/statute/7/2015", part: "Deductions" }),
        { nodes: [], modules: [], attempts: [] },
        AT
      ),
    ];
    render(<ProgramBundle bundle={withParts} documents={moreDocuments} available referenceMs={NOW} />);
    const panel = screen.getByRole("region", { name: "Documents" });
    expect(within(panel).getByRole("heading", { name: "Documents" })).toHaveTextContent(/^Documents$/);
    // By document type first: the three statutes and the FNS page apart.
    expect(within(panel).getByRole("button", { name: /^Federal statutes and public laws3 documents/ })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("radio", { name: "Part" }));
    const income = within(panel).getByRole("button", { name: /^Income/ });
    expect(income).toHaveAttribute("aria-expanded", "false");
    // Tier 1 counts the provisions that parity needs: two in 7 USC 2014, and all three of 7 USC 2017, cited whole.
    expect(income).toHaveTextContent("Income2 documents · 0 complete1 of 5 Tier 1 provisions encoded");
    expect(within(panel).getByRole("button", { name: /^Deductions/ })).toHaveTextContent(
      "Deductions1 document · 0 complete · 1 not in the corpus0 of 1 Tier 1 provision encoded"
    );
    expect(within(panel).queryByRole("button", { name: "7 USC 2017" })).toBeNull();
    fireEvent.click(income);
    // Most Tier 1 provisions first by default.
    const names = () => [...panel.querySelectorAll('tbody th[scope="row"] button')].map((b) => b.textContent);
    expect(names().slice(0, 2)).toEqual(["7 USC 2017", "7 USC 2014"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Tier 1" }));
    expect(within(panel).getByRole("columnheader", { name: "Tier 1" })).toHaveAttribute("aria-sort", "ascending");
    expect(names().slice(0, 2)).toEqual(["7 USC 2014", "7 USC 2017"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Encoded" }));
    expect(within(panel).getByRole("columnheader", { name: "Encoded" })).toHaveAttribute("aria-sort", "descending");
    expect(names().slice(0, 2)).toEqual(["7 USC 2014", "7 USC 2017"]);
    fireEvent.click(within(panel).getByRole("radio", { name: "Status" }));
    expect(within(panel).getByRole("button", { name: /^Partly encoded/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /^Not started\d/ })).toBeInTheDocument();
  });

  it("lists excluded documents with their reasons in the table", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "1 excluded" }));
    const table = screen.getByRole("table", { name: "Screener-level parity documents" });
    // Grouped by reason; a lone group is open.
    expect(within(table).getByRole("button", { name: /^Back-year table: not current law1 document/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(within(table).getByRole("cell", { name: "Back-year table: not current law" })).toBeInTheDocument();
  });

  it("says where each tier's numbers come from", () => {
    render(<ProgramBundle bundle={withParts} documents={documents} available referenceMs={NOW} />);
    const provenance = screen.getByRole("region", { name: "Where the numbers come from" });
    expect(provenance).toHaveTextContent("Tier 1 built from reference version2.29.11 (4c900b6d3d), 448 references; the newest release");
    expect(provenance).toHaveTextContent("Screener-level parity runaz-snap-ecps, run against reference version 1.767.3, Jul 28, 2026");
    expect(provenance).toHaveTextContent("FY2027");
    expect(provenance).toHaveTextContent("12 known sources");
  });

  it("names the parity run's reference version and RuleSpec commit, and weighs as the report does", () => {
    const weighted = {
      ...withParts,
      parity: {
        ...bundle.parity!,
        weighted: true,
        rulespecs: [{ repo: "TheAxiomFoundation/rulespec-us", sha: "c13cdf7dda5948e7a86ff0c317872f93743a2084" }],
      },
    };
    render(<ProgramBundle bundle={weighted} documents={documents} available referenceMs={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: /0% of eligible households match/ }));
    const parity = screen.getByRole("complementary", { name: "Screener-level parity" });
    expect(parity).toHaveTextContent("from both (survey-weighted).");
    expect(parity).toHaveTextContent("Run against reference version1.767.3 · newest is 2.29.10");
    expect(within(parity).getByRole("link", { name: "rulespec-us@c13cdf7" })).toHaveAttribute(
      "href",
      "https://github.com/TheAxiomFoundation/rulespec-us/commit/c13cdf7dda5948e7a86ff0c317872f93743a2084"
    );
    expect(parity).toHaveTextContent("Jul 28, 2026, 9w ago · over 30 days old · manual run");
    expect(parity).toHaveTextContent("Mismatched outputs597 mismatched outputs in 306 households");
  });

  it("says parity runs are per state on a federal bundle, and that a state has no documents of its own", () => {
    const federal = { ...withParts, id: "us/snap", title: "SNAP: federal law", jurisdiction: "us", parity: null };
    render(<ProgramBundle bundle={federal} documents={documents} available referenceMs={NOW} />);
    const headers = within(screen.getByRole("table", { name: "Parts of the program by tier" })).getAllByRole("columnheader");
    expect(headers[1]).toHaveTextContent("Parity runs are per state");
    expect(headers[1]).not.toHaveTextContent("No run yet");
    cleanup();
    // A state bundle whose Tier 1 is all federal law.
    const federalOnly = documents.map((d) => ({ ...d, bundle_id: "us/snap" }));
    render(<ProgramBundle bundle={withParts} documents={federalOnly} available referenceMs={NOW} />);
    expect(screen.getByRole("region", { name: "Where the numbers come from" })).toHaveTextContent(
      "By layer1 federal; no state documents in this tier"
    );
  });

  it("totals the table as its rows show it, with what the corpus does not hold on a row of its own", () => {
    const full = [
      ...documents,
      measureDocument(
        "us-az/snap",
        "full",
        doc({ key: "us/statute/7/2014", sources: ["screener"] }),
        { nodes, modules: [module("us/statute/7/2014/a")], attempts: [] },
        AT
      ),
    ];
    render(<ProgramBundle bundle={withParts} documents={full} available referenceMs={NOW} initialCount="provisions" />);
    const cells = within(screen.getByRole("table", { name: "Parts of the program by tier" })).getAllByRole("cell");
    // Tier 2 counts the document the corpus does not hold, so its total is the tier's, not the corpus's.
    expect(cells.at(-1)).toHaveTextContent(/^3 in Tier 2Encoded1/);
    fireEvent.click(screen.getByRole("tab", { name: "Full document bundle" }));
    const table = screen.getByRole("table", { name: "Full document bundle documents" });
    const foot = table.querySelector("tfoot")!;
    expect(within(foot).getByRole("rowheader", { name: "Total" }).closest("tr")).toHaveTextContent("Total10000012");
    expect(within(foot).getByRole("rowheader", { name: "Not in the corpus" }).closest("tr")).toHaveTextContent(
      "Not in the corpusonce per document the corpus does not hold1"
    );
  });

  it("says why each Tier 1 document is in Tier 1, and when a tier's total changed", () => {
    const snapshots = [
      { bundle_id: "us-az/snap", tier: "screener" as const, day: "2026-10-04", counts: { ...tierCountsOf(1) } },
      { bundle_id: "us-az/snap", tier: "screener" as const, day: "2026-10-05", counts: { ...tierCountsOf(3) } },
    ];
    render(<ProgramBundle bundle={withParts} documents={documents} snapshots={snapshots} available referenceMs={NOW} />);
    const headers = within(screen.getByRole("table", { name: "Parts of the program by tier" })).getAllByRole("columnheader");
    expect(headers[1]).toHaveTextContent("Changed from 3 on Oct 5, 2026");
    const panel = screen.getByRole("region", { name: "Documents" });
    fireEvent.click(within(panel).getByRole("button", { name: /^Federal statutes and public laws/ }));
    expect(within(panel).getByRole("button", { name: "7 USC 2014" }).closest("th")).toHaveTextContent(
      "7 USC 2014Partly encoded · by the plan"
    );
  });

  it("says when the bundle tables are not there yet", () => {
    render(<ProgramBundle bundle={null} documents={[]} available={false} referenceMs={NOW} />);
    expect(screen.getByText("The bundle tables are not available yet.")).toBeInTheDocument();
  });
});
