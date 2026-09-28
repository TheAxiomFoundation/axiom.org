import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface VercelRedirect {
  source: string;
  destination: string;
  permanent?: boolean;
}

interface VercelRewrite {
  source: string;
  destination: string;
}

interface VercelConfig {
  redirects?: VercelRedirect[];
  rewrites?: VercelRewrite[];
}

const config = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
) as VercelConfig;

describe("vercel redirects", () => {
  it("keeps the PBIF proposal mounted on its dedicated subdomain", () => {
    expect(config.redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/pbif-proposal",
          destination: "https://pbif-proposal.axiom-foundation.org/",
          permanent: false,
        }),
        expect.objectContaining({
          source: "/pbif-proposal/:path*",
          destination: "https://pbif-proposal.axiom-foundation.org/:path*",
          permanent: false,
        }),
      ]),
    );
  });
});

// Demo zones served under axiom.org/<slug>. Each zone app is configured
// with a matching basePath/base, so the destination keeps the slug prefix.
const DEMO_ZONES: Record<string, string> = {
  demos: "axiom-demo-shell",
  architecture: "axiom-architecture-one",
  "graph-viewer": "rulespec-graph-viewer",
  oracles: "axiom-oracles",
  bills: "axiom-bills",
};

// Zone apps that moved to a /gallery/<slug> basePath: /gallery/<slug>
// rewrites to the app, and the bare /<slug> redirects into the
// gallery path (the apps' old bare basePaths are gone).
const GALLERY_ZONES: Record<string, string> = {
  chatbot: "finbot-snap-demo",
  "reg-demo": "axiom-reg-demo",
  builder: "dashboard-builder-flax",
  workflow: "co-snap-workflow-checker",
  cliffs: "axiom-co-snap",
  microsim: "axiom-microsim",
};

describe("demo zone rewrites", () => {
  it.each(Object.entries(DEMO_ZONES))(
    "proxies /%s to its Vercel project",
    (slug, project) => {
      expect(config.rewrites).toEqual(
        expect.arrayContaining([
          {
            source: `/${slug}`,
            destination: `https://${project}.vercel.app/${slug}`,
          },
          // :path(.*) (not :path*) so the bare trailing-slash URL
          // /<slug>/ matches too — :path* rejects the empty segment.
          {
            source: `/${slug}/:path(.*)`,
            destination: `https://${project}.vercel.app/${slug}/:path(.*)`,
          },
        ]),
      );
    },
  );

  it.each(Object.entries(GALLERY_ZONES))(
    "proxies /gallery/%s to its Vercel project and redirects the bare path in",
    (slug, project) => {
      expect(config.rewrites).toEqual(
        expect.arrayContaining([
          {
            source: `/gallery/${slug}`,
            destination: `https://${project}.vercel.app/gallery/${slug}`,
          },
          {
            source: `/gallery/${slug}/:path(.*)`,
            destination: `https://${project}.vercel.app/gallery/${slug}/:path(.*)`,
          },
        ]),
      );
      expect(config.redirects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: `/${slug}`,
            destination: `/gallery/${slug}`,
            permanent: false,
          }),
          expect.objectContaining({
            source: `/${slug}/:path(.*)`,
            destination: `/gallery/${slug}/:path(.*)`,
            permanent: false,
          }),
        ]),
      );
    },
  );

  it("guidance joins the gallery scheme — its app now serves under /guidance, and its ROOT canonically redirects to axiom.org/guidance, so the old root redirect was an infinite loop", () => {
    expect(config.redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/guidance",
          destination: "/gallery/guidance",
          permanent: false,
        }),
        expect.objectContaining({
          source: "/guidance/:path(.*)",
          destination: "/gallery/guidance/:path(.*)",
          permanent: false,
        }),
      ]),
    );
    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/gallery/guidance",
          destination:
            "https://guidance-impact-visualizer.vercel.app/guidance",
        }),
        expect.objectContaining({
          source: "/gallery/guidance/:path(.*)",
          destination:
            "https://guidance-impact-visualizer.vercel.app/guidance/:path(.*)",
        }),
      ]),
    );
    // The demo's own redirect must never point back at the app's root
    // — that root 308s to axiom.org/guidance, closing the loop.
    for (const redirect of config.redirects) {
      expect(redirect.destination).not.toBe(
        "https://guidance-impact-visualizer.vercel.app/",
      );
    }
  });

  it("rewrites the working-paper manuscript tree to the receipt Pages deployment", () => {
    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/receipt/paper/web/:path(.*)",
          destination:
            "https://theaxiomfoundation.github.io/receipt/paper/web/:path(.*)",
        }),
      ]),
    );
  });

  it("redirects the bare receipt API reference path and rewrites only the tree", () => {
    expect(config.redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/receipt/api",
          destination: "/receipt/api/",
          permanent: false,
        }),
      ]),
    );
    expect(config.rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/receipt/api/:path(.*)",
          destination: "https://theaxiomfoundation.github.io/receipt/:path(.*)",
        }),
      ]),
    );
    expect(config.rewrites).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "/receipt/api" }),
      ]),
    );
  });

  it("never claims a two-letter jurisdiction path or an existing app route", () => {
    const reserved =
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?|canada|axiom|graph|start|about|team|privacy|docs|format|stack|reports|preview|proposal|pbif-proposal)$/;
    for (const slug of [
      ...Object.keys(DEMO_ZONES),
      ...Object.keys(GALLERY_ZONES),
      "guidance",
      "gallery",
    ]) {
      expect(`/${slug}`).not.toMatch(reserved);
    }
  });
});
