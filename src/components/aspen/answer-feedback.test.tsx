import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDataStream, summarizeRules, type RulesAnswer, type RulesComputation } from "@/lib/aspen/rules";
import { federalFiscalYear, snapStandardsYears } from "@/lib/aspen/coverage";
import { azSavingsStream } from "@/test/rules-az-savings";
import {
  citationPath,
  formatPeriod,
  outputLabel,
  panelRows,
  RatingCard,
  RulesCheck,
  rulesCaveats,
  shownValue,
} from "./answer-feedback";
import { formatValue } from "./client";

function jsonResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data } as unknown as Response;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

const MESSAGES = [{ role: "user" as const, content: "How much SNAP can I get?" }, { role: "assistant" as const, content: "$0" }];

const SNAP_RESULT: RulesAnswer & { latencyMs: number } = {
  text: "**You get $24 a month.** See https://des.az.gov/snap",
  computations: [
    {
      program: "snap",
      displayName: "SNAP",
      period: "2026-10",
      primary: {
        name: "snap",
        label: "Snap",
        value: 24,
        unit: "USD",
        incomplete: false,
        legalId: "us:statutes/7/2017#a",
        semantics: "scalar",
      },
      outputs: [
        {
          name: "snap",
          label: "Snap",
          value: 24,
          unit: "USD",
          incomplete: false,
          legalId: "us:statutes/7/2017#a",
          semantics: "scalar",
        },
        {
          name: "snap_excess_shelter_deduction",
          label: "Snap excess shelter deduction",
          value: 512.5,
          unit: "USD",
          incomplete: true,
          legalId: "us:statutes/7/2014#e",
          semantics: "scalar",
        },
      ],
      disclosures: [],
      standardsYears: [],
      eligibilityTested: true,
    },
  ],
  amount: 24,
  program: "SNAP",
  period: "2026-10",
  incomplete: ["snap standard utility allowance sua"],
  citations: ["us:statutes/7/2017#a", "us:statutes/7/2017#b", "us-az:policies/des/faa5/x#y"],
  errors: [],
  latencyMs: 1200,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("aspen.participant", "p-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("citationPath", () => {
  it("drops the anchor and turns the first colon into a slash", () => {
    expect(citationPath("us-az:policies/des/faa5/x#y")).toBe("us-az/policies/des/faa5/x");
    expect(citationPath("us:statutes/7/2017")).toBe("us/statutes/7/2017");
  });
});

describe("formatPeriod", () => {
  it("spells out a year-month", () => {
    expect(formatPeriod("2026-10")).toBe("October 2026");
    expect(formatPeriod("2027-01")).toBe("January 2027");
  });

  it("leaves other periods unchanged", () => {
    expect(formatPeriod("2026")).toBe("2026");
    expect(formatPeriod(null)).toBeNull();
  });

  it("keeps the raw month when it is out of range", () => {
    expect(formatPeriod("2026-13")).toBe("13 2026");
  });
});

describe("outputLabel", () => {
  it("drops a leading program name and capitalizes", () => {
    expect(outputLabel("Snap excess shelter deduction")).toBe("Excess shelter deduction");
    expect(outputLabel("tanf countable income")).toBe("Countable income");
  });

  it("upper-cases acronyms", () => {
    expect(outputLabel("Snap")).toBe("SNAP");
    expect(outputLabel("standard utility allowance sua")).toBe("Standard utility allowance SUA");
    expect(outputLabel("income as share of fpl")).toBe("Income as share of FPL");
  });
});

describe("RatingCard", () => {
  it("asks one question at a time", () => {
    render(<RatingCard promptId="p1" />);
    expect(screen.getByText("Does it look right?")).toBeInTheDocument();
    expect(screen.queryByText("Would you act on it?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rating" })).not.toBeInTheDocument();

    expect(screen.queryByLabelText(/Anything the room should know about this answer\?/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    expect(screen.getByRole("button", { name: "Not sure" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Would you act on it?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rating" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(screen.getByRole("button", { name: "Maybe" })).toHaveAttribute("aria-pressed", "true");
    // Third: what a resident would do; the tags, note and save come after it.
    expect(screen.getByText("What would a resident do next?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save rating" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Call to check" }));
    expect(screen.getByRole("button", { name: "Call to check" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/What went wrong\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wrong amount" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plain and clear" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Anything the room should know about this answer\?/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save rating" })).toBeEnabled();
  });

  it("leads with what went well for a right answer and offers the rest on request", () => {
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText(/What went well\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plain and clear" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong amount" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Something went wrong too?" }));
    expect(screen.getByRole("button", { name: "Wrong amount" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Something went wrong too?" })).not.toBeInTheDocument();
  });

  it("posts the rating and reports success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);

    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Wrong amount" }));
    fireEvent.click(screen.getByRole("button", { name: "Something went well too?" }));
    fireEvent.click(screen.getByRole("button", { name: "Plain and clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Gave a number" }));
    fireEvent.click(screen.getByRole("button", { name: "Plain and clear" }));
    expect(screen.getByRole("button", { name: "Plain and clear" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByLabelText(/Anything the room should know about this answer\?/), { target: { value: "Missed BBCE" } });

    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("Rating saved. Thank you.")).toBeInTheDocument();
    expect(onRated).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/rate");
    expect(bodyOf(fetchMock)).toEqual({
      participantId: "p-1",
      promptId: "p1",
      verdict: "wrong",
      wouldAct: "no",
      residentAction: "not-apply",
      wentWell: ["Gave a number"],
      wentWrong: ["Wrong amount"],
      note: "Missed BBCE",
    });
  });

  it("shows a saving state while the request is open", async () => {
    let resolve: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r))));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => resolve(jsonResponse({ ok: true })));
    expect(await screen.findByText("Rating saved. Thank you.")).toBeInTheDocument();
  });

  it("reports a failed save and keeps the form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "no" }, false)));
    const onRated = vi.fn();
    render(<RatingCard promptId="p1" onRated={onRated} />);
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Not sure" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("That didn't save. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save rating" })).toBeEnabled();
    expect(onRated).not.toHaveBeenCalled();
  });

  it("reports a dropped connection as a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RatingCard promptId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Looks wrong" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Not apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rating" }));
    expect(await screen.findByText("That didn't save. Try again.")).toBeInTheDocument();
  });
});

describe("RulesCheck", () => {
  it("shows the locked line until the presenter unlocks it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p1" messages={MESSAGES} unlocked={false} />);
    expect(screen.getByText(/later in the session, you'll check this answer/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the check and shows the rules answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAP_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p1" messages={MESSAGES} unlocked />);

    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/aspen/rules");
    expect(bodyOf(fetchMock)).toEqual({ participantId: "p-1", promptId: "p1", messages: MESSAGES });

    expect(screen.getByText("a month").parentElement).toHaveTextContent(/^\$24a month$/);
    expect(screen.getByText("SNAP · for October 2026")).toBeInTheDocument();

    const outputs = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes("$"));
    expect(outputs.map((li) => li.textContent)).toEqual([
      "SNAP$24",
      "Excess shelter deduction(still being encoded)$512.50",
    ]);

    expect(
      screen.getByText(/Not final: the rules release marks Standard utility allowance SUA as still being/),
    ).toBeInTheDocument();

    expect(screen.getAllByText("us/statutes/7/2017")).toHaveLength(1);
    expect(screen.getByText("us-az/policies/des/faa5/x")).toBeInTheDocument();

    expect(screen.queryByText("You get $24 a month.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the full rules answer" }));
    expect(screen.getByText("You get $24 a month.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "des.az.gov/snap" })).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Hide the full rules answer" }));
    expect(screen.queryByText("You get $24 a month.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "It matched" }));
    expect(screen.getByRole("button", { name: "It matched" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/aspen/rate");
    expect(bodyOf(fetchMock, 1)).toEqual({ participantId: "p-1", promptId: "p1", postCheck: "match" });
  });

  it("keeps the post-check choice when saving it fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAP_RESULT))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p1" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    fireEvent.click(await screen.findByRole("button", { name: "It was wrong" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "It was wrong" })).toHaveAttribute("aria-pressed", "true");
  });

  it("labels several programs and shows a dash without a primary amount", async () => {
    const result: RulesAnswer = {
      text: "Two programs.",
      computations: [
        {
          program: "ctc",
          displayName: "Child Tax Credit",
          period: "2026",
          primary: null,
          outputs: [
            { name: "ctc", label: "Ctc", value: 4400, unit: "USD", incomplete: false, legalId: null, semantics: "scalar" },
          ],
          disclosures: [],
          standardsYears: [],
          eligibilityTested: true,
        },
        {
          program: "eitc",
          displayName: "EITC",
          period: "2026",
          primary: null,
          outputs: [
            {
              name: "eitc_eligible",
              label: "Eitc eligible",
              value: "not_holds",
              unit: null,
              incomplete: false,
              legalId: null,
              semantics: "judgment",
            },
          ],
          disclosures: [],
          standardsYears: [],
          eligibilityTested: true,
        },
      ],
      amount: null,
      program: null,
      period: "2026",
      incomplete: [],
      citations: [],
      errors: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(result)));
    render(<RulesCheck promptId="p2" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(screen.queryByText("a month")).not.toBeInTheDocument();
    expect(screen.getByText("for 2026")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toContain("Child Tax Credit: CTC$4,400");
    expect(items).toContain("EITC: EligibleNo");
    expect(screen.queryByText("Rules used")).not.toBeInTheDocument();
    expect(screen.queryByText(/Not final/)).not.toBeInTheDocument();
  });

  it("does not say 'a month' for a yearly dollar amount", async () => {
    const result: RulesAnswer = {
      ...SNAP_RESULT,
      computations: [{ ...SNAP_RESULT.computations[0], outputs: [SNAP_RESULT.computations[0].outputs[0]] }],
      period: "2026",
      program: null,
      incomplete: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(result)));
    render(<RulesCheck promptId="p3" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("$24")).toBeInTheDocument();
    expect(screen.queryByText("a month")).not.toBeInTheDocument();
    expect(screen.queryByText("SNAP$24")).not.toBeInTheDocument();
  });

  it("says so honestly when no calculation ran", async () => {
    const result: RulesAnswer = {
      text: "I could not compute this.",
      computations: [],
      amount: null,
      program: null,
      period: null,
      incomplete: [],
      citations: [],
      errors: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(result)));
    render(<RulesCheck promptId="p4" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText(/answered without running a calculation/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("reports a failed check and lets the participant retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "upstream" }, false))
      .mockResolvedValueOnce(jsonResponse({ error: "rules chatbot unavailable" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(SNAP_RESULT));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p5" messages={MESSAGES} unlocked />);

    for (let attempt = 0; attempt < 3; attempt++) {
      fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
      expect(await screen.findByText("The rules check didn't finish. Try again.")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("can run the check again from the result", async () => {
    let second: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAP_RESULT))
      .mockReturnValueOnce(new Promise<Response>((r) => (second = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<RulesCheck promptId="p6" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run the check again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Reading the household…");
    await act(async () => second(jsonResponse(SNAP_RESULT)));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("steps through the progress lines while the check runs", async () => {
    vi.useFakeTimers();
    let resolve: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r))));
    render(<RulesCheck promptId="p7" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    const status = () => within(screen.getByRole("status"));
    expect(status().getByText("Reading the household…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(status().getByText("Finding the program's rules…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(status().getByText("Running the encoded rules…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3500 * 5);
    });
    expect(status().getByText("Writing up the answer…")).toBeInTheDocument();
    await act(async () => {
      resolve(jsonResponse(SNAP_RESULT));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("What the encoded rules say")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the recorded Arizona answer as an amount if eligible, never as an eligibility verdict", async () => {
    const recorded = summarizeRules(parseDataStream(azSavingsStream()));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...recorded, latencyMs: 9000 })));
    render(<RulesCheck promptId="p8" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();

    expect(screen.getByText("a month if eligible").parentElement).toHaveTextContent(/^\$24a month if eligible$/);
    expect(screen.getByText("Arizona SNAP · for October 2026")).toBeInTheDocument();
    // The note shows without opening the full answer.
    expect(screen.getByRole("note")).toHaveTextContent(
      "Not an eligibility determination: Axiom's Arizona SNAP rules don't test eligibility yet. Read this as the amount if eligible.",
    );
    expect(
      screen.getByText(
        "Uses FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
      ),
    ).toBeInTheDocument();

    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    // No yes/no verdict at all: one row says eligibility wasn't tested, right under the benefit.
    expect(rows.slice(0, 2)).toEqual(["Benefit$24", "EligibilityNot tested"]);
    expect(rows.some((row) => /^Eligible/.test(row ?? ""))).toBe(false);
    expect(rows).toContain("Maximum allotment$298");
    expect(rows.some((row) => /Yes$|No$/.test(row ?? ""))).toBe(false);
    // finbot's own wording of both limits is replaced, not repeated.
    expect(screen.queryByRole("list", { name: "Notes on this check" })).not.toBeInTheDocument();
    expect(screen.queryByText(/every household shows as eligible/)).not.toBeInTheDocument();
  });

  it("lists the chatbot's other limits, and says nothing about standards that match the period", async () => {
    const ny: RulesAnswer = {
      ...SNAP_RESULT,
      period: "2026-03",
      computations: [
        {
          ...SNAP_RESULT.computations[0],
          program: "us-ny-snap",
          period: "2026-03",
          outputs: [
            ...SNAP_RESULT.computations[0].outputs,
            { name: "snap_eligible", label: "Snap eligible", value: "holds", unit: null, incomplete: false, legalId: null, semantics: "judgment" },
          ],
          disclosures: [
            "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.",
            "New York: the household's earned-income input was set from the earnings given (has earned income).",
          ],
          standardsYears: [2026],
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(ny)));
    render(<RulesCheck promptId="p9" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    const notes = await screen.findByRole("list", { name: "Notes on this check" });
    expect(within(notes).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "New York: the household's earned-income input was set from the earnings given (has earned income).",
    ]);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText(/SNAP standards/)).not.toBeInTheDocument();
    expect(screen.getByText("a month").parentElement).toHaveTextContent(/^\$24a month$/);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toContain("EligibleYes");
  });

  it("reads rules results saved before the panel knew about limits", async () => {
    const old = {
      ...SNAP_RESULT,
      computations: [{ ...SNAP_RESULT.computations[0], disclosures: undefined, standardsYears: undefined }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(old)));
    render(<RulesCheck promptId="p10" messages={MESSAGES} unlocked />);
    fireEvent.click(screen.getByRole("button", { name: "Check against the rules" }));
    expect(await screen.findByText("What the encoded rules say")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("rules panel values and caveats", () => {
  const AZ_NOTE =
    "Axiom's Arizona SNAP encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".";
  const FY_NOTE =
    "SNAP figures use FY2026 standards; FY2027 standards took effect October 1, 2026 and are not encoded yet.";
  const output = (name: string, value: unknown, semantics: string | null, unit: string | null = null) => ({
    name,
    label: name.replace(/_/g, " "),
    value,
    unit,
    incomplete: false,
    legalId: null,
    semantics,
  });
  const check = (program: string, period: string | null, extra: Partial<RulesComputation> = {}): RulesComputation => ({
    program,
    displayName: program === "us-az-snap" ? "Arizona SNAP" : "New York SNAP",
    period,
    primary: null,
    outputs: [
      output("snap_benefit", 24, "scalar", "USD"),
      output("snap_eligible", "holds", "judgment"),
      output("snap_resource_eligible", "not_holds", "judgment"),
      output("snap_standard_gross_income_eligible", "holds", null),
      output("snap_net_income", 2329, "scalar", "USD"),
    ],
    disclosures: [],
    standardsYears: [],
    eligibilityTested: program !== "us-az-snap",
    ...extra,
  });

  it("never shows a yes/no verdict, sub-tests included, for rules that don't test eligibility", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("us-az-snap", "us-ny-snap"),
        fc.array(
          fc.record({
            name: fc.constantFrom("snap_eligible", "snap_resource_eligible", "snap_benefit", "x"),
            value: fc.oneof(fc.constantFrom("holds", "not_holds"), fc.integer({ min: 0, max: 900 })),
            semantics: fc.constantFrom("judgment", "scalar", null),
          }),
          { maxLength: 6 },
        ),
        (program, outs) => {
          const c = check(program, "2026-10", { outputs: outs.map((o) => output(o.name, o.value, o.semantics)) });
          const rows = panelRows(c);
          const verdicts = rows.filter((r) => r.value === "Yes" || r.value === "No");
          if (program === "us-az-snap") {
            expect(verdicts).toEqual([]);
            expect(rows.filter((r) => r.value === "Not tested")).toHaveLength(1);
            for (const o of c.outputs) if (o.value === "holds" || o.value === "not_holds") expect(shownValue(o, c)).toBe("Not tested");
          } else {
            expect(verdicts).toHaveLength(c.outputs.filter((o) => o.value === "holds" || o.value === "not_holds").length);
            expect(rows.some((r) => r.value === "Not tested")).toBe(false);
          }
        },
      ),
    );
  });

  it("shows amounts as computed for every program", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 10_000 }), fc.constantFrom("us-az-snap", "us-ny-snap"), (value, program) => {
        expect(shownValue(output("snap_benefit", value, "scalar", "USD"), check(program, "2026-10"))).toBe(formatValue(value, "USD"));
      }),
    );
    expect(panelRows(check("us-ny-snap", "2026-10")).map((r) => [r.label, r.value])).toEqual([
      ["Benefit", "$24"],
      ["Eligible", "Yes"],
      ["Resource eligible", "No"],
      ["Standard gross income eligible", "Yes"],
      ["Net income", "$2,329"],
    ]);
  });

  it("states each caveat once across computations", () => {
    const az = check("us-az-snap", "2026-10", { disclosures: ["Something else.", AZ_NOTE, FY_NOTE], standardsYears: [2025, 2026] });
    const caveats = rulesCaveats({ computations: [az, { ...az }] });
    expect(caveats.eligibility).toHaveLength(1);
    expect(caveats.standards).toEqual([
      "Uses FY2025 and FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
    ]);
    expect(caveats.other).toEqual(["Something else."]);
  });

  it("states the standards year for a check saved without standardsYears (GPT-6.1 Sol, round 4)", () => {
    const old = check("us-ny-snap", "2026-10", { disclosures: [FY_NOTE], standardsYears: undefined });
    expect(rulesCaveats({ computations: [old] })).toEqual({
      eligibility: [],
      standards: [
        "Uses FY2026 SNAP standards, but October 2026 falls under FY2027 standards (from October 1, 2026), which Axiom hasn't encoded yet. The amount may differ.",
      ],
      other: [],
    });
    // Cited years that disagree with finbot's sentence: the sentence stays, so nothing is lost.
    const disagree = check("us-ny-snap", "2026-10", { disclosures: [FY_NOTE], standardsYears: [2025] });
    expect(rulesCaveats({ computations: [disagree] }).other).toEqual([FY_NOTE]);
  });

  it("keeps the standards note for a yearly or missing period", () => {
    for (const period of ["2026", null]) {
      const caveats = rulesCaveats({ computations: [check("us-ny-snap", period, { disclosures: [FY_NOTE], standardsYears: [2026] })] });
      expect(caveats.standards).toEqual([]);
      expect(caveats.other).toEqual([FY_NOTE]);
    }
  });

  it("never drops a disclosure without saying the same thing itself", () => {
    const disclosure = fc.oneof(
      fc.constantFrom(
        AZ_NOTE,
        `${AZ_NOTE} Shelter costs are not included.`,
        "Arizona SNAP rules do not test eligibility yet. Shelter costs are not included in this amount.",
        "Axiom's Arizona SNAP encoding omits shelter costs. This encoding doesn't test eligibility yet: every household shows as eligible, so read the amount as \"if eligible\".",
        "Not an eligibility determination: Axiom's Arizona SNAP rules don't test eligibility yet. Read this as the amount if eligible.",
        FY_NOTE,
        `${FY_NOTE} More.`,
        "Other note.",
      ),
      fc.string(),
    );
    fc.assert(
      fc.property(
        fc.constantFrom("us-az-snap", "us-ny-snap"),
        fc.constantFrom("2026-03", "2026-10", "2027-11", "2026", null),
        fc.array(disclosure, { maxLength: 5 }),
        fc.array(fc.integer({ min: 2025, max: 2028 }), { maxLength: 2 }),
        fc.constantFrom(true, false, undefined),
        fc.boolean(),
        (program, period, disclosures, cited, eligibilityTested, saved) => {
          // A check saved without standardsYears (an older shape) must lose nothing either.
          const standardsYears = saved ? snapYears(cited, disclosures) : undefined;
          const c = check(program, period, { disclosures, eligibilityTested, standardsYears });
          const caveats = rulesCaveats({ computations: [c] });
          for (const d of disclosures) {
            if (caveats.other.includes(d)) continue;
            if (d === FY_NOTE) {
              // Only for a month. FY_NOTE says FY2026 standards were used; unless the month is in
              // FY2026 itself, the panel's own line must say FY2026 (and "not encoded" for FY2027).
              const due = federalFiscalYear(period);
              expect(due).not.toBeNull();
              if (due !== 2026) {
                expect(caveats.standards).toHaveLength(1);
                expect(caveats.standards[0]).toContain("FY2026");
                if (due === 2027) expect(caveats.standards[0]).toMatch(/hasn't encoded yet/);
              }
            } else if (d === AZ_NOTE) {
              // finbot's whole eligibility sentence: the panel's note replaces it.
              expect(caveats.eligibility).toHaveLength(1);
            } else {
              // Anything else dropped is word for word one of the panel's own lines, shown once.
              expect([...caveats.eligibility, ...caveats.standards]).toContain(d);
            }
          }
        },
      ),
      // Pure functions: enough runs to hit the rarer combinations (cited years against finbot's sentence).
      { numRuns: 1000 },
    );
  });
});

function snapYears(cited: number[], disclosures: string[]): number[] {
  return snapStandardsYears(
    cited.map((y) => `us:policies/usda/snap/fy-${y}-cola/deductions#x`),
    disclosures,
  );
}
