"use client";

import { useState } from "react";
import { EVENT } from "@/lib/aspen/content";
import { BUTTON, FIELD } from "./ui";
import { BrandLogo } from "./brand-logo";

/** The password screen for axiom.org/aspen (and the presenter view). */
export function SignInForm({ open, next, presenter }: { open: boolean; next: string; presenter: boolean }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");
    const response = await fetch("/api/aspen/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (response?.ok) {
      // Replace, so Back from the page never lands on this form again.
      window.location.replace(next);
      return;
    }
    const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setError(data?.error ?? "That didn't work. Try again.");
    setStatus("error");
  }

  return (
    <div data-aspen-page className="relative z-1 flex min-h-screen items-center justify-center bg-[var(--color-paper)] px-4">
      <div className="w-full max-w-[420px]">
        <BrandLogo className="mb-10 h-10" />
        <span className="kicker mb-5 inline-flex">
          <span className="kicker-mark">&sect;</span>
          Aspen Institute · {EVENT.place}
        </span>
        <h1 className="heading-section m-0 mb-8 text-balance">{presenter ? "Presenter sign-in" : EVENT.title}</h1>
        {open ? (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor="aspen-password" className="font-body text-[0.95rem] text-[var(--color-ink-secondary)]">
              {presenter ? "Presenter password" : "Enter the password on the screen"}
            </label>
            <input
              id="aspen-password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
            <button type="submit" className={`${BUTTON} w-full py-3`} disabled={!password || status === "checking"}>
              {status === "checking" ? "Checking…" : "Join"}
            </button>
            {status === "error" && (
              <p role="alert" className="m-0 font-body text-[0.9rem] text-[var(--color-error)]">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="m-0 font-body text-[1rem] text-[var(--color-ink-secondary)]">This page is not open yet.</p>
        )}
      </div>
    </div>
  );
}
