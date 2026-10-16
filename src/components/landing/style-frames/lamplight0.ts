// Direction A — LAMPLIGHT, the opening frame: the reading room. A wall
// of law books under one lamp; the shelves carry the real kinds of
// official source; Title 7 · Agriculture, the amber volume, is half off
// the shelf. Dust hangs in the lamplight.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { canvasTexture, ease, fbm, fontVar, grainField, lerp, noise2, particleGeometry, particleMaterial, rng, seg, W, H, type BeatCtx, type BeatSpec, type Look, themedLook, THEME } from "./kit";

// muted buckram: oxblood, tan, slate, sage, dark brown
const CLOTH = ["#4a1f19", "#5b3a26", "#3a3f46", "#3f4636", "#2e231b", "#6a4a2e", "#55302a", "#2f3338"];

// Gold foil stamped into the cloth, the way real bindings are lettered:
// no label patch. The lettering is drawn on its own layer, worn with a
// speckle of missing foil, then pressed in (a dark edge above-left, a
// faint light edge below-right).
function gilt(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  paint: (l: CanvasRenderingContext2D) => void,
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const l = c.getContext("2d")!;
  const gold = l.createLinearGradient(0, 0, w, 0);
  gold.addColorStop(0, "#a8803e");
  gold.addColorStop(0.45, "#e9cc8a");
  gold.addColorStop(0.55, "#f3dca2");
  gold.addColorStop(1, "#9a733a");
  l.fillStyle = gold;
  l.strokeStyle = gold;
  paint(l);
  // worn foil: small flecks where the gold has rubbed off
  const r = rng(seed * 7 + 3);
  l.globalCompositeOperation = "destination-out";
  for (let i = 0; i < (w * h) / 90; i++) {
    l.globalAlpha = 0.25 + r() * 0.6;
    l.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.6);
  }
  l.globalAlpha = 1;
  l.globalCompositeOperation = "source-over";
  // pressed into the cloth
  g.save();
  g.globalAlpha = 0.55;
  g.filter = "brightness(0)";
  g.drawImage(c, -1, -1);
  g.filter = "none";
  g.globalAlpha = 0.18;
  g.drawImage(c, 1, 1);
  g.globalAlpha = 0.92;
  g.drawImage(c, 0, 0);
  g.restore();
}

function spine(color: string, seed: number, label: string | null) {
  const cn = noise2(200);
  const cloth = grainField("cloth", 96, 768, (x, y) => (fbm(cn, x / 10, y / 40, 3) - 0.5) * 22);
  const w = 96;
  const h = 768;
  const serif = fontVar("--font-serif");
  const n = noise2(seed);
  return canvasTexture(w, h, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = cloth[(((y + seed * 37) % h) * w) + x];
        img.data[i] += v;
        img.data[i + 1] += v;
        img.data[i + 2] += v;
      }
    }
    g.putImageData(img, 0, 0);
    gilt(g, w, h, seed, (l) => {
      [0.07, 0.09, 0.9, 0.92].forEach((f) => l.fillRect(6, h * f, w - 12, 2.5));
      if (label) {
        // thin rules frame the title, stamped like the bands
        l.fillRect(14, h * 0.19, w - 28, 1.5);
        l.fillRect(14, h * 0.37, w - 28, 1.5);
        l.save();
        l.translate(w / 2, h * 0.28);
        l.rotate(Math.PI / 2);
        l.font = `600 28px ${serif}`;
        l.textAlign = "center";
        l.textBaseline = "middle";
        l.fillText(label, 0, 0);
        l.restore();
      }
    });
  });
}

export function heroSpine() {
  const hn = noise2(77);
  const heroGrain = grainField("heroSpine", 160, 1024, (x, y) => (fbm(hn, x / 12, y / 50, 3) - 0.5) * 26);
  const w = 160;
  const h = 1024;
  const serif = fontVar("--font-serif");
  const mono = fontVar("--font-mono");
  const n = noise2(77);
  return canvasTexture(w, h, (g) => {
    g.fillStyle = "#7e3f12";
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = heroGrain[y * w + x];
        img.data[i] += v;
        img.data[i + 1] += v * 0.8;
        img.data[i + 2] += v * 0.6;
      }
    }
    g.putImageData(img, 0, 0);
    gilt(g, w, h, 77, (l) => {
      [0.06, 0.075, 0.925, 0.94].forEach((f) => l.fillRect(8, h * f, w - 16, 3));
      // double rules above and below the title, as on a bound Code volume
      [0.13, 0.14, 0.64, 0.65].forEach((f) => l.fillRect(18, h * f, w - 36, 1.6));
      l.save();
      l.translate(w / 2, h * 0.39);
      l.rotate(Math.PI / 2);
      l.textAlign = "center";
      l.textBaseline = "middle";
      l.font = `500 24px ${mono}`;
      l.fillText("UNITED STATES CODE", 0, -36);
      l.font = `600 62px ${serif}`;
      l.fillText("TITLE 7", 0, 12);
      l.font = `italic 400 34px ${serif}`;
      l.fillText("Agriculture", 0, 54);
      l.restore();
      l.font = `600 66px ${serif}`;
      l.textAlign = "center";
      l.fillText("7", w / 2, h * 0.8);
    });
  });
}

function pageEdges() {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = "#d9ccb2";
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = "rgba(90, 70, 40, 0.18)";
    for (let y = 2; y < 64; y += 3) g.fillRect(0, y, 256, 1);
  });
}

function plaque(text: string) {
  const mono = fontVar("--font-mono");
  return canvasTexture(1024, 160, (g) => {
    g.fillStyle = "#a9853f";
    g.fillRect(0, 0, 1024, 160);
    g.strokeStyle = "rgba(60, 40, 10, 0.6)";
    g.lineWidth = 6;
    g.strokeRect(10, 10, 1004, 140);
    g.fillStyle = "#3a2a10";
    g.font = `600 64px ${mono}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 512, 84);
  });
}

export function lamplightShelf(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  camera.position.set(-2.5, 1.62, 3.9);
  camera.lookAt(0.75, 1.2, -0.1);
  const r = rng(101);

  // the row above Title 7 sits high enough that the volume, tipped as it
  // comes out, clears the board above it
  const SHELVES = [0.0, 1.05, 2.22];
  const ROW = 1; // Title 7 sits at eye level
  const T7 = { x: 0.35, w: 0.17, h: 0.96 };
  const heroAt = new THREE.Vector3(T7.x, SHELVES[ROW] + T7.h / 2, 0.36);
  const focus = camera.position.distanceTo(heroAt);
  const look: Look = themedLook({
    background: "#050302",
    exposure: 1.05,
    shadows: true,
    dof: { focus, aperture: 0.001, maxblur: 0.005 },
    bloom: { strength: 0.45, radius: 0.5, threshold: 0.9 },
    grain: 0.05,
    vignette: 0.6,
  });
  const { scene, fx } = ctx;
  scene.fog = new THREE.FogExp2(THEME.paper ? "#ffffff" : "#050302", 0.08);

  // the carcass: back panel, shelf boards, uprights
  const wood = new THREE.MeshStandardMaterial({ color: "#2b1a10", roughness: 0.6 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), new THREE.MeshStandardMaterial({ color: "#1a120c", roughness: 0.9 }));
  back.position.set(0, 1.4, -0.32);
  back.receiveShadow = true;
  // on paper there is no wall: the shelves stand on the page
  if (!THEME.paper) scene.add(back);
  SHELVES.forEach((y) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(30, 0.05, 0.64), wood);
    b.position.set(0, y - 0.025, 0);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  });
  const BAYS = [
    { x0: -6.4, x1: -2.3, name: "CODE OF FEDERAL REGULATIONS" },
    { x0: -2.2, x1: 1.9, name: "UNITED STATES CODE" },
    { x0: 2.0, x1: 6.1, name: "STATE CODES" },
    { x0: 6.2, x1: 10.3, name: "POLICY MANUALS" },
  ];
  BAYS.forEach((bay) => {
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.3, 0.64), wood);
    up.position.set(bay.x0 - 0.05, 1.45, 0);
    up.castShadow = up.receiveShadow = true;
    scene.add(up);
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.097),
      new THREE.MeshStandardMaterial({ map: plaque(bay.name), metalness: 0.65, roughness: 0.35 }),
    );
    // in Title 7's bay the plate sits to the right of the pulled volume
    p.position.set(bay.name === "UNITED STATES CODE" ? T7.x + 0.56 : (bay.x0 + bay.x1) / 2, SHELVES[ROW] - 0.026, 0.322);
    scene.add(p);
  });

  // the books
  const edges = pageEdges();
  // spine labels: real titles and parts, spread so no two neighbours match
  const LABELS = ["TITLE 26", null, "PART 273", "TITLE 42", null, "TITLE 8", "VOL. II", null, "TITLE 29", "PART 435", null, "TITLE 38", "TITLE 12", null, "PART 271", "TITLE 2", null, "VOL. I", "TITLE 45", null, "TITLE 20", "PART 1", null, "TITLE 5"];
  const variants = LABELS.map((lb, i) => spine(CLOTH[i % CLOTH.length], 200 + i, lb));
  const plainSide = CLOTH.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const topMat = new THREE.MeshStandardMaterial({ map: edges, roughness: 0.95 });
  const spineMats = variants.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.75 }));
  // the shelves never move: their books are merged into one mesh per
  // material, a few dozen draws in place of several thousand
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const addFaces = (key: string, mat: THREE.Material, flat: THREE.BufferGeometry, groups: number[]) => {
    const parts = groups.map((gi) => {
      const g = flat.groups.find((x) => x.materialIndex === gi)!;
      const sub = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const at = flat.getAttribute(name) as THREE.BufferAttribute;
        sub.setAttribute(name, new THREE.BufferAttribute(at.array.slice(g.start * at.itemSize, (g.start + g.count) * at.itemSize), at.itemSize));
      }
      return sub;
    });
    const bucket = buckets.get(key) ?? { mat, geos: [] };
    bucket.geos.push(...parts);
    buckets.set(key, bucket);
  };
  SHELVES.forEach((sy, ri) => {
    BAYS.forEach((bay) => {
      // Title 7's slot: kept empty, a little wider than the volume
      const slot = ri === ROW && bay.name === "UNITED STATES CODE" ? [T7.x - T7.w / 2 - 0.008, T7.x + T7.w / 2 + 0.008] : null;
      let x = bay.x0 + 0.04;
      while (x < bay.x1 - 0.1) {
        const w = 0.07 + r() * 0.08;
        const h = 0.72 + r() * 0.22;
        if (slot && x < slot[1] && x + w > slot[0]) {
          x = slot[1] + 0.004;
          continue;
        }
        if (x + w > bay.x1) break;
        const vi = Math.floor(r() * variants.length);
        const v = vi % CLOTH.length;
        const geo = new RoundedBoxGeometry(w, h, 0.5, 2, 0.008);
        geo.translate(x + w / 2, sy + h / 2, 0.02 + (r() - 0.5) * 0.03);
        // (a rounded box is already a plain triangle list)
        const flat = geo.index ? geo.toNonIndexed() : geo;
        if (flat !== geo) geo.dispose();
        // faces by material: sides (0, 1, 3, 5), the page edges (2), the spine (4)
        addFaces(`side${v}`, plainSide[v], flat, [0, 1, 3, 5]);
        addFaces("top", topMat, flat, [2]);
        addFaces(`spine${vi}`, spineMats[vi], flat, [4]);
        flat.dispose();
        x += w + 0.004 + (r() < 0.05 ? 0.05 : 0);
      }
    });
  });

  buckets.forEach(({ mat, geos }) => {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    geos.forEach((g) => g.dispose());
  });

  // Title 7, half off the shelf, tipped toward us
  // the covers: grained leather with a blind-tooled gilt border
  const ln = noise2(91);
  const leatherGrain = grainField("leather", 512, 960, (x, y) => (fbm(ln, x / 9, y / 9, 4) - 0.5) * 34 + (fbm(ln, x / 70, y / 90, 2) - 0.5) * 24);
  const coverTex = canvasTexture(512, 960, (g) => {
    g.fillStyle = "#6e3510";
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
    g.strokeStyle = "rgba(226, 186, 110, 0.55)";
    g.lineWidth = 5;
    g.strokeRect(34, 34, 444, 892);
    g.strokeStyle = "rgba(226, 186, 110, 0.3)";
    g.lineWidth = 2;
    g.strokeRect(48, 48, 416, 864);
  });
  const leather = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.6 });
  const t7 = new THREE.Mesh(new RoundedBoxGeometry(T7.w, T7.h, 0.52, 2, 0.01), [
    leather,
    leather,
    topMat,
    leather,
    new THREE.MeshStandardMaterial({ map: heroSpine(), roughness: 0.5 }),
    leather,
  ]);
  // pulled straight out of its slot (out 0 → 0.24), its top tipped toward
  // us (tip 0 → 0.09); the bottom stays on the board
  const pose = (out: number, tip: number) => {
    t7.rotation.set(tip, 0, 0);
    t7.position.set(T7.x, SHELVES[ROW] + (T7.h / 2) * Math.cos(tip), 0.02 + out + (T7.h / 2) * Math.sin(tip));
  };
  pose(0.22, 0.09);
  t7.castShadow = t7.receiveShadow = true;
  scene.add(t7);

  // dust in the lamplight
  const lampFrom = new THREE.Vector3(-3.4, 4.2, 3.2);
  const dust = particleGeometry(2600, (i, o) => {
    const t = r();
    const p = lampFrom.clone().lerp(heroAt, 0.35 + t * 0.75);
    o.p.set(p.x + (r() - 0.5) * 1.6, p.y + (r() - 0.5) * 1.2, p.z + (r() - 0.5) * 1.4);
    o.c.set("#ffe3b8").multiplyScalar(0.6 + r() * 0.6);
    o.size = 0.006 + r() * 0.008;
    o.alpha = 0.35 + r() * 0.4;
  });
  const dustPoints = new THREE.Points(dust, particleMaterial({ focus, aperture: 3 }));
  fx.add(dustPoints);

  // one lamp, warm, from the upper left; a low glow from the right
  const lamp = new THREE.SpotLight("#ffd2a0", 95, 20, 0.38, 0.9, 2);
  lamp.position.copy(lampFrom);
  lamp.target.position.copy(heroAt);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.radius = 8;
  lamp.shadow.blurSamples = 16;
  lamp.shadow.bias = -0.0004;
  scene.add(lamp, lamp.target);
  const fill = new THREE.PointLight("#ff9a50", 3.5, 12, 2);
  fill.position.set(3.5, 2.2, 2.2);
  scene.add(fill);
  scene.add(new THREE.AmbientLight("#ffe2c0", THEME.paper ? 0.9 : 0.03));
  // the motion: the camera drifts in from across the room while the
  // volume comes out of its slot; dust drifts in the lamp's beam
  const camFrom = new THREE.Vector3(-3.9, 1.95, 6.4);
  const camTo = camera.position.clone();
  const aimFrom = new THREE.Vector3(0.2, 1.35, -0.2);
  const aimTo = new THREE.Vector3(0.75, 1.2, -0.1);
  const update = (t: number) => {
    const c = ease(t);
    camera.position.lerpVectors(camFrom, camTo, c);
    camera.lookAt(new THREE.Vector3().lerpVectors(aimFrom, aimTo, c));
    const pull = ease(seg(t, 0.3, 0.92));
    pose(lerp(0, 0.22, pull), lerp(0, 0.09, ease(seg(t, 0.45, 0.95))));
    dustPoints.position.set(t * 0.12, -t * 0.08, 0);
    look.dof!.focus = camera.position.distanceTo(heroAt);
  };
  return {
    camera,
    look,
    update,
    parts: { t7, lamp, fill, heroAt, slot: { x: T7.x, y: SHELVES[ROW], front: 0.3 } },
  };
}
