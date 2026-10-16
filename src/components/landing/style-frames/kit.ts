// Shared kit for the style frames: one WebGL renderer, a post chain
// (depth of field → particles → bloom → tone map → grain + vignette),
// canvas-drawn text textures, a glyph atlas for letter particles, and
// HTML labels projected from 3D. Every frame is a deterministic still.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export const W = 1920;
export const H = 1080;

// ── motion helpers: a beat's local progress t runs 0..1 ──────────────

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// how far t is through the window [a, b], 0..1
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
// ease in and out
export const ease = (v: number) => {
  const x = clamp01(v);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// print a second texture on a material's back face, mirrored so it reads
// the right way once the sheet has turned over; call from onBeforeCompile
export function patchBackFace(sh: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }, back: THREE.Texture) {
  sh.uniforms.mapBack = { value: back };
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform sampler2D mapBack;")
    .replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
        vec4 sampledDiffuseColor = gl_FrontFacing ? texture2D(map, vMapUv) : texture2D(mapBack, vec2(1.0 - vMapUv.x, vMapUv.y));
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
}

export function twoSidedPaper(front: THREE.Texture, back: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ map: front, roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => patchBackFace(sh, back);
  return mat;
}

// draw only the first share of a line-like mesh (tubes are indexed along
// their length, so a partial index range draws a partial tube)
export function drawShare(mesh: THREE.Mesh | THREE.Points, share: number) {
  const g = mesh.geometry;
  const total = g.index ? g.index.count : g.attributes.position.count;
  const step = g.index && !(mesh instanceof THREE.Points) ? 6 : 1;
  g.setDrawRange(0, Math.floor((total * clamp01(share)) / step) * step);
  mesh.visible = share > 0;
}

// sorted random numbers: particles laid along a path in order, so a draw
// range grows them outward from the start
export function sortedRandoms(n: number, r: () => number, shape = 1) {
  return Array.from({ length: n }, () => Math.pow(r(), shape)).sort((a, b) => a - b);
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fontVar(name: "--font-serif" | "--font-mono" | "--font-geist-sans") {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "serif";
}

export async function loadFonts() {
  const fams = [fontVar("--font-serif"), fontVar("--font-mono"), fontVar("--font-geist-sans")];
  await Promise.all(
    fams.flatMap((f) => [
      document.fonts.load(`400 40px ${f}`),
      document.fonts.load(`italic 400 40px ${f}`),
      document.fonts.load(`600 40px ${f}`),
    ]),
  );
  await document.fonts.ready;
}

// ── text on canvas ───────────────────────────────────────────────────

// ss > 1 draws at that many times the resolution (same coordinates), for
// textures that carry text the reader must read sharp on a Retina screen;
// only for vector drawing, not pixel loops
// `graphic`: drawn content (cards, code, labels), not a material. On the
// paper theme its colours are turned over to ink (see toPaperCss).
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, ss = 1, graphic = false) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * ss);
  c.height = Math.round(h * ss);
  const g = c.getContext("2d")!;
  if (ss !== 1) g.scale(ss, ss);
  draw(THEME.paper && graphic ? paperCanvas(g) : g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// word-wrap text into lines that fit `maxW`; returns [line, words-with-x]
export function wrap(g: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// draw a paragraph, painting any `hot` phrase in its own style
export function paragraph(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
  hot?: { phrase: string; paint: (g: CanvasRenderingContext2D, x: number, y: number, w: number, word: string) => void },
) {
  const lines = wrap(g, text, maxW);
  const hotWords = hot ? hot.phrase.split(" ") : [];
  // find the hot phrase as a word-index range in the flat word list
  const flat = lines.flatMap((l) => l.split(" "));
  let hotStart = -1;
  if (hot) {
    for (let i = 0; i <= flat.length - hotWords.length; i++) {
      if (hotWords.every((w, k) => flat[i + k] === w)) {
        hotStart = i;
        break;
      }
    }
  }
  let wi = 0;
  lines.forEach((line, li) => {
    let cx = x;
    const yy = y + li * lh;
    line.split(" ").forEach((w) => {
      const ww = g.measureText(w).width;
      if (hot && hotStart >= 0 && wi >= hotStart && wi < hotStart + hotWords.length) {
        hot.paint(g, cx, yy, ww, w);
      } else {
        g.fillText(w, cx, yy);
      }
      cx += ww + g.measureText(" ").width;
      wi++;
    });
  });
  return y + lines.length * lh;
}

// ── letter particles ─────────────────────────────────────────────────

const ATLAS_CELLS = 16;

export function glyphAtlas(chars: string, font: string) {
  return canvasTexture(1024, 1024, (g) => {
    const cell = 1024 / ATLAS_CELLS;
    g.fillStyle = "#000";
    g.fillRect(0, 0, 1024, 1024);
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `400 ${cell * 0.72}px ${font}`;
    for (let i = 0; i < ATLAS_CELLS * ATLAS_CELLS; i++) {
      const ch = chars[i % chars.length];
      g.fillText(ch, (i % ATLAS_CELLS) * cell + cell / 2, Math.floor(i / ATLAS_CELLS) * cell + cell / 2 + cell * 0.04);
    }
  });
}

// Points that can be letters (atlas) or soft dots, with their own depth
// of field: out-of-focus points grow into dimmer, softer discs.
export function particleMaterial(opts: {
  atlas?: THREE.Texture;
  square?: boolean; // square cells instead of round dots
  focus: number;
  aperture: number; // px of blur per world unit off focus
  blending?: THREE.Blending;
}) {
  if (opts.atlas) {
    opts.atlas.flipY = false;
    opts.atlas.needsUpdate = true;
  }
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // on paper the dots are ink laid on the page, not light added to it
    blending: opts.blending ?? (THEME.paper ? THREE.NormalBlending : THREE.AdditiveBlending),
    // the fragment colour is already multiplied by its alpha
    premultipliedAlpha: (opts.blending ?? (THEME.paper ? THREE.NormalBlending : THREE.AdditiveBlending)) === THREE.NormalBlending,
    uniforms: {
      uAtlas: { value: opts.atlas ?? null },
      uUseAtlas: { value: opts.atlas ? 1 : 0 },
      uSquare: { value: opts.square ? 1 : 0 },
      uCells: { value: ATLAS_CELLS },
      uScale: { value: H / 2 },
      uFocus: { value: opts.focus },
      uAperture: { value: opts.aperture },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aGlyph;
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform float uScale, uFocus, uAperture;
      varying float vGlyph, vAlpha, vSoft;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        float sharp = aSize * uScale / dist;
        float coc = abs(dist - uFocus) * uAperture;
        float s = sharp + coc;
        // a letter that passes right by the lens fades out, and no disc
        // grows past a limit: such discs are near-invisible haze, but each
        // would cost the GPU hundreds of thousands of pixels
        float nearFade = smoothstep(0.25, 0.9, dist);
        gl_PointSize = min(s, 0.3 * uScale) * nearFade;
        if (nearFade < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        // energy stays roughly constant as the disc grows
        vAlpha = aAlpha * nearFade * clamp((sharp * sharp) / (s * s), 0.04, 1.0);
        vSoft = clamp(coc / max(sharp, 1.0), 0.0, 1.0);
        vGlyph = aGlyph;
        vColor = aColor;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uUseAtlas, uCells, uSquare, uOpacity;
      varying float vGlyph, vAlpha, vSoft;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float disc = smoothstep(0.5, 0.36, d);
        float a = disc;
        if (uUseAtlas > 0.5) {
          vec2 cell = vec2(mod(vGlyph, uCells), floor(vGlyph / uCells));
          float glyph = texture2D(uAtlas, (cell + gl_PointCoord) / uCells).r;
          a = mix(glyph, disc * 0.55, vSoft);
        } else if (uSquare > 0.5) {
          vec2 q = abs(gl_PointCoord - 0.5);
          float sq = 1.0 - smoothstep(0.36, 0.42, max(q.x, q.y));
          a = mix(sq, disc * 0.6, vSoft);
        } else {
          a = mix(smoothstep(0.5, 0.0, d), disc * 0.7, vSoft);
        }
        a *= uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * a * vAlpha, a * vAlpha);
      }
    `,
  });
}

export function particleGeometry(
  n: number,
  fill: (i: number, out: { p: THREE.Vector3; c: THREE.Color; size: number; glyph: number; alpha: number }) => void,
) {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const glyph = new Float32Array(n);
  const alpha = new Float32Array(n);
  const o = { p: new THREE.Vector3(), c: new THREE.Color(), size: 1, glyph: 0, alpha: 1 };
  for (let i = 0; i < n; i++) {
    o.size = 1;
    o.glyph = 0;
    o.alpha = 1;
    fill(i, o);
    pos.set([o.p.x, o.p.y, o.p.z], i * 3);
    if (THEME.paper) {
      inkDot(o.c);
      // ink dots read fainter than dots of light: a little larger, a little
      // more solid
      o.size *= 1.35;
      o.alpha = Math.min(1, o.alpha * 1.2);
    }
    col.set([o.c.r, o.c.g, o.c.b], i * 3);
    size[i] = o.size;
    glyph[i] = o.glyph;
    alpha[i] = o.alpha;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aGlyph", new THREE.BufferAttribute(glyph, 1));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
  return g;
}

// ── the finishing pass: grade, vignette, grain ───────────────────────

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uGrain: { value: 0.05 },
    uVignette: { value: 0.35 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uSeed: { value: 0.37 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGrain, uVignette, uSeed;
    uniform vec3 uLift, uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = c.rgb * uTint + uLift * (1.0 - c.rgb);
      float v = smoothstep(1.15, 0.35, length((vUv - 0.5) * vec2(1.25, 1.0)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      c.rgb += (hash(vUv * 1931.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
};

// the page theme the scenes are built for: "paper" draws them in ink on
// white, for a canvas multiplied onto the website's own light background
export const THEME = { paper: false };

// night → paper: the same hue, its lightness turned over. A bright glow
// becomes deep ink, cream text becomes dark brown, a dark card becomes
// light paper. (Values brighter than white, for the bloom, count as white:
// the brightest light becomes the darkest ink.)
function flipSrgb(r: number, g: number, b: number): [number, number, number] {
  // overbright (for the glow): scale down as a whole, so the hue holds
  const top = Math.max(r, g, b, 1);
  r = Math.max(0, r / top);
  g = Math.max(0, g / top);
  b = Math.max(0, b / top);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const l2 = 1 - l;
  const c = (1 - Math.abs(2 * l2 - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l2 - c / 2;
  const k = Math.floor(((h % 1) + 1) % 1 * 6);
  const [r1, g1, b1] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k] as [number, number, number];
  return [r1 + m, g1 + m, b1 + m];
}
const srgbTmp = { r: 0, g: 0, b: 0 };
// a colour for the current theme (unchanged at night)
export function themed(c: THREE.Color): THREE.Color {
  if (!THEME.paper) return c;
  c.getRGB(srgbTmp, THREE.SRGBColorSpace);
  const [r, g, b] = flipSrgb(srgbTmp.r, srgbTmp.g, srgbTmp.b);
  return c.setRGB(r, g, b, THREE.SRGBColorSpace);
}
export const themedColor = (c: THREE.ColorRepresentation) => themed(new THREE.Color(c));
// a dot of light becomes a dot of ink: warm light prints amber, pale light
// (cream, white) prints dark brown; dimmer light prints a little lighter
const INK_AMBER = new THREE.Color("#9c4a0e");
const INK_DARK = new THREE.Color("#3a2a1d");
const hslTmp = { h: 0, s: 0, l: 0 };
export function inkDot(c: THREE.Color): THREE.Color {
  const top = Math.max(c.r, c.g, c.b);
  const lum = Math.min(1, top);
  if (top > 1) c.multiplyScalar(1 / top);
  c.getHSL(hslTmp);
  const warm = Math.min(1, Math.max(0, (hslTmp.s - 0.35) / 0.4));
  return c.copy(INK_DARK).lerp(INK_AMBER, warm).lerp(new THREE.Color(1, 1, 1), 0.25 * (1 - lum));
}
// the same for a CSS colour string
export function toPaperCss(css: string): string {
  const m = css.match(/^rgba?\(([^)]+)\)$/);
  let r: number;
  let g: number;
  let b: number;
  let a = 1;
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    [r, g, b] = [p[0] / 255, p[1] / 255, p[2] / 255];
    if (p.length > 3) a = p[3];
  } else if (/^#[0-9a-f]{3,8}$/i.test(css)) {
    const c = new THREE.Color().setStyle(css);
    c.getRGB(srgbTmp, THREE.SRGBColorSpace);
    [r, g, b] = [srgbTmp.r, srgbTmp.g, srgbTmp.b];
  } else return css;
  const [r2, g2, b2] = flipSrgb(r, g, b);
  return `rgba(${Math.round(r2 * 255)}, ${Math.round(g2 * 255)}, ${Math.round(b2 * 255)}, ${a})`;
}
// a 2D context whose colours are turned over as they are set
function paperCanvas(g: CanvasRenderingContext2D): CanvasRenderingContext2D {
  const conv = (v: unknown) => (typeof v === "string" ? toPaperCss(v) : v);
  const grad = (gr: CanvasGradient) => {
    const add = gr.addColorStop.bind(gr);
    gr.addColorStop = (o: number, c: string) => add(o, toPaperCss(c));
    return gr;
  };
  return new Proxy(g, {
    get(t, k) {
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient") {
        return (...args: number[]) => grad((t[k] as (...a: number[]) => CanvasGradient).apply(t, args));
      }
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) {
      return Reflect.set(t, k, k === "fillStyle" || k === "strokeStyle" || k === "shadowColor" ? conv(v) : v, t);
    },
  });
}

// the paper look: ink on white, no tone curve, glow, grain or vignette to
// tint the white (which becomes see-through in the last pass)
export function themedLook(look: Look): Look {
  if (!THEME.paper) return look;
  return {
    ...look,
    background: "#ffffff",
    toneMapping: THREE.NoToneMapping,
    bloom: undefined,
    grain: 0,
    vignette: 0,
    lift: undefined,
    tint: undefined,
  };
}

export type Look = {
  background: THREE.ColorRepresentation;
  exposure?: number;
  toneMapping?: THREE.ToneMapping;
  dof?: { focus: number; aperture: number; maxblur: number };
  bloom?: { strength: number; radius: number; threshold: number };
  grain?: number;
  vignette?: number;
  lift?: [number, number, number];
  tint?: [number, number, number];
  shadows?: boolean;
  // false: nothing that casts a shadow has moved since the last frame, so
  // the shadow maps are reused (they cost a full draw of the scene each)
  shadowsDirty?: boolean;
};

// ── beats: one scene each, rendered through a shared pipeline ─────────

export type Label = {
  el: HTMLElement;
  pos: THREE.Vector3;
  track?: () => THREE.Vector3; // for anchors on moving things
  when?: [number, number]; // the stretch of the beat's own time it shows
};

export type HotspotOpts = { track?: () => THREE.Vector3; when?: [number, number]; external?: boolean };

// A link that is a thing in the scene. The director lights `target` on
// hover, focus and a periodic glint; `hit` is what the pointer must touch
// (thin things get a larger invisible area).
export type SceneLink = {
  target: THREE.Object3D;
  hit: THREE.Object3D;
  href: string;
  text: string;
  when?: [number, number];
  external: boolean;
  anchor: HTMLAnchorElement; // keyboard and screen readers
  glow: number; // 0..1, set by the director before each render
  hover: boolean;
  focus: boolean;
};

export type LinkOpts = { when?: [number, number]; external?: boolean; hit?: THREE.Object3D; anchorAt?: () => THREE.Vector3 };

const AMBER_GLOW = new THREE.Color("#ff9a3a");
// light a link's object: basic materials brighten, lit ones glow amber
export function lightLink(l: SceneLink, h: number) {
  l.target.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      const u = m.userData as { baseColor?: THREE.Color; wrote?: THREE.Color; glowSprite?: boolean };
      if (u.glowSprite) {
        (m as THREE.SpriteMaterial).opacity = h;
        return;
      }
      const c = (m as THREE.MeshBasicMaterial).color as THREE.Color | undefined;
      if (!c) return;
      // the base is the scene's own colour: if the scene has set a new one
      // since the last write (a gate lighting up, fading in), take that
      if (!u.baseColor || !u.wrote || !c.equals(u.wrote)) u.baseColor = c.clone();
      if (m instanceof THREE.MeshStandardMaterial) {
        // lit surfaces (leather, paper) brighten and warm through their own
        // texture; an emissive glow would flatten them into one colour
        c.copy(u.baseColor).multiplyScalar(1 + 0.6 * h).lerp(AMBER_GLOW, 0.12 * h);
      } else {
        c.copy(u.baseColor).multiplyScalar(1 + 0.55 * h);
      }
      u.wrote = c.clone();
    });
  });
}

let glowTex: THREE.Texture | null = null;
// a soft amber light, for links whose object is a point or a crowd
export function glowSprite(size: number) {
  glowTex ??= canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255, 190, 110, 0.9)");
    gr.addColorStop(0.35, "rgba(255, 150, 60, 0.35)");
    gr.addColorStop(1, "rgba(255, 150, 60, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  });
  const m = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  m.userData.glowSprite = true;
  const sp = new THREE.Sprite(m);
  sp.scale.setScalar(size);
  return sp;
}

// an invisible area the pointer can hit
export function hitArea(w: number, h: number, d = 0.02) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  m.userData.hitOnly = true;
  return m;
}

export type BeatCtx = {
  scene: THREE.Scene; // meshes: get depth of field
  fx: THREE.Scene; // particles and light: carry their own depth of field
  label: (p: THREE.Vector3, html: string, cls?: string) => Label;
  // a link that lives on a thing in the scene: a glowing ring, its words
  // only on hover or focus
  hotspot: (p: THREE.Vector3, href: string, text: string, opts?: HotspotOpts) => Label;
  // the thing itself is the link
  link: (target: THREE.Object3D, href: string, text: string, opts?: LinkOpts) => SceneLink;
};

export type BeatSpec = {
  camera: THREE.PerspectiveCamera;
  look: Look;
  // local progress 0..1: the beat's own motion; 1 is the style frame
  update?: (t: number) => void;
  ready?: Promise<unknown>; // async assets the beat must wait for
  parts?: Record<string, unknown>; // for scenes that compose this beat
  // a cut of its own in place of the pan through the dark: k runs 0..1
  // over the cut, applied after the camera is posed
  // next: the incoming scene (its camera already posed for this frame)
  cutOut?: (k: number, next?: { camera: THREE.PerspectiveCamera; parts?: Record<string, unknown> }) => void;
  cutIn?: (k: number) => void;
};

export type BeatBuilder = (ctx: BeatCtx) => BeatSpec;

export type Beat = BeatSpec & {
  scene: THREE.Scene;
  fx: THREE.Scene;
  labels: Label[];
  links: SceneLink[];
  overlay: HTMLElement;
  invalidate?: () => void; // set by the director: redraw soon
};

export function createBeat(build: BeatBuilder, overlay: HTMLElement): Beat {
  const scene = new THREE.Scene();
  const fx = new THREE.Scene();
  const labels: Label[] = [];
  const label = (p: THREE.Vector3, html: string, cls = "") => {
    const el = document.createElement("div");
    el.className = `sf-label ${cls}`;
    el.innerHTML = html;
    overlay.appendChild(el);
    const l = { el, pos: p.clone() };
    labels.push(l);
    return l;
  };
  const links: SceneLink[] = [];
  const beatRef: { b?: Beat } = {};
  const box = new THREE.Box3();
  const link = (target: THREE.Object3D, href: string, text: string, opts: LinkOpts = {}) => {
    const external = opts.external ?? href.startsWith("http");
    const a = document.createElement("a");
    a.className = "sf-hot sf-hot--quiet";
    a.href = href;
    if (external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.setAttribute("aria-label", text);
    a.innerHTML = `<span class="sf-hot__ring"></span><span class="sf-hot__text">${text} →</span>`;
    overlay.appendChild(a);
    const hit = opts.hit ?? target;
    if (opts.hit && !opts.hit.parent) target.add(opts.hit);
    const l: SceneLink = { target, hit, href, text, when: opts.when, external, anchor: a, glow: 0, hover: false, focus: false };
    a.addEventListener("focus", () => ((l.focus = true), beatRef.b?.invalidate?.()));
    a.addEventListener("blur", () => ((l.focus = false), beatRef.b?.invalidate?.()));
    links.push(l);
    // the focus target sits on the thing's middle
    const at =
      opts.anchorAt ??
      (() => {
        box.setFromObject(hit);
        return box.isEmpty() ? hit.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
      });
    labels.push({ el: a, pos: new THREE.Vector3(), track: at, when: opts.when });
    return l;
  };
  // a link at a point: a soft light there, and an area to hit
  const hotspot = (p: THREE.Vector3, href: string, text: string, opts: HotspotOpts = {}) => {
    const g = new THREE.Group();
    g.position.copy(p);
    const sp = glowSprite(0.5);
    g.add(sp);
    const hit = hitArea(0.5, 0.5, 0.5);
    g.add(hit);
    scene.add(g);
    if (opts.track) {
      const tr = opts.track;
      g.onBeforeRender = () => g.position.copy(tr());
      hit.onBeforeRender = () => g.position.copy(tr());
    }
    const l = link(g, href, text, { when: opts.when, external: opts.external, hit, anchorAt: opts.track ?? (() => g.getWorldPosition(new THREE.Vector3())) });
    return labels[labels.length - 1] ?? ({ el: l.anchor, pos: p } as Label);
  };
  const spec = build({ scene, fx, label, hotspot, link });
  scene.background = new THREE.Color(spec.look.background);
  spec.camera.userData.baseFov ??= spec.camera.fov;
  spec.camera.userData.basePos = spec.camera.position.clone();
  spec.camera.userData.baseQuat = spec.camera.quaternion.clone();
  spec.camera.userData.baseFocus = spec.look.dof?.focus ?? 8;
  const beat: Beat = { ...spec, scene, fx, labels, links, overlay };
  beatRef.b = beat;
  return beat;
}

// The frames were composed at 16:9. On a narrower screen, widen the
// vertical field of view so the same width of the scene stays in frame.
// every scene is framed a little wider than it was composed, so its
// elements sit smaller on the page with more room around them
export const VIEW_ZOOM = 1.32;
export function fitCamera(camera: THREE.PerspectiveCamera, w: number, h: number) {
  const aspect = w / h;
  const base = (camera.userData.baseFov as number) ?? camera.fov;
  camera.aspect = aspect;
  const wide = VIEW_ZOOM * (aspect >= W / H ? 1 : (W / H) / aspect);
  camera.fov = (2 * Math.atan(Math.tan((base * Math.PI) / 360) * wide) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

// HTML labels follow their 3D anchors, in CSS pixels of a w×h viewport
export function placeLabels(beat: Beat, w: number, h: number, t = 1) {
  beat.camera.updateMatrixWorld();
  for (const l of beat.labels) {
    if (l.track) l.pos.copy(l.track());
    const v = l.pos.clone().project(beat.camera);
    // move with a transform (composited) rather than left/top (layout),
    // and touch nothing that has not changed: each write invalidates style
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    // most labels centre on their anchor; a few hang off it to the right
    const c = l.el.className;
    const anchor = /sf-label--quiet|sf-x\b|sf-node/.test(c) ? "translate(0, -50%)" : /sf-pop/.test(c) ? "" : "translate(-50%, -50%)";
    l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ${anchor}`;
    const left = v.x > 0.45;
    if (l.el.classList.contains("sf-hot--left") !== left) l.el.classList.toggle("sf-hot--left", left);
    const on = !l.when || (t >= l.when[0] && t <= l.when[1]);
    const offscreen = v.z > 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02;
    const vis = offscreen || !on ? "hidden" : "";
    if (l.el.style.visibility !== vis) l.el.style.visibility = vis;
    if (l.el.tagName === "A") {
      const ti = vis ? -1 : 0;
      if (l.el.tabIndex !== ti) l.el.tabIndex = ti;
    }
  }
}

// One post chain, reconfigured per beat: depth of field → particles →
// bloom → tone map → grain and vignette. With toScreen false the result
// stays in `texture`, for the director to blend two beats.
export class Pipeline {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private bokeh: BokehPass;
  private fxPass: RenderPass;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private dummyScene = new THREE.Scene();

  constructor(
    private renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
    toScreen: boolean,
  ) {
    const cam = new THREE.PerspectiveCamera();
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.renderToScreen = toScreen;
    this.renderPass = new RenderPass(this.dummyScene, cam);
    this.bokeh = new BokehPass(this.dummyScene, cam, { focus: 10, aperture: 0.001, maxblur: 0.01 });
    this.fxPass = new RenderPass(this.dummyScene, cam);
    this.fxPass.clear = false;
    this.fxPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.5, 0.85);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bokeh);
    this.composer.addPass(this.fxPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.finish);
    this.setSize(width, height);
  }

  setSize(width: number, height: number) {
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
  }

  get texture() {
    return this.composer.readBuffer.texture;
  }

  render(beat: Beat) {
    const { look, camera, scene, fx } = beat;
    const r = this.renderer;
    r.toneMapping = look.toneMapping ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = look.exposure ?? 1;
    // shadow maps: drawn once per frame at most (not again for the depth
    // pass), and only when something that casts one has moved
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = look.shadowsDirty !== false;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.bokeh.enabled = !!look.dof;
    if (look.dof) {
      this.bokeh.scene = scene;
      this.bokeh.camera = camera;
      const bu = this.bokeh.uniforms as Record<string, THREE.IUniform<number>>;
      bu.focus.value = look.dof.focus;
      bu.aperture.value = look.dof.aperture;
      bu.maxblur.value = look.dof.maxblur;
    }
    this.fxPass.scene = fx;
    this.fxPass.camera = camera;
    this.bloom.enabled = !!look.bloom;
    if (look.bloom) {
      this.bloom.strength = look.bloom.strength;
      this.bloom.radius = look.bloom.radius;
      this.bloom.threshold = look.bloom.threshold;
    }
    const u = this.finish.uniforms;
    u.uGrain.value = look.grain ?? 0.04;
    u.uVignette.value = look.vignette ?? 0.3;
    u.uLift.value.set(...(look.lift ?? [0, 0, 0]));
    u.uTint.value.set(...(look.tint ?? [1, 1, 1]));
    // particle sizes are in buffer pixels: keep them true to the frame
    const bh = this.composer.readBuffer.height;
    fx.traverse((o) => {
      const m = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
      if (m && m.uniforms?.uScale) {
        m.userData.baseAperture ??= m.uniforms.uAperture.value;
        // (points shrink with the wider view, like everything else)
        m.uniforms.uScale.value = bh / 2 / VIEW_ZOOM;
        m.uniforms.uAperture.value = (m.userData.baseAperture as number) * (bh / H) * (THEME.paper ? 0.3 : 1);
      }
    });
    camera.updateMatrixWorld();
    this.composer.render();
  }
}

export function makeRenderer(canvas?: HTMLCanvasElement) {
  // alpha: on the paper theme the canvas is see-through (white becomes
  // transparent in the last pass), so the page shows behind the scenes
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, canvas, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  return renderer;
}

// screen position of a world point, in frame pixels
export function toScreen(p: THREE.Vector3, camera: THREE.Camera): [number, number] {
  camera.updateMatrixWorld();
  const v = p.clone().project(camera);
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
}

// value noise for dissolve masks and paper fibre
export function noise2(seed: number) {
  const r = rng(seed);
  const N = 256;
  const tab = new Float32Array(N * N).map(() => r());
  const at = (x: number, y: number) => tab[((y & (N - 1)) * N) + (x & (N - 1))];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = sm(x - xi);
    const yf = sm(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * xf;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  };
}

// A grain field (values 0..1) computed once per size and recipe and then
// shared: paper, cloth, leather and wood reuse it instead of recomputing
// noise pixel by pixel for every texture.
const GRAIN = new Map<string, Float32Array>();
export function grainField(key: string, w: number, h: number, f: (x: number, y: number) => number) {
  const k = `${key}:${w}x${h}`;
  let a = GRAIN.get(k);
  if (!a) {
    a = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y);
    GRAIN.set(k, a);
  }
  return a;
}

export function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * n(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}


// ── match moves between scenes ───────────────────────────────────────
// A card (or a strip of one) flies from where it is in this scene to where
// its counterpart sits on screen in the next scene, so the two line up
// exactly while one scene dissolves into the other.

const ndcTmp = new THREE.Vector3();
// the four corners of a plane (or a sub-rectangle of it, in its local
// units), in world space; order: top-left, top-right, bottom-left, bottom-right
export function planeCorners(mesh: THREE.Mesh, rect?: { x0: number; x1: number; y0: number; y1: number }): THREE.Vector3[] {
  const g = mesh.geometry as THREE.PlaneGeometry;
  const w = g.parameters.width;
  const h = g.parameters.height;
  const r = rect ?? { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2 };
  mesh.updateMatrixWorld();
  return [
    [r.x0, r.y1],
    [r.x1, r.y1],
    [r.x0, r.y0],
    [r.x1, r.y0],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld));
}
// a world point seen by `from`, put at the same place on screen for `to`,
// at a chosen distance from it
export function carryOnScreen(p: THREE.Vector3, from: THREE.Camera, to: THREE.PerspectiveCamera, dist: number, out = new THREE.Vector3()) {
  from.updateMatrixWorld();
  to.updateMatrixWorld();
  ndcTmp.copy(p).project(from);
  out.set(ndcTmp.x, ndcTmp.y, 0.5).unproject(to).sub(to.position).normalize();
  return out.multiplyScalar(dist).add(to.position);
}

export class QuadMorph {
  readonly fly: THREE.Mesh;
  private from: THREE.Vector3[] | null = null;
  constructor(
    scene: THREE.Scene,
    private src: THREE.Mesh,
    private rect?: { x0: number; x1: number; y0: number; y1: number },
  ) {
    const g = src.geometry as THREE.PlaneGeometry;
    const w = g.parameters.width;
    const h = g.parameters.height;
    const r = rect ?? { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    const u = (x: number) => x / w + 0.5;
    const v = (y: number) => y / h + 0.5;
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([u(r.x0), v(r.y1), u(r.x1), v(r.y1), u(r.x0), v(r.y0), u(r.x1), v(r.y0)], 2));
    geo.setIndex([0, 2, 1, 2, 3, 1]);
    const mat = (src.material as THREE.MeshBasicMaterial).clone();
    mat.transparent = true;
    mat.side = THREE.DoubleSide;
    // in flight it passes in front of everything else in the scene
    mat.depthTest = false;
    mat.depthWrite = false;
    this.fly = new THREE.Mesh(geo, mat);
    this.fly.frustumCulled = false;
    this.fly.visible = false;
    this.fly.renderOrder = 100;
    scene.add(this.fly);
  }
  // back to the scene's own state (each frame, before any cut)
  reset() {
    this.fly.visible = false;
    this.from = null;
  }
  // e 0..1 toward the target corners (world, already in this scene)
  set(e: number, to: THREE.Vector3[], opacity = 1) {
    this.from ??= planeCorners(this.src, this.rect);
    const pos = this.fly.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < 4; i++) {
      const p = this.from[i].clone().lerp(to[i], e);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    this.fly.geometry.computeBoundingSphere();
    (this.fly.material as THREE.MeshBasicMaterial).opacity = opacity;
    this.fly.visible = opacity > 0.002;
  }
  // the target: a plane in the next scene, carried onto this camera's screen
  // at the depth the source sits at
  toward(target: THREE.Mesh, next: THREE.PerspectiveCamera, here: THREE.PerspectiveCamera, targetRect?: { x0: number; x1: number; y0: number; y1: number }) {
    this.from ??= planeCorners(this.src, this.rect);
    const d = this.from[0].distanceTo(here.position);
    return planeCorners(target, targetRect).map((p) => carryOnScreen(p, next, here, d));
  }
}

// fading a whole scene out (all but what flies on): every material is
// made transparent when the scene is built, so the fade only changes a
// number and never builds a new shader mid-scroll
export class SceneFade {
  private mats: Array<{ m: THREE.Material & { uniforms?: Record<string, THREE.IUniform> }; base: number; baseU: number }> = [];
  constructor(roots: THREE.Object3D[], keep: (m: THREE.Material) => boolean = () => false) {
    const seen = new Set<THREE.Material>();
    roots.forEach((r) =>
      r.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((m) => {
          if (seen.has(m) || keep(m)) return;
          seen.add(m);
          m.transparent = true;
          const u = m as THREE.Material & { uniforms?: Record<string, THREE.IUniform> };
          this.mats.push({ m: u, base: m.opacity, baseU: u.uniforms?.uOpacity?.value ?? 1 });
        });
      }),
    );
  }
  // at the start of the scene's update: back to its own opacities (the
  // update then sets whatever it animates)
  reset() {
    this.mats.forEach((e) => {
      e.m.opacity = e.base;
      if (e.m.uniforms?.uOpacity) e.m.uniforms.uOpacity.value = e.baseU;
    });
  }
  // after the update, in the way out: v 1 = as set, 0 = gone
  apply(v: number) {
    this.mats.forEach((e) => {
      if (e.m.uniforms?.uOpacity) e.m.uniforms.uOpacity.value *= v;
      else e.m.opacity *= v;
    });
  }
}
