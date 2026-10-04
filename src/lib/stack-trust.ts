/**
 * Trust overlay for /stack.
 *
 * The stack page answers "how does a provision become an executable rule?".
 * This adds the second question an auditor actually asks: "at this layer, what
 * can I check, and what am I taking on faith?"
 *
 * Rules for editing:
 *  - `checkable` may only list things a non-employee can confirm from public
 *    bytes. If confirming it needs our credentials, it is not checkable.
 *  - `open` is not a disclaimer section. It names the specific thing that is
 *    not yet independently confirmable, so the gap is legible rather than
 *    implied by silence.
 *  - When a gap closes, the line moves up. It does not just disappear.
 *
 * DRAFT — the `checkable` lines for layers 01–03 describe artifacts that the
 * pipeline produces; confirm each is reachable from a public URL before this
 * ships. Layers 04–07 were verified against published releases on 2026-07-25.
 */

export interface LayerTrust {
  /** What a third party can confirm about this layer's output. */
  checkable: string[];
  /** What is not yet independently confirmable here. */
  open: string[];
}

export const layerTrust: Record<string, LayerTrust> = {
  scrape: {
    checkable: [
      "Each captured document keeps its origin URL and capture date.",
      "The archived copy is retained, so a later edit upstream does not silently rewrite history.",
    ],
    open: [
      "Continuous re-checking against the publisher's live copy is not published as a check.",
    ],
  },

  "source-structure": {
    checkable: [
      "Normalization is deterministic: the same input document produces the same structured output.",
    ],
    open: [
      "The normalized tree is not separately hash-published today — it is checkable only by re-running the parser.",
    ],
  },

  "source-graph": {
    checkable: [
      "Every encoded value carries the durable legal id of the slice it came from, so a claim can be traced back to statutory text.",
    ],
    open: [
      "That the slice faithfully represents the provision is a human judgment, checked by review rather than by a machine.",
    ],
  },

  rulespec: {
    checkable: [
      "Corpus releases are pinned and publicly mirrored; the canonical sha256 recomputes from the downloaded bytes.",
      "Each program in the manifest declares its spec path and spec sha256.",
    ],
    open: [
      "Coverage is per-program. There is no blanket coverage claim, and there should not be one.",
      "CI skips validation, companion tests, and proof checks for modules on a public waiver list: 1,940 rulespec-us modules carried an active validation waiver on October 2, 2026, and they hold 23,735 of our 34,810 US rules. Each waiver names an owner, an issue, and an expiry date.",
    ],
  },

  encoder: {
    checkable: [
      "Generation runs on operator-controlled compute and is recorded as an event; the record of what was generated is separate from the decision to accept it.",
    ],
    open: [
      "Acceptance is decided downstream by checks that do not involve a model. Modules on the public waiver list skip the validation, companion-test, and proof steps.",
      "Not every rule went through the encoder. In September 2026, about 16,300 of our 34,810 US rules matched a signed manifest that names the encoder's apply step, and about 15,300 more (mostly the generated US tariff schedule) were signed in by manual attestation.",
    ],
  },

  engine: {
    checkable: [
      "Engine releases publish a sha256 per platform target and a build attestation resolving to the release workflow and commit.",
      "Program artifacts are content-addressed; the manifest declares each artifact's sha256 before you download it.",
      "Encodings are compared with other calculators, and every disagreement on a covered policy is classified with evidence that CI recomputes.",
      "The released golden household is stranger-path reproducible on engine v0.1.1 x program-artifacts-59a10dab866e: snap_eligible = holds, snap_allotment = 478, and snap_net_income = 226.",
    ],
    open: [
      "The hosted API still returns snap_net_income = 226.5 for the golden household while the released engine returns 226; axiom-api#115 tracks the divergence.",
      "Coverage is evidence-set specific; the verify page carries the current US comparison and administrative evidence.",
      "Agreement shows two implementations agree; where both misread a provision the same way, it shows nothing.",
    ],
  },

  axiom: {
    checkable: [
      "Every displayed value links to the provision it came from and the release it was computed in.",
    ],
    open: [
      "The hosted surfaces are a developer preview: live and usable, with no service commitment yet.",
    ],
  },
};
