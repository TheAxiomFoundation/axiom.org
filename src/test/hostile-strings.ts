import fc from "fast-check";

/** Strings dense in the fragments that end or confuse a script element,
 *  interleaved with arbitrary code points and UTF-16 code units. */
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
        // Lone surrogates: the binary unit only yields whole code points.
        "\ud800",
        "\udbff",
        "\udc00",
        "\udfff",
      ),
      fc.string({ unit: "binary", maxLength: 8 }),
      // Arbitrary UTF-16 code units, unpaired surrogates included.
      fc
        .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 6 })
        .map((units) => String.fromCharCode(...units)),
    ),
    { maxLength: 12 },
  )
  .map((parts) => parts.join(""));
