// The library aisle: two walls of law books that run to one lit volume,
// Title 7, in the bookcase at the far end. Modelled, not drawn: rounded
// volumes in bound sets (buckram law reports with a red and a black label,
// and leather sets with raised bands), walnut carcasses with a grain, a
// plank floor, pendant lamps, soft shadows.
//
// It is lit for the page, not for the dark: the room has no walls or
// ceiling, the canvas is see-through, and the fog is the page's own paper
// colour, so the far shelves and the floor fade into the page.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { canvasTexture, ease, fbm, fontVar, grainField, lerp, noise2, rng, seg } from "./kit";
import { gilt, heroSpine, pageEdges, plaque } from "./lamplight0";

export const PAPER = "#faf9f6";

// classic: the period room. gallery: pale oak, daylight, volumes in bone,
// tan and ink only. paper: the whole room in matte paper, relief and shadow
// but no colour. fade: the period room near the camera, paper at the far end.
// In all of them Title 7 keeps its colour.
// blend: between the gallery and the period room. Mid oak, the red
// labels, two quiet leathers, and the lamps over daylight.
export type AisleLook = "classic" | "gallery" | "paper" | "fade" | "blend";
type Binding = { kind: "report" | "leather"; color: string; l1?: string; l2?: string };
const CLASSIC: Binding[] = [
  { kind: "report", color: "#bfa878" },
  { kind: "leather", color: "#1f3527" },
  { kind: "report", color: "#c4ad80" },
  { kind: "leather", color: "#4f1d1d" },
  { kind: "report", color: "#b89f70" },
  { kind: "leather", color: "#1d2a40" },
  { kind: "leather", color: "#241f1c" },
  { kind: "report", color: "#c9b48a" },
  { kind: "leather", color: "#4a301d" },
];
const GALLERY: Binding[] = [
  { kind: "report", color: "#d9cfba", l1: "#3b332d", l2: "#1f1a17" },
  { kind: "leather", color: "#2a2623" },
  { kind: "report", color: "#c6b594", l1: "#3b332d", l2: "#1f1a17" },
  { kind: "leather", color: "#cfc4ad" },
  { kind: "report", color: "#e2dacb", l1: "#4a4038", l2: "#1f1a17" },
  { kind: "leather", color: "#3a322b" },
  { kind: "report", color: "#d0c3a8", l1: "#3b332d", l2: "#1f1a17" },
  { kind: "leather", color: "#b9aa8c" },
  { kind: "leather", color: "#211d1a" },
];
const BLEND: Binding[] = [
  { kind: "report", color: "#d3c6aa", l1: "#6f2a20", l2: "#1f1a17" },
  { kind: "leather", color: "#2a2623" },
  { kind: "report", color: "#c2ae88", l1: "#6f2a20", l2: "#1f1a17" },
  { kind: "leather", color: "#2c3d33" },
  { kind: "report", color: "#dcd2bd", l1: "#6f2a20", l2: "#1f1a17" },
  { kind: "leather", color: "#4a2622" },
  { kind: "report", color: "#cbbb9c", l1: "#3b332d", l2: "#1f1a17" },
  { kind: "leather", color: "#3a322b" },
  { kind: "leather", color: "#5b4630" },
];
const PAPER_TONES = ["#ece6da", "#e3dccd", "#f1ece2", "#e8e1d3", "#dcd4c4"];

// One texture holds a set's spines side by side: COLS volumes, numbered in
// order, so a run of books on a shelf reads 12, 13, 14… as a bound set does.
// The relief (cloth weave, raised bands, the edges of the labels) is one
// spine, repeated.
const COLS = 12;
const SW = 128;
const SH = 768;
const BANDS = [0.1, 0.34, 0.58, 0.8];
function spineGrain(b: Binding) {
  const n = noise2(300);
  return b.kind === "report"
    ? grainField("aisleCloth", SW, SH, (x, y) => (fbm(n, x / 7, y / 30, 3) - 0.5) * 26 + ((x + y) % 2 ? 3 : -3))
    : grainField("aisleLeather", SW, SH, (x, y) => (fbm(n, x / 5, y / 5, 4) - 0.5) * 30 + (fbm(n, x / 40, y / 60, 2) - 0.5) * 22);
}
function spineAtlas(b: Binding, seed: number, series: string, first: number) {
  const serif = fontVar("--font-serif");
  const grain = spineGrain(b);
  const w = SW;
  const h = SH;
  return canvasTexture(SW * COLS, SH, (g) => {
    g.fillStyle = b.color;
    g.fillRect(0, 0, SW * COLS, SH);
    const img = g.getImageData(0, 0, SW * COLS, SH);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW * COLS; x++) {
        const i = (y * SW * COLS + x) * 4;
        const col = Math.floor(x / SW);
        const v = grain[(((y + (seed + col) * 53) % SH) * SW) + ((x + col * 17) % SW)];
        img.data[i] += v;
        img.data[i + 1] += v * 0.9;
        img.data[i + 2] += v * 0.75;
      }
    }
    g.putImageData(img, 0, 0);
    // wear: lighter at the head, darker at the foot
    const wear = g.createLinearGradient(0, 0, 0, SH);
    wear.addColorStop(0, "rgba(255, 240, 210, 0.14)");
    wear.addColorStop(0.07, "rgba(255, 240, 210, 0)");
    wear.addColorStop(0.95, "rgba(0, 0, 0, 0)");
    wear.addColorStop(1, "rgba(0, 0, 0, 0.2)");
    g.fillStyle = wear;
    g.fillRect(0, 0, SW * COLS, SH);
    for (let col = 0; col < COLS; col++) {
      const num = String(first + col);
      g.save();
      g.translate(col * SW, 0);
      if (b.kind === "report") {
        g.fillStyle = b.l1 ?? "#7d2418";
        g.fillRect(0, h * 0.13, w, h * 0.15);
        g.fillStyle = b.l2 ?? "#1f1a17";
        g.fillRect(0, h * 0.35, w, h * 0.12);
        gilt(g, w, h, seed + col, (l) => {
          [0.135, 0.275, 0.355, 0.465].forEach((f) => l.fillRect(0, h * f, w, 2));
          [0.05, 0.93].forEach((f) => l.fillRect(10, h * f, w - 20, 2));
          l.textAlign = "center";
          l.textBaseline = "middle";
          l.font = `600 25px ${serif}`;
          l.fillText(series, w / 2, h * 0.207);
          l.font = `600 46px ${serif}`;
          l.fillText(num, w / 2, h * 0.414);
        });
      } else {
        // raised bands, with the shadow under each
        BANDS.forEach((f) => {
          g.fillStyle = "rgba(255, 235, 200, 0.14)";
          g.fillRect(0, h * f - 5, w, 4);
          g.fillStyle = "rgba(0, 0, 0, 0.38)";
          g.fillRect(0, h * f + 5, w, 5);
        });
        // the lettering piece, between the first two bands
        g.fillStyle = "rgba(0, 0, 0, 0.32)";
        g.fillRect(10, h * 0.15, w - 20, h * 0.14);
        gilt(g, w, h, seed + col, (l) => {
          BANDS.forEach((f) => {
            l.fillRect(8, h * f - 12, w - 16, 1.5);
            l.fillRect(8, h * f + 16, w - 16, 1.5);
          });
          l.strokeStyle = l.fillStyle;
          l.lineWidth = 1.5;
          l.strokeRect(14, h * 0.155, w - 28, h * 0.13);
          l.textAlign = "center";
          l.textBaseline = "middle";
          l.font = `600 22px ${serif}`;
          l.fillText(series, w / 2, h * 0.19);
          l.font = `600 40px ${serif}`;
          l.fillText(num, w / 2, h * 0.245);
          // a small tool in each lower panel
          [0.46, 0.69].forEach((f) => {
            l.fillRect(w / 2 - 10, h * f, 20, 1.5);
            l.fillRect(w / 2 - 0.75, h * f - 9, 1.5, 20);
          });
        });
      }
      g.restore();
    }
  });
}
function spineBump(b: Binding) {
  const grain = spineGrain(b);
  const t = canvasTexture(SW, SH, (g) => {
    g.fillStyle = "#808080";
    g.fillRect(0, 0, SW, SH);
    const img = g.getImageData(0, 0, SW, SH);
    for (let i = 0; i < SW * SH; i++) {
      const v = grain[i] * 2.2;
      img.data[i * 4] += v;
      img.data[i * 4 + 1] += v;
      img.data[i * 4 + 2] += v;
    }
    g.putImageData(img, 0, 0);
    if (b.kind === "report") {
      g.fillStyle = "#a8a8a8";
      g.fillRect(0, SH * 0.13, SW, SH * 0.15);
      g.fillRect(0, SH * 0.35, SW, SH * 0.12);
    } else {
      BANDS.forEach((f) => {
        const band = g.createLinearGradient(0, SH * f - 9, 0, SH * f + 9);
        band.addColorStop(0, "#808080");
        band.addColorStop(0.5, "#ffffff");
        band.addColorStop(1, "#808080");
        g.fillStyle = band;
        g.fillRect(0, SH * f - 9, SW, 18);
      });
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(COLS, 1);
  return t;
}

function woodTexture(base: string, seed: number, plank = 0) {
  const w = 512;
  const h = 512;
  const n = noise2(seed);
  const grain = grainField(`aisleWood${seed}`, w, h, (x, y) => {
    const ring = Math.sin((y + fbm(n, x / 160, y / 30, 3) * 60) / 3.2) * 0.5;
    return (fbm(n, x / 120, y / 5, 4) - 0.5) * 46 + ring * 9;
  });
  const t = canvasTexture(w, h, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const board = plank ? Math.floor(y / plank) : 0;
      const tone = plank ? ((board * 37) % 11) - 5 : 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = grain[y * w + ((x + board * 131) % w)] + tone * 2.4;
        img.data[i] += v;
        img.data[i + 1] += v * 0.85;
        img.data[i + 2] += v * 0.65;
      }
    }
    g.putImageData(img, 0, 0);
    if (plank) {
      g.fillStyle = "rgba(40, 26, 14, 0.5)";
      for (let y = 0; y < h; y += plank) {
        g.fillRect(0, y, w, 1.5);
        const at = ((y / plank) * 197) % w;
        g.fillRect(at, y, 1.5, plank);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export type Aisle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  // t: down the aisle, and Title 7 off its shelf. turn (0..1): the volume
  // comes away from the shelf and turns its front cover to the camera
  update: (t: number, turn?: number) => void;
  // where Title 7 is on screen: its box, as fractions of the frame
  // (x0, y0, x1, y1; y down)
  heroRect: () => [number, number, number, number];
  dispose: () => void;
};

// t runs 0..1: the camera goes down the aisle and Title 7 comes off its shelf
export function buildAisle(mode: AisleLook = "classic"): Aisle {
  const period = mode === "classic" || mode === "fade";
  const BINDINGS = period ? CLASSIC : mode === "blend" ? BLEND : GALLERY;
  const blend = mode === "blend";
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PAPER, 11, 30);
  const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.05, 80);
  const r = rng(418);

  const HALF = 1.85; // the aisle's half width, to the faces of the shelves
  const NEAR = 4.5; // the side walls run from here, behind the camera…
  const END = -13.2; // …to the bookcase at the far end
  const SHELVES = [0.12, 0.98, 1.84, 2.7, 3.5];
  const TOP = 4.32;
  const DEPTH = 0.42;

  // fade: colour gives way to paper along the aisle
  const fade = <T extends THREE.Material>(mat: T): T => {
    if (mode !== "fade") return mat;
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vWz;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWz = (modelMatrix * vec4(transformed, 1.0)).z;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vWz;")
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\nfloat fk = 1.0 - smoothstep(-10.5, 1.5, vWz);\nfloat fl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\ndiffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(fl), vec3(0.86, 0.83, 0.76), 0.88), fk);",
        );
    };
    return mat;
  };

  // ── materials
  const walnut = woodTexture(mode === "paper" ? "#ebe6db" : period ? "#553a26" : blend ? "#8f6d4a" : "#cdb994", 61);
  walnut.repeat.set(3, 1);
  const wood = fade(new THREE.MeshStandardMaterial({ map: walnut, roughness: mode === "paper" ? 0.9 : 0.55, bumpMap: walnut, bumpScale: 0.4 }));
  const woodDark = fade(new THREE.MeshStandardMaterial({ color: mode === "paper" ? "#dfd9cc" : period ? "#3a281b" : blend ? "#6d5338" : "#bca883", roughness: 0.85 }));
  const oak = woodTexture(mode === "paper" ? "#f0ece3" : period ? "#b08f6c" : blend ? "#c9b393" : "#dccfb8", 97, 64);
  oak.repeat.set(5, 9);
  const floorMat = fade(new THREE.MeshStandardMaterial({ map: oak, roughness: mode === "paper" ? 0.9 : 0.42, metalness: 0.02, bumpMap: oak, bumpScale: 0.25 }));
  const pages = new THREE.MeshStandardMaterial({ map: pageEdges(), roughness: 0.95 });
  const pagesShelf = mode === "paper" ? new THREE.MeshStandardMaterial({ color: "#f4f0e7", roughness: 0.95 }) : fade(new THREE.MeshStandardMaterial({ map: pageEdges(), roughness: 0.95 }));
  // each wall holds one kind of source, lettered on its spines
  const SERIES = ["U.S.C.", "C.F.R.", "CODE"];
  // a binding's volumes are one size wherever the set stands
  const SIZE = [
    { w: 0.084, h: 0.72 },
    { w: 0.07, h: 0.68 },
    { w: 0.08, h: 0.7 },
    { w: 0.074, h: 0.66 },
    { w: 0.086, h: 0.72 },
    { w: 0.068, h: 0.69 },
  ];
  const bindings = BINDINGS.slice(0, SIZE.length);
  const bumps = bindings.map((b) => spineBump(b));
  const sides = bindings.map((b, i) => fade(new THREE.MeshStandardMaterial({ color: mode === "paper" ? PAPER_TONES[i % PAPER_TONES.length] : b.color, roughness: 0.85 })));
  const spineMat = SERIES.map((series, si) =>
    bindings.map((b, i) => {
      if (mode === "paper") return new THREE.MeshStandardMaterial({ color: PAPER_TONES[i % PAPER_TONES.length], bumpMap: bumps[i], bumpScale: 2.2, roughness: 0.92 });
      const map = spineAtlas(b, 500 + si * 31 + i * 7, series, 8 + ((i * 11) % 36));
      return fade(new THREE.MeshStandardMaterial({ map, bumpMap: bumps[i], bumpScale: b.kind === "leather" ? 1.6 : 0.9, roughness: b.kind === "leather" ? 0.5 : 0.82 }));
    }),
  );

  // ── one bookcase wall, built along x with its spines to +z, then turned
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const put = (key: string, mat: THREE.Material, geo: THREE.BufferGeometry) => {
    const b = buckets.get(key) ?? { mat, geos: [] };
    b.geos.push(geo);
    buckets.set(key, b);
  };
  const faces = (flat: THREE.BufferGeometry, groups: number[]) => {
    const out = new THREE.BufferGeometry();
    const picked = groups.map((gi) => flat.groups.find((x) => x.materialIndex === gi)!);
    for (const name of ["position", "normal", "uv"]) {
      const at = flat.getAttribute(name) as THREE.BufferAttribute;
      const len = picked.reduce((a, g) => a + g.count, 0) * at.itemSize;
      const arr = new Float32Array(len);
      let o = 0;
      for (const g of picked) {
        arr.set((at.array as Float32Array).subarray(g.start * at.itemSize, (g.start + g.count) * at.itemSize), o);
        o += g.count * at.itemSize;
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize));
    }
    return out;
  };
  // the slot Title 7 stands in, in the end wall's own x
  const T7 = { x: 0, w: 0.15, h: 0.74, row: 1 };

  const wall = (len: number, m: THREE.Matrix4, slot: boolean, plates: string[], series: number) => {
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, key: string) => {
      const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      // wood runs along the long side
      g.translate(x, y, z);
      g.applyMatrix4(m);
      put(key, mat, g);
    };
    // carcass: back, boards, uprights every bay, plinth and cornice
    box(len, TOP, 0.03, 0, TOP / 2, -DEPTH / 2, woodDark, "back");
    SHELVES.forEach((y) => box(len, 0.045, DEPTH, 0, y - 0.0225, 0, wood, "wood"));
    box(len, 0.12, DEPTH + 0.04, 0, 0.06, 0.02, wood, "wood");
    box(len, 0.11, DEPTH + 0.1, 0, TOP + 0.055, 0.05, wood, "wood");
    box(len, 0.05, DEPTH + 0.16, 0, TOP + 0.135, 0.08, wood, "wood");
    const BAY = 1.72;
    const bays = Math.max(1, Math.round(len / BAY));
    const bw = len / bays;
    for (let i = 0; i <= bays; i++) box(0.06, TOP, DEPTH + 0.02, -len / 2 + i * bw, TOP / 2, 0.01, wood, "wood");
    // a brass plate on each bay, at eye level
    for (let i = 0; i < bays; i++) {
      const name = plates[i % plates.length];
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.072), mode === "paper" ? new THREE.MeshStandardMaterial({ color: "#f6f2ea", roughness: 0.9 }) : new THREE.MeshStandardMaterial({ map: plaque(name), metalness: 0.7, roughness: 0.32 }));
      p.position.set(-len / 2 + (i + 0.5) * bw, SHELVES[2] - 0.0225, DEPTH / 2 + 0.004);
      p.applyMatrix4(m);
      scene.add(p);
    }
    // the volumes: bound sets, upright, their fronts in one line, each bay
    // filled from upright to upright, each set numbered in order
    const GAP = 0.003;
    const D = 0.3;
    SHELVES.forEach((sy, ri) => {
      const room = (SHELVES[ri + 1] ?? TOP) - sy - 0.07;
      for (let i = 0; i < bays; i++) {
        const x0 = -len / 2 + i * bw + 0.036;
        const x1 = -len / 2 + (i + 1) * bw - 0.036;
        // Title 7's slot splits its bay in two
        const cut = slot && ri === T7.row && x0 < T7.x && x1 > T7.x;
        const spans = cut ? [[x0, T7.x - T7.w / 2 - 0.006], [T7.x + T7.w / 2 + 0.006, x1]] : [[x0, x1]];
        for (const [a, b] of spans) {
          const L = b - a;
          const books: Array<{ bi: number; col: number; w: number }> = [];
          let used = 0;
          let last = -1;
          let full = false;
          while (!full) {
            let bi = Math.floor(r() * bindings.length);
            if (bi === last) bi = (bi + 1) % bindings.length;
            const w = SIZE[bi].w;
            // no room for a set of three: the last set runs on to the upright
            const tail = L - used < 3 * (w + GAP) && books.length > 0;
            const run = tail ? COLS : 4 + Math.floor(r() * 6);
            const from = tail ? books[books.length - 1] : null;
            const set = from ? from.bi : bi;
            let col = from ? from.col + 1 : Math.floor(r() * (COLS - run + 1));
            for (let k = 0; k < run; k++, col++) {
              if (used + SIZE[set].w > L || col >= COLS) {
                full = true;
                break;
              }
              books.push({ bi: set, col, w: SIZE[set].w });
              used += SIZE[set].w + GAP;
            }
            if (tail) full = true;
            last = set;
          }
          // spread what is left over the volumes, so the row ends on the upright
          const f = (L - GAP * (books.length - 1)) / books.reduce((s, k) => s + k.w, 0);
          let x = a;
          for (const k of books) {
            const bwid = k.w * f;
            const h = Math.min(room, SIZE[k.bi].h);
            const geo = new RoundedBoxGeometry(bwid, h, D, 2, 0.006);
            const flat = geo.index ? geo.toNonIndexed() : geo;
            if (flat !== geo) geo.dispose();
            const spine = faces(flat, [4]);
            const uv = spine.getAttribute("uv") as THREE.BufferAttribute;
            for (let v = 0; v < uv.count; v++) uv.setX(v, (k.col + Math.min(0.985, Math.max(0.015, uv.getX(v)))) / COLS);
            const rest = [faces(flat, [0, 1, 3, 5]), faces(flat, [2]), spine];
            const at = new THREE.Matrix4().makeTranslation(x + bwid / 2, sy + h / 2, DEPTH / 2 - D / 2 - 0.025).premultiply(m);
            rest.forEach((g) => g.applyMatrix4(at));
            put(`side${k.bi}`, sides[k.bi], rest[0]);
            put("pages", pagesShelf, rest[1]);
            put(`spine${series}_${k.bi}`, spineMat[series][k.bi], rest[2]);
            flat.dispose();
            x += bwid + GAP;
          }
        }
      }
    });
  };

  const sideLen = NEAR - END;
  const midZ = (NEAR + END) / 2;
  wall(sideLen, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(-HALF - DEPTH / 2, 0, midZ), false, ["CODE OF FEDERAL REGULATIONS"], 1);
  wall(sideLen, new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(HALF + DEPTH / 2, 0, midZ), false, ["STATE CODES"], 2);
  const endM = new THREE.Matrix4().makeTranslation(0, 0, END);
  wall(HALF * 2 + DEPTH * 2, endM, true, ["UNITED STATES CODE"], 0);

  const disposables: Array<{ dispose: () => void }> = [];
  buckets.forEach(({ mat, geos }) => {
    const merged = mergeGeometries(geos);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    geos.forEach((g) => g.dispose());
    disposables.push(merged, mat);
  });

  // ── the floor, and a runner down the middle of it
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -6);
  floor.receiveShadow = true;
  scene.add(floor);
  const runner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, sideLen - 1.2),
    new THREE.MeshStandardMaterial({
      roughness: 0.95,
      map: canvasTexture(256, 1024, (g) => {
        g.fillStyle = "#532619";
        g.fillRect(0, 0, 256, 1024);
        const n = noise2(12);
        const img = g.getImageData(0, 0, 256, 1024);
        for (let y = 0; y < 1024; y++) {
          for (let x = 0; x < 256; x++) {
            const i = (y * 256 + x) * 4;
            const v = (fbm(n, x / 3, y / 3, 2) - 0.5) * 30;
            img.data[i] += v;
            img.data[i + 1] += v * 0.7;
            img.data[i + 2] += v * 0.5;
          }
        }
        g.putImageData(img, 0, 0);
        g.strokeStyle = "rgba(226, 186, 110, 0.7)";
        g.lineWidth = 5;
        g.strokeRect(16, 16, 224, 992);
        g.lineWidth = 2;
        g.strokeRect(28, 28, 200, 968);
      }),
    }),
  );
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.004, midZ + 0.2);
  runner.receiveShadow = true;
  if (mode === "classic") scene.add(runner);

  // ── Title 7, in the end bookcase at eye level
  const ln = noise2(91);
  const leatherGrain = grainField("leather", 512, 960, (x, y) => (fbm(ln, x / 9, y / 9, 4) - 0.5) * 34 + (fbm(ln, x / 70, y / 90, 2) - 0.5) * 24);
  const coverTex = canvasTexture(512, 960, (g) => {
    g.fillStyle = "#7a3a12";
    g.fillRect(0, 0, 512, 960);
    const img = g.getImageData(0, 0, 512, 960);
    for (let y = 0; y < 960; y++) {
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4;
        const v = leatherGrain[y * 512 + x];
        img.data[i] += v;
        img.data[i + 1] += v * 0.7;
        img.data[i + 2] += v * 0.45;
      }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = "rgba(226, 186, 110, 0.6)";
    g.lineWidth = 5;
    g.strokeRect(34, 34, 444, 892);
  });
  const leather = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.55, bumpMap: coverTex, bumpScale: 1.2 });
  const t7 = new THREE.Mesh(new RoundedBoxGeometry(T7.w, T7.h, 0.32, 2, 0.009), [
    leather,
    leather,
    pages,
    leather,
    new THREE.MeshStandardMaterial({ map: heroSpine(), roughness: 0.45 }),
    leather,
  ]);
  t7.castShadow = t7.receiveShadow = true;
  scene.add(t7);
  const heroAt = new THREE.Vector3(T7.x, SHELVES[T7.row] + T7.h / 2, END + DEPTH / 2);
  const pose = (out: number, tip: number, turn: number) => {
    t7.rotation.set(tip * (1 - turn), (-turn * Math.PI) / 2, 0);
    t7.position.set(T7.x, SHELVES[T7.row] + (T7.h / 2) * Math.cos(tip * (1 - turn)) + 0.06 * turn, END + DEPTH / 2 - 0.18 + out + 0.45 * turn + (T7.h / 2) * Math.sin(tip * (1 - turn)));
  };

  // ── pendant lamps down the aisle: a brass shade, a warm bulb, a pool of light
  const brass = new THREE.MeshStandardMaterial({ color: "#a9853f", metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: "#fff1d0" });
  const cord = new THREE.MeshStandardMaterial({ color: "#2a2018", roughness: 0.8 });
  const LAMPS = [1.4, -2.4, -6.2, -10];
  if (mode !== "classic" && !blend) LAMPS.length = 0;
  LAMPS.forEach((z, i) => {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.17, 32, 1, true), brass);
    shade.position.set(0, 3.52, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), glow);
    bulb.position.set(0, 3.45, z);
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 4, 6), cord);
    line.position.set(0, 5.6, z);
    scene.add(shade, bulb, line);
    const lamp = new THREE.SpotLight("#ffd9a8", blend ? 20 : 34, 9, 0.95, 0.75, 1.6);
    lamp.position.set(0, 3.44, z);
    lamp.target.position.set(0, 0, z);
    // the two nearest the camera cast the shadows the eye reads
    if (i < 2) {
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(1024, 1024);
      lamp.shadow.radius = 6;
      lamp.shadow.bias = -0.0006;
    }
    scene.add(lamp, lamp.target);
  });
  // the light that picks out Title 7
  const pick = new THREE.SpotLight("#ffb866", 0, 7, 0.2, 0.7, 1.4);
  pick.position.set(0.5, 3.3, END + 3.2);
  pick.target.position.copy(heroAt);
  pick.castShadow = true;
  pick.shadow.mapSize.set(1024, 1024);
  pick.shadow.radius = 5;
  pick.shadow.bias = -0.0006;
  scene.add(pick, pick.target);
  // daylight from above and behind: the room is open to the page
  scene.add(mode === "classic" ? new THREE.HemisphereLight("#fff8ec", "#b89f80", 0.8) : new THREE.HemisphereLight("#ffffff", mode === "paper" ? "#e6dfd2" : "#cfc2ab", mode === "paper" ? 1.25 : blend ? 1.05 : 1.45));
  const sun = new THREE.DirectionalLight(mode === "classic" ? "#fff3df" : "#fffaf2", mode === "classic" ? 1.15 : mode === "paper" ? 1.5 : blend ? 1.35 : 1.9);
  // without the lamps the light comes straight down the aisle, so
  // neither wall stands in the other's shadow
  if (mode === "classic") sun.position.set(2.4, 9, 6);
  else sun.position.set(0.5, 11, 3);
  sun.target.position.set(0, 0, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.far = 30;
  sun.shadow.radius = 7;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  if (mode !== "classic") {
    const front = new THREE.DirectionalLight("#fffaf2", 0.75);
    front.position.set(0, 2.5, 9);
    front.target.position.set(0, 1.6, -6);
    scene.add(front, front.target);
  }

  // ── the move: down the aisle to Title 7, which comes off its shelf
  const camFrom = new THREE.Vector3(0.15, 1.7, 3.9);
  // the camera stops well back from the end bookcase, with the whole case
  // in view. Title 7 stays in its row: only the light on it grows.
  const camTo = new THREE.Vector3(0.05, 1.52, END + 4.6);
  const aimFrom = new THREE.Vector3(0, 1.45, END);
  const aimTo = new THREE.Vector3(0, 1.5, END);
  const aim = new THREE.Vector3();
  const update = (t: number, turn = 0) => {
    const c = ease(seg(t, 0, 1));
    camera.position.lerpVectors(camFrom, camTo, c);
    aim.lerpVectors(aimFrom, aimTo, ease(seg(t, 0.15, 0.85)));
    camera.lookAt(aim);
    pick.intensity = lerp(18, 85, ease(seg(t, 0.35, 1)));
    pose(0, 0, ease(turn));
  };
  update(0);

  const corner = new THREE.Vector3();
  const heroRect = (): [number, number, number, number] => {
    t7.updateMatrixWorld();
    camera.updateMatrixWorld();
    let x0 = 1;
    let y0 = 1;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < 8; i++) {
      corner.set(((i & 1 ? 1 : -1) * T7.w) / 2, ((i & 2 ? 1 : -1) * T7.h) / 2, (i & 4 ? 1 : -1) * 0.16).applyMatrix4(t7.matrixWorld).project(camera);
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    return [(x0 + 1) / 2, (1 - y1) / 2, (x1 + 1) / 2, (1 - y0) / 2];
  };

  return {
    scene,
    camera,
    update,
    heroRect,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
    },
  };
}
