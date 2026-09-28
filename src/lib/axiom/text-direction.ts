/**
 * The base direction of a run of text, by its first strong character —
 * the rule `dir="auto"` applies, made available where the element that
 * needs the direction does not contain the text that decides it (a
 * heading row whose own content is "(1)" above a Hebrew paragraph).
 *
 * Covers the right-to-left scripts' blocks (Hebrew, Arabic, Syriac,
 * Thaana, N'Ko and their presentation forms); any other letter is
 * left-to-right. Null when the text has no letters at all.
 */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
const ANY_LETTER = /\p{L}/u;

export function baseDirection(text: string): "rtl" | "ltr" | null {
  for (const char of text) {
    if (RTL_LETTER.test(char)) return "rtl";
    if (ANY_LETTER.test(char)) return "ltr";
  }
  return null;
}
