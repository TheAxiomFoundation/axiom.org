import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RootInputSlot } from "./api";
import { AnswerControl } from "./answer-control";
import { catalogAnswerMeta, censusAnswerMeta } from "./input-meta";

afterEach(cleanup);

const meta = (...slots: RootInputSlot[]) => catalogAnswerMeta(slots, censusAnswerMeta([]));
const optionTexts = (select: HTMLElement) =>
  [...(select as HTMLSelectElement).options].map((option) => option.textContent);
/** Picks the option a person sees as `text`. */
const choose = (select: HTMLElement, text: string) => {
  const option = [...(select as HTMLSelectElement).options].find((item) => item.textContent === text);
  if (!option) throw new Error(`no option ${text}`);
  fireEvent.change(select, { target: { value: option.value } });
};

const ZONE_SLOT: RootInputSlot[] = [{
  name: "wcc_supermarket_zone",
  dtype: "text",
  default: "none",
  entity: "Person",
  values: ["CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "none"],
}];
const ZONE = meta(...ZONE_SLOT);

describe("AnswerControl: text slots", () => {
  it("offers a zone's codes, folding the default into the first option", () => {
    const onChange = vi.fn();
    render(<AnswerControl name="wcc_supermarket_zone" value={undefined} meta={ZONE} onChange={onChange} />);
    const select = screen.getByRole("combobox");
    expect(optionTexts(select)).toEqual(["default — none", "CCZ", "GIZ", "LCZ", "MCZ", "MUZ", "NCZ", "Other…"]);
    expect(screen.queryByRole("textbox")).toBeNull();
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

  it("takes a value the formulas never name through Other…", () => {
    const onChange = vi.fn();
    // The runtime suggests only the literals a formula compares the slot
    // with; a pay frequency compared with "weekly" alone still takes others.
    const frequency = meta({
      name: "pay_frequency",
      dtype: "text",
      default: "monthly",
      entity: "Person",
      values: ["weekly", "monthly"],
    });
    const { rerender } = render(
      <AnswerControl name="pay_frequency" value={undefined} meta={frequency} onChange={onChange} />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(optionTexts(select)).toEqual(["default — monthly", "weekly", "Other…"]);
    choose(select, "Other…");
    // Other… opens an empty field; the default holds until text arrives.
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    const field = screen.getByRole("textbox", { name: "Other value" }) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("default — monthly");
    fireEvent.change(field, { target: { value: "biweekly" } });
    expect(onChange).toHaveBeenLastCalledWith("biweekly");
    rerender(<AnswerControl name="pay_frequency" value="biweekly" meta={frequency} onChange={onChange} />);
    expect(optionTexts(select)[select.selectedIndex]).toBe("Other…");
    expect(field.value).toBe("biweekly");
    // Clearing the field returns to the default and leaves it open.
    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    rerender(<AnswerControl name="pay_frequency" value={undefined} meta={frequency} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Other value" })).toBe(field);
    // Picking a suggestion closes it.
    choose(select, "weekly");
    expect(onChange).toHaveBeenLastCalledWith("weekly");
    rerender(<AnswerControl name="pay_frequency" value="weekly" meta={frequency} onChange={onChange} />);
    expect(select.value).toBe("weekly");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens Other… for an answer outside the suggestions", () => {
    render(<AnswerControl name="wcc_supermarket_zone" value="OSZ" meta={ZONE} onChange={vi.fn()} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(optionTexts(select)[select.selectedIndex]).toBe("Other…");
    expect((screen.getByRole("textbox", { name: "Other value" }) as HTMLInputElement).value).toBe("OSZ");
  });

  it("names an empty default in the select", () => {
    const blank = meta({ name: "note", dtype: "text", default: "", entity: "Person", values: ["", "a"] });
    render(<AnswerControl name="note" value={undefined} meta={blank} onChange={vi.fn()} />);
    expect(optionTexts(screen.getByRole("combobox"))).toEqual(["default — (blank)", "a", "Other…"]);
  });

  it("disables every control while a run is in flight", () => {
    const slots = meta(
      ...ZONE_SLOT,
      { name: "eligible", dtype: "bool", default: false, entity: "Person" },
      { name: "amount", dtype: "decimal", default: 0, entity: "Person" },
      { name: "frequency", dtype: "text", default: "monthly", entity: "Person" },
      { name: "status", dtype: "integer", default: 1, entity: "TaxUnit", choices: [{ value: 1, label: "Single" }, { value: 2, label: "Joint" }] },
    );
    for (const [name, value] of [["wcc_supermarket_zone", "OSZ"], ["eligible", undefined], ["amount", 3], ["frequency", "weekly"], ["status", 2]] as const) {
      const { container, unmount } = render(<AnswerControl name={name} value={value} meta={slots} onChange={vi.fn()} disabled />);
      const controls = [...container.querySelectorAll("select, input")] as Array<HTMLSelectElement | HTMLInputElement>;
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((control) => control.disabled)).toBe(true);
      unmount();
    }
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
