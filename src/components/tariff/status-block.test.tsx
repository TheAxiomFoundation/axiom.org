import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schedule from "@/lib/tariff-schedule";
import { TariffStatusBlock } from "./status-block";

afterEach(() => { vi.restoreAllMocks(); });

const certificate = JSON.parse(readFileSync("public/downloads/us-tariff-duty.certificate.json", "utf8"));

describe("TariffStatusBlock", () => {
  it("names exactly the certificate's burndown families, in the certificate's order", () => {
    render(<TariffStatusBlock />);
    const metadata = schedule.getTariffMetadata();
    const labelOf = new Map(metadata.coverageFamilies.map((row) => [row.ledgerFamily, row.family]));
    const expected = (certificate.verdicts.closed.burndown as { family: string }[]).map((item) => labelOf.get(item.family));
    const items = within(screen.getByText("Named burndown").closest("details")!).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("strong")?.textContent?.split(" — ")[0])).toEqual(expected);
  });

  it("dates the build and the tariff encodings separately", () => {
    const { container } = render(<TariffStatusBlock />);
    const metadata = schedule.getTariffMetadata();
    expect(container.textContent).toContain(`source commit dated ${metadata.builtAt.slice(0, 10)}; tariff encodings last changed on main ${metadata.tariffEncodingsChangedAt.slice(0, 10)}`);
  });

  it("refuses to render a download that names a different certificate", () => {
    const metadata = schedule.getTariffMetadata();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(schedule, "getTariffMetadata");
    spy.mockReturnValue({ ...metadata, certificateSha256: "0".repeat(64) });
    expect(() => render(<TariffStatusBlock />)).toThrow(/names a different certificate/);
    spy.mockReturnValue({ ...metadata, certificateCommit: "f".repeat(40) });
    expect(() => render(<TariffStatusBlock />)).toThrow(/names a different certificate/);
  });
});
