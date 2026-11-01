import { NextRequest, NextResponse } from "next/server";

const SITE_HOST = "axiom.org";
const APP_HOST = "app.axiom-foundation.org";

// Citation paths the app is allowed to serve at the root of the
// app subdomain. In production these are rewritten to /axiom/*
// transparently; in local dev (single-host on localhost) we apply
// the same rewrite so the breadcrumb hrefs the app generates
// (``/us/statute/26/3101``) don't 404. Marketing routes (``/``,
// ``/about``, ``/format`` …) are not in this list and pass through
// unchanged so the dev server can also serve the marketing site.
// Any two-letter jurisdiction slug (optionally state-suffixed) plus
// the legacy "canada" alias. Hardcoding a jurisdiction list here
// silently 404'd every newer corpus jurisdiction (nz, be, de, …).
// No marketing route uses a two-letter root segment.
const APP_ROOT_PREFIX_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?|canada)(?:\/|$)/;

// Jurisdictions whose corpus rows navigate by provision_id rather
// than citation_path (plus the legacy "canada" alias). The v2
// reader resolves via citation_path only, so these stay on the v1
// tree browser until their corpora gain citation paths.
const V1_ONLY_JURISDICTIONS = new Set(["ca", "canada"]);

// Every jurisdiction-rooted path renders the v2 surface — browse
// levels (jurisdiction / doc type / title) get the v2 list view,
// section depth and deeper the v2 reader. The app root ("/") stays
// on the v1 landing until it is rebuilt.
function appPagePath(pathname: string): string {
  // The Plane is the app: the root serves the graph. The Library
  // returns later as the corpus app; its routes stay reachable for
  // the in-graph law popup.
  if (pathname === "/") return "/axiom/graph";
  if (pathname === "/app") return "/axiom/graph";
  if (!APP_ROOT_PREFIX_RE.test(pathname)) return `/axiom${pathname}`;
  const slug = pathname.split("/")[1];
  return V1_ONLY_JURISDICTIONS.has(slug)
    ? `/axiom${pathname}`
    : `/axiom/v2${pathname}`;
}

function cleanHost(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

function stripAxiomPrefix(pathname: string): string {
  if (pathname === "/axiom") return "/";
  return pathname.startsWith("/axiom/") ? pathname.slice("/axiom".length) : pathname;
}

// The app's own routes that are not citation paths and are public at
// their bare path on every host -- the encoded-rules index links to
// /encoded/<citation> -- rewritten to their /axiom mount like citation
// paths are. /ops is not among them: on the marketing host /ops is the
// marketing page, so the app's ops dashboard stays at /axiom/ops.
const APP_BARE_ROUTE_RE = /^\/(?:encoded|search)(?:\/|$)/;

// The one public URL on the canonical host for a path that reached the
// app under its old host, its /axiom mount or a trailing-slash alias:
// the root and the graph are /app, the ops dashboard is /axiom/ops, and
// everything else -- a citation path, an index link, a marketing page --
// is the bare path itself.
function canonicalSitePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  const bare = isInternalAxiomPath(trimmed) ? stripAxiomPrefix(trimmed) : trimmed;
  if (bare === "/" || bare === "/graph" || bare === "/app") return "/app";
  if (bare === "/ops") return "/axiom/ops";
  return bare;
}

// Top-level dirs/files in ``public/`` that ship to the deploy
// verbatim. Without an explicit bypass the app-subdomain rewrite
// turns e.g. ``/logos/foo.svg`` into ``/axiom/logos/foo.svg``, which
// the catch-all page route renders as HTML — the browser then shows
// a broken image instead of the asset.
const STATIC_PUBLIC_PATH_RE = /^\/(?:logos|stack-examples|axiom-icon-)/;

function isBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    // PostHog's same-origin proxy (next.config rewrites → us.i.posthog
    // .com). The app-host catch-all was rewriting it to /axiom/ingest,
    // serving HTML with a 200 — analytics silently swallowed on the
    // app subdomain.
    pathname.startsWith("/ingest/") ||
    pathname === "/favicon.ico" ||
    pathname === "/favicon.svg" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/sitemap/") ||
    STATIC_PUBLIC_PATH_RE.test(pathname)
  );
}

function isLocalDevHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

function isInternalAxiomPath(pathname: string): boolean {
  return pathname === "/axiom" || pathname.startsWith("/axiom/");
}

/**
 * Pages served with a strict script policy, by the path Next renders
 * (after any rewrite) and the page module that renders it. The policy
 * names a fresh nonce per request; Next reads it from the request's
 * CSP header and puts it on every script it emits, so a script injected
 * into the page has no nonce and doesn't run. Only pages rendered per
 * request can carry one: a prerendered page's scripts have no nonce,
 * and the policy would block them all. So every module here must be
 * force-dynamic, which proxy.test.ts checks.
 *
 * The statute readers echo the request path and render corpus text;
 * Aspen's pages hold the session cookies.
 */
export const CSP_PAGES: ReadonlyArray<{ path: RegExp; module: string }> = [
  { path: /^\/axiom\/v2\/.+/, module: "app/axiom/v2/[...segments]/page.tsx" },
  { path: /^\/aspen\/?$/, module: "app/aspen/page.tsx" },
  { path: /^\/aspen\/present\/?$/, module: "app/aspen/present/page.tsx" },
  { path: /^\/aspen\/sign-in\/?$/, module: "app/aspen/sign-in/page.tsx" },
];

/**
 * Google's strict CSP. Browsers that understand nonces ignore
 * 'unsafe-inline' and https: (CSP 2+) and host lists under
 * 'strict-dynamic' (CSP 3), which lets nonced scripts load the chunks
 * and the analytics they add. The fallbacks only keep pre-CSP-2
 * browsers working. `next dev` evaluates code, so dev allows eval.
 */
export function scriptPolicy(nonce: string): string {
  const scripts = [
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    "'unsafe-inline'",
    "https:",
  ];
  return [
    `script-src ${scripts.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

/**
 * The response for a page rendered at `renderedPath`. A CSP page gets a
 * new nonce, set on the request (for Next) and the response (for the
 * browser); any other path is served as it was.
 */
function servePage(
  request: NextRequest,
  renderedPath: string,
  respond: (init?: { request: { headers: Headers } }) => NextResponse
): NextResponse {
  if (!CSP_PAGES.some((page) => page.path.test(renderedPath))) return respond();
  const policy = scriptPolicy(btoa(crypto.randomUUID()));
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = respond({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export function proxy(request: NextRequest) {
  const host = cleanHost(request);
  const { pathname } = request.nextUrl;

  // "/canada" is a legacy alias the resolver no longer understands —
  // it fell through to the app landing instead of the Canadian
  // browser. Canonicalize to /ca on every host.
  if (pathname === "/canada" || pathname.startsWith("/canada/")) {
    const target = request.nextUrl.clone();
    target.pathname = `/ca${pathname.slice("/canada".length)}`;
    return NextResponse.redirect(target, 308);
  }

  // /axiom/v2/… is the internal rewrite target, never a public URL.
  // Requests that reach it directly (previews, old links) redirect to
  // the canonical bare citation path so one document has one URL.
  if (pathname === "/axiom/v2" || pathname.startsWith("/axiom/v2/")) {
    const target = request.nextUrl.clone();
    target.pathname = pathname.slice("/axiom/v2".length) || "/";
    return NextResponse.redirect(target, 308);
  }

  // app.axiom-foundation.org is the retired app host: axiom.org serves
  // the site and the app alike, so every page request there redirects to
  // the same resource on the canonical host. Framework, asset and
  // analytics paths still resolve, so nothing cached on the old host
  // breaks before the alias is removed.
  if (host === APP_HOST) {
    if (isBypassPath(pathname)) {
      return NextResponse.next();
    }
    // A plain URL, not nextUrl.clone(): NextURL keeps a trailing-slash
    // alias's slash on pathname assignment, which would send /graph/ to
    // /app/, a URL with no page.
    const target = new URL(
      `https://${SITE_HOST}${canonicalSitePath(pathname)}${request.nextUrl.search}`
    );
    return NextResponse.redirect(target, 308);
  }

  // The site skips Next's trailing-slash normalization, but the
  // proxied API reference only resolves its relative links under
  // /receipt/api/ — give this one path its slash. Exact match only,
  // so the slash form can never re-match (no redirect loop). Plain
  // URL, not nextUrl.clone(): NextURL normalizes a trailing slash
  // away on pathname assignment, which would point the redirect at
  // itself. Mirrors the vercel.json redirect for environments the
  // proxy doesn't front.
  if (pathname === "/receipt/api") {
    return NextResponse.redirect(new URL("/receipt/api/", request.url), 307);
  }

  // /axiom is the app's internal mount. On the canonical host a public
  // /axiom URL for the root, the graph or a citation path redirects to
  // its one public form (/app, or the bare citation path); the app's
  // own routes under the mount are served in place.
  if (host === SITE_HOST && isInternalAxiomPath(pathname)) {
    const canonical = canonicalSitePath(pathname);
    if (canonical !== pathname) {
      const target = new URL(request.url);
      target.pathname = canonical;
      return NextResponse.redirect(target, 308);
    }
    return NextResponse.next();
  }

  // The two-door portal is retired — the Plane is the app. Old
  // /start links land on the graph.
  if (pathname === "/start") {
    const target = request.nextUrl.clone();
    target.pathname = "/app";
    return NextResponse.redirect(target, 308);
  }

  // /app is the Plane's canonical path on every host; /graph was its
  // old name, and the trailing-slash forms (the site disables Next's
  // own slash redirect) are aliases, all redirecting with their query.
  const slashless = pathname.replace(/\/+$/, "") || "/";
  if (slashless === "/graph" || (slashless === "/app" && pathname !== "/app")) {
    const target = new URL(request.url);
    target.pathname = "/app";
    return NextResponse.redirect(target, 308);
  }
  if (pathname === "/app") {
    const target = request.nextUrl.clone();
    target.pathname = "/axiom/graph";
    return NextResponse.rewrite(target);
  }

  // Jurisdiction-rooted paths resolve on every host — localhost,
  // Vercel preview deployments, and the marketing host (where the
  // globally mounted palette can navigate to them). App links are
  // subdomain-clean bare paths; without this rewrite they 404
  // anywhere the APP_HOST branch above doesn't apply.
  if (APP_ROOT_PREFIX_RE.test(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = appPagePath(pathname);
    return servePage(request, target.pathname, (init) =>
      NextResponse.rewrite(target, init)
    );
  }

  // The app's bare public routes (the encoded-rules index and search)
  // resolve on every host the same way, at their /axiom mount.
  if (APP_BARE_ROUTE_RE.test(pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = `/axiom${pathname}`;
    return NextResponse.rewrite(target);
  }

  return servePage(request, pathname, (init) => NextResponse.next(init));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)"],
};
