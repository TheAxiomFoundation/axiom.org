import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ESM config: __dirname does not exist here.
const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory makes Next infer
  // the wrong workspace root; pin it to the repo.
  turbopack: { root: configDir },
  images: {
    remotePatterns: [
      { hostname: "maxghenis.com" },
    ],
  },
  // Mirrors the /proposal rewrites in vercel.json. Vercel's platform
  // rewrites serve production; this copy makes `next dev` proxy to the
  // same upstream instead of a different deployment.
  async rewrites() {
    return [
      // Dev-parity mirror for the receipt API reference, which
      // vercel.json rewrites to the package repo's GitHub Pages build.
      // Wildcard form only: the slashless /receipt/api gets its slash
      // from src/proxy.ts (exact match) and the vercel.json redirect,
      // so pdoc's relative links resolve under /receipt/api/.
      {
        source: "/receipt/api/:path*",
        destination: "https://theaxiomfoundation.github.io/receipt/:path*",
      },
      // Dev-parity mirror for the working-paper manuscript embed; the
      // wrapper page at /receipt/paper is a normal route.
      {
        source: "/receipt/paper/web/:path*",
        destination: "https://theaxiomfoundation.github.io/receipt/paper/web/:path*",
      },
      {
        source: "/proposal",
        destination: "https://proposal.axiom-foundation.org/",
      },
      {
        source: "/proposal/:path*",
        destination: "https://proposal.axiom-foundation.org/:path*",
      },
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/array/:path*",
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
