import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The share card is the same frame as the page's interactive: the
// "rewrite a rule" attack, mid-refusal. Same miniature corpus, same real
// SHA-256 prefixes, the command's own wording. Colocating this file wires
// og:image (and Twitter's fallback) for /receipt automatically.

export const alt =
  "receipt verify refusing a rewritten rule: the tree's digest no longer matches the witnessed journal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#faf9f6";
const CODE_BG = "#1c1917";
const CODE_BORDER = "#2a2826";
const CODE_TEXT = "#e7e5e4";
const CODE_DIM = "#a8a29e";
const CODE_AMBER = "#fbbf24";
const INK = "#1c1917";
const MUTED = "#78716c";
const SECONDARY = "#57534e";
const RULE = "#e7e5e4";
const ACCENT = "#d97706";

const font = (name: string) =>
  readFile(join(process.cwd(), "src/app/receipt/og-fonts", name));

export default async function Image() {
  const [mono, monoBold, sans, serif] = await Promise.all([
    font("JetBrainsMono-Regular.ttf"),
    font("JetBrainsMono-Bold.ttf"),
    font("Geist-Regular.ttf"),
    font("Newsreader16pt-SemiBold.ttf"),
  ]);

  const pane = {
    display: "flex" as const,
    flexDirection: "column" as const,
    background: CODE_BG,
    border: `1.5px solid ${CODE_BORDER}`,
    borderRadius: 10,
    padding: "26px 30px",
    fontFamily: "JetBrains Mono",
    fontSize: 22,
    lineHeight: 1.65,
    whiteSpace: "pre" as const,
  };
  const label = {
    fontSize: 15,
    letterSpacing: 2.2,
    color: MUTED,
    marginBottom: 14,
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          padding: "44px 56px 36px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "JetBrains Mono",
            fontSize: 17,
            letterSpacing: 3,
            color: SECONDARY,
          }}
        >
          <span style={{ color: ACCENT, marginRight: 14 }}>§</span>
          RECEIPT
        </div>
        <div
          style={{
            fontFamily: "Newsreader",
            fontSize: 44,
            color: INK,
            marginTop: 10,
            marginBottom: 26,
          }}
        >
          Verifiable custody of agent-produced records
        </div>

        <div style={{ display: "flex", gap: 24, flexGrow: 1 }}>
          <div style={{ ...pane, width: 420 }}>
            <div style={{ ...label, color: CODE_DIM, display: "flex" }}>THE CLONE</div>
            <span style={{ color: CODE_TEXT }}>rules/</span>
            <span style={{ color: CODE_AMBER }}>{"  tax/rate.yaml"}</span>
            <span style={{ color: CODE_AMBER }}>{"    value: 0.17"}</span>
            <span style={{ color: CODE_TEXT }}>releases/</span>
            <span style={{ color: CODE_TEXT }}>{"  manifests/0002.json"}</span>
            <span style={{ color: CODE_TEXT }}>{"  anchors/producer.pub"}</span>
            <span style={{ color: CODE_DIM, marginTop: 16 }}>
              {"auditor's own repo:"}
            </span>
            <span style={{ color: CODE_DIM }}>{"  spec.py — pinned anchors"}</span>
          </div>

          <div style={{ ...pane, flexGrow: 1 }}>
            <div style={{ ...label, color: CODE_DIM, display: "flex" }}>RECEIPT VERIFY</div>
            <span style={{ color: CODE_TEXT }}>{"  [ok  ] custody"}</span>
            <span style={{ color: CODE_AMBER, fontFamily: "JetBrains Mono Bold" }}>
              {"  [FAIL] binding"}
            </span>
            <span style={{ color: CODE_TEXT }}>
              {"    content file 'rules/tax/rate.yaml' does not"}
            </span>
            <span style={{ color: CODE_TEXT }}>
              {"    match its witnessed digest:"}
            </span>
            <span style={{ color: CODE_TEXT }}>
              {"    tree has c0f597cf00ba…, journal binds"}
            </span>
            <span style={{ color: CODE_TEXT }}>{"    e218ac6d2f12…"}</span>
            <span
              style={{
                color: CODE_AMBER,
                fontFamily: "JetBrains Mono Bold",
                marginTop: 14,
              }}
            >
              VERDICT: FAIL — binding
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 26,
            fontFamily: "Geist",
            fontSize: 21,
            color: SECONDARY,
          }}
        >
          <span>
            Offline, fail-closed verification — a clone and commodity tools.
          </span>
          <span style={{ fontFamily: "JetBrains Mono", fontSize: 18, color: MUTED }}>
            axiom.org/receipt
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "JetBrains Mono", data: mono, weight: 400 },
        { name: "JetBrains Mono Bold", data: monoBold, weight: 700 },
        { name: "Geist", data: sans, weight: 400 },
        { name: "Newsreader", data: serif, weight: 600 },
      ],
    },
  );
}
