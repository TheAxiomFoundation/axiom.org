import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import "./globals.css";
import { NavWrapper } from "@/components/nav-wrapper";
import { CommandPaletteProvider } from "@/components/axiom/command-palette-provider";
import { Footer, GradientSync } from "@axiom-foundation/ui";
import { GoogleAnalytics } from "@/components/google-analytics";
import { PostHogProvider } from "@/components/posthog-provider";
import { SITE_URL, axiomAppHref } from "@/lib/urls";
import { UPDATES_URL } from "@/lib/launch";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "./" },
  title: "Axiom Foundation — Computable law for all",
  description:
    "Open, machine-readable encodings of the world's rules, starting with tax and benefit policy. Cited, time-aware, and executable, so anyone can run, audit, or reform them.",
  openGraph: {
    url: "./",
    title: "Axiom Foundation",
    // Post-launch share copy — the Message House top line (ops repo,
    // comms/Message-House.md). Keep in sync if the house changes.
    description:
      "The rules that decide who gets food assistance, health coverage, and tax credits live in closed code that no one can check — the Axiom Foundation publishes them in the open: cited, computable, and verified.",
    // Official brand share card (axiom-brand png/social/og-paper-full.png,
    // 1200×630, w350 lockup on paper).
    images: ["/og-image.png"],
  },
  twitter: {
    site: "@AxiomFdn",
    // The brand share card is 1200×630; without this Next emits the
    // small summary card and shares render a thumbnail.
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${mono.variable} ${GeistSans.variable} ${serif.variable}`}
    >
      <head>
        {/* Favicons from the axiom-brand kit (w350 tile). */}
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="apple-touch-icon" href="/axiom-icon-180.png" />
      </head>
      <body>
        <GoogleAnalytics />
        <PostHogProvider />
        <GradientSync />
        <CommandPaletteProvider>
          <NavWrapper />
          {/* Above the footer's z-10: fixed overlays inside main (the
              run sheet, the law popup) are trapped in main's stacking
              context, and a later same-level footer would paint over
              them once the page scrolls to it. */}
          <main className="relative z-20">{children}</main>
        </CommandPaletteProvider>
        <Footer renderLink={Link} appUrl={axiomAppHref()} updatesUrl={UPDATES_URL} />
      </body>
    </html>
  );
}
