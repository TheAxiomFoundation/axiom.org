import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hostileString } from "@/test/hostile-strings";
import { JsonLd } from "./json-ld";

/** Parse server markup as a whole document, the way a browser receives
 *  it, with a sentinel after it that a broken-out script would precede
 *  with elements of its own. */
function parsePage(markup: string) {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><head></head><body>${markup}<p id="after">after</p></body></html>`,
    "text/html",
  );
  return {
    scripts: Array.from(doc.querySelectorAll("script")),
    bodyChildren: Array.from(doc.body.children).map((el) => el.tagName),
  };
}

/** The sink both readers used before: plain JSON.stringify. */
function unescapedMarkup(data: object): string {
  return renderToStaticMarkup(
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />,
  );
}

const PAYLOAD = {
  url: "https://axiom.org/us/statute/26/32/</script><script>alert(document.domain)</script>",
};

describe("JsonLd", () => {
  it("renders the data as a single JSON-LD script", () => {
    const markup = renderToStaticMarkup(<JsonLd data={{ "@type": "Legislation" }} />);
    expect(markup).toBe(
      '<script type="application/ld+json">{"@type":"Legislation"}</script>',
    );
  });

  it("keeps the reported payload inside its own script element", () => {
    const { scripts, bodyChildren } = parsePage(
      renderToStaticMarkup(<JsonLd data={PAYLOAD} />),
    );
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0].textContent ?? "")).toEqual(PAYLOAD);
    expect(bodyChildren).toEqual(["SCRIPT", "P"]);
  });

  it("is the fix: the old JSON.stringify sink let the payload open a second script", () => {
    const { scripts } = parsePage(unescapedMarkup(PAYLOAD));
    expect(scripts).toHaveLength(2);
    expect(scripts[1].textContent).toBe("alert(document.domain)");
  });

  it("for any strings, the page parses to one script holding exactly the data", () => {
    fc.assert(
      fc.property(
        fc.record({
          url: hostileString,
          name: hostileString,
          text: fc.option(hostileString, { nil: undefined }),
          identifier: fc.array(hostileString, { maxLength: 3 }),
        }),
        (data) => {
          const markup = renderToStaticMarkup(<JsonLd data={data} />);
          // Only the element's own closing tag may spell </script.
          expect(markup.match(/<\/script/gi)).toHaveLength(1);
          expect(markup.endsWith("</script>")).toBe(true);
          const { scripts, bodyChildren } = parsePage(markup);
          expect(scripts).toHaveLength(1);
          expect(scripts[0].getAttribute("type")).toBe("application/ld+json");
          expect(JSON.parse(scripts[0].textContent ?? "")).toEqual(
            JSON.parse(JSON.stringify(data)),
          );
          expect(bodyChildren).toEqual(["SCRIPT", "P"]);
        },
      ),
      { numRuns: 300 },
    );
  });
});
