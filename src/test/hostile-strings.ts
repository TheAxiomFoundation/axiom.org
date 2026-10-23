import fc from "fast-check";

/** Strings dense in the fragments that end or confuse a script element,
 *  interleaved with arbitrary code points (surrogates included). */
export const hostileString = fc
  .array(
    fc.oneof(
      fc.constantFrom(
        "</script>",
        "</script",
        "</SCRIPT ",
        "</ScRiPt\t>",
        "<script>",
        "<!--",
        "-->",
        "<",
        ">",
        "&",
        "&lt;",
        "\\",
        "\\u003c",
        '"',
        "/",
        "\u2028",
        "\u2029",
        "\u0000",
      ),
      fc.string({ unit: "binary", maxLength: 8 }),
    ),
    { maxLength: 12 },
  )
  .map((parts) => parts.join(""));
