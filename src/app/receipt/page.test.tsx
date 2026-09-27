import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SITE_URL } from "@/lib/urls";
import ReceiptPage, { metadata } from "./page";

// The module list mirrors the package's own docstring: the six extracted
// modules render plainly, the two the docstring calls "also shipped" — new
// composition over them rather than a fourth extraction — are labeled as
// composed, and the machinery it calls "pending extraction" is labeled as
// such. If an id here goes stale against the package, fix the page, not the
// test.
const EXTRACTED_MODULES = [
  "receipt.release_chain",
  "receipt.canonical",
  "receipt.append_gate",
  "receipt.tsa",
  "receipt.sign",
  "receipt.attest",
];
const COMPOSED_MODULES = ["receipt.corpus", "receipt.verify"];

describe("receipt package page", () => {
  it("renders the package headline and the two-command install story", () => {
    render(<ReceiptPage />);

    expect(
      screen.getByRole("heading", {
        name: /verifiable custody of agent-produced records/i,
      })
    ).toBeInTheDocument();
    // The command form is 0.6.0's: the spec is named, and so is the revision
    // the verdict is about.
    expect(
      screen.getByText(
        /pip install receipt receipt verify --spec verification\/spec.py --commit HEAD/
      )
    ).toBeInTheDocument();
  });

  it("lists the shipped modules and labels composed and pending machinery", () => {
    render(<ReceiptPage />);

    for (const mod of [...EXTRACTED_MODULES, ...COMPOSED_MODULES]) {
      expect(screen.getByText(mod)).toBeInTheDocument();
    }
    expect(screen.queryByText("receipt.chain")).not.toBeInTheDocument();
    expect(screen.getByText("receipt.ratchet")).toBeInTheDocument();
    expect(screen.getByText("receipt.chronology")).toBeInTheDocument();
    expect(screen.getAllByText(/pending extraction/i)).toHaveLength(2);
    expect(screen.getAllByText(/composed, not extracted/i)).toHaveLength(2);
  });

  it("links the package's public surfaces", () => {
    render(<ReceiptPage />);

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://pypi.org/project/receipt/");
    expect(hrefs).toContain("https://github.com/TheAxiomFoundation/receipt");
    expect(hrefs).toContain("/receipt/api/");
    expect(hrefs).toContain("/receipts");
  });
});

describe("receipt package share card", () => {
  // The sibling opengraph-image.tsx supplies the image. An explicit
  // images key here would take precedence over it, so the block
  // carries everything else and no images.
  it("sets a complete openGraph that leaves the image to opengraph-image", () => {
    expect(metadata.openGraph).toEqual({
      type: "website",
      siteName: "Axiom Foundation",
      title: "receipt — verifiable custody of agent-produced records",
      description:
        "Anyone can verify, offline, that an agent-produced record was never changed, backdated, or deleted. One command over a clone; trust anchors live in the verifier's own code.",
      url: `${SITE_URL}/receipt`,
    });
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata).not.toHaveProperty("twitter");
  });
});
