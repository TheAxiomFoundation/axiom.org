import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT } from "@/lib/aspen/content";
import { SignInForm } from "./sign-in-form";

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function typePassword(value: string) {
  fireEvent.change(screen.getByLabelText("Enter the password on the screen"), { target: { value } });
}

describe("SignInForm", () => {
  it("says the page is not open yet when closed", () => {
    render(<SignInForm open={false} next="/aspen" presenter={false} />);
    expect(screen.getByRole("heading", { name: EVENT.title })).toBeInTheDocument();
    expect(screen.getByText("This page is not open yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(`Aspen Institute · ${EVENT.place}`)).toBeInTheDocument();
  });

  it("labels the presenter sign-in", () => {
    render(<SignInForm open next="/aspen/present" presenter />);
    expect(screen.getByRole("heading", { name: "Presenter sign-in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Presenter password")).toHaveAttribute("type", "password");
  });

  it("signs in and goes to the next page", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(<SignInForm open next="/aspen?from=sign-in" presenter={false} />);

    const join = screen.getByRole("button", { name: "Join" });
    expect(join).toBeDisabled();
    typePassword("phoenix");
    expect(join).toBeEnabled();
    fireEvent.click(join);

    expect(await screen.findByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/aspen/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "phoenix" }),
    });
    resolve({ ok: true, json: async () => ({ ok: true }) } as unknown as Response);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/aspen?from=sign-in"));
  });

  it("shows the server's error for a wrong password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Wrong password." }) }),
    );
    render(<SignInForm open next="/aspen" presenter={false} />);
    typePassword("nope");
    fireEvent.submit(screen.getByRole("button", { name: "Join" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password.");
    expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows a generic error when the response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.reject(new Error("html")) }),
    );
    render(<SignInForm open next="/aspen" presenter={false} />);
    typePassword("nope");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
  });

  it("shows a generic error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<SignInForm open next="/aspen" presenter={false} />);
    typePassword("phoenix");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't work. Try again.");
    expect(assign).not.toHaveBeenCalled();
  });
});
