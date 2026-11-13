import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnswerControl } from "./viewer-app";

// viewer-app pulls in the canvas and library views; jsdom renders neither.
vi.mock("./InteractiveRuleGraph", async () => {
  const { createContext } = await import("react");
  return { InputEditContext: createContext(null), initialCollapse: () => new Set(), InteractiveRuleGraph: () => null };
});
vi.mock("./inspector-mini-graph", () => ({ InspectorMiniGraph: () => null }));
vi.mock("./corpus-library", () => ({ CorpusLibrary: () => null }));
vi.mock("@/lib/analytics", () => ({ trackAxiomEvent: vi.fn() }));

afterEach(cleanup);

// 42 USC 1396a(xx)'s run panel: the runtime catalog presumes 1 for the
// minimum wage and the national unemployment rate, and 0 for income.
const meta = {
  dtypes: {
    applicable_minimum_wage_hourly_rate: "number",
    national_unemployment_rate: "number",
    monthly_income: "number",
  },
  defaults: {
    applicable_minimum_wage_hourly_rate: 1,
    national_unemployment_rate: 1,
    monthly_income: 0,
  },
};

const field = (name: string, placeholder = "answer…", value?: number) => {
  render(<AnswerControl name={name} value={value} meta={meta} onChange={vi.fn()} placeholder={placeholder} />);
  return screen.getByRole("spinbutton") as HTMLInputElement;
};

it("names a nonzero presumed number in the blank field", () => {
  const input = field("applicable_minimum_wage_hourly_rate");
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("default — 1");
});

it("keeps the caller's placeholder when the default is zero", () => {
  expect(field("monthly_income", "e.g. 1200").placeholder).toBe("e.g. 1200");
});

it("shows the answer, not the default, once the user enters one", () => {
  const input = field("national_unemployment_rate", "answer…", 0.04);
  expect(input.value).toBe("0.04");
});

it("leaves plain-default fields to show the default as their value", () => {
  render(
    <AnswerControl
      name="applicable_minimum_wage_hourly_rate"
      value={undefined}
      meta={meta}
      onChange={vi.fn()}
      placeholder="e.g. 7.25"
      plainDefaults
    />,
  );
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  expect(input.value).toBe("1");
  expect(input.placeholder).toBe("e.g. 7.25");
});
