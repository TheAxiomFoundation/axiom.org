/**
 * Text for an inline JSON-LD script element (components/json-ld.tsx).
 *
 * JSON.stringify leaves `<`, `>` and `&` as they are, so a string value
 * holding `</script>` ends the element early and whatever follows is
 * parsed as page markup — a script of the attacker's choosing, when the
 * value echoes a URL. These characters (and U+2028/U+2029, which
 * pre-ES2019 parsers read as line terminators) can only occur inside
 * JSON string literals, where a `\uXXXX` escape parses back to the same
 * character. The output therefore never contains `<`, so no input can
 * close the script, open a comment, or start a new tag, and JSON.parse
 * of the output equals JSON.parse of plain JSON.stringify.
 */
export function serializeJsonLd(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(
    /[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
