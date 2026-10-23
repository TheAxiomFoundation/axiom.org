import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hostileString } from "@/test/hostile-strings";
import { serializeJsonLd } from "./json-ld";

describe("serializeJsonLd", () => {
  it("escapes the reader-URL payload the 2026-10-22 review reported", () => {
    const out = serializeJsonLd({
      url: "https://axiom.org/us/statute/26/32/</script><script>alert(document.domain)</script>",
    });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
    expect(JSON.parse(out).url).toContain("</script><script>alert(");
  });

  it("escapes >, & and the JS line separators as unicode escapes", () => {
    expect(serializeJsonLd({ s: "a>b&c\u2028d\u2029e" })).toBe(
      '{"s":"a\\u003eb\\u0026c\\u2028d\\u2029e"}',
    );
  });

  it("keeps a literal backslash before an escaped character intact", () => {
    const out = serializeJsonLd({ s: "\\<" });
    expect(out).toBe('{"s":"\\\\\\u003c"}');
    expect(JSON.parse(out).s).toBe("\\<");
  });

  it("serializes a value JSON.stringify drops as null", () => {
    expect(serializeJsonLd(undefined)).toBe("null");
  });

  it("never emits a character that HTML treats specially, for any JSON value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(serializeJsonLd(value)).not.toMatch(/[<>&\u2028\u2029]/);
      }),
    );
  });

  it("round-trips to exactly what plain JSON.stringify would parse to", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(serializeJsonLd(value))).toEqual(
          JSON.parse(JSON.stringify(value)),
        );
      }),
    );
  });

  it("no string, in any key or value, produces </script", () => {
    fc.assert(
      fc.property(
        fc.dictionary(hostileString, fc.oneof(hostileString, fc.array(hostileString))),
        (value) => {
          const out = serializeJsonLd(value);
          expect(out).not.toMatch(/<\/script/i);
          expect(out).not.toContain("<!--");
          expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(value)));
        },
      ),
      { numRuns: 500 },
    );
  });
});
