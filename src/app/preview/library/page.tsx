// Mocks of the walkthrough's first beat (the law library), to pick a
// direction: old books, drawn in the story's modern hand. Static; not
// linked; the preview layout keeps it out of search.

import { AisleMock } from "./aisle-mock";

const rng = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const TAN = "#cdb88f";
const GREEN = "#2f4a3c";
const OX = "#6b2a2a";
const NAVY = "#27364f";
const BLACK = "#2e2925";
const SETS = [TAN, TAN, GREEN, TAN, OX, NAVY, TAN, BLACK];

type Vol = { w: number; h: number; set: string; hero: boolean };
function shelf(seed: number, n: number, hero = -1, max = 100): Vol[] {
  const r = rng(seed);
  const out: Vol[] = [];
  let k = seed;
  while (out.length < n) {
    const len = 3 + Math.floor(r() * 6);
    const set = SETS[k++ % SETS.length];
    const w = 0.85 + r() * 0.35;
    const h = max - 24 + Math.round(r() * 18);
    for (let i = 0; i < len && out.length < n; i++) out.push({ w, h, set, hero: false });
  }
  if (hero >= 0) out[hero] = { w: 1.7, h: max, set: "hero", hero: true };
  return out;
}

function Row({ vols, mode = "bound" }: { vols: Vol[]; mode?: "bound" | "wire" }) {
  return (
    <div className="lm-row">
      {vols.map((v, i) => (
        <span
          key={i}
          className={`lm-vol lm-vol--${mode}${v.hero ? " lm-vol--hero" : ""}${v.set === TAN ? " lm-vol--tan" : ""}`}
          style={{ height: v.h, flexGrow: v.w, ["--cloth" as string]: v.hero ? "var(--color-accent-hover)" : v.set }}
        />
      ))}
    </div>
  );
}

// 1 ── half bound, half captured: the capture line crosses the shelves
function Sweep() {
  const rows = [shelf(3, 46, 6), shelf(8, 44), shelf(13, 46)];
  const names = ["United States Code", "Code of Federal Regulations", "State codes and regulations"];
  return (
    <div className="lm-case lm-sweep">
      {rows.map((vols, r) => (
        <div key={r} className="lm-bay">
          <div className="lm-sweep__layer lm-sweep__old">
            <Row vols={vols} />
          </div>
          <div className="lm-sweep__layer lm-sweep__new">
            <Row vols={vols} mode="wire" />
          </div>
          <span className="lm-board">{names[r]}</span>
        </div>
      ))}
      <span className="lm-sweep__line" />
      <span className="lm-sweep__tag">captured, word for word</span>
    </div>
  );
}

// 2 ── an engraving: the library as a line drawing, one volume in colour
function Engraving() {
  const r = rng(21);
  const rows = [0, 1, 2].map((row) => {
    const xs: Array<{ x: number; w: number; h: number; hatch: number; hero: boolean }> = [];
    let x = 26;
    let i = 0;
    while (x < 940) {
      const hero = row === 0 && i === 6;
      const w = hero ? 34 : 15 + Math.round(r() * 12);
      xs.push({ x, w, h: hero ? 104 : 74 + Math.round(r() * 26), hatch: Math.floor(r() * 4), hero });
      x += w + 2;
      i++;
    }
    return xs;
  });
  return (
    <svg className="lm-engr" viewBox="0 0 1000 420" role="img" aria-label="A bookcase as a line engraving, with Title 7 in colour">
      <defs>
        <pattern id="h1" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" />
        </pattern>
        <pattern id="h2" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="3" />
        </pattern>
        <pattern id="h3" width="5" height="5" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="5" y2="0" />
        </pattern>
      </defs>
      <rect x="8" y="8" width="984" height="404" rx="3" className="lm-engr__frame" />
      <rect x="16" y="16" width="968" height="388" rx="2" className="lm-engr__frame" />
      {rows.map((xs, row) => {
        const base = 132 + row * 130;
        return (
          <g key={row}>
            <line x1="16" x2="984" y1={base} y2={base} />
            <line x1="16" x2="984" y1={base + 7} y2={base + 7} />
            <rect x="16" y={base} width="968" height="7" fill="url(#h3)" stroke="none" />
            {xs.map((s, i) => (
              <g key={i}>
                <rect x={s.x} y={base - s.h} width={s.w} height={s.h} className={s.hero ? "lm-engr__hero" : undefined} fill={s.hero || s.hatch === 0 ? undefined : `url(#h${s.hatch})`} />
                <line x1={s.x} x2={s.x + s.w} y1={base - s.h + 12} y2={base - s.h + 12} className={s.hero ? "lm-engr__gilt" : undefined} />
                <line x1={s.x} x2={s.x + s.w} y1={base - s.h + 15} y2={base - s.h + 15} className={s.hero ? "lm-engr__gilt" : undefined} />
                <line x1={s.x} x2={s.x + s.w} y1={base - 12} y2={base - 12} className={s.hero ? "lm-engr__gilt" : undefined} />
              </g>
            ))}
          </g>
        );
      })}
      <text x="500" y="398" textAnchor="middle" className="lm-engr__cap">
        THE LAW, AS WRITTEN
      </text>
    </svg>
  );
}

// 3 ── the card catalogue: drawers of titles, one pulled open
const DRAWERS = ["1–4", "5–6", "7", "8–11", "12–15", "16–19", "20–25", "26", "27–31", "32–37", "38–41", "42", "43–47", "48–54", "CFR 1–7", "CFR 8–26", "CFR 27–50", "States A–M", "States N–W", "Session laws"];
const INDEX = ["§ 2011", "§ 2012", "§ 2013", "§ 2014", "§ 2015", "§ 2016", "§ 2017"];
function Catalogue() {
  return (
    <div className="lm-cat">
      <div className="lm-cat__cabinet">
        {DRAWERS.map((d) => (
          <span key={d} className={d === "7" ? "lm-cat__drawer lm-cat__drawer--hero" : "lm-cat__drawer"}>
            <b>{d === "7" ? "Title 7" : d}</b>
            <i />
          </span>
        ))}
      </div>
      <div className="lm-cat__tray">
        {INDEX.map((s, i) => (
          <span key={s} className={i === INDEX.length - 1 ? "lm-cat__card lm-cat__card--hero" : "lm-cat__card"} style={{ top: i * 26, left: i * 9 }}>
            <b>{s}</b>
            {i === INDEX.length - 1 && (
              <>
                <em>Value of allotment</em>
                <u />
                <u />
                <u style={{ width: "62%" }} />
              </>
            )}
          </span>
        ))}
        <span className="lm-cat__front">
          <b>Title 7 · Agriculture</b>
          <i />
        </span>
      </div>
    </div>
  );
}

// 4 ── close on the spines: a few volumes, large, with their lettering
const CLOSE = [
  { n: "5", name: "Government Organization", set: TAN },
  { n: "6", name: "Domestic Security", set: TAN },
  { n: "7", name: "Agriculture", set: "hero" },
  { n: "8", name: "Aliens and Nationality", set: TAN },
  { n: "9", name: "Arbitration", set: TAN },
  { n: "10", name: "Armed Forces", set: TAN },
  { n: "11", name: "Bankruptcy", set: TAN },
];
function CloseUp() {
  return (
    <div className="lm-close">
      <div className="lm-close__row">
        {CLOSE.map((v) => (
          <span key={v.n} className={v.set === "hero" ? "lm-close__vol lm-close__vol--hero" : "lm-close__vol"}>
            <span className="lm-close__l1">
              United States
              <br />
              Code
            </span>
            <span className="lm-close__l2">
              Title {v.n}
              <small>{v.name}</small>
            </span>
          </span>
        ))}
      </div>
      <span className="lm-close__board" />
    </div>
  );
}

// 5 ── the stack on the desk: volumes lying flat, titles readable
const STACK = [
  { t: "Title 7 · Agriculture", w: 400, h: 54, c: "hero", dx: 26, rot: -2.5 },
  { t: "Title 26 · Internal Revenue Code", w: 470, h: 60, c: OX, dx: -18, rot: 0 },
  { t: "Title 42 · The Public Health and Welfare", w: 520, h: 66, c: NAVY, dx: 10, rot: 0 },
  { t: "7 CFR · Agriculture", w: 440, h: 50, c: TAN, dx: -30, rot: 0 },
  { t: "Colorado Revised Statutes", w: 500, h: 58, c: GREEN, dx: 16, rot: 0 },
  { t: "Title 20 · Education", w: 540, h: 62, c: BLACK, dx: -6, rot: 0 },
];
function Stack() {
  return (
    <div className="lm-stack">
      {STACK.map((b) => (
        <span
          key={b.t}
          className={`lm-stack__book${b.c === "hero" ? " lm-stack__book--hero" : ""}${b.c === TAN ? " lm-stack__book--tan" : ""}`}
          style={{ width: b.w, height: b.h, background: b.c === "hero" ? "var(--color-accent-hover)" : b.c, transform: `translateX(${b.dx}px) rotate(${b.rot}deg)` }}
        >
          <b>{b.t}</b>
        </span>
      ))}
      <span className="lm-stack__desk" />
    </div>
  );
}

// 6 ── the aisle: two walls of shelves, running to one lit volume
function Aisle() {
  const wall = (seed: number) => [0, 1, 2, 3].map((r) => shelf(seed + r * 5, 34, -1, 74));
  return (
    <div className="lm-aisle">
      <div className="lm-aisle__wall lm-aisle__wall--l">
        {wall(4).map((vols, r) => (
          <div key={r} className="lm-bay lm-bay--tight">
            <Row vols={vols} />
            <span className="lm-board lm-board--thin" />
          </div>
        ))}
      </div>
      <div className="lm-aisle__end">
        <span>
          Title 7<small>Agriculture</small>
        </span>
      </div>
      <div className="lm-aisle__wall lm-aisle__wall--r">
        {wall(9).map((vols, r) => (
          <div key={r} className="lm-bay lm-bay--tight">
            <Row vols={vols} />
            <span className="lm-board lm-board--thin" />
          </div>
        ))}
      </div>
      <span className="lm-aisle__floor" />
    </div>
  );
}

const CSS = `
.lm { --walnut: #6b4a32; --gilt: #d6b26a; --cream: #f0dcae; max-width: 1180px; margin: 0 auto; padding: 56px 32px 96px; display: grid; gap: 64px; }
.lm h1 { font: 400 34px/1.1 var(--font-serif); letter-spacing: -0.01em; margin: 0; }
.lm section { display: grid; gap: 14px; }
.lm h2 { margin: 0; font: 400 24px/1.2 var(--font-serif); }
.lm h2 small { margin-left: 10px; font: 500 11px/1 var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-accent); }
.lm p { margin: 0; max-width: 78ch; font: 400 15px/1.5 var(--font-geist-sans, system-ui), sans-serif; color: var(--color-ink-secondary); }
.lm p b { font-weight: 500; color: var(--color-ink); }
.lm-frame { padding: 44px 48px; border-radius: 16px; background: var(--color-paper, #faf9f6); border: 1px solid color-mix(in srgb, var(--color-ink) 8%, transparent); overflow: hidden; }

.lm-frame--bare { padding: 0; background: #faf9f6; }
.lm-3d { position: relative; }
.lm-3d__host { aspect-ratio: 16 / 9; width: 100%; }
.lm-3d__host canvas { display: block; width: 100%; height: 100%; }
.lm-3d__scrub { position: absolute; left: 24px; bottom: 18px; display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 999px; background: rgba(255,255,255,0.86); border: 1px solid color-mix(in srgb, var(--color-ink) 10%, transparent); font: 500 10.5px/1 var(--font-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-ink-muted); }
.lm-3d__looks { position: absolute; left: 24px; top: 18px; display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.9); border: 1px solid color-mix(in srgb, var(--color-ink) 10%, transparent); }
.lm-3d__looks button { padding: 7px 13px; border: 0; border-radius: 999px; background: transparent; font: 500 11px/1 var(--font-mono); letter-spacing: 0.06em; color: var(--color-ink-secondary); cursor: pointer; }
.lm-3d__looks button[aria-pressed="true"] { background: var(--color-accent-hover); color: #fff; }
.lm-3d__scrub input { width: 260px; accent-color: var(--color-accent); }

/* shared: a card bookcase, walnut boards, bound volumes */
.lm-case { position: relative; padding: 14px 18px 0; border-radius: 14px; background: color-mix(in srgb, var(--walnut) 13%, #fff); border: 1px solid color-mix(in srgb, var(--walnut) 30%, transparent); box-shadow: inset 0 22px 30px -22px rgba(74,51,36,0.35), 0 12px 24px -6px rgba(28,25,23,0.07), 0 40px 80px -20px rgba(28,25,23,0.16); }
.lm-bay { position: relative; height: 134px; display: flex; flex-direction: column; justify-content: flex-end; }
.lm-bay--tight { height: 88px; }
.lm-row { display: flex; align-items: flex-end; gap: 2px; }
.lm-board { display: flex; align-items: center; height: 18px; margin: 0 -18px; padding-left: 20px; background: var(--walnut); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 10px 14px -8px rgba(74,51,36,0.45); font: 500 8.5px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: #ead9b8; }
.lm-board--thin { height: 8px; margin: 0; }
.lm-vol { flex: 1 1 0; min-width: 0; border-radius: 2px 2px 0 0; }
.lm-vol--bound { --l1: rgba(0,0,0,0.3); --l2: transparent; --g: rgba(214,178,106,0.7); background-color: var(--cloth); background-image: linear-gradient(90deg, rgba(0,0,0,0.2), rgba(255,255,255,0.12) 32%, rgba(0,0,0,0) 64%, rgba(0,0,0,0.18)), linear-gradient(180deg, transparent 9%, var(--g) 9%, var(--g) 10%, transparent 10%, transparent 14%, var(--l1) 14%, var(--l1) 30%, transparent 30%, transparent 37%, var(--l2) 37%, var(--l2) 47%, transparent 47%, transparent 88%, var(--g) 88%, var(--g) 89%, transparent 89%); }
.lm-vol--bound.lm-vol--tan { --l1: #8a2a1c; --l2: #2a2420; --g: rgba(120,88,40,0.55); }
.lm-vol--hero.lm-vol--bound { transform: translateY(-10px); box-shadow: 0 14px 24px -8px rgba(146,64,14,0.6); }
.lm-vol--wire { background: var(--color-paper-elevated, #fff); border: 1px solid color-mix(in srgb, var(--color-ink) 22%, transparent); border-bottom: 0; background-image: linear-gradient(180deg, transparent 14%, color-mix(in srgb, var(--color-ink) 12%, transparent) 14%, color-mix(in srgb, var(--color-ink) 12%, transparent) 30%, transparent 30%); }
.lm-vol--wire.lm-vol--hero { border-color: var(--color-accent); background-color: color-mix(in srgb, var(--color-accent) 14%, #fff); }

/* 1 sweep */
.lm-sweep { --at: 58%; }
.lm-sweep__layer { position: absolute; left: 0; right: 0; bottom: 18px; }
.lm-sweep__old { clip-path: inset(-30px 0 0 var(--at)); }
.lm-sweep__new { clip-path: inset(-30px calc(100% - var(--at)) 0 0); }
.lm-sweep .lm-bay { margin: 0; }
.lm-sweep__line { position: absolute; top: -10px; bottom: -10px; left: calc(18px + (100% - 36px) * 0.58); width: 2px; background: var(--color-accent); box-shadow: 0 0 16px 3px color-mix(in srgb, var(--color-accent) 50%, transparent); }
.lm-sweep__tag { position: absolute; top: -34px; left: calc(18px + (100% - 36px) * 0.58); transform: translateX(-100%); padding: 6px 11px; border-radius: 999px 999px 0 999px; background: var(--color-paper-elevated, #fff); border: 1px solid color-mix(in srgb, var(--color-accent) 38%, transparent); font: 400 11px/1 var(--font-mono); color: var(--color-accent-hover); white-space: nowrap; }

/* 2 engraving */
.lm-frame--sepia { background: #f4ecdc; }
.lm-engr { display: block; width: 100%; height: auto; fill: none; stroke: #3b2f25; stroke-width: 0.9; }
.lm-engr pattern line { stroke: #3b2f25; stroke-width: 0.6; }
.lm-engr__frame { stroke-width: 1.2; }
.lm-engr__hero { fill: var(--color-accent-hover); stroke: var(--color-accent-hover); filter: drop-shadow(0 6px 8px rgba(146,64,14,0.45)); transform: translateY(-8px); }
.lm-engr__gilt { stroke: var(--gilt); transform: translateY(-8px); }
.lm-engr__cap { fill: #3b2f25; stroke: none; font: 500 9px var(--font-mono); letter-spacing: 0.32em; }

/* 3 catalogue */
.lm-cat { display: grid; grid-template-columns: 1.35fr 1fr; gap: 56px; align-items: center; }
.lm-cat__cabinet { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; padding: 14px; border-radius: 14px; background: var(--walnut); box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 12px 24px -6px rgba(28,25,23,0.1), 0 40px 80px -20px rgba(28,25,23,0.22); }
.lm-cat__drawer { height: 76px; border-radius: 6px; background: #7d5a3f; box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -10px 14px -10px rgba(0,0,0,0.35); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; }
.lm-cat__drawer b { padding: 5px 8px; min-width: 62%; text-align: center; border-radius: 2px; background: #f3e9d2; box-shadow: 0 0 0 2px var(--gilt); font: 500 9.5px/1 var(--font-mono); letter-spacing: 0.04em; color: #3b2f25; white-space: nowrap; }
.lm-cat__drawer i, .lm-cat__front i { width: 34px; height: 8px; border-radius: 0 0 8px 8px; background: var(--gilt); box-shadow: 0 2px 3px rgba(0,0,0,0.3); }
.lm-cat__drawer--hero { background: var(--color-accent-hover); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 22%, transparent), 0 16px 26px -8px rgba(146,64,14,0.6); transform: translateY(3px) scale(1.04); }
.lm-cat__tray { position: relative; height: 330px; }
.lm-cat__card { position: absolute; width: 250px; height: 150px; padding: 10px 14px; border-radius: 6px 6px 0 0; background: var(--color-paper-elevated, #fff); border: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent); box-shadow: 0 -2px 6px -2px rgba(28,25,23,0.08); display: flex; flex-direction: column; gap: 9px; }
.lm-cat__card b { font: 400 10.5px/1 var(--font-mono); letter-spacing: 0.08em; color: var(--color-ink-muted); }
.lm-cat__card em { font: 500 18px/1.2 var(--font-serif); font-style: normal; }
.lm-cat__card u { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--color-ink) 10%, transparent); }
.lm-cat__card--hero { border-color: color-mix(in srgb, var(--color-accent) 55%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 10%, transparent), 0 -8px 20px -8px rgba(146,64,14,0.3); }
.lm-cat__card--hero b { color: var(--color-accent-hover); }
.lm-cat__front { position: absolute; left: 30px; right: 0; bottom: 0; height: 92px; border-radius: 8px; background: var(--color-accent-hover); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 24px 40px -14px rgba(146,64,14,0.55); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
.lm-cat__front b { padding: 6px 12px; border-radius: 2px; background: #f3e9d2; box-shadow: 0 0 0 2px var(--gilt); font: 500 10.5px/1 var(--font-mono); letter-spacing: 0.06em; color: #3b2f25; }

/* 4 close on the spines */
.lm-close { margin: -44px -8px 0; }
.lm-close__row { display: flex; align-items: flex-end; gap: 5px; }
.lm-close__vol { flex: 1 1 0; height: 380px; padding-top: 70px; border-radius: 0 0 0 0; background-color: #cdb88f; background-image: linear-gradient(90deg, rgba(0,0,0,0.2), rgba(255,255,255,0.14) 32%, rgba(0,0,0,0) 64%, rgba(0,0,0,0.18)), linear-gradient(180deg, transparent 44px, rgba(120,88,40,0.55) 44px, rgba(120,88,40,0.55) 46px, transparent 46px); display: flex; flex-direction: column; gap: 22px; color: var(--cream); text-align: center; }
.lm-close__l1, .lm-close__l2 { display: flex; flex-direction: column; justify-content: center; margin: 0 9px; padding: 14px 4px; border-top: 1px solid var(--gilt); border-bottom: 1px solid var(--gilt); box-shadow: 0 -3px 0 #8a2a1c, 0 3px 0 #8a2a1c; }
.lm-close__l1 { background: #8a2a1c; font: 500 11px/1.5 var(--font-serif); letter-spacing: 0.14em; text-transform: uppercase; }
.lm-close__l2 { background: #2a2420; box-shadow: 0 -3px 0 #2a2420, 0 3px 0 #2a2420; font: 400 21px/1.1 var(--font-serif); gap: 7px; }
.lm-close__l2 small { font: italic 400 12px/1.25 var(--font-serif); opacity: 0.85; }
.lm-close__vol--hero { background-color: var(--color-accent-hover); background-image: linear-gradient(90deg, rgba(0,0,0,0.2), rgba(255,255,255,0.12) 32%, rgba(0,0,0,0) 64%, rgba(0,0,0,0.18)), linear-gradient(180deg, transparent 44px, var(--gilt) 44px, var(--gilt) 46px, transparent 46px); transform: translateY(-26px); box-shadow: 0 26px 40px -14px rgba(146,64,14,0.6); }
.lm-close__vol--hero .lm-close__l1, .lm-close__vol--hero .lm-close__l2 { background: rgba(0,0,0,0.28); box-shadow: 0 -3px 0 rgba(0,0,0,0.28), 0 3px 0 rgba(0,0,0,0.28); }
.lm-close__board { display: block; height: 16px; margin: 0 -40px; background: var(--walnut); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 14px 18px -10px rgba(74,51,36,0.5); }

/* 5 the stack */
.lm-stack { display: flex; flex-direction: column; align-items: center; padding-top: 18px; }
.lm-stack__book { position: relative; display: flex; align-items: center; justify-content: center; border-radius: 5px 3px 3px 5px; color: var(--cream); background-image: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(0,0,0,0) 40%, rgba(0,0,0,0.22)), linear-gradient(90deg, transparent 22px, var(--gilt) 22px, var(--gilt) 23px, transparent 23px, transparent 30px, var(--gilt) 30px, var(--gilt) 31px, transparent 31px, transparent calc(100% - 31px), var(--gilt) calc(100% - 31px), var(--gilt) calc(100% - 30px), transparent calc(100% - 30px)) !important; background-blend-mode: normal; box-shadow: 0 8px 12px -8px rgba(28,25,23,0.45); }
.lm-stack__book b { font: 400 19px/1 var(--font-serif); letter-spacing: 0.02em; }
.lm-stack__book--tan { color: #3b2f25; }
.lm-stack__book--hero { z-index: 2; box-shadow: 0 18px 30px -10px rgba(146,64,14,0.6); margin-bottom: 4px; }
.lm-stack__desk { display: block; width: 78%; height: 1px; margin-top: 0; background: color-mix(in srgb, var(--color-ink) 26%, transparent); }

/* 6 the aisle */
.lm-aisle { position: relative; height: 380px; perspective: 1100px; display: flex; justify-content: center; align-items: center; }
.lm-aisle__wall { position: absolute; top: 14px; width: 54%; padding: 6px 10px 0; background: color-mix(in srgb, var(--walnut) 16%, #fff); border: 1px solid color-mix(in srgb, var(--walnut) 30%, transparent); }
.lm-aisle__wall--l { left: 0; transform-origin: 0 50%; transform: rotateY(58deg); }
.lm-aisle__wall--r { right: 0; transform-origin: 100% 50%; transform: rotateY(-58deg); }
.lm-aisle__end { position: relative; z-index: 2; width: 92px; height: 132px; margin-top: -10px; border-radius: 3px; background: var(--color-accent-hover); box-shadow: inset 0 0 0 6px var(--color-accent-hover), inset 0 0 0 7px rgba(236,204,140,0.7), 0 0 60px 14px color-mix(in srgb, var(--color-accent) 30%, transparent); display: flex; align-items: center; justify-content: center; text-align: center; color: var(--cream); font: 400 17px/1.1 var(--font-serif); }
.lm-aisle__end small { display: block; margin-top: 5px; font: italic 400 10px/1 var(--font-serif); }
.lm-aisle__floor { position: absolute; left: 12%; right: 12%; bottom: 0; height: 70px; background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 70%); }
`;

const MOCKS = [
  {
    id: "6b",
    name: "The aisle, modelled",
    about: "The aisle as a real 3D scene, in three modern looks. Use the buttons to change the look, and the slider to go down the aisle. 1 Gallery: pale oak, daylight, volumes in bone, tan and ink only. 2 Paper model: the full room in matte paper, with relief and shadow but no colour. 3 Old to new: the period room near you, which becomes paper at the far end. In each look, Title 7 is the only volume in the accent colour.",
    next: "The camera stops at Title 7 as it comes off the shelf. The cover then fills the stage and opens.",
    el: <AisleMock />,
    bare: true,
  },
  {
    id: "1",
    name: "The capture line",
    about: "The old bookcase, half bound and half captured. The same capture line that reads the page in beat 2 crosses the shelves: leather and buckram on one side, clean outlined volumes on the other.",
    next: "The line sweeps left as you scroll. Title 7 lifts off and opens.",
    el: <Sweep />,
  },
  {
    id: "2",
    name: "The engraving",
    about: "The library as a fine line engraving, like a plate in an old book: all ink line and hatching on aged paper. One volume, Title 7, is in full colour.",
    next: "Title 7 leaves the drawing and becomes the solid cover. The engraving fades behind it.",
    el: <Engraving />,
    sepia: true,
  },
  {
    id: "3",
    name: "The card catalogue",
    about: "A walnut card catalogue with brass label frames. The Title 7 drawer is open, and its index cards run to § 2017. An index is the old form of what the corpus does in beat 3.",
    next: "The § 2017 card lifts out of the drawer and grows into the page. No book cover is necessary.",
    el: <Catalogue />,
  },
  {
    id: "4",
    name: "Close on the spines",
    about: "Seven volumes, very large, cropped by the frame. You can read the red and black labels and the gilt lettering. It is bold and simple, and the serif type links it to the titles of the page.",
    next: "Title 7 comes forward, turns to its cover and opens.",
    el: <CloseUp />,
  },
  {
    id: "5",
    name: "The stack on the desk",
    about: "Old volumes that lie flat in a stack, with titles you can read: statutes, regulations and state law. Title 7 is on top, slightly turned.",
    next: "The top volume lifts off the stack, turns to its cover and opens.",
    el: <Stack />,
  },
  {
    id: "6",
    name: "The aisle",
    about: "Two walls of shelves in perspective, which run to one lit volume. The corpus in beat 3 is also drawn in perspective, so the two views echo each other.",
    next: "The camera moves down the aisle to Title 7, and the cover fills the stage and opens.",
    el: <Aisle />,
  },
];

export default function LibraryMocksPage() {
  return (
    <main className="lm">
      <style>{CSS}</style>
      <h1>The library: directions</h1>
      {MOCKS.map((m) => (
        <section key={m.id}>
          <h2>
            {m.id} <small>{m.name}</small>
          </h2>
          <p>{m.about}</p>
          <p>
            <b>Into beat 2:</b> {m.next}
          </p>
          <div className={"bare" in m && m.bare ? "lm-frame lm-frame--bare" : "sepia" in m && m.sepia ? "lm-frame lm-frame--sepia" : "lm-frame"}>{m.el}</div>
        </section>
      ))}
    </main>
  );
}
