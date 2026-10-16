// Direction A — LAMPLIGHT, beats 2, 3, 4, 6 and 7. Same world as beats
// 1 and 5: night, one warm light, real depth of field; text and wires
// are made of light, and "30 per centum" stays the brightest thing in
// every frame.
//
// Copy rules (journey-film.tsx): the gates in beat 3 are the three the
// encoder holds every draft to — it compiles, its sources ground, its
// companion tests pass — and the failed draft is an illustration. The
// registry numbers in beat 6 carry their snapshot month. Nothing says
// certified, signed or sealed.

import * as THREE from "three";
import { CODE, STATUTE, type MarkId } from "../journey-digital/data";
import { CLUSTERS } from "../registry-snapshot";
import {
  canvasTexture,
  fbm,
  fontVar,
  glyphAtlas,
  noise2,
  particleGeometry,
  particleMaterial,
  rng,
  W,
  H,
  drawShare,
  ease,
  hitArea,
  lerp,
  seg,
  sortedRandoms,
  type BeatCtx,
  type BeatSpec,
  type Look,
  THEME,
  themed,
  themedLook,
} from "./kit";
import { STATUTE_TEXT } from "./pages";

const AMBER = new THREE.Color("#ffab4a");
const CREAM = new THREE.Color("#fff0d4");
// the stream of letters keeps one warm yellow from the page to its cell
const STREAM = new THREE.Color("#ffc870");
const BG = "#070504";
// the paper palette: ink and amber on white (multiplied onto the page)
const AMBER_INK = "#b45309";


// ── shared pieces ────────────────────────────────────────────────────

// a dark glass card with a warm edge; `draw` paints its content
function glass(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, edge = "rgba(255, 190, 120, 0.5)") {
  // text cards: drawn at twice their size so they stay sharp up close
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 26);
    g.fillStyle = "rgba(24, 18, 13, 0.94)";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = edge;
    g.stroke();
    draw(g);
  }, 2, true);
}

function cardMesh(tex: THREE.Texture, w: number, h: number, bright = 1) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    // (on paper there is no glow to push: the card is printed as is)
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, color: new THREE.Color(1, 1, 1).multiplyScalar(THEME.paper ? 1 : bright), toneMapped: THEME.paper || bright <= 1 }),
  );
}

function fade(m: THREE.Mesh, v: number) {
  (m.material as THREE.MeshBasicMaterial).opacity = v;
  m.visible = v > 0.002;
}

// text made of light: additive, over-bright so the bloom catches it
function lightMesh(tex: THREE.Texture, w: number, h: number, color: THREE.ColorRepresentation, intensity: number) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      // on paper: the texture is already ink (a graphic), laid on as is
      blending: THEME.paper ? THREE.NormalBlending : THREE.AdditiveBlending,
      color: THEME.paper ? new THREE.Color(1, 1, 1) : new THREE.Color(color).multiplyScalar(intensity),
      toneMapped: false,
    }),
  );
}

function wire(curve: THREE.Curve<THREE.Vector3>, radius: number, color: THREE.ColorRepresentation, intensity: number) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 120, radius, 8, false),
    new THREE.MeshBasicMaterial({ color: themed(new THREE.Color(color).multiplyScalar(intensity)), toneMapped: false }),
  );
}

function dot(p: THREE.Vector3, r: number, intensity: number, color: THREE.ColorRepresentation = "#ffd29a") {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 16),
    new THREE.MeshBasicMaterial({ color: themed(new THREE.Color(color).multiplyScalar(intensity)), toneMapped: false }),
  );
  m.position.copy(p);
  return m;
}

// a world point on a plane mesh, from texture pixel coordinates
function onCard(m: THREE.Mesh, w: number, h: number, px: number, py: number, tw: number, th: number, lift = 0.012) {
  m.updateMatrixWorld();
  return m.localToWorld(new THREE.Vector3((px / tw - 0.5) * w, (0.5 - py / th) * h, lift));
}

function far(fx: THREE.Scene, focus: number, seed: number, n = 9000) {
  if (THEME.paper) return; // haze is light in the dark only
  const r = rng(seed);
  const g = particleGeometry(n, (i, o) => {
    o.p.set(-25 + r() * 50, -8 + r() * 16, -8 - r() * 40);
    o.c.copy(AMBER).multiplyScalar(0.35 + r() * 0.5);
    o.size = 0.04 + r() * 0.06;
    o.alpha = 0.2 + r() * 0.3;
  });
  fx.add(new THREE.Points(g, particleMaterial({ focus, aperture: 3 })));
}

// ── beat 2: the corpus, a plain of lit pages ─────────────────────────

export function lamplightBeat2(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 200);
  camera.position.set(-1.0, 1.25, 4.6);
  camera.lookAt(1.0, 0.0, -3.2);
  const hero = new THREE.Vector3(0.95, 0, -1.35);
  const focus = camera.position.distanceTo(hero);
  const look: Look = themedLook({
    background: "#050302",
    exposure: 1.0,
    // shallow: the plain stays sharp near and far, only the horizon softens
    dof: { focus, aperture: 0.0004, maxblur: 0.003 },
    bloom: { strength: 0.75, radius: 0.6, threshold: 0.8 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  // the distance fades into the night, or on paper into the page
  scene.fog = new THREE.FogExp2(THEME.paper ? "#ffffff" : "#050302", 0.04);
  const r = rng(12);
  const n = noise2(14);

  // each cell is a tiny lit page: a warm sheet with darker text lines
  const page = canvasTexture(64, 80, (g) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 64, 80);
    g.fillStyle = "rgba(0, 0, 0, 0.42)";
    for (let i = 0; i < 7; i++) g.fillRect(9, 12 + i * 9, i === 0 ? 26 : i === 6 ? 30 : 46, 3);
  }, 4); // supersampled: the cells nearest the camera fill many pixels
  const PX = 0.2;
  const PZ = 0.25;
  const cells: Array<{ x: number; z: number; b: number; hero?: boolean }> = [];
  for (let ci = -70; ci < 80; ci++) {
    if (((ci % 23) + 23) % 23 === 22) continue; // gutters between titles
    for (let ri = -220; ri < 14; ri++) {
      if (((ri % 17) + 17) % 17 === 16) continue;
      const x = ci * PX;
      const z = ri * PZ;
      if (r() < 0.05) continue;
      // brighter districts, like a city's lit blocks
      const district = fbm(n, ci / 14, ri / 14, 3);
      const b = 0.02 + 0.3 * Math.pow(r(), 3.2) + 0.22 * Math.max(0, district - 0.52);
      cells.push({ x, z, b });
    }
  }
  // the hero and its sibling subsections in the same row
  const hc = Math.round(hero.x / PX);
  const hr = Math.round(hero.z / PZ);
  cells.forEach((c) => {
    const ci = Math.round(c.x / PX);
    const ri = Math.round(c.z / PZ);
    if (ri === hr && ci >= hc && ci < hc + 9) c.b = 0.42;
    if (ri === hr && ci === hc) c.hero = true;
  });
  const geo = new THREE.PlaneGeometry(PX * 0.74, PZ * 0.74);
  geo.rotateX(-Math.PI / 2);
  // (on paper the plain fades by opacity: darkening it would not hide it)
  const plainMat = new THREE.MeshBasicMaterial({ map: page, toneMapped: false, transparent: THEME.paper });
  const mesh = new THREE.InstancedMesh(geo, plainMat, cells.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  cells.forEach((c, i) => {
    m4.makeTranslation(c.x, 0, c.z);
    mesh.setMatrixAt(i, m4);
    if (c.hero) col.copy(AMBER).multiplyScalar(2.6);
    else col.setRGB(1.0, 0.64, 0.34).multiplyScalar(c.b);
    mesh.setColorAt(i, themed(col));
  });
  scene.add(mesh);
  hero.set(hc * PX, 0, hr * PZ);

  // the letters of beat 1 still arriving, falling into the one cell
  const atlas = glyphAtlas(STATUTE_TEXT.replace(/\s+/g, ""), fontVar("--font-serif"));
  const from = new THREE.Vector3(-2.4, 2.6, 0.6);
  const curve = new THREE.CatmullRomCurve3([
    from,
    new THREE.Vector3(-1.2, 1.9, 0.0),
    new THREE.Vector3(0.2, 0.9, -0.9),
    hero.clone().add(new THREE.Vector3(0, 0.25, 0)),
    hero.clone().add(new THREE.Vector3(0, 0.02, 0)),
  ]);
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  const fallT = sortedRandoms(7000, r, 0.8);
  const letters = particleGeometry(7000, (i, o) => {
    const t = fallT[i];
    const p = curve.getPoint(t);
    // a dense line, as the book scene's stream was when it left
    const rad = 0.03 + 0.26 * (1 - t) * (1 - t);
    o.p.set(p.x + gauss() * rad, p.y + gauss() * rad, p.z + gauss() * rad);
    o.c.copy(STREAM).multiplyScalar(1.05 + 0.2 * t + r() * 0.15);
    // larger where it enters from the sky, as the book scene's stream was
    o.size = 0.03 + 0.04 * (1 - t) + r() * 0.02;
    o.glyph = Math.floor(r() * 256);
    o.alpha = 0.85;
  });
  const fallMat = particleMaterial({ atlas, focus, aperture: 2.2 });
  const fall = new THREE.Points(letters, fallMat);
  fx.add(fall);
  // a thin rule of light rising from the cell to its address
  const rule = wire(new THREE.LineCurve3(hero.clone().add(new THREE.Vector3(0, 0.02, 0)), hero.clone().add(new THREE.Vector3(0, 0.62, 0))), 0.003, "#ffcf94", 2);
  scene.add(rule);
  const addr = ctx.label(hero.clone().add(new THREE.Vector3(0, 0.7, 0)), "us / statute / 7 / 2017 / <b>a</b>", "sf-label--addr");
  const rest = ctx.label(hero.clone().add(new THREE.Vector3(1.05, 0.24, 0)), "(b) (c) (d) … the rest of § 2017", "sf-label--quiet");
  ctx.hotspot(hero.clone().add(new THREE.Vector3(0, 0.03, 0)), "/us/statute/7/2017/a", "Open us/statute/7/2017/a", { when: [0.86, 1.4] });

  // districts in the distance: other titles of the code
  ctx.label(new THREE.Vector3(-5.2, 0.05, -12), "26 U.S.C. · Internal Revenue Code", "sf-label--far");
  ctx.label(new THREE.Vector3(6.5, 0.05, -17), "42 U.S.C. · The Public Health and Welfare", "sf-label--far");
  ctx.label(new THREE.Vector3(0.6, 0.05, -26), "7 C.F.R. · Agriculture", "sf-label--far");
  ctx.hotspot(new THREE.Vector3(-5.2, 0.35, -12), "/us/statute/26", "Browse 26 U.S.C.", { when: [0.75, 1.4] });
  ctx.hotspot(new THREE.Vector3(6.5, 0.35, -17), "/us/statute/42", "Browse 42 U.S.C.", { when: [0.75, 1.4] });
  ctx.hotspot(new THREE.Vector3(0.6, 0.35, -26), "/us/regulation/7", "Browse 7 C.F.R.", { when: [0.75, 1.4] });
  // the motion: from high over the plain, the camera comes down toward
  // the one cell as the letters land in it; the cell lights; its address
  const heroIdx = cells.findIndex((c) => c.hero);
  const camFrom = new THREE.Vector3(0.3, 7.4, 2.6);
  const aimFrom = new THREE.Vector3(0.95, 0, -2.2);
  const camTo = camera.position.clone();
  const aimTo = new THREE.Vector3(1.0, 0.0, -3.2);
  const warm = new THREE.Color(1.0, 0.64, 0.34).multiplyScalar(0.42);
  const lit = AMBER.clone().multiplyScalar(2.6);
  let lastLit = -1;
  const update = (t: number) => {
    const c = ease(seg(t, 0, 0.78));
    camera.position.lerpVectors(camFrom, camTo, c);
    camera.lookAt(new THREE.Vector3().lerpVectors(aimFrom, aimTo, c));
    // the stream is already in the sky as the cut arrives
    drawShare(fall, 0.5 + 0.5 * ease(seg(t, 0.05, 0.88)));
    // only the one cell changes: upload its colour alone, and only when
    // it changes (the whole plain's colours are 30,000 entries)
    const heroLit = seg(t, 0.72, 0.9);
    if (heroLit !== lastLit) {
      lastLit = heroLit;
      mesh.setColorAt(heroIdx, themed(col.copy(warm).lerp(lit, heroLit)));
      const ic = mesh.instanceColor!;
      ic.clearUpdateRanges();
      ic.addUpdateRange(heroIdx * 3, 3);
      ic.needsUpdate = true;
    }
    drawShare(rule, seg(t, 0.82, 0.92));
    addr.el.style.opacity = rest.el.style.opacity = String(seg(t, 0.88, 0.97));
    look.dof!.focus = camera.position.distanceTo(hero);
    // the plain lights up as the letters lead the eye down to it
    const up = lerp(0.12, 1, ease(seg(t, 0.05, 0.5)));
    if (THEME.paper) plainMat.opacity = up;
    else plainMat.color.setScalar(up);
  };
  return {
    camera,
    look,
    update,
    // for the opening shot, which flies into this plain along the stream
    parts: { plain: mesh, plainMat, fall, fallMat, rule, curve, hero, camTo, aimTo, focus },
  };

}

// ── beat 3: encode, through the gates ────────────────────────────────

// The rule as it is published in rulespec-us, us/statutes/7/2017/a.yaml
// (lines 13–27, the proof metadata left out), and its companion test,
// a.test.yaml case 1. Draft 1 is the illustration's mistake: it writes the
// rate as 30, not 0.30, so the test's contribution comes out a hundred times
// too large (386.50 × 30 = 11,595 against the expected 115.95).
const CARD_W = 1180;
const CARD_H = 600;
function draftFace(state: "pass" | "fail" | "drafting") {
  const mono = fontVar("--font-mono");
  const w = CARD_W;
  const h = CARD_H;
  const edge = state === "pass" ? "#ffb45c" : state === "fail" ? "rgba(255, 200, 170, 0.28)" : "rgba(255, 190, 120, 0.5)";
  return glass(w, h, (g) => {
    g.globalAlpha = state === "fail" ? 0.45 : 1;
    g.fillStyle = "rgba(255, 225, 190, 0.55)";
    g.font = `500 28px ${mono}`;
    // the one that passes is no longer a draft: it is the encoded rule
    g.fillText(state === "pass" ? "ENCODED RULE · US/STATUTES/7/2017/A.YAML" : state === "fail" ? "DRAFT 1" : "DRAFT", 50, 70);
    const key = "rgba(246, 234, 216, 0.62)";
    const val = "#f6ead8";
    const rows: Array<[string, string, string?]> = [
      ["- name: ", "snap_household_food_contribution_rate"],
      ["  kind: ", "parameter"],
      ["  dtype: ", "Rate"],
      ["  source: ", '7 USC 2017(a), "30 per centum"', "#9fe0b4"],
      ["  versions:", ""],
      ["    - effective_from: ", "'2008-10-01'"],
      ["      formula: ", state === "fail" ? "30" : "0.30", "#ffb45c"],
    ];
    rows.forEach(([k, v, colour], i) => {
      const y = 132 + i * 50;
      g.font = `500 34px ${mono}`;
      g.fillStyle = key;
      g.fillText(k, 50, y);
      const x = 50 + g.measureText(k).width;
      g.fillStyle = colour ?? val;
      g.font = colour === "#ffb45c" ? `600 36px ${mono}` : `500 34px ${mono}`;
      g.fillText(v, x, y);
    });
    g.font = `500 26px ${mono}`;
    if (state === "fail") {
      g.fillStyle = "rgba(255, 210, 190, 0.9)";
      g.fillText("✕ a.test.yaml, case 1: snap_household_food_contribution", 50, 528);
      g.fillText("  expected 115.95, got 11,595", 50, 562);
    }
    if (state === "pass") {
      g.fillStyle = "#ffcf94";
      // the encoder's own checks (no count: CI waives the published module)
      g.fillText("✓ compiles   ✓ source grounded   ✓ companion tests pass", 50, 548);
    }
  }, edge);
}

// the encode view and its sentence: the opening shot ends on the same
// sentence at the same place on screen, so the change of scene is hidden
export const ENCODE_CAM = { pos: new THREE.Vector3(0.2, 1.7, 9.4), aim: new THREE.Vector3(0.6, 0.45, -0.6), fov: 30 };
export const SENT_AT = new THREE.Vector3(-1.35, 2.45, -0.3);
export function encodeSentence() {
  const serif = fontVar("--font-serif");
  const lines = ["…reduced by an amount equal to", "|30 per centum| of the household’s income…"];
  let phrasePx = { x: 0, y: 0, w: 0 };
  const sentence = canvasTexture(1600, 300, (g) => {
    g.clearRect(0, 0, 1600, 300);
    g.font = `400 76px ${serif}`;
    lines.forEach((ln, i) => {
      const y = 100 + i * 120;
      let x = 20;
      ln.split("|").forEach((part, k) => {
        g.fillStyle = k === 1 ? "#ffcf94" : "rgba(255, 240, 220, 0.5)";
        if (k === 1) phrasePx = { x, y, w: g.measureText(part).width };
        g.fillText(part, x, y);
        x += g.measureText(part).width;
      });
    });
  }, 1, true);
  const sw = 3.6;
  const sh = (300 / 1600) * sw;
  const mesh = lightMesh(sentence, sw, sh, "#ffffff", 1.25);
  const phraseLocal = new THREE.Vector3((phrasePx.x + phrasePx.w / 2) / 1600 - 0.5, 0.5 - (phrasePx.y + 16) / 300, 0).multiply(new THREE.Vector3(sw, sh, 1));
  return { mesh, phraseLocal };
}

export function lamplightBeat3(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(ENCODE_CAM.fov, W / H, 0.05, 200);
  camera.position.copy(ENCODE_CAM.pos);
  camera.lookAt(ENCODE_CAM.aim);
  const focus = camera.position.distanceTo(new THREE.Vector3(0.9, 0.4, -0.8));
  const paper = THEME.paper;
  const look: Look = themedLook({
    background: BG,
    exposure: 1.0,
    // text must read: almost no depth-of-field blur on the text scenes
    dof: { focus, aperture: 0.0002, maxblur: 0.002 },
    bloom: { strength: 0.65, radius: 0.55, threshold: 0.8 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  far(fx, focus, 31);

  // the phrase, in light, above the start of the path
  const serif = fontVar("--font-serif");
  const { mesh: sent, phraseLocal } = encodeSentence();
  sent.position.copy(SENT_AT);
  sent.lookAt(camera.position);
  fx.add(sent);
  sent.updateMatrixWorld();
  const phraseAt = sent.localToWorld(phraseLocal.clone());

  // four gates, left to right, receding a little. The text goes into the
  // encode gate and a draft comes out; only checks sends a draft back (it
  // blocks apply), so the loop closes around encode and checks. Compare
  // (where another calculator covers the program) and the AI review come
  // after it.
  const a = new THREE.Vector3(-3.4, 0.35, 0.4);
  const b = new THREE.Vector3(4.15, 0.35, -1.6);
  const dir = b.clone().sub(a).normalize();
  const GATES = ["encode", "checks", "compare", "AI review"];
  const gatePos = GATES.map((_, i) => a.clone().lerp(b, 0.24 + i * 0.165));
  const gateMats: THREE.MeshBasicMaterial[] = [];
  const gateLabels: ReturnType<typeof ctx.label>[] = [];
  const GW = 0.9;
  const GH = 1.2;
  gatePos.forEach((p, i) => {
    const frame = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(paper ? AMBER_INK : "#ffcf94").multiplyScalar(paper ? 1 : 1.8), toneMapped: false });
    gateMats.push(mat);
    const t = 0.016;
    [
      [0, GH / 2, GW, t],
      [0, -GH / 2, GW, t],
      [-GW / 2, 0, t, GH],
      [GW / 2, 0, t, GH],
    ].forEach(([x, y, w, h]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
      bar.position.set(x, y, 0);
      frame.add(bar);
    });
    frame.position.copy(p);
    // each gate stands across the path
    frame.lookAt(p.clone().add(dir));
    scene.add(frame);
    gateLabels.push(ctx.label(p.clone().add(new THREE.Vector3(0, 0.88, 0)), `<span class="sf-gate-n">${i + 1}</span> ${GATES[i]}`, "sf-label--gate"));
    const GATE_LINKS: Array<[string, string]> = [
      ["/encoder", "How the AI encoder drafts a rule"],
      ["/validation", "The checks: source grounding and companion tests"],
      ["/validation", "Compared with another calculator, where one covers the program"],
      ["/encoder", "An AI model reviews the draft"],
    ];
    ctx.link(frame, GATE_LINKS[i][0], GATE_LINKS[i][1], { when: [0.2 + i * 0.1, 1.4], hit: hitArea(GW, GH, 0.05) });
  });

  // the drafts. The text flows into encode; on the far side its letters
  // float out and gather into a draft card, which moves on along the
  // front of the gates. Draft 1 is caught at checks and drops away; the
  // failure runs back round the loop into encode, as dust. Draft 2 leaves
  // encode as loose dust that draws tighter at every gate, and after the
  // last it is one line, into the final version.
  const CW = 1.6;
  const CH = (CARD_H / CARD_W) * CW;
  const F = new THREE.Vector3(0.15, -0.62, 0.8); // in front of and a little below each gate
  const front = (p: THREE.Vector3) => p.clone().add(F);
  const formAt = front(gatePos[0].clone().lerp(gatePos[1], 0.5));
  const cardTrack = new THREE.CatmullRomCurve3([formAt, front(gatePos[1]), front(gatePos[2]), front(gatePos[3]), front(gatePos[3]).add(dir.clone().multiplyScalar(1.3))]);
  const gateOn = [0, 1, 2, 3].map((i) => {
    let best = 0;
    let bd = Infinity;
    for (let q = 0; q <= 200; q++) {
      const d = cardTrack.getPoint(q / 200).distanceTo(front(gatePos[i]));
      if (d < bd) [bd, best] = [d, q / 200];
    }
    return best;
  });
  const card = (state: "pass" | "fail" | "drafting", glow: number) => {
    const m = cardMesh(draftFace(state), CW, CH, glow);
    m.lookAt(camera.position);
    scene.add(m);
    return m;
  };
  const draft1 = card("drafting", 1.05);
  const failCard = card("fail", 0.85);
  // the encoded rule: larger than the drafts, set past the last gate
  const FW = CW * 1.55;
  const passCard = cardMesh(draftFace("pass"), FW, FW * (CARD_H / CARD_W), 1.12);
  passCard.position.copy(gatePos[3].clone().add(dir.clone().multiplyScalar(1.95)).add(new THREE.Vector3(0.1, -0.12, 0.35)));
  passCard.lookAt(camera.position);
  scene.add(passCard);
  const failTo = front(gatePos[1]).add(new THREE.Vector3(0.75, -0.5, 0.1));
  // the loop: from the failed draft, under the gates, back into encode
  const loopEnd = a.clone().lerp(b, 0.1).add(new THREE.Vector3(0, 0.05, 0));
  const back = new THREE.CubicBezierCurve3(
    failTo.clone().add(new THREE.Vector3(-CW / 2, 0, 0)),
    failTo.clone().add(new THREE.Vector3(-1.4, -0.1, -0.3)),
    loopEnd.clone().add(new THREE.Vector3(-0.7, -0.6, 0.2)),
    loopEnd,
  );
  // one pulse of light carries the failure back round the loop
  const pulse = dot(back.getPoint(0), 0.05, 4);
  scene.add(pulse);
  const redraft = ctx.label(back.getPoint(0.72).add(new THREE.Vector3(0.1, -0.15, 0)), "↺ redraft with the failure", "sf-label--quiet");

  // the letters
  const atlas = glyphAtlas("30percentum", serif);
  const r = rng(4);
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  const stream = (curve: THREE.Curve<THREE.Vector3>, n: number, spread = 0.08) => {
    const ts = sortedRandoms(n, r);
    return new THREE.Points(
      particleGeometry(n, (i, o) => {
        const t = ts[i];
        const p = curve.getPoint(t);
        const rad = 0.03 + spread * Math.sin(Math.PI * t);
        o.p.set(p.x + gauss() * rad, p.y + gauss() * rad, p.z + gauss() * rad);
        // bright enough to read as light against the dark, like the
        // book's stream
        o.c.copy(STREAM).multiplyScalar(1.7 + r() * 0.3);
        o.size = 0.04 + r() * 0.025;
        o.glyph = Math.floor(r() * 256);
        o.alpha = 0.95;
      }),
      // on paper the letters are amber ink, laid over the page, not added light
      particleMaterial({ atlas, focus, aperture: 1.6 }),
    );
  };
  const intoEncode = gatePos[0].clone().add(dir.clone().multiplyScalar(-0.05));
  const outOfEncode = gatePos[0].clone().add(dir.clone().multiplyScalar(0.08));
  const text1 = stream(new THREE.CatmullRomCurve3([phraseAt, loopEnd.clone().add(new THREE.Vector3(0, 0.25, 0)), intoEncode]), 1800);
  // the failure goes back into the encoder with the text
  const text2 = stream(new THREE.CatmullRomCurve3([loopEnd, loopEnd.clone().lerp(intoEncode, 0.5).add(new THREE.Vector3(0, 0.05, 0)), intoEncode]), 900);
  // out of encode, the letters float down into the card that forms there
  const gather = new THREE.CatmullRomCurve3([outOfEncode, outOfEncode.clone().lerp(formAt, 0.5).add(new THREE.Vector3(0.15, 0.1, 0.2)), formAt]);
  const out1 = stream(gather, 1200, 0.12);
  // the failure, back round the loop, as dust
  const loopDust = stream(back, 1500, 0.05);
  // draft 2: from encode through every gate into the final version; the
  // dust is loose out of encode and draws tighter at each gate
  const through = new THREE.CatmullRomCurve3([
    outOfEncode,
    gatePos[1],
    gatePos[2],
    gatePos[3],
    passCard.position.clone().add(new THREE.Vector3(-FW / 2, 0, 0)),
  ]);
  const gateT = [1, 2, 3].map((i) => {
    let best = 0;
    let bd = Infinity;
    for (let q = 0; q <= 400; q++) {
      const d = through.getPoint(q / 400).distanceTo(gatePos[i]);
      if (d < bd) [bd, best] = [d, q / 400];
    }
    return best;
  });
  // long, overlapping steps: it tightens on the way into each gate
  const tightAt = (u: number) => gateT.reduce((acc, g) => acc + ease(seg(u, g - 0.16, g + 0.02)), 0) / gateT.length;
  const NT = 7000;
  const throughT = sortedRandoms(NT, r);
  const draft2Dust = new THREE.Points(
    particleGeometry(NT, (i, o) => {
      const u = throughT[i];
      const p = through.getPoint(u);
      // it leaves encode as tight as the text that went in, opens out, then
      // draws in at every gate
      const open = ease(seg(u, 0, 0.12));
      const rad = lerp(0.03, 0.18, open) * Math.pow(1 - tightAt(u), 1.2) + 0.004;
      o.p.set(p.x + gauss() * rad, p.y + gauss() * rad, p.z + gauss() * rad);
      o.c.copy(STREAM).multiplyScalar(1.7 + r() * 0.3);
      o.size = 0.04 + r() * 0.025;
      o.glyph = Math.floor(r() * 256);
      // the tight run past the last gate is the line below, not dust
      o.alpha = u > gateT[2] + 0.02 ? 0 : 0.95;
    }),
    particleMaterial({ atlas, focus, aperture: 1.6 }),
  );
  // past the last gate: one line into the final version
  const lineCurve = new THREE.CatmullRomCurve3(
    Array.from({ length: 24 }, (_, q) => through.getPoint(gateT[2] + ((1 - gateT[2]) * q) / 23)),
  );
  const finalLine = wire(lineCurve, 0.007, "#ffb45c", 2.2);
  scene.add(finalLine);
  fx.add(text1, text2, out1, loopDust, draft2Dust);
  scene.add(dot(phraseAt, 0.03, 3));
  const matOf = (p: THREE.Points) => p.material as THREE.ShaderMaterial;

  // the motion, one draft at a time
  const gateBase = new THREE.Color("#ffcf94");
  const gateFail = new THREE.Color("#ff7a5c");
  // on paper: a gate is a pale tan line at rest and deep amber when lit;
  // it fades up from white
  const gateIdle = new THREE.Color("#ddc7a4");
  const gateLit = new THREE.Color(AMBER_INK);
  const gateRed = new THREE.Color("#c2410c");
  const white = new THREE.Color(1, 1, 1);
  const update = (t: number) => {
    // the gates come up out of the dark after the sentence has arrived
    const appear = ease(seg(t, 0.0, 0.14));
    // draft 1: the text into encode, out into the card, on to checks
    drawShare(text1, ease(seg(t, 0.04, 0.17)));
    matOf(text1).uniforms.uOpacity.value = 1 - 0.75 * seg(t, 0.36, 0.5);
    drawShare(out1, ease(seg(t, 0.16, 0.24)));
    matOf(out1).uniforms.uOpacity.value = 1 - seg(t, 0.25, 0.31);
    const k1 = seg(t, 0.27, 0.33);
    draft1.position.copy(cardTrack.getPoint(gateOn[1] * ease(k1)));
    fade(draft1, seg(t, 0.2, 0.27) * (1 - seg(t, 0.33, 0.36)));
    // caught at checks: it turns into the failed draft and drops away
    fade(failCard, seg(t, 0.33, 0.36) * (1 - 0.4 * seg(t, 0.58, 0.68)));
    failCard.position.lerpVectors(front(gatePos[1]), failTo, ease(seg(t, 0.36, 0.46)));
    drawShare(loopDust, ease(seg(t, 0.42, 0.52)));
    matOf(loopDust).uniforms.uOpacity.value = 1 - 0.6 * seg(t, 0.6, 0.7);
    const pk = seg(t, 0.44, 0.54);
    pulse.position.copy(back.getPoint(ease(pk)));
    pulse.visible = pk > 0 && pk < 1;
    redraft.el.style.opacity = String(seg(t, 0.46, 0.53));
    // draft 2: back into encode, then out through every gate, tightening,
    // and as one line into the final version
    drawShare(text2, ease(seg(t, 0.52, 0.59)));
    const k2 = ease(seg(t, 0.59, 0.86));
    drawShare(draft2Dust, k2);
    drawShare(finalLine, seg(k2, gateT[2], 1));
    fade(passCard, seg(t, 0.84, 0.9));
    // each gate lights as the text or a draft passes it; checks flashes
    // when draft 1 fails it, then passes draft 2
    const at2 = (g: number) => seg(k2, gateT[g - 1] - 0.03, gateT[g - 1] + 0.02);
    const pass1 = [seg(t, 0.15, 0.19), 0, 0, 0];
    const pass2 = [seg(t, 0.56, 0.6), at2(1), at2(2), at2(3)];
    const fail = seg(t, 0.32, 0.35) * (1 - seg(t, 0.46, 0.58));
    gateMats.forEach((m, i) => {
      const on = Math.max(pass1[i] * (1 - seg(t, 0.46, 0.58)), pass2[i]);
      if (paper) {
        m.color.copy(gateIdle).lerp(gateLit, on);
        if (i === 1) m.color.lerp(gateRed, fail * (1 - pass2[1]));
        m.color.lerp(white, 1 - appear);
      } else {
        m.color.copy(gateBase).multiplyScalar((0.3 + 1.0 * on) * appear);
        if (i === 1) m.color.lerp(gateFail.clone().multiplyScalar(1.8), fail * (1 - pass2[1]));
      }
      gateLabels[i].el.style.opacity = String((0.35 + 0.65 * Math.max(on, i === 1 ? fail : 0)) * appear);
    });
  };
  // no pan of its own into this scene: the opening shot ends on this
  // sentence, in this place, and the scene comes up around it
  return { camera, look, update, cutIn: () => {} };

}

// ── beat 4: cited code ───────────────────────────────────────────────

type MarkGeo = { id: MarkId; x: number; y: number; portY?: number };

// the phrase → line pairs, numbered in reading order like footnotes
const LINKS: Array<{ id: MarkId; line: number; n: number }> = [
  { id: "tfp", line: 11, n: 1 },
  { id: "rate30", line: 27, n: 2 },
  { id: "income", line: 10, n: 3 },
  { id: "floor", line: 128, n: 4 },
  { id: "size2", line: 59, n: 5 },
  { id: "rate8", line: 43, n: 6 },
];
const HERO_LINK: MarkId = "rate30";

function badge(g: CanvasRenderingContext2D, x: number, y: number, n: number, hot: boolean, mono: string) {
  g.beginPath();
  g.arc(x, y, 17, 0, Math.PI * 2);
  g.fillStyle = hot ? "#ffb45c" : "rgba(255, 190, 120, 0.22)";
  g.fill();
  g.fillStyle = hot ? "#1a120a" : "#ffcf94";
  g.font = `600 22px ${mono}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), x, y + 1);
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
}

function statuteFace(): { tex: THREE.Texture; marks: MarkGeo[]; w: number; h: number } {
  const serif = fontVar("--font-serif");
  const mono = fontVar("--font-mono");
  const w = 1200;
  const h = 1420;
  const marks: MarkGeo[] = [];
  const tex = glass(w, h, (g) => {
    g.fillStyle = "rgba(255, 225, 190, 0.5)";
    g.font = `500 26px ${mono}`;
    g.fillText("UNITED STATES CODE · TITLE 7 · CHAPTER 51", 70, 100);
    g.fillStyle = "#f6ead8";
    g.font = `400 60px ${serif}`;
    g.fillText("§ 2017. Value of allotment", 70, 190);
    g.fillStyle = "#ffb45c";
    g.font = `italic 400 40px ${serif}`;
    g.fillText("(a) Calculation", 70, 255);
    g.font = `400 37px ${serif}`;
    const maxW = w - 210;
    const lh = 60;
    let x = 70;
    let y = 340;
    const space = g.measureText(" ").width;
    STATUTE.forEach((seg) => {
      const text = typeof seg === "string" ? seg : "mark" in seg ? seg.text : seg.em;
      const mark = typeof seg === "object" && "mark" in seg ? seg.mark : null;
      const words = text.split(/\s+/).filter(Boolean);
      // punctuation that follows a word directly (": ", ".") glues on
      if (/^[:.,;]/.test(text) && x > 70) x -= space;
      words.forEach((wd, wi) => {
        const ww = g.measureText(wd).width;
        if (x + ww > 70 + maxW) {
          x = 70;
          y += lh;
        }
        if (mark) {
          g.fillStyle = "rgba(255, 171, 74, 0.16)";
          g.fillRect(x - 3, y - 36, ww + 6, 48);
          g.fillStyle = "#ffcf94";
          g.fillRect(x - 3, y + 10, ww + (wi < words.length - 1 ? space + 6 : 6), 2.5);
          g.fillStyle = "#fff1dc";
        } else {
          g.fillStyle = "rgba(246, 234, 216, 0.72)";
        }
        g.font = typeof seg === "object" && "em" in seg ? `italic 400 37px ${serif}` : `400 37px ${serif}`;
        g.fillText(wd, x, y);
        if (mark && wi === words.length - 1) marks.push({ id: mark, x: x + ww, y });
        x += ww + space;
      });
    });
    // each linked phrase: a footnote number after it, and the same number
    // in the right margin on its line, where its thread leaves the page
    // two phrases can share a line: their margin numbers sit side by
    // side (the later phrase nearer the edge) and their threads leave
    // the edge a little apart
    const linked = marks.filter((m) => LINKS.some((l) => l.id === m.id));
    linked.forEach((m) => {
      const link = LINKS.find((l) => l.id === m.id)!;
      const hot = m.id === HERO_LINK;
      const sameLine = linked.filter((o) => o.y === m.y).sort((p, q) => q.x - p.x);
      const k = sameLine.indexOf(m);
      const twin = sameLine.length > 1;
      m.portY = m.y - 12 + (twin ? (k === 0 ? -9 : 9) : 0);
      g.fillStyle = hot ? "#ffb45c" : "#ffcf94";
      g.font = `600 24px ${mono}`;
      g.fillText(String(link.n), m.x + 3, m.y - 20);
      badge(g, w - 46 - k * 40, m.y - 12, link.n, hot, mono);
    });
  });
  return { tex, marks, w, h };
}

function codeFace(): { tex: THREE.Texture; lines: Map<number, number>; w: number; h: number } {
  const mono = fontVar("--font-mono");
  const serif = fontVar("--font-serif");
  const w = 1500;
  const h = 1420;
  const lines = new Map<number, number>();
  const tex = glass(w, h, (g) => {
    g.fillStyle = "rgba(255, 225, 190, 0.5)";
    g.font = `500 26px ${mono}`;
    g.fillText("RULESPEC-US · US/STATUTES/7/2017/A.YAML", 70, 100);
    g.fillStyle = "rgba(255, 190, 120, 0.25)";
    g.fillRect(70, 130, w - 140, 2);
    const lh = 47;
    let y = 200;
    CODE.forEach((row) => {
      if ("gap" in row) {
        g.fillStyle = "rgba(255, 225, 190, 0.25)";
        g.font = `400 28px ${mono}`;
        g.fillText("⋮", 100, y);
        y += lh;
        return;
      }
      lines.set(row.n, y);
      const link = LINKS.find((l) => l.line === row.n);
      if (link) {
        const hot = link.id === HERO_LINK;
        g.strokeStyle = hot ? "rgba(255, 180, 92, 0.85)" : "rgba(255, 190, 120, 0.35)";
        g.lineWidth = hot ? 3 : 2;
        g.setLineDash([3, 7]);
        g.beginPath();
        g.moveTo(40, y - 10);
        g.lineTo(78, y - 10);
        g.stroke();
        g.setLineDash([]);
        badge(g, 100, y - 10, link.n, hot, mono);
        if (hot) {
          g.fillStyle = "rgba(255, 171, 74, 0.1)";
          g.fillRect(170, y - 36, w - 230, 44);
        }
      }
      g.fillStyle = "rgba(255, 225, 190, 0.32)";
      g.font = `400 27px ${mono}`;
      g.textAlign = "right";
      g.fillText(String(row.n), 160, y);
      g.textAlign = "left";
      const text = row.text;
      const q = text.indexOf('"');
      g.font = `400 29px ${mono}`;
      if (q > 0) {
        g.fillStyle = "rgba(246, 234, 216, 0.6)";
        g.fillText(text.slice(0, q), 190, y);
        const x = 190 + g.measureText(text.slice(0, q)).width;
        g.fillStyle = "#9fe0b4";
        g.font = `italic 400 34px ${serif}`;
        g.fillText(text.slice(q), x, y);
      } else {
        const isName = /- name:/.test(text);
        const isNum = /^\s+[\d.]+$/.test(text);
        g.fillStyle = isNum ? "#ffb45c" : isName ? "#f6ead8" : "rgba(246, 234, 216, 0.66)";
        g.font = `${isName || isNum ? 500 : 400} 29px ${mono}`;
        const max = w - 230;
        let t = text;
        while (g.measureText(t).width > max) t = t.slice(0, -1);
        g.fillText(t === text ? t : `${t.slice(0, -1)}…`, 190, y);
      }
      y += lh;
    });
  });
  return { tex, lines, w, h };
}

export function lamplightBeat4(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  // far enough back that the pages' tops stay in frame as the scene drifts in
  camera.position.set(0.3, 0.2, 11.8);
  camera.lookAt(0.2, -0.25, 0);
  const focus = camera.position.distanceTo(new THREE.Vector3(0, 0.2, 0));
  const look: Look = themedLook({
    background: BG,
    exposure: 1.0,
    dof: { focus, aperture: 0.0002, maxblur: 0.002 },
    bloom: { strength: 0.6, radius: 0.55, threshold: 0.82 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  far(fx, focus, 41);

  // two pages of light, angled like an open book
  const sf = statuteFace();
  const cf = codeFace();
  const PH = 3.7;
  const sW = (sf.w / sf.h) * PH;
  const cW = (cf.w / cf.h) * PH;
  const left = cardMesh(sf.tex, sW, PH, 1.0);
  left.position.set(-2.0, 0.55, 0.25);
  left.rotation.y = 0.34;
  scene.add(left);
  const right = cardMesh(cf.tex, cW, PH, 1.0);
  right.position.set(2.1, 0.55, 0.25);
  right.rotation.y = -0.3;
  scene.add(right);

  const threads: Array<{ w: THREE.Mesh; da: THREE.Mesh; db: THREE.Mesh }> = [];
  ctx.link(left, "/us/statute/7/2017/a", "Read § 2017(a) in the corpus", { when: [0.2, 1.4] });
  ctx.link(right, "https://github.com/TheAxiomFoundation/rulespec-us/blob/main/us/statutes/7/2017/a.yaml#L27", "Open a.yaml on GitHub", { when: [0.2, 1.4] });
  // threads run only through the gap between the pages: from the port
  // on the statute's right edge to the port on the code's left edge
  // threads that leave from the same line of the statute get their own
  // port each, a little apart, so no two dots sit on one another
  const portY = new Map<number, MarkId[]>();
  LINKS.forEach((link) => {
    const m = sf.marks.find((mm) => mm.id === link.id);
    if (!m) return;
    const y0 = Math.round(m.portY ?? m.y - 12);
    portY.set(y0, [...(portY.get(y0) ?? []), link.id]);
  });
  LINKS.forEach((link, i) => {
    const m = sf.marks.find((mm) => mm.id === link.id);
    const y = cf.lines.get(link.line);
    if (!m || y === undefined) return;
    const y0 = Math.round(m.portY ?? m.y - 12);
    const same = portY.get(y0) ?? [];
    const k = same.indexOf(link.id);
    const A = onCard(left, sW, PH, sf.w - 24, y0 + (k - (same.length - 1) / 2) * 30, sf.w, sf.h);
    const B = onCard(right, cW, PH, 40, y - 10, cf.w, cf.h);
    const hot = link.id === HERO_LINK;
    const span = B.x - A.x;
    const c = new THREE.CubicBezierCurve3(
      A,
      // nearly flat: a curve bowed toward the camera reads as a kink
      A.clone().add(new THREE.Vector3(span * 0.45, 0, 0.08 + i * 0.01)),
      B.clone().add(new THREE.Vector3(-span * 0.45, 0, 0.08 + i * 0.01)),
      B,
    );
    const w = wire(c, hot ? 0.009 : 0.0045, hot ? "#ffb45c" : "#e8c79e", hot ? 2.8 : 0.9);
    // one dot size; the hero's a little larger
    const da = dot(A, hot ? 0.026 : 0.018, hot ? 3.2 : 1.6);
    const db = dot(B, hot ? 0.026 : 0.018, hot ? 3.2 : 1.6);
    scene.add(w, da, db);
    threads.push({ w, da, db });
  });
  // the motion: the two pages slide in from either side; then each
  // thread draws in turn, phrase to line, in footnote order
  const leftTo = left.position.clone();
  const rightTo = right.position.clone();
  const leftFrom = leftTo.clone().add(new THREE.Vector3(-1.4, 0, -0.6));
  const rightFrom = rightTo.clone().add(new THREE.Vector3(1.4, 0, -0.6));
  const update = (t: number) => {
    const inn = ease(seg(t, 0, 0.26));
    left.position.lerpVectors(leftFrom, leftTo, inn);
    right.position.lerpVectors(rightFrom, rightTo, inn);
    fade(left, inn);
    fade(right, inn);
    threads.forEach((th, k) => {
      const d = seg(t, 0.3 + k * 0.09, 0.42 + k * 0.09);
      drawShare(th.w, d);
      th.da.visible = d > 0;
      th.db.visible = d >= 1;
    });
  };
  return { camera, look, update };

}

// ── beat 6: all the law ──────────────────────────────────────────────

export function lamplightBeat6(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.05, 300);
  camera.position.set(0.5, 0.2, 11.4);
  camera.lookAt(0.6, 0.25, 0);
  const heroP = new THREE.Vector3(3.9, -1.25, 2.4);
  const focus = camera.position.distanceTo(new THREE.Vector3(0, 0, 0.5));
  const look: Look = themedLook({
    background: "#050302",
    exposure: 1.0,
    dof: { focus, aperture: 0.0009, maxblur: 0.006 },
    bloom: { strength: 0.7, radius: 0.6, threshold: 0.78 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  const r = rng(61);

  // each runtime package is a ball of its outputs (real counts)
  const pts: Array<[number, number, number, number]> = []; // x y z bright
  const pkgLabels: ReturnType<typeof ctx.label>[] = [];
  const wires: number[] = [];
  CLUSTERS.forEach((c, ci) => {
    const cx = (c.x - 740) / 105;
    const cy = (330 - c.y) / 105;
    const cz = -2 + ((ci * 37) % 7) * 0.6;
    const rad = (c.r / 105) * 1.15;
    const base = pts.length;
    for (let i = 0; i < c.count; i++) {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const rr = rad * Math.cbrt(r());
      const s = Math.sqrt(1 - u * u);
      pts.push([cx + rr * s * Math.cos(th), cy + rr * u, cz + rr * s * Math.sin(th), r() < 0.08 ? 1 : 0]);
    }
    // a little wiring inside each package
    for (let i = 0; i < Math.min(c.count, 260); i++) {
      const p = pts[base + Math.floor(r() * c.count)];
      const q = pts[base + Math.floor(r() * c.count)];
      if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < rad * rad * 0.25) wires.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
    if (c.count >= 100) pkgLabels.push(ctx.label(new THREE.Vector3(cx, cy - rad - 0.28, cz), `${c.id} · ${c.count.toLocaleString("en-US")}`, "sf-label--pkg"));
  });
  const g = particleGeometry(pts.length, (i, o) => {
    const [x, y, z, bright] = pts[i];
    o.p.set(x, y, z);
    o.c.copy(bright ? AMBER : CREAM).multiplyScalar(bright ? 1.8 : 1.15);
    o.size = 0.05 + r() * 0.03;
    o.alpha = 0.9;
  });
  fx.add(new THREE.Points(g, particleMaterial({ focus, aperture: 2.4 })));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(wires, 3));
  scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: themed(new THREE.Color("#e0b07a")), transparent: true, opacity: THEME.paper ? 0.2 : 0.12, blending: THEME.paper ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false })));

  // what is not encoded yet: the rest of the law, dim
  const ghost = particleGeometry(16000, (i, o) => {
    o.p.set(-22 + r() * 44, -10 + r() * 20, -18 + r() * 16);
    o.c.copy(CREAM).multiplyScalar(0.3 + r() * 0.25);
    o.size = 0.045 + r() * 0.04;
    o.alpha = 0.45;
  });
  if (!THEME.paper) fx.add(new THREE.Points(ghost, particleMaterial({ focus, aperture: 2.4 })));

  // § 2017(a)'s eight rules: small, amber, in the foreground
  const heroNodes: THREE.Vector3[] = [
    [-0.42, 0.18], [-0.42, -0.1], [-0.22, 0.24], [-0.22, 0.1], [-0.22, -0.12], [-0.22, -0.24],
    [0.0, 0.2], [0.0, -0.16], [0.2, 0.04], [0.32, -0.18],
  ].map(([x, y]) => heroP.clone().add(new THREE.Vector3(x, y, 0)));
  const E = [[0, 2], [2, 6], [3, 6], [1, 8], [6, 8], [1, 7], [4, 7], [5, 7], [8, 9], [7, 9]];
  E.forEach(([a, b]) => scene.add(wire(new THREE.LineCurve3(heroNodes[a], heroNodes[b]), 0.004, "#ffb45c", 1.8)));
  heroNodes.forEach((p, i) => scene.add(dot(p, i === 9 ? 0.035 : 0.022, i === 9 ? 3.5 : 2.4)));
  const heroLabel = ctx.label(heroP.clone().add(new THREE.Vector3(0, -0.55, 0)), "us/statute/7/2017/a · 8 rules", "sf-label--addr");
  ctx.hotspot(heroP.clone(), "/us/statute/7/2017/a", "The provision behind these 8 rules", { when: [0.1, 1.4] });
  {
    const big = CLUSTERS.reduce((m, c) => (c.count > m.count ? c : m));
    ctx.hotspot(new THREE.Vector3((big.x - 740) / 105, (330 - big.y) / 105, -2 + ((CLUSTERS.indexOf(big) * 37) % 7) * 0.6), "/ops", "Watch encodings land in the registry", { when: [0.72, 1.4] });
  }
  // the motion: from close on § 2017(a)'s eight rules, the camera pulls
  // back until the registry is in frame; the package names come up last
  const camTo = camera.position.clone();
  const aimTo = new THREE.Vector3(0.6, 0.25, 0);
  const camFrom = heroP.clone().add(new THREE.Vector3(-0.3, 0.35, 2.6));
  const aimFrom = heroP.clone();
  const focusTo = look.dof!.focus;
  const update = (t: number) => {
    const c = ease(seg(t, 0.05, 0.9));
    camera.position.lerpVectors(camFrom, camTo, c);
    camera.lookAt(new THREE.Vector3().lerpVectors(aimFrom, aimTo, c));
    look.dof!.focus = lerp(camFrom.distanceTo(heroP), focusTo, c);
    heroLabel.el.style.opacity = String(seg(t, 0.0, 0.15));
    pkgLabels.forEach((l) => (l.el.style.opacity = String(seg(t, 0.72, 0.92))));
  };
  return { camera, look, update };

}

// ── beat 8: one set of rules powers every kind of tool ──────────────
// After the RaC Guild deck's OneSourceSlide (axiom-slides, 2026-10-06):
// one source card fans out to the five kinds of user, each with the
// slide's three uses.

const GROUPS: Array<{ icon: "person" | "bank" | "spark" | "code" | "book"; who: string; items: string[] }> = [
  { icon: "person", who: "Individuals & navigators", items: ["Benefits screeners, calculators and navigation tools", "Benefit-cliff explorers", "Legal aid assistance"] },
  { icon: "bank", who: "Governments", items: ["The eligibility rules engine inside a state system", "A test oracle to check current rules and workflows", "Policy dashboards and microsimulation"] },
  { icon: "spark", who: "AI systems", items: ["Assistants that call the rules through MCP", "Benefits chatbots grounded in the law", "Model evaluation and rewards"] },
  { icon: "code", who: "Builders", items: ["A hosted API behind any product", "Embedded libraries — Rust, Python, npm", "Zero-PII WASM, running in the browser"] },
  { icon: "book", who: "Researchers", items: ["Reproducible analysis, pinned to a dated release", "Reform modeling and forecasting", "Open rules to study and cite"] },
];

function icon(g: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = "#ffb45c";
  g.fillStyle = "#ffb45c";
  g.lineWidth = s * 0.08;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  if (kind === "person") {
    g.arc(0, -s * 0.18, s * 0.17, 0, Math.PI * 2);
    g.moveTo(-s * 0.32, s * 0.36);
    g.quadraticCurveTo(0, -s * 0.06, s * 0.32, s * 0.36);
  } else if (kind === "bank") {
    g.moveTo(-s * 0.38, -s * 0.12);
    g.lineTo(0, -s * 0.38);
    g.lineTo(s * 0.38, -s * 0.12);
    g.closePath();
    [-0.24, 0, 0.24].forEach((cx) => {
      g.moveTo(s * cx, -s * 0.04);
      g.lineTo(s * cx, s * 0.26);
    });
    g.moveTo(-s * 0.4, s * 0.36);
    g.lineTo(s * 0.4, s * 0.36);
  } else if (kind === "spark") {
    const star = (cx: number, cy: number, r: number) => {
      g.moveTo(cx, cy - r);
      g.quadraticCurveTo(cx, cy, cx + r, cy);
      g.quadraticCurveTo(cx, cy, cx, cy + r);
      g.quadraticCurveTo(cx, cy, cx - r, cy);
      g.quadraticCurveTo(cx, cy, cx, cy - r);
    };
    star(-s * 0.06, s * 0.04, s * 0.32);
    star(s * 0.28, -s * 0.26, s * 0.13);
  } else if (kind === "code") {
    g.moveTo(-s * 0.16, -s * 0.28);
    g.lineTo(-s * 0.38, 0);
    g.lineTo(-s * 0.16, s * 0.28);
    g.moveTo(s * 0.16, -s * 0.28);
    g.lineTo(s * 0.38, 0);
    g.lineTo(s * 0.16, s * 0.28);
    g.moveTo(s * 0.06, -s * 0.34);
    g.lineTo(-s * 0.06, s * 0.34);
  } else {
    g.moveTo(0, -s * 0.22);
    g.quadraticCurveTo(-s * 0.2, -s * 0.34, -s * 0.4, -s * 0.26);
    g.lineTo(-s * 0.4, s * 0.3);
    g.quadraticCurveTo(-s * 0.2, s * 0.22, 0, s * 0.34);
    g.quadraticCurveTo(s * 0.2, s * 0.22, s * 0.4, s * 0.3);
    g.lineTo(s * 0.4, -s * 0.26);
    g.quadraticCurveTo(s * 0.2, -s * 0.34, 0, -s * 0.22);
    g.lineTo(0, s * 0.34);
  }
  g.stroke();
  g.restore();
}

function wrapLines(g: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  let cur = "";
  text.split(" ").forEach((w) => {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  });
  if (cur) out.push(cur);
  return out;
}

export function lamplightBeat7(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  camera.position.set(-2.2, 0.6, 12.2);
  camera.lookAt(1.0, 0.5, 0);
  const focus = camera.position.distanceTo(new THREE.Vector3(0.7, 0.5, 0));
  const look: Look = themedLook({
    background: BG,
    exposure: 1.0,
    dof: { focus, aperture: 0.0002, maxblur: 0.002 },
    bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  far(fx, focus, 71);
  const mono = fontVar("--font-mono");
  const serif = fontVar("--font-serif");
  const sans = fontVar("--font-geist-sans");

  // the one source
  const SWpx = 900;
  const SHpx = 1060;
  const src = glass(SWpx, SHpx, (g) => {
    g.fillStyle = "rgba(255, 171, 74, 0.1)";
    g.fillRect(8, 8, 14, SHpx - 16);
    g.fillStyle = "#ffb45c";
    g.font = `500 30px ${mono}`;
    g.fillText("ONE SOURCE", 70, 110);
    g.fillStyle = "#f6ead8";
    g.font = `400 86px ${serif}`;
    g.fillText("Encoded, cited", 70, 222);
    g.fillText("rules", 70, 316);
    g.fillStyle = "rgba(246, 234, 216, 0.68)";
    g.font = `400 38px ${sans}`;
    wrapLines(g, "Every value tied to the provision it comes from, effective-dated, in versioned releases.", SWpx - 140).forEach((ln, i) =>
      g.fillText(ln, 70, 400 + i * 54),
    );
    // the delivery channels, as chips
    let x = 70;
    let y = 600;
    g.font = `500 30px ${mono}`;
    ["App", "API", "MCP", "Rust · Python · npm", "WASM"].forEach((c) => {
      const w = g.measureText(c).width + 44;
      if (x + w > SWpx - 60) {
        x = 70;
        y += 76;
      }
      g.beginPath();
      g.roundRect(x, y, w, 56, 10);
      g.fillStyle = "rgba(255, 225, 190, 0.06)";
      g.fill();
      g.strokeStyle = "rgba(255, 190, 120, 0.45)";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#f6ead8";
      g.fillText(c, x + 22, y + 38);
      x += w + 16;
    });
    // a glimpse of the graph the rules form
    const nodes = [[120, 900], [120, 990], [260, 860], [260, 950], [400, 900], [520, 860], [520, 990], [660, 930], [780, 960]];
    g.strokeStyle = "rgba(255, 180, 92, 0.55)";
    g.lineWidth = 3;
    [[0, 2], [2, 4], [3, 4], [1, 3], [4, 5], [4, 6], [5, 7], [6, 7], [7, 8]].forEach(([a, b]) => {
      g.beginPath();
      g.moveTo(nodes[a][0], nodes[a][1]);
      g.lineTo(nodes[b][0], nodes[b][1]);
      g.stroke();
    });
    nodes.forEach(([nx, ny], i) => {
      g.fillStyle = i === 8 ? "#ffb45c" : "#ffe2b8";
      g.beginPath();
      g.arc(nx, ny, i === 8 ? 11 : 7, 0, Math.PI * 2);
      g.fill();
    });
  }, "#ffb45c");
  const SW = 2.55;
  const SH = (SHpx / SWpx) * SW;
  // at 1.0 the card stays below the bloom threshold, so its text does not glow
  const source = cardMesh(src, SW, SH, 1.0);
  source.position.set(-2.55, 0.85, 0.3);
  source.lookAt(camera.position);
  scene.add(source);
  ctx.link(source, "/docs", "Build on the rules", { when: [0.14, 1.4] });
  const halo = canvasTexture(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255, 170, 80, 0.5)");
    gr.addColorStop(1, "rgba(255, 170, 80, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  });
  const glow = lightMesh(halo, 5, 5, "#ffffff", 0.32);
  // a halo is light only: on paper it has no ink to show
  glow.visible = !THEME.paper;
  glow.position.copy(source.position).add(new THREE.Vector3(0, 0, -0.4));
  glow.lookAt(camera.position);
  fx.add(glow);

  // the five kinds of user, on a shallow arc
  const GWpx = 1900;
  const GHpx = 420;
  const GW = 4.0;
  const GH = (GHpx / GWpx) * GW;
  const ys = [2.65, 1.6, 0.55, -0.5, -1.55];
  const groupCards: THREE.Mesh[] = [];
  const beams: Array<{ beam: THREE.Mesh; df: THREE.Mesh; dt: THREE.Mesh; packet: THREE.Mesh; c: THREE.Curve<THREE.Vector3> }> = [];
  const r = rng(88);
  GROUPS.forEach((grp, i) => {
    const tex = glass(GWpx, GHpx, (g) => {
      icon(g, grp.icon, 110, 128, 92);
      g.fillStyle = "rgba(255, 210, 160, 0.82)";
      g.font = `500 30px ${mono}`;
      g.fillText(grp.who.toUpperCase(), 190, 140);
      g.fillStyle = "rgba(255, 190, 120, 0.18)";
      g.fillRect(60, 196, GWpx - 120, 2);
      const colW = (GWpx - 160) / 3;
      g.font = `400 40px ${sans}`;
      grp.items.forEach((it, k) => {
        const x = 70 + k * colW;
        g.fillStyle = "#ffb45c";
        g.fillText("·", x, 270);
        g.fillStyle = "#f2e6d4";
        wrapLines(g, it, colW - 70).forEach((ln, li) => g.fillText(ln, x + 30, 270 + li * 54));
      });
    });
    const m = cardMesh(tex, GW, GH, 1.0);
    groupCards.push(m);
    m.position.set(4.2, ys[i], -0.32 * Math.abs(i - 2));
    m.lookAt(camera.position);
    scene.add(m);
    m.updateMatrixWorld();
    // the fan: one beam per group, leaving the source in the same order
    const from = source.localToWorld(new THREE.Vector3(SW / 2, (0.5 - (i + 0.5) / 5) * SH * 0.62 + SH * 0.08, 0.01));
    const to = m.localToWorld(new THREE.Vector3(-GW / 2, 0, 0.01));
    const c = new THREE.CubicBezierCurve3(from, from.clone().add(new THREE.Vector3(1.5, 0, 0.25)), to.clone().add(new THREE.Vector3(-1.5, 0, 0.2)), to);
    const beam = wire(c, 0.008, "#ffb45c", 2.0);
    const df = dot(from, 0.028, 3);
    const dt = dot(to, 0.028, 3);
    const packet = dot(c.getPoint(0.3 + r() * 0.4), 0.042, 4);
    scene.add(beam, df, dt, packet);
    beams.push({ beam, df, dt, packet, c });
    const GROUP_LINKS: Array<[string, string]> = [
      ["/demos", "Try a screener built on the rules"],
      ["/validation", "See how the rules are checked"],
      ["/docs", "Connect an assistant over MCP"],
      ["/docs", "Use the API and libraries"],
      ["/coverage", "See what the rules cover"],
    ];
    ctx.link(m, GROUP_LINKS[i][0], GROUP_LINKS[i][1], { when: [0.4 + i * 0.1, 1.4] });
  });
  // the motion: the source lights; one beam at a time runs out to each
  // kind of user, whose card comes up as the beam lands; values travel on
  const srcTo = source.position.clone();
  const srcFrom = srcTo.clone().add(new THREE.Vector3(-0.6, 0, -0.4));
  const cardTo = groupCards.map((m) => m.position.clone());
  const update = (t: number) => {
    const s0 = ease(seg(t, 0, 0.16));
    source.position.lerpVectors(srcFrom, srcTo, s0);
    fade(source, s0);
    (glow.material as THREE.MeshBasicMaterial).opacity = s0;
    beams.forEach((b, i) => {
      const d = seg(t, 0.18 + i * 0.1, 0.32 + i * 0.1);
      drawShare(b.beam, d);
      b.df.visible = d > 0;
      b.dt.visible = d >= 1;
      const pop = ease(seg(t, 0.3 + i * 0.1, 0.4 + i * 0.1));
      fade(groupCards[i], pop);
      groupCards[i].position.copy(cardTo[i]).add(new THREE.Vector3(0.25 * (1 - pop), 0, 0));
      // one pulse per beam, once, as the beam lands
      const run = seg(t, 0.18 + i * 0.1, 0.32 + i * 0.1);
      b.packet.visible = run > 0 && run < 1;
      b.packet.position.copy(b.c.getPoint(ease(run)));
    });
  };
  return { camera, look, update };

}
