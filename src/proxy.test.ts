import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function request(url: string, host: string): NextRequest {
  return new NextRequest(url, { headers: { host } });
}

describe("proxy", () => {
  it("redirects app host paths to the same path on the canonical host", () => {
    // axiom.org serves the app; the old app host only forwards there.
    const response = proxy(
      request("https://app.axiom-foundation.org/us/statute/7", "app.axiom-foundation.org")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://axiom.org/us/statute/7");
  });

  it("redirects app routes on the old host to their canonical axiom.org form", () => {
    for (const [path, expected] of [
      ["/encoded/il", "https://axiom.org/encoded/il"],
      ["/search?q=credit", "https://axiom.org/search?q=credit"],
      ["/app?program=us-co/co-snap", "https://axiom.org/app?program=us-co/co-snap"],
      ["/graph", "https://axiom.org/app"],
      ["/graph/?x=1", "https://axiom.org/app?x=1"],
      ["/axiom/graph/", "https://axiom.org/app"],
      ["/ops", "https://axiom.org/axiom/ops"],
    ] as const) {
      const response = proxy(
        request(`https://app.axiom-foundation.org${path}`, "app.axiom-foundation.org")
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("routes every jurisdiction-rooted path to the v2 surface", () => {
    for (const [path, expected] of [
      ["/us/statute/26/164", "/axiom/v2/us/statute/26/164"],
      ["/us/statute/7/2017/a", "/axiom/v2/us/statute/7/2017/a"],
      ["/us-co/regulation/10-ccr-2506-1/4.207.3", "/axiom/v2/us-co/regulation/10-ccr-2506-1/4.207.3"],
      // Browse depths render the v2 list view.
      ["/us/statute/26", "/axiom/v2/us/statute/26"],
      ["/us/statute", "/axiom/v2/us/statute"],
      ["/us", "/axiom/v2/us"],
      ["/us/policy/usda/snap", "/axiom/v2/us/policy/usda/snap"],
      // Jurisdictions without citation paths stay on the v1 tree
      // browser, which navigates by provision_id.
      ["/ca", "/axiom/ca"],
      ["/ca/statute/act/1", "/axiom/ca/statute/act/1"],
    ] as const) {
      const response = proxy(request(`https://axiom.org${path}`, "axiom.org"));
      expect(response.headers.get("x-middleware-rewrite")).toBe(
        `https://axiom.org${expected}`
      );
    }
  });

  it("applies the same v2 routing on localhost", () => {
    const response = proxy(
      request("http://localhost:3000/us/statute/26/164", "localhost")
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/axiom/v2/us/statute/26/164"
    );
  });

  it("redirects site /axiom citation paths to the bare canonical path", () => {
    const response = proxy(
      request("https://axiom.org/axiom/us/statute/7", "axiom.org")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://axiom.org/us/statute/7");
  });

  it("redirects site /axiom root and graph to /app", () => {
    for (const path of ["/axiom", "/axiom/graph"]) {
      const response = proxy(request(`https://axiom.org${path}`, "axiom.org"));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://axiom.org/app");
    }
  });

  it("serves the ops dashboard under its /axiom mount in place", () => {
    const response = proxy(request("https://axiom.org/axiom/ops", "axiom.org"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("routes the encoded-rules index links and search at their bare path on every host", () => {
    // The index at /axiom/encoded links each row to /encoded/<citation>
    // (src/app/axiom/encoded/page.tsx); those resolve like citation paths.
    for (const [url, host, expected] of [
      ["https://axiom.org/encoded/us/statute/26/3101/a", "axiom.org", "https://axiom.org/axiom/encoded/us/statute/26/3101/a"],
      ["https://axiom.org/encoded/il", "axiom.org", "https://axiom.org/axiom/encoded/il"],
      ["https://axiom.org/search?q=credit", "axiom.org", "https://axiom.org/axiom/search?q=credit"],
      ["http://localhost:4944/encoded/il", "localhost:4944", "http://localhost:4944/axiom/encoded/il"],
    ] as const) {
      const response = proxy(request(url, host));
      expect(response.headers.get("x-middleware-rewrite")).toBe(expected);
    }
    // The mounted form is not a second public URL for them.
    for (const [path, expected] of [
      ["/axiom/encoded/il", "https://axiom.org/encoded/il"],
      ["/axiom/search?q=credit", "https://axiom.org/search?q=credit"],
    ] as const) {
      const response = proxy(request(`https://axiom.org${path}`, "axiom.org"));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("normalizes trailing-slash graph aliases to /app with their query", () => {
    for (const path of ["/graph/", "/graph/?x=1", "/axiom/graph/", "/axiom/graph/?x=1", "/app/", "/app/?x=1"]) {
      const response = proxy(request(`https://axiom.org${path}`, "axiom.org"));
      expect(response.status).toBe(308);
      const query = path.includes("?") ? "?x=1" : "";
      expect(response.headers.get("location")).toBe(`https://axiom.org/app${query}`);
    }
  });

  it("redirects explicit app host /axiom paths to the canonical host without double-prefixing", () => {
    const response = proxy(
      request("https://app.axiom-foundation.org/axiom/us/statute/7", "app.axiom-foundation.org")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://axiom.org/us/statute/7");
  });

  it("redirects explicit app host /axiom root to the canonical graph", () => {
    const response = proxy(
      request("https://app.axiom-foundation.org/axiom", "app.axiom-foundation.org")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://axiom.org/app");
  });

  it("bypasses framework and API paths on the app host", () => {
    const response = proxy(
      request("https://app.axiom-foundation.org/api/axiom", "app.axiom-foundation.org")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("bypasses static public assets on the app host", () => {
    const response = proxy(
      request("https://app.axiom-foundation.org/logos/axiom-foundation.svg", "app.axiom-foundation.org")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("bypasses the PostHog ingest proxy on the app host", () => {
    // Without the bypass, the catch-all rewrote /ingest/* to
    // /axiom/ingest/* — an HTML page answering capture requests
    // with 200, silently swallowing every analytics event.
    const response = proxy(
      request("https://app.axiom-foundation.org/ingest/e/?v=1", "app.axiom-foundation.org")
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects the app host root to the canonical graph (the Plane is the app)", () => {
    const response = proxy(
      request("https://app.axiom-foundation.org/", "app.axiom-foundation.org")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://axiom.org/app");
  });

  it("redirects the ops dashboard on the old host to its /axiom mount", () => {
    const response = proxy(
      request("https://app.axiom-foundation.org/ops", "app.axiom-foundation.org")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://axiom.org/axiom/ops");
  });

  it("rewrites jurisdiction paths on localhost into the Axiom app route", () => {
    const response = proxy(
      request("http://localhost:4944/us-co/statute", "localhost:4944")
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:4944/axiom/v2/us-co/statute"
    );
  });

  it("rewrites jurisdiction paths on 127.0.0.1 into the Axiom app route", () => {
    const response = proxy(
      request("http://127.0.0.1:4944/uk/legislation", "127.0.0.1:4944")
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:4944/axiom/v2/uk/legislation"
    );
  });

  it("rewrites jurisdiction paths on custom localhost names into the Axiom app route", () => {
    const response = proxy(
      request("http://app.localhost:4944/ca/regulation", "app.localhost:4944")
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://app.localhost:4944/axiom/ca/regulation"
    );
  });

  it("redirects the legacy /canada alias to /ca on every host", () => {
    for (const [url, host, expected] of [
      [
        "https://app.axiom-foundation.org/canada",
        "app.axiom-foundation.org",
        "https://app.axiom-foundation.org/ca",
      ],
      [
        "https://app.axiom-foundation.org/canada/regulation",
        "app.axiom-foundation.org",
        "https://app.axiom-foundation.org/ca/regulation",
      ],
      [
        "http://localhost:4944/canada",
        "localhost:4944",
        "http://localhost:4944/ca",
      ],
    ] as const) {
      const response = proxy(request(url, host));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("redirects direct /axiom/v2 URLs to the canonical bare path", () => {
    for (const [url, host, expected] of [
      [
        "https://axiom-foundation-abc123.vercel.app/axiom/v2/us/statute/26/32",
        "axiom-foundation-abc123.vercel.app",
        "https://axiom-foundation-abc123.vercel.app/us/statute/26/32",
      ],
      [
        "http://localhost:4944/axiom/v2/us",
        "localhost:4944",
        "http://localhost:4944/us",
      ],
    ] as const) {
      const response = proxy(request(url, host));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(expected);
    }
  });

  it("redirects marketing paths on the app host to the marketing site", () => {
    // axiom.org became the canonical marketing host on master
    // (#134–#152); the app host forwards there.
    for (const path of ["/about", "/team", "/privacy", "/docs"]) {
      const response = proxy(
        request(
          `https://app.axiom-foundation.org${path}`,
          "app.axiom-foundation.org"
        )
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        `https://axiom.org${path}`
      );
    }
  });

  it("rewrites jurisdiction paths on preview and marketing hosts too", () => {
    // Vercel preview deployment: internal bare links must resolve.
    const preview = proxy(
      request(
        "https://axiom-foundation-abc123-policy-engine.vercel.app/us/statute/26/32",
        "axiom-foundation-abc123-policy-engine.vercel.app"
      )
    );
    expect(preview.headers.get("x-middleware-rewrite")).toBe(
      "https://axiom-foundation-abc123-policy-engine.vercel.app/axiom/v2/us/statute/26/32"
    );
    // Marketing host: the globally mounted palette can navigate here.
    const marketing = proxy(
      request(
        "https://axiom-foundation.org/us/statute/26/32",
        "axiom-foundation.org"
      )
    );
    expect(marketing.headers.get("x-middleware-rewrite")).toBe(
      "https://axiom-foundation.org/axiom/v2/us/statute/26/32"
    );
  });

  it("redirects the retired /start portal to the app", () => {
    const response = proxy(
      request("http://localhost:4944/start", "localhost:4944")
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:4944/app"
    );
  });

  it("rewrites /app to the in-app viewer on every host", () => {
    for (const [url, host, expected] of [
      [
        "https://axiom.org/app?program=us-co/co-snap",
        "axiom.org",
        "https://axiom.org/axiom/graph?program=us-co/co-snap",
      ],
      [
        "http://localhost:4944/app?compose=us:statutes/7/2017/a",
        "localhost:4944",
        "http://localhost:4944/axiom/graph?compose=us:statutes/7/2017/a",
      ],
    ] as const) {
      const response = proxy(request(url, host));
      expect(response.headers.get("x-middleware-rewrite")).toBe(expected);
    }
  });

  it("leaves marketing paths on localhost alone", () => {
    const response = proxy(request("http://localhost:4944/about", "localhost:4944"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("passes through regular site pages", () => {
    const response = proxy(request("https://axiom.org/about", "axiom.org"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects the slashless API reference path to the slash form", () => {
    const response = proxy(request("https://axiom.org/receipt/api", "axiom.org"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://axiom.org/receipt/api/"
    );
  });

  it("redirects the slashless API reference path on localhost too", () => {
    const response = proxy(
      request("http://localhost:4944/receipt/api", "localhost:4944")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:4944/receipt/api/"
    );
  });

  it("passes the slash-form API reference path through, so it cannot loop", () => {
    const response = proxy(request("https://axiom.org/receipt/api/", "axiom.org"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
