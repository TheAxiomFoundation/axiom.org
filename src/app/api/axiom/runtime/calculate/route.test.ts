import { compositionReadiness } from "@/lib/axiom/runtime/composition-readiness";
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getRuntimePackageMock,
  runCalculateMock,
  runCalculateRootMock,
  isConfiguredMock,
} = vi.hoisted(() => ({
  getRuntimePackageMock: vi.fn(),
  runCalculateMock: vi.fn(),
  runCalculateRootMock: vi.fn(),
  isConfiguredMock: vi.fn(),
}));

vi.mock("@/lib/axiom/runtime/api", () => ({
  getRuntimePackage: getRuntimePackageMock,
  runCalculate: runCalculateMock,
  runCalculateRoot: runCalculateRootMock,
  isRuntimeApiConfigured: isConfiguredMock,
}));

import { POST } from "./route";
import { _resetRunRouteState } from "../run/limiter";

function post(body: unknown): Request {
  return new Request("http://localhost/api/axiom/runtime/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/axiom/runtime/calculate (run-by-root)", () => {
  beforeEach(() => {
    _resetRunRouteState();
    getRuntimePackageMock.mockReset();
    runCalculateMock.mockReset();
    runCalculateRootMock.mockReset();
    isConfiguredMock.mockReset();
    isConfiguredMock.mockReturnValue(true);
  });

  it("preserves long encoding input and trace names for every person and reports rejected keys", async () => {
    const name = "last_enacted_appropriation_act_maximum_federal_pell_grant_applicable_to_award_year";
    const variable = "us:statutes/20/1070a/b/5#" + "long_".repeat(40);
    runCalculateRootMock.mockResolvedValue({kind:"ok",result:{outputs:{total:7060},trace:[]}});
    const response = await POST(post({root:"us:statutes/20/1070a/b/5",facts:{[name]:6000,"invalid-key":1},people:{person_2:{[name]:5000}},variables:[variable]}));
    expect(response.status).toBe(200);
    expect(runCalculateRootMock).toHaveBeenCalledWith({root:"us:statutes/20/1070a/b/5",facts:{[name]:6000},people:{person_2:{[name]:5000}},variables:[variable]});
    expect(await response.json()).toMatchObject({applied:[name],dropped:["invalid-key"]});
  });

  it("passes the root shape through and returns the run envelope", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "ok",
      result: {
        outputs: { net_income: 1200 },
        trace: [
          {
            rule_id: "net_income",
            variable: "net_income",
            value: 1200,
            sources: [],
          },
        ],
      },
    });

    const response = await POST(
      post({
        root: "us:statutes/7/2014/e/6/A",
        facts: { household_size: 2, bogus: "nope" },
        variables: ["net_income"],
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.outputs.net_income).toBe(1200);
    expect(data.trace).toHaveLength(1);
    expect(data.applied).toEqual(["household_size"]);
    expect(data.dropped).toEqual(["bogus"]);
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/7/2014/e/6/A",
      facts: { household_size: 2 },
      variables: ["net_income"],
    });
    // The package path must not be consulted for root runs.
    expect(getRuntimePackageMock).not.toHaveBeenCalled();
  });

  it("sanitizes extra members like facts and forwards them as people", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "ok",
      result: { outputs: {}, trace: [] },
    });
    const response = await POST(
      post({
        root: "us:statutes/26/32",
        facts: { age: 40 },
        people: {
          person_2: { age: 38, bogus: "nope" },
          person_13: { age: 1 }, // beyond the member-id bound
          "not-a-member": { age: 2 },
        },
        variables: ["eitc"],
      })
    );
    expect(response.status).toBe(200);
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/26/32",
      facts: { age: 40 },
      people: { person_2: { age: 38 } },
      variables: ["eitc"],
    });
  });

  it("omits people entirely when no valid member survives", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "ok",
      result: { outputs: {}, trace: [] },
    });
    await POST(
      post({
        root: "us:statutes/26/32",
        facts: { age: 40 },
        people: { intruder: { age: 9 } },
        variables: [],
      })
    );
    expect(runCalculateRootMock).toHaveBeenCalledWith({
      root: "us:statutes/26/32",
      facts: { age: 40 },
      people: undefined,
      variables: [],
    });
  });

  it("404s root_calculate_unsupported when the upstream lacks the endpoint", async () => {
    runCalculateRootMock.mockResolvedValue({ kind: "unsupported" });
    const response = await POST(
      post({ root: "us:regulations/7-cfr/273/10", facts: {} })
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("root_calculate_unsupported");
  });

  it("maps refusal and failure outcomes for root runs, message included", async () => {
    runCalculateRootMock.mockResolvedValue({
      kind: "refused",
      code: "compile_failed",
      message: "versioned derived formulas are not supported yet",
    });
    const refused = await POST(
      post({ root: "us:statutes/42/1396a/a/10", facts: {} })
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: "compile_failed",
      message: "versioned derived formulas are not supported yet",
    });

    runCalculateRootMock.mockResolvedValue({ kind: "failed" });
    expect(
      (await POST(post({ root: "us:statutes/7/2014", facts: {} }))).status
    ).toBe(502);
  });

  it("rejects malformed roots without touching the upstream", async () => {
    for (const root of ["statutes/7/2014", "us:", "us:stat utes", 7, "x:#a"]) {
      const response = await POST(post({ root }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_root");
    }
    expect(runCalculateRootMock).not.toHaveBeenCalled();
  });

  it("503s when the runtime API is unconfigured", async () => {
    isConfiguredMock.mockReturnValue(false);
    const response = await POST(
      post({ root: "us:statutes/7/2014", facts: {} })
    );
    expect(response.status).toBe(503);
  });

  it("keeps the program-coordinates shape working unchanged", async () => {
    getRuntimePackageMock.mockResolvedValue({
      sample_request: {
        household: { entities: { unit: { u1: {} } } },
      },
      default_outputs: ["snap_allotment"],
      default_period: "2026-01",
      entities: [
        { entity: "unit", inputs: [{ name: "household_size" }] },
      ],
    });
    runCalculateMock.mockResolvedValue({
      outputs: { snap_allotment: 298 },
      trace: [],
    });

    const response = await POST(
      post({
        jurisdiction: "us-co",
        program_id: "co-snap",
        values: { household_size: 3 },
      })
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.outputs.snap_allotment).toBe(298);
    expect(data.period).toBe("2026-01");
    expect(data.applied).toEqual(["household_size"]);
    expect(runCalculateRootMock).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/axiom/runtime/composition-readiness", () => ({compositionReadiness:vi.fn().mockResolvedValue("ready")}));
it("refuses unsupported composition before executing flat facts", async () => {
 isConfiguredMock.mockReturnValue(true);
 _resetRunRouteState();
 vi.mocked(compositionReadiness).mockResolvedValueOnce("relationships_unsupported");
 runCalculateRootMock.mockClear();
 const response = await POST(post({root:"us:statutes/26/22",facts:{payment_amount:1000}}));
 expect(response.status).toBe(422);
 expect(await response.json()).toEqual({error:"relationships_unsupported"});
 expect(runCalculateRootMock).not.toHaveBeenCalled();
});
