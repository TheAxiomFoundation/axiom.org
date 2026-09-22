import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schedule from "@/lib/tariff-schedule";
import { TariffStatusBlock } from "./status-block";

afterEach(() => { vi.restoreAllMocks(); });

describe("TariffStatusBlock", () => {
  it("lists only the ledger families that are not yet encoded or excluded", () => {
    render(<TariffStatusBlock />);
    const burndown = schedule.coverageBurndown(schedule.getTariffMetadata().coverageFamilies);
    expect(burndown.map((row) => row.status)).not.toContain("encoded");
    for (const row of burndown) expect(screen.getByText(row.note)).toBeInTheDocument();
    expect(screen.queryByText(/Ad valorem and Free rate lines/)).not.toBeInTheDocument();
  });

  it("refuses to render a download that names a different certificate", () => {
    const metadata = schedule.getTariffMetadata();
    vi.spyOn(schedule, "getTariffMetadata").mockReturnValue({ ...metadata, certificateSha256: "0".repeat(64) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TariffStatusBlock />)).toThrow(/names a different certificate/);
  });
});
