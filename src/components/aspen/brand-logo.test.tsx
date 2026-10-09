import { render, screen } from "@testing-library/react";
import { BrandLogo } from "./brand-logo";

describe("BrandLogo", () => {
  it("shows the brand kit's full lockup file", () => {
    render(<BrandLogo className="h-8" />);
    const logo = screen.getByRole("img", { name: "Axiom Foundation" });
    expect(logo).toHaveAttribute("src", "/logos/axiom-foundation.svg");
    expect(logo).toHaveClass("h-8", "w-auto");
  });

  it("needs no size", () => {
    render(<BrandLogo />);
    expect(screen.getByRole("img", { name: "Axiom Foundation" })).toHaveClass("shrink-0");
  });
});
