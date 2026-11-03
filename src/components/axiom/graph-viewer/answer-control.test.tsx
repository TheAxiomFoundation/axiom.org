import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RootInputSlot } from "./api";
import { AnswerControl } from "./answer-control";
import { catalogAnswerMeta, censusAnswerMeta } from "./input-meta";

afterEach(cleanup);

const meta = (...slots: RootInputSlot[]) => catalogAnswerMeta(slots, censusAnswerMeta([]));
const optionTexts = (select: HTMLElement) =>
  [...(select as HTMLSelectElement).options].map((option) => option.textContent);

const ZONE = meta({
  name: "wcc_supermarket_zone",
  dtype: "text",
  default: "none",
  entity: "Person",
  values: ["CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "none"],
});

describe("AnswerControl: text slots", () => {
  it("offers a zone's codes, folding the default into the first option", () => {
    const onChange = vi.fn();
    render(<AnswerControl name="wcc_supermarket_zone" value={undefined} meta={ZONE} onChange={onChange} />);
    const select = screen.getByRole("combobox");
    expect(optionTexts(select)).toEqual(["default — none", "CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ"]);
    fireEvent.change(select, { target: { value: "MUZ" } });
    expect(onChange).toHaveBeenLastCalledWith("MUZ");
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("shows a chosen code, and an explicit default as the default", () => {
    const { rerender } = render(
      <AnswerControl name="wcc_supermarket_zone" value="MUZ" meta={ZONE} onChange={vi.fn()} plainDefaults />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("MUZ");
    expect(select.options[0]!.textContent).toBe("none");
    rerender(<AnswerControl name="wcc_supermarket_zone" value="none" meta={ZONE} onChange={vi.fn()} />);
    expect(select.value).toBe("");
  });

  it("takes open text in a text field; clearing it returns to the default", () => {
    const onChange = vi.fn();
    const free = meta({ name: "frequency", dtype: "text", default: "monthly", entity: "Person" });
    const { rerender } = render(
      <AnswerControl name="frequency" value={undefined} meta={free} onChange={onChange} placeholder="answer…" />,
    );
    const field = screen.getByRole("textbox") as HTMLInputElement;
    expect(field.placeholder).toBe("default — monthly");
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "weekly" } });
    expect(onChange).toHaveBeenLastCalledWith("weekly");
    rerender(<AnswerControl name="frequency" value="weekly" meta={free} onChange={onChange} />);
    expect(field.value).toBe("weekly");
    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("falls back to the caller's placeholder when the default is empty", () => {
    const blank = meta({ name: "note", dtype: "text", default: "", entity: "Person" });
    render(<AnswerControl name="note" value={undefined} meta={blank} onChange={vi.fn()} placeholder="answer…" />);
    expect((screen.getByRole("textbox") as HTMLInputElement).placeholder).toBe("answer…");
  });
});

describe("AnswerControl: bools, numeric choices and numbers", () => {
  it("offers a bool's default and its opposite", () => {
    const onChange = vi.fn();
    const flag = meta({ name: "eligible", dtype: "bool", default: false, entity: "Person" });
    const { rerender } = render(<AnswerControl name="eligible" value={undefined} meta={flag} onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(optionTexts(select)).toEqual(["default — false", "true"]);
    fireEvent.change(select, { target: { value: "true" } });
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    rerender(<AnswerControl name="eligible" value={true} meta={flag} onChange={onChange} />);
    expect(select.value).toBe("true");
  });

  it("labels numeric choices and returns numbers", () => {
    const onChange = vi.fn();
    const status = meta({
      name: "status",
      dtype: "integer",
      default: 2,
      entity: "TaxUnit",
      choices: [
        { value: 1, label: "Single" },
        { value: 2, label: "Joint" },
        { value: 3, label: "Separate" },
      ],
    });
    render(<AnswerControl name="status" value={undefined} meta={status} onChange={onChange} />);
    const select = screen.getByRole("combobox");
    expect(optionTexts(select)).toEqual(["default — Joint", "Single", "Separate"]);
    fireEvent.change(select, { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith(3);
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("types numbers with the slot's step and shows a plain default", () => {
    const onChange = vi.fn();
    const amounts = meta(
      { name: "amount", dtype: "decimal", default: 0, entity: "Person" },
      { name: "size", dtype: "integer", default: 1, entity: "Household" },
    );
    const { rerender } = render(<AnswerControl name="amount" value={undefined} meta={amounts} onChange={onChange} />);
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(field.step).toBe("any");
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "2000" } });
    expect(onChange).toHaveBeenLastCalledWith(2000);
    rerender(<AnswerControl name="amount" value={2000} meta={amounts} onChange={onChange} />);
    expect(field.value).toBe("2000");
    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    rerender(<AnswerControl name="size" value={undefined} meta={amounts} onChange={onChange} plainDefaults />);
    expect(field.step).toBe("1");
    expect(field.value).toBe("1");
    rerender(<AnswerControl name="size" value={4} meta={amounts} onChange={onChange} />);
    expect(field.value).toBe("4");
  });
});
