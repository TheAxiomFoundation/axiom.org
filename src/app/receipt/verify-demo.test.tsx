import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { VerifyDemo, tones } from "./verify-demo";
import {
  CLONES,
  CORPUS,
  RECEIPT_VERSION,
  TRANSCRIPTS,
  type AttackId,
  type Pin,
} from "./verify-transcripts";

// These assert the *shape* of receipt's verdict, never a digest or an OID:
// the transcripts are regenerated against each release and every commit,
// tree, key and timestamp in them changes when they are. What must not change
// silently is which pass refuses which attack, that a run stops at the first
// failure, and that the demo's colouring still finds the lines it colours.
//
// A release that renames a pass or reshapes a refusal will fail here, which is
// the point: the page claims to print receipt's own words, so it should break
// loudly rather than keep showing the previous release's.

const attack = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

const pin = (action: string) =>
  fireEvent.click(screen.getByRole("button", { name: action }));

// The attack buttons, in the order the demo offers them. Every id here indexes
// TRANSCRIPTS and CLONES and every label is clicked, so a renamed scenario
// throws out of the loops below rather than quietly dropping out of them.
const ATTACKS: { id: AttackId; label: string }[] = [
  { id: "pristine", label: "pristine clone" },
  { id: "rewrite", label: "hand-edit the fix" },
  { id: "reencode", label: "re-encode the fix" },
  { id: "swapkey", label: "swap the signing key" },
  { id: "rewitness", label: "regenerate everything" },
  { id: "dropgate", label: "drop a gate declaration" },
];

describe("receipt verify demo", () => {
  it("opens on the passing clone, with 0.6.0's header and verdict", () => {
    render(<VerifyDemo />);

    expect(
      screen.getByText("ESTABLISHED OFFLINE, FROM THIS CLONE ALONE"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("VERDICT: PASS — custody and corpus binding"),
    ).toBeInTheDocument();
    // 0.6.0's header names the subject of the verdict, not just the root.
    expect(screen.getByText(/^commit [0-9a-f]{40} \(tree [0-9a-f]{40}\)$/))
      .toBeInTheDocument();
    expect(screen.getByText("names portable")).toBeInTheDocument();
    expect(screen.getByText("objects not requested")).toBeInTheDocument();
    expect(screen.getByText(/^sha256 [0-9a-f]{64}$/)).toBeInTheDocument();
    expect(
      screen.getByText(`receipt ${RECEIPT_VERSION} — receipt test corpus`),
    ).toBeInTheDocument();
  });

  it("names all four passes in the singular receipt 0.6.0 uses", () => {
    render(<VerifyDemo />);

    expect(screen.getByText(/\[ok +\] custody/)).toBeInTheDocument();
    expect(screen.getByText(/\[ok +\] binding/)).toBeInTheDocument();
    expect(screen.getByText(/\[ok +\] declaration$/)).toBeInTheDocument();
    expect(screen.queryByText(/declarations/)).not.toBeInTheDocument();

    pin("add --base-ref from the auditor's records");
    pin("pin --expect-commit as well");
    expect(screen.getByText(/\[ok +\] history/)).toBeInTheDocument();
  });

  it("stops at the first failing pass, marking the rest not reached", () => {
    render(<VerifyDemo />);
    attack("swap the signing key");

    expect(screen.getByText(/\[FAIL\] custody/)).toBeInTheDocument();
    // Once beside the failing pass, once again under FAILED: — receipt
    // repeats the refusal rather than making the reader scroll back for it.
    expect(
      screen.getAllByText(
        /producer public-key SPKI is not code-pinned: [0-9a-f]{64}/,
      ),
    ).toHaveLength(2);
    // binding is reported unrun rather than passed, and declaration never
    // appears at all — the fail-closed order.
    expect(screen.getByText(/\[FAIL\] binding/)).toBeInTheDocument();
    expect(screen.getByText("not reached")).toBeInTheDocument();
    expect(
      screen.queryByText(/\[(ok +|FAIL)\] declaration/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("VERDICT: FAIL — custody")).toBeInTheDocument();
  });

  it("refuses the hand edit with both digests, tree against journal", () => {
    render(<VerifyDemo />);
    attack("hand-edit the fix");

    expect(
      screen.getAllByText(
        /content file 'rules\/tax\/rate.yaml' does not match its witnessed digest: tree has [0-9a-f]{64}, journal binds [0-9a-f]{64}/,
      ),
    ).toHaveLength(2);
    // The refusal is repeated under its own heading before the verdict line.
    expect(screen.getByText("FAILED: binding")).toBeInTheDocument();
    expect(screen.getByText("VERDICT: FAIL — binding")).toBeInTheDocument();
  });

  it("passes the same correction when it arrives by re-encoding", () => {
    render(<VerifyDemo />);
    attack("re-encode the fix");

    expect(
      screen.getByText("VERDICT: PASS — custody and corpus binding"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^3 release\(s\), HEAD 0002-/)).toBeInTheDocument();
  });

  it("admits that wholesale regeneration passes on first contact", () => {
    render(<VerifyDemo />);
    attack("regenerate everything");

    expect(
      screen.getByText("VERDICT: PASS — custody and corpus binding"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It does NOT prove the history was never rewritten/),
    ).toBeInTheDocument();
  });

  it("refuses --base-ref until the revision under test is pinned too", () => {
    render(<VerifyDemo />);
    attack("regenerate everything");
    pin("add --base-ref from the auditor's records");

    expect(
      screen.getByText("receipt verify: --base-ref requires --expect-commit"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^exit 2/)).toBeInTheDocument();
    expect(screen.queryByText(/VERDICT/)).not.toBeInTheDocument();
  });

  it("catches regeneration once the auditor pins both", () => {
    render(<VerifyDemo />);
    attack("regenerate everything");
    pin("add --base-ref from the auditor's records");
    pin("pin --expect-commit as well");

    expect(screen.getByText(/\[FAIL\] history/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/release history is not immutable/),
    ).toHaveLength(2);
    expect(screen.getByText("VERDICT: FAIL — history")).toBeInTheDocument();
    // history runs before custody, so custody is the pass left unrun.
    expect(screen.getByText(/\[FAIL\] custody/)).toBeInTheDocument();
    expect(screen.getByText("not reached")).toBeInTheDocument();
  });

  it("refuses an undeclared gate by naming the gate the spec requires", () => {
    render(<VerifyDemo />);
    attack("drop a gate declaration");

    expect(screen.getByText(/\[ok +\] custody/)).toBeInTheDocument();
    expect(screen.getByText(/\[ok +\] binding/)).toBeInTheDocument();
    expect(screen.getByText(/\[FAIL\] declaration/)).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /the witnessed journal does not declare a gate the pinned spec requires: 'rulespec\/compile'/,
      ),
    ).toHaveLength(2);
    expect(screen.getByText("VERDICT: FAIL — declaration")).toBeInTheDocument();
  });

  it("resets the auditor's pins when another attack is chosen", () => {
    render(<VerifyDemo />);
    pin("add --base-ref from the auditor's records");
    expect(screen.getByText(/^exit 2/)).toBeInTheDocument();

    attack("hand-edit the fix");
    expect(screen.getByText(/^exit 1/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "add --base-ref from the auditor's records",
      }),
    ).toBeInTheDocument();
  });

  it("shows the exact command each transcript was captured from", () => {
    render(<VerifyDemo />);
    const { command } = TRANSCRIPTS.pristine.none;

    expect(command.startsWith("receipt verify ")).toBe(true);
    expect(screen.getByText(`$ ${command}`)).toBeInTheDocument();
  });
});

// Every state the demo can reach, so a regenerated transcript is held to the
// same rules the shipped one is.
const RUNS = Object.entries(TRANSCRIPTS).flatMap(([attackId, pins]) =>
  Object.entries(pins).map(([pinId, run]) => ({
    where: `${attackId}.${pinId}`,
    run,
  })),
);

describe("the transcript colouring", () => {
  // tones() is the only thing on this page that decides what a reader sees
  // as a refusal, and it decides it from receipt's own line shapes. This
  // classifies every line of every captured run rather than a sample: a
  // release that reshapes a marker, a detail line or the verdict block fails
  // here instead of quietly recolouring the page.
  it("tones every line of every captured transcript by its shape", () => {
    expect(RUNS).toHaveLength(18);

    const seen = {
      header: 0,
      headerBody: 0,
      refusal: 0,
      okMarker: 0,
      failMarker: 0,
      okDetail: 0,
      failDetail: 0,
      failedHeading: 0,
      failedBody: 0,
      verdictPass: 0,
      verdictFail: 0,
      provesTail: 0,
      heading: 0,
    };

    for (const { where, run } of RUNS) {
      const lines = run.text.split("\n");
      const toned = tones(lines);
      expect(toned, where).toHaveLength(lines.length);

      let marker: "ok" | "fail" | null = null;
      let block: "failed" | "proves" | null = null;

      lines.forEach((line, i) => {
        const at = `${where} line ${i + 1}: ${JSON.stringify(line)}`;
        const tone = toned[i];

        // `receipt 0.6.0 — receipt test corpus`, and the run's own header body.
        if (/^receipt \d/.test(line)) {
          expect(tone, at).toBe("plain");
          seen.header += 1;
          return;
        }
        // Both lines of an argument refusal, before any pass runs.
        if (/^receipt verify: /.test(line)) {
          expect(tone, at).toBe("fail");
          seen.refusal += 1;
          return;
        }
        if (/^ {2}\[ok {2}\] /.test(line)) {
          expect(tone, at).toBe("ok");
          marker = "ok";
          seen.okMarker += 1;
          return;
        }
        if (/^ {2}\[FAIL\] /.test(line)) {
          expect(tone, at).toBe("fail");
          marker = "fail";
          seen.failMarker += 1;
          return;
        }
        // A pass's detail line takes the colour of the marker above it, so
        // `not reached` reads as part of the refusal it follows.
        if (/^ {9}/.test(line)) {
          expect(marker, at).not.toBeNull();
          expect(tone, at).toBe(marker === "fail" ? "fail" : "dim");
          if (marker === "fail") seen.failDetail += 1;
          else seen.okDetail += 1;
          return;
        }
        if (/^FAILED: /.test(line)) {
          expect(tone, at).toBe("fail");
          block = "failed";
          seen.failedHeading += 1;
          return;
        }
        if (/^VERDICT: FAIL/.test(line)) {
          expect(tone, at).toBe("fail");
          seen.verdictFail += 1;
          return;
        }
        if (/^VERDICT: PASS/.test(line)) {
          expect(tone, at).toBe("plain");
          block = "proves";
          seen.verdictPass += 1;
          return;
        }
        // Indented prose: the repeated refusal under FAILED: is amber, the
        // "what this proves" tail after a passing verdict is not.
        if (/^ {2}/.test(line)) {
          expect(tone, at).toBe(block === "failed" ? "fail" : "dim");
          if (block === "failed") seen.failedBody += 1;
          else if (block === "proves") seen.provesTail += 1;
          else seen.headerBody += 1;
          return;
        }
        // ESTABLISHED OFFLINE…, PASSES, DECLARED IN THE WITNESSED JOURNAL…
        expect(tone, at).toBe("plain");
        seen.heading += 1;
      });
    }

    // A rule no captured line reached is a rule this test did not check.
    for (const [shape, count] of Object.entries(seen)) {
      expect(count, `no captured line had the shape "${shape}"`).toBeGreaterThan(
        0,
      );
    }
  });

  // ConsoleLine feeds a tone into nothing but a className, so the loop above
  // only matters if the class it produces is the one the reader sees. The
  // panes render over the site's dark code block, where the page's ink scale
  // is invisible, so the tones have to come from the code palette.
  it("renders each transcript line in the class its tone names", () => {
    const PALETTE: Record<string, string> = {
      plain: "var(--color-code-text)",
      ok: "var(--color-code-text)",
      dim: "var(--color-code-comment)",
      fail: "var(--color-code-keyword)",
    };

    const { container } = render(<VerifyDemo />);

    const paneMatches = (run: { text: string }, where: string) => {
      const lines = run.text.split("\n");
      const toned = tones(lines);
      // The verdict pane, after the invocation and the blank line above it.
      const rendered = Array.from(container.querySelectorAll("pre")[1].children);
      expect(rendered, where).toHaveLength(lines.length + 2);
      lines.forEach((line, i) => {
        expect(
          rendered[i + 2].className,
          `${where} line ${i + 1}: ${JSON.stringify(line)}`,
        ).toContain(PALETTE[toned[i]]);
      });
    };

    // A passing run carries every tone but `fail`; the refusal carries it.
    paneMatches(TRANSCRIPTS.pristine.none, "pristine.none");
    attack("swap the signing key");
    paneMatches(TRANSCRIPTS.swapkey.none, "swapkey.none");
  });
});

// The clone pane is the one pane the demo writes rather than replays, so it is
// the one place the page could drift from the corpus the transcripts are of.
// These hold it to CLONES and CORPUS, and cross-check it against the run
// printed beside it.
describe("the clone pane", () => {
  it("lists each clone's real releases, ending at the head its run names", () => {
    render(<VerifyDemo />);

    for (const { id, label } of ATTACKS) {
      attack(label);

      const { manifests } = CLONES[id];
      expect(manifests.length, id).toBeGreaterThan(0);
      manifests.forEach((name, i) => {
        const stem = name.replace(/\.json$/, "");
        // A regenerated chain is marked whole; a re-encode marks only the
        // release that carries the correction.
        const note =
          id === "rewitness" ? " re-witnessed" : i >= 2 ? " the correction" : "";
        expect(
          screen.getByText(`${stem}${note}`),
          `${id} release ${i}`,
        ).toBeInTheDocument();
      });

      const head = TRANSCRIPTS[id].none.text.match(
        /HEAD (\d{4}-[0-9a-f]+\.json)/,
      );
      if (head) {
        expect(head[1], `${id} head`).toBe(manifests[manifests.length - 1]);
      } else {
        // swapkey is the one clone whose custody pass refuses before it can
        // report a head, so its run names none to cross-check against.
        expect(id).toBe("swapkey");
        expect(TRANSCRIPTS[id].none.text).toMatch(/\[FAIL\] custody/);
      }
    }
  });

  it("marks exactly what each clone differs in", () => {
    render(<VerifyDemo />);

    for (const { id, label } of ATTACKS) {
      attack(label);

      // The correction is the same two bytes either way; only how it arrived
      // differs, which is the whole point of the pair.
      const corrected = id === "rewrite" || id === "reencode";
      expect(
        screen.getByText(`tax/rate.yaml value: ${corrected ? "0.17" : "0.15"}`),
        id,
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          `tax/rate.yaml value: ${corrected ? "0.15" : "0.17"}`,
        ),
        id,
      ).not.toBeInTheDocument();

      expect(
        screen.getByText(
          id === "swapkey"
            ? "producer-ed25519.pub substituted key"
            : "producer-ed25519.pub",
        ),
        id,
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          id === "dropgate"
            ? "rulespec/compile never declared"
            : "rulespec/compile outcome: pass",
        ),
        id,
      ).toBeInTheDocument();
    }
  });

  it("prints the auditor's pins out of the corpus the runs are of", () => {
    render(<VerifyDemo />);

    expect(
      screen.getByText("the auditor's own repo — out of the producer's reach"),
    ).toBeInTheDocument();
    // Abbreviated, but abbreviated from the real anchors: a key or a spec the
    // page invented would not match the corpus the transcripts were run over.
    expect(
      screen.getByText(`producer SPKI ${CORPUS.producerSpki.slice(0, 16)}…`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`sha256 ${CORPUS.specSha256.slice(0, 16)}…`),
    ).toBeInTheDocument();
  });
});

// Six attacks by three levels of pinning is eighteen reachable states, and the
// PR's own argument — that history refuses before custody can — lives in the
// states an attack reaches only after the auditor pins. This walks all of them.
describe("the auditor's pins", () => {
  const STEPS: { id: Pin; action: string }[] = [
    { id: "none", action: "add --base-ref from the auditor's records" },
    { id: "baseRef", action: "pin --expect-commit as well" },
    { id: "pinned", action: "clear the auditor's pins" },
  ];

  it("runs every attack at every level of pinning, to its own exit and stream", () => {
    render(<VerifyDemo />);
    let walked = 0;

    for (const { id, label } of ATTACKS) {
      attack(label);

      for (const step of STEPS) {
        const where = `${id}.${step.id}`;
        const run = TRANSCRIPTS[id][step.id];

        expect(screen.getByText(`$ ${run.command}`), where).toBeInTheDocument();
        expect(
          screen.getByText(run.text.split("\n")[0]),
          where,
        ).toBeInTheDocument();
        // receipt writes a passing verdict to stdout and a refusal to stderr;
        // the caption says which happened, so it has to say the captured one.
        expect(
          screen.getByText(
            new RegExp(
              `^exit ${run.exitCode} .*this one went to ${run.stream}$`,
            ),
          ),
          where,
        ).toBeInTheDocument();

        if (step.id === "pinned") {
          expect(run.command, where).toContain("--expect-commit");
          expect(run.command, where).toContain("--base-ref");
        }

        walked += 1;
        fireEvent.click(screen.getByRole("button", { name: step.action }));
      }

      // Clearing is the only way out of the fully pinned state, and it lands
      // back on first contact rather than on some fourth state.
      expect(
        screen.getByText(TRANSCRIPTS[id].none.text.split("\n")[0]),
        `${id} cleared`,
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: STEPS[0].action }),
      ).toBeInTheDocument();
    }

    // A state the loop skipped is a state nothing above checked.
    expect(walked).toBe(ATTACKS.length * STEPS.length);
    expect(walked).toBe(18);
  });
});
