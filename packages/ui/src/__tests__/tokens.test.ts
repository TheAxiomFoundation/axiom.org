import { colors, easings } from "../tokens/index";

describe("tokens", () => {
  it("exports color values matching the design system", () => {
    expect(colors.paper).toBe("#faf9f6");
    expect(colors.ink).toBe("#1c1917");
    expect(colors.inkMuted).toBe("#78716c");
    expect(colors.accent).toBe("#92400e");
    expect(colors.accentHover).toBe("#7c2d12");
    expect(colors.ruleStrong).toBe("#78716c");
    expect(colors.focusRing).toBe("#92400e");
  });

  it("exports all expected color keys", () => {
    const expectedKeys = [
      "paper",
      "paperElevated",
      "ink",
      "inkSecondary",
      "inkMuted",
      "rule",
      "ruleSubtle",
      "ruleStrong",
      "accent",
      "accentHover",
      "accentLight",
      "focusRing",
      "codeBg",
      "codeText",
      "codeSelection",
      "success",
      "warning",
      "error",
    ];
    expect(Object.keys(colors)).toEqual(expectedKeys);
  });

  it("exports easing values", () => {
    expect(easings.out).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(easings.spring).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
  });

  it("color values snapshot", () => {
    expect(colors).toMatchInlineSnapshot(`
      {
        "accent": "#92400e",
        "accentHover": "#7c2d12",
        "accentLight": "rgba(146, 64, 14, 0.06)",
        "codeBg": "#1c1917",
        "codeSelection": "#755b1c",
        "codeText": "#e7e5e4",
        "error": "#991b1b",
        "focusRing": "#92400e",
        "ink": "#1c1917",
        "inkMuted": "#78716c",
        "inkSecondary": "#57534e",
        "paper": "#faf9f6",
        "paperElevated": "#ffffff",
        "rule": "#e7e5e4",
        "ruleStrong": "#78716c",
        "ruleSubtle": "#f5f5f4",
        "success": "#166534",
        "warning": "#92400e",
      }
    `);
  });
});
