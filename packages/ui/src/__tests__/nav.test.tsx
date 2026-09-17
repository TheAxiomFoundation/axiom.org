import { render, screen, fireEvent } from "@testing-library/react";
import { Nav } from "../components/nav";

describe("Nav", () => {
  it("renders the full launch navigation links (pages only, no scroll anchors)", () => {
    render(<Nav />);
    // The app entry is the "Get started" CTA button, not a tab.
    expect(screen.getAllByText("Get started")[0]).toHaveAttribute(
      "href",
      "https://axiom.org/app",
    );
    // "Axiom" names the About dropdown's first item, never an app link.
    for (const el of screen.getAllByText("Axiom")) {
      expect(el.closest("a")).toHaveAttribute("href", "/about");
    }
    expect(screen.getAllByText("What's possible").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Validation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("About").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Team").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: "GitHub" }).length,
    ).toBeGreaterThan(0);
    // Landing scroll anchors live on the page, not in the header;
    // Docs is footer-only (contributor audience).
    expect(screen.queryByText("Why")).not.toBeInTheDocument();
    expect(screen.queryByText("Encoding")).not.toBeInTheDocument();
    expect(screen.queryByText("Docs")).not.toBeInTheDocument();
  });

  it("renders the demos dropdown grouped by stakeholder", () => {
    render(<Nav />);
    // Group headers are the demo-gallery row sentences from axiom-demo-shell.
    expect(
      screen.getAllByText("Build government systems on the law").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Ground AI models in citable law").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Power products on rules you don't rebuild").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Simulate policy on real rules").length,
    ).toBeGreaterThan(0);
    // Labels are active phrases, shared with the shell gallery tiles.
    expect(
      screen.getAllByText("Build a form")[0].closest("a"),
    ).toHaveAttribute("href", "/demos?d=builder");
    // The small company checker was pulled from the gallery.
    expect(screen.queryByText("Small company checker")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Get accurate answers")[0].closest("a"),
    ).toHaveAttribute("href", "/demos?d=chatbot");
    expect(
      screen.getAllByText("Explore benefits cliffs")[0].closest("a"),
    ).toHaveAttribute("href", "/demos?d=snap");
    expect(screen.getAllByText("All demos")[0].closest("a")).toHaveAttribute(
      "href",
      "/demos",
    );
  });

  it("renders the Axiom Foundation logo", () => {
    render(<Nav />);
    expect(screen.getByAltText("Axiom Foundation")).toBeInTheDocument();
  });

  it("applies baseUrl to links", () => {
    render(<Nav baseUrl="https://axiom-foundation.org" />);
    expect(screen.getAllByText("About")[0]).toHaveAttribute(
      "href",
      "https://axiom-foundation.org/about",
    );
    expect(screen.getAllByText("Team")[0]).toHaveAttribute(
      "href",
      "https://axiom-foundation.org/team",
    );
  });

  it("highlights active link based on pathname", () => {
    render(<Nav pathname="/about" />);
    const browseLinks = screen.getAllByText("About");
    // Desktop link should have the persistent-underline active class
    expect(browseLinks[0].className).toContain("is-active");
  });

  it("toggles mobile menu on hamburger click", () => {
    render(<Nav />);
    const hamburger = screen.getByLabelText("Open menu");
    expect(hamburger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(hamburger);
    expect(screen.getByLabelText("Close menu")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders extra links when provided", () => {
    render(
      <Nav extraLinks={[{ href: "/proposal", label: "Proposal" }]} />,
    );
    expect(screen.getAllByText("Proposal").length).toBeGreaterThan(0);
  });

  it("uses renderLink for internal navigation", () => {
    function TestLink({
      href,
      children,
      className,
    }: {
      href: string;
      children: React.ReactNode;
      className?: string;
    }) {
      return (
        <a href={href} className={className} data-testid="custom-link">
          {children}
        </a>
      );
    }

    render(<Nav renderLink={TestLink} pathname="/about" />);
    const customLinks = screen.getAllByTestId("custom-link");
    expect(customLinks.length).toBeGreaterThan(0);
  });

  it("uses plain <a> with absolute URLs when baseUrl is set", () => {
    render(<Nav baseUrl="https://axiom-foundation.org" />);
    const aboutLink = screen.getAllByText("About")[0];
    expect(aboutLink.tagName).toBe("A");
    expect(aboutLink).toHaveAttribute(
      "href",
      "https://axiom-foundation.org/about",
    );
  });
});
