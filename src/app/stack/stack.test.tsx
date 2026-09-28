import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import StackPage from "@/app/stack/page";

describe("StackPage", () => {
  it("renders the broader stack structure", () => {
    render(<StackPage />);

    expect(
      screen.getByRole("heading", { name: /from scraped documents to executable rules/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /general flow/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /follow one real rule/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /layer detail/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /execution and promotion path/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /repository map/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /choose a layer to inspect/i })).toBeInTheDocument();
    expect(screen.getByText(/pension credit regulation 4A\(1\)\(a\)/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open encoder system map/i })).toHaveAttribute(
      "href",
      "/encoder"
    );
    expect(screen.getByRole("link", { name: /documentation index/i })).toHaveAttribute(
      "href",
      "/docs"
    );
    expect(screen.getByRole("link", { name: /current execution architecture/i })).toHaveAttribute(
      "href",
      "/docs/#core-execution"
    );
  });

  it("switches layer detail panels", () => {
    render(<StackPage />);

    expect(screen.getByText(/overview mode/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: /normalize source structure/i })[0]
    );
    expect(screen.getAllByText(/source XML normalization/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/source\.xml/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /back to overview/i })).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: /compile, validate, test, and execute/i })[0]
    );
    expect(screen.getAllByText(/test harness/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/python\/js\/rust codegen/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /exact source slice/i }));
    expect(screen.getByRole("link", { name: /open extracted source slice/i })).toHaveAttribute(
      "href",
      "/stack-examples/uk-regulation-4A-1-a-source-slice.txt"
    );

    fireEvent.click(screen.getByRole("button", { name: /encoder run summary/i }));
    expect(screen.getByRole("link", { name: /open encoder summary json/i })).toHaveAttribute(
      "href",
      "/stack-examples/uk-regulation-4A-1-a-encoder-summary.json"
    );
  });
});
