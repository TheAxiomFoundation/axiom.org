import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import DocsPage from "@/app/docs/page";

describe("DocsPage", () => {
  it("renders the documentation ownership model", () => {
    render(<DocsPage />);

    expect(
      screen.getByRole("heading", {
        name: /docs live with the system that enforces them/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/docs live in the repo that owns the code or contract/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("axiom-corpus").length).toBeGreaterThan(0);
    expect(screen.getAllByText("axiom-encode").length).toBeGreaterThan(0);
    expect(screen.getByText("axiom-core")).toBeInTheDocument();
    expect(screen.getByText("axiom-oracles")).toBeInTheDocument();
  });

  it("no longer indexes the per-repo doc links (Documentation homes removed)", () => {
    render(<DocsPage />);
    expect(
      screen.queryByRole("heading", { name: /documentation homes/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /signed corpus releases/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /oracle adapters/i })
    ).not.toBeInTheDocument();
    // The internal lab notebook stays in the repo, not on the index.
    expect(screen.queryByText(/methods log/i)).not.toBeInTheDocument();
  });

  it("renders the pipeline strip natively — no architecture iframe", () => {
    render(<DocsPage />);
    expect(screen.queryByTitle("Cross-system architecture map")).toBeNull();
    expect(
      screen.getByRole("heading", { name: /^the architecture$/i })
    ).toBeInTheDocument();
    // The strip mounts client-side (jsdom runs effects, so it's here).
    expect(
      screen.getByRole("img", { name: /five equal stations/i, hidden: true })
    ).toBeInTheDocument();
  });

  it("distinguishes implemented execution from planned admission", () => {
    render(<DocsPage />);

    const implemented = screen.getByRole("list", {
      name: "Implemented local execution path",
    });
    expect(
      within(implemented).getAllByRole("heading").map((heading) => heading.textContent)
    ).toEqual([
      "Select the source",
      "Export exact bytes",
      "Build and verify",
      "Execute and explain",
    ]);
    expect(within(implemented).getByText("Assurance: unvalidated_candidate")).toBeInTheDocument();
    expect(within(implemented).getByText("Assurance: development_unsigned")).toBeInTheDocument();
    expect(within(implemented).getByText(/caller’s expected digest, engine identity/i)).toBeInTheDocument();
    expect(within(implemented).getByText(/full native result, metadata, and explanation traces/i)).toBeInTheDocument();

    const planned = screen.getByRole("list", {
      name: "Planned admission and publication path",
    });
    expect(within(planned).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Signed source intake",
      "Independent workload",
      "Admission and publication",
    ]);
    expect(within(planned).getByText(/existing signed corpus releases/i)).toBeInTheDocument();
    expect(screen.getByText(/does not authenticate an author, establish legal correctness/i)).toBeInTheDocument();
    expect(implemented.closest("section")).toHaveAttribute("id", "core-execution");
  });

  it("links the merged implementations and retains the broader map as context", () => {
    render(<DocsPage />);

    expect(screen.getByRole("link", { name: "core bundles and execution" })).toHaveAttribute(
      "href", "https://github.com/TheAxiomFoundation/axiom-core/pull/1"
    );
    expect(screen.getByRole("link", { name: "explicit encoder export" })).toHaveAttribute(
      "href", "https://github.com/TheAxiomFoundation/axiom-encode/pull/1581"
    );
    expect(screen.getByRole("link", { name: "real encoder/core integration tests" })).toHaveAttribute(
      "href", "https://github.com/TheAxiomFoundation/axiom-core/pull/2"
    );
    expect(screen.getByText("The broader pipeline").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/export does not change signed apply or acceptance-test trust/i)).toBeInTheDocument();
  });

  it("no longer shows the Related maps row (held back for now)", () => {
    render(<DocsPage />);
    expect(
      screen.queryByRole("heading", { name: /related maps/i })
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /technical stack/i })
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /encoder system map/i })
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /open axiom/i })).toBeNull();
  });
});
