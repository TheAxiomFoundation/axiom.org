/* The resting cascade of a few stylesheets for one element at one
   viewport — the slice of a browser's style engine that jsdom leaves
   out. jsdom parses CSS into a CSSOM (rules, media blocks,
   declarations) and matches selectors, but its getComputedStyle
   ignores @media blocks and the cascade across sheets. This module
   fills in media evaluation, specificity, and source order so a test
   can ask "which declaration wins for `height` on .irg-wrap at
   900px?" and get the same answer Chrome gives. Pure logic, no
   layout: it resolves declared values, never used pixels. */

export type Viewport = { width: number; height: number };

/* (ids, classes+attributes+pseudo-classes, types+pseudo-elements) */
export type Specificity = readonly [number, number, number];

export type Declaration = {
  prop: string;
  value: string;
  important: boolean;
};

export type StyleRule = {
  sheet: string;
  selectors: string[];
  declarations: Declaration[];
  /* Enclosing @media conditions, outermost first. */
  media: string[];
  /* Position in the concatenated cascade (sheets in load order). */
  order: number;
};

export type Winner = Declaration & {
  sheet: string;
  selector: string;
  media: string[];
  specificity: Specificity;
  order: number;
};

export type Sheet = { name: string; css: string };

const STYLE_RULE = 1;
const MEDIA_RULE = 4;

/* Parse sheets in load order into plain rules. A <style> element is
   the parser jsdom exposes; it is removed again once read so the
   document under test keeps no live stylesheet. */
export function loadSheets(sheets: Sheet[], doc: Document = document): StyleRule[] {
  const rules: StyleRule[] = [];
  let order = 0;
  for (const sheet of sheets) {
    const el = doc.createElement("style");
    el.textContent = sheet.css;
    doc.head.appendChild(el);
    const parsed = el.sheet;
    if (!parsed) throw new Error(`stylesheet did not parse: ${sheet.name}`);
    const walk = (list: CSSRuleList, media: string[]) => {
      for (const rule of Array.from(list)) {
        if (rule.type === MEDIA_RULE) {
          const mediaRule = rule as CSSMediaRule;
          walk(mediaRule.cssRules, [...media, mediaRule.media.mediaText]);
        } else if (rule.type === STYLE_RULE) {
          const styleRule = rule as CSSStyleRule;
          rules.push({
            sheet: sheet.name,
            selectors: splitSelectorList(styleRule.selectorText),
            declarations: readDeclarations(styleRule.style),
            media,
            order: order++,
          });
        }
        /* @keyframes, @font-face, @supports: no resting declarations
           for an element, or (supports) none of them in these sheets. */
      }
    };
    walk(parsed.cssRules, []);
    el.remove();
  }
  return rules;
}

function readDeclarations(style: CSSStyleDeclaration): Declaration[] {
  const out: Declaration[] = [];
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i);
    out.push({
      prop,
      value: style.getPropertyValue(prop).trim(),
      important: style.getPropertyPriority(prop) === "important",
    });
  }
  return out;
}

/* Split a selector list on top-level commas — commas inside :not(),
   :is(), attribute values, or strings stay put. */
export function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of selectorText) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/* Selector specificity per the Selectors Level 4 rules that matter
   here: :not()/:is()/:has() take their most specific argument,
   :where() adds nothing, `*` adds nothing. */
export function specificity(selector: string): Specificity {
  let ids = 0;
  let classes = 0;
  let types = 0;
  let rest = selector;
  rest = rest.replace(/:(not|is|has|where)\(([^()]*)\)/g, (_match, fn: string, arg: string) => {
    if (fn !== "where") {
      const best = splitSelectorList(arg)
        .map(specificity)
        .sort(compareSpecificity)
        .pop();
      if (best) {
        ids += best[0];
        classes += best[1];
        types += best[2];
      }
    }
    return "";
  });
  rest = rest.replace(/\[[^\]]*\]/g, () => {
    classes++;
    return "";
  });
  rest = rest.replace(/#[\w-]+/g, () => {
    ids++;
    return "";
  });
  rest = rest.replace(/\.[\w-]+/g, () => {
    classes++;
    return "";
  });
  rest = rest.replace(/::[\w-]+(\([^)]*\))?/g, () => {
    types++;
    return "";
  });
  rest = rest.replace(/:[\w-]+(\([^)]*\))?/g, () => {
    classes++;
    return "";
  });
  for (const token of rest.replace(/[>+~]/g, " ").split(/\s+/)) {
    if (token && token !== "*") types++;
  }
  return [ids, classes, types];
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/* Evaluate a media query list against a viewport. Only the features
   these sheets use are modelled; anything else throws so a new
   feature is handled on purpose rather than silently ignored. */
export function mediaMatches(mediaText: string, viewport: Viewport): boolean {
  return splitSelectorList(mediaText).some((query) => queryMatches(query, viewport));
}

function queryMatches(query: string, viewport: Viewport): boolean {
  let q = query.trim().replace(/^only\s+/, "");
  let negate = false;
  if (/^not\s/.test(q)) {
    negate = true;
    q = q.replace(/^not\s+/, "");
  }
  const matched = q
    .split(/\s+and\s+/)
    .every((part) => featureMatches(part.trim(), viewport));
  return negate ? !matched : matched;
}

function featureMatches(part: string, viewport: Viewport): boolean {
  if (part === "all" || part === "screen") return true;
  if (part === "print") return false;
  const match = /^\(\s*([a-z-]+)\s*(?::\s*(.+?))?\s*\)$/.exec(part);
  if (!match) throw new Error(`unsupported media query: ${part}`);
  const [, feature, raw] = match;
  switch (feature) {
    case "max-width":
      return viewport.width <= px(raw);
    case "min-width":
      return viewport.width >= px(raw);
    case "max-height":
      return viewport.height <= px(raw);
    case "min-height":
      return viewport.height >= px(raw);
    /* Resting defaults: motion allowed, light scheme, a mouse. */
    case "prefers-reduced-motion":
      return raw === "no-preference";
    case "prefers-color-scheme":
      return raw === "light";
    case "hover":
      return raw === "hover";
    case "pointer":
      return raw === "fine";
    default:
      throw new Error(`unsupported media feature: ${feature}`);
  }
}

function px(raw: string | undefined): number {
  const match = /^(-?\d*\.?\d+)px$/.exec(raw ?? "");
  if (!match) throw new Error(`expected a px length, got: ${raw}`);
  return Number(match[1]);
}

/* The winning declaration per property for `element` at `viewport`:
   !important first, then specificity, then source order (later
   wins). Selector matching is jsdom's own `Element.matches`; state
   pseudo-classes (:hover, :focus) do not match a resting element,
   and a selector jsdom cannot parse simply does not match. */
export function resolveStyle(
  rules: StyleRule[],
  element: Element,
  viewport: Viewport,
): Map<string, Winner> {
  const winners = new Map<string, Winner>();
  for (const rule of rules) {
    if (!rule.media.every((media) => mediaMatches(media, viewport))) continue;
    let best: { selector: string; specificity: Specificity } | null = null;
    for (const selector of rule.selectors) {
      let matched = false;
      try {
        matched = element.matches(selector);
      } catch {
        matched = false;
      }
      if (!matched) continue;
      const spec = specificity(selector);
      if (!best || compareSpecificity(spec, best.specificity) > 0) {
        best = { selector, specificity: spec };
      }
    }
    if (!best) continue;
    for (const declaration of rule.declarations) {
      const candidate: Winner = {
        ...declaration,
        sheet: rule.sheet,
        selector: best.selector,
        media: rule.media,
        specificity: best.specificity,
        order: rule.order,
      };
      const current = winners.get(declaration.prop);
      if (!current || beats(candidate, current)) {
        winners.set(declaration.prop, candidate);
      }
    }
  }
  return winners;
}

function beats(candidate: Winner, current: Winner): boolean {
  if (candidate.important !== current.important) return candidate.important;
  const bySpecificity = compareSpecificity(candidate.specificity, current.specificity);
  if (bySpecificity !== 0) return bySpecificity > 0;
  return candidate.order >= current.order;
}

export function resolvedValue(
  rules: StyleRule[],
  element: Element,
  viewport: Viewport,
  prop: string,
): string | undefined {
  return resolveStyle(rules, element, viewport).get(prop)?.value;
}
