// Direction A — LAMPLIGHT. Night, one warm key light, real depth of
// field. The law is a physical book; its pages lift off and come apart
// into letters of light, which stream away into the dark. The graph is
// made of the same light.

import * as THREE from "three";
import { GRAPH_EDGES, GRAPH_NODES } from "../journey-digital/data";
import { contentsPage, STATUTE_TEXT, typesetPages } from "./pages";
import { BOOK } from "./book-text";
import { heroSpine } from "./lamplight0";
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
  grainField,
  lerp,
  patchBackFace,
  seg,
  sortedRandoms,
  type BeatCtx,
  type BeatSpec,
  type Look, themed, themedLook, THEME } from "./kit";

const AMBER = new THREE.Color("#ffab4a");
const CREAM = new THREE.Color("#fff0d4");
// the stream of letters keeps one warm yellow from the page to its cell
const STREAM = new THREE.Color("#ffc870");

// A page breaks into square cells from its leading edge — digitized, not
// burnt. The cell pattern is baked once (R: when each cell leaves, G: the
// hairline grid); a shader cuts it at any amount, and cells about to
// leave glow pale gold.
function dissolveField(seed: number) {
  const w = 256;
  const h = 352;
  const cell = 8;
  const n = noise2(seed);
  const tex = canvasTexture(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        const jitter = ((cx * 7919 + cy * 104729 + seed * 31) % 97) / 97;
        // read top down: the head of the page comes apart first, line by
        // line, with a little noise so the edge is not a ruler
        const v = (1 - (cy * cell) / h) * 0.86 + fbm(n, cx / 5, cy / 5, 2) * 0.22 + jitter * 0.08;
        const i = (y * w + x) * 4;
        img.data[i] = Math.round(Math.min(1, v / 1.4) * 255);
        img.data[i + 1] = x % cell === 0 || y % cell === 0 ? 255 : 0;
        img.data[i + 2] = 0;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function dissolveMaterial(map: THREE.Texture, field: THREE.Texture, back: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    // the breaking edge glows at night; on paper it is a dark burn instead
    emissive: THEME.paper ? new THREE.Color(0, 0, 0) : new THREE.Color("#ffe6b8").multiplyScalar(1.5),
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const uAmount = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    patchBackFace(sh, back);
    sh.uniforms.uField = { value: field };
    sh.uniforms.uAmount = uAmount;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uField;\nuniform float uAmount;")
      .replace(
        "#include <alphatest_fragment>",
        `vec4 fld = texture2D(uField, vMapUv);
        // whole at amount 0, gone at 1 (the field runs to ~1.27)
        float dd = 1.3 - uAmount * 1.32 - fld.r * 1.4;
        if (dd <= 0.0 || (fld.g > 0.5 && dd < 0.14)) discard;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        THEME.paper
          ? "diffuseColor.rgb *= 1.0 - 0.75 * ((dd > 0.0 && dd < 0.14) ? pow(1.0 - dd / 0.14, 1.5) : 0.0);"
          : "totalEmissiveRadiance = emissive * ((dd > 0.0 && dd < 0.14) ? pow(1.0 - dd / 0.14, 1.5) : 0.0);",
      );
  };
  return { mat, uAmount };
}

// the front cover: grained leather, a gilt border, the title stamped in gilt
function coverFace(title = true) {
  const serif = fontVar("--font-serif");
  const mono = fontVar("--font-mono");
  const n = noise2(91);
  const w = 700;
  const h = 960;
  const coverGrain = grainField("cover", w, h, (x, y) => (fbm(n, x / 9, y / 9, 4) - 0.5) * 34 + (fbm(n, x / 70, y / 90, 2) - 0.5) * 24);
  return canvasTexture(w, h, (g) => {
    g.fillStyle = "#6e3510";
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = coverGrain[y * w + x];
        img.data[i] += v;
        img.data[i + 1] += v * 0.7;
        img.data[i + 2] += v * 0.45;
      }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = "rgba(226, 186, 110, 0.6)";
    g.lineWidth = 6;
    g.strokeRect(40, 40, w - 80, h - 80);
    g.strokeStyle = "rgba(226, 186, 110, 0.32)";
    g.lineWidth = 2;
    g.strokeRect(56, 56, w - 112, h - 112);
    if (!title) return;
    g.fillStyle = "#e6c893";
    g.textAlign = "center";
    g.font = `500 30px ${mono}`;
    g.fillText("UNITED STATES CODE", w / 2, 300);
    g.font = `600 96px ${serif}`;
    g.fillText("TITLE 7", w / 2, 420);
    g.fillRect(w / 2 - 90, 455, 180, 3);
    g.font = `italic 400 54px ${serif}`;
    g.fillText("Agriculture", w / 2, 530);
  });
}

// a page as a bent sheet: lifted, tilted, curled
function sheet(width: number, depth: number, curl: number, flutter: number, seed: number) {
  const geo = new THREE.PlaneGeometry(width, depth, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / width + 0.5; // 0 at the gutter side, 1 at the fore-edge
    const z = pos.getZ(i) / depth;
    pos.setY(i, pos.getY(i) + curl * x * x + flutter * Math.sin(z * 5 + seed) * x);
  }
  geo.computeVertexNormals();
  return geo;
}

export function lamplightBeat1(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
  camera.position.set(-2.7, 3.9, 8.6);
  camera.lookAt(0.55, 1.5, -1.3);
  const focus = camera.position.distanceTo(new THREE.Vector3(1.4, 0.7, 0.4));
  const look: Look = themedLook({
    background: "#080605",
    exposure: 1.05,
    shadows: true,
    dof: { focus, aperture: 0.0016, maxblur: 0.005 },
    bloom: { strength: 0.55, radius: 0.45, threshold: 0.92 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  // far things fade into the night, or on paper into the page
  // (thin on paper: a white haze would bleach the far shelves)
  scene.fog = new THREE.FogExp2(THEME.paper ? "#ffffff" : "#080605", THEME.paper ? 0.008 : 0.03);

  // the table
  const wood = noise2(11);
  const woodGrain = grainField("wood", 1024, 1024, (x, y) => 20 + fbm(wood, x / 300, y / 18, 4) * 26);
  const tableTex = canvasTexture(1024, 1024, (g) => {
    const img = g.createImageData(1024, 1024);
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const v = woodGrain[y * 1024 + x];
        const i = (y * 1024 + x) * 4;
        img.data[i] = v * 1.25;
        img.data[i + 1] = v * 0.92;
        img.data[i + 2] = v * 0.7;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  // dense enough to stay sharp right under the camera; mirrored, so the
  // tiles meet without a seam
  tableTex.wrapS = tableTex.wrapT = THREE.MirroredRepeatWrapping;
  tableTex.repeat.set(10, 10);
  // on paper there is no table: only the shadow the book casts on it,
  // so the book rests on the page itself
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    THEME.paper
      ? new THREE.ShadowMaterial({ color: "#5a3c22", opacity: 0.22 })
      : new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.5, metalness: 0 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  // the book — a rig that can close: the left half (board, page block,
  // contents page) swings on a hinge at the gutter; a spine joins the
  // boards when it is shut. Open, it is the spread at § 2017.
  const book = new THREE.Group();
  book.position.set(1.45, 0.004, 1.0);
  book.rotation.y = 0.22;
  scene.add(book);
  const cloth = new THREE.MeshStandardMaterial({ color: "#4a2312", roughness: 0.75 });
  // the book's head is at −z (the pages read that way): turn the cover's
  // print to match
  const frontTex = coverFace();
  frontTex.center.set(0.5, 0.5);
  frontTex.rotation = Math.PI;
  const frontCover = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.6 });
  const backCover = new THREE.MeshStandardMaterial({ map: coverFace(false), roughness: 0.6 });
  const YH = 0.155; // the hinge line: the shut book's middle
  const hinge = new THREE.Group();
  hinge.position.set(0, YH, 0);
  book.add(hinge);
  const leftHalf = new THREE.Group();
  leftHalf.position.set(0, -YH, 0);
  hinge.add(leftHalf);
  const rightBoard = new THREE.Mesh(new THREE.BoxGeometry(1.71, 0.04, 2.34), [cloth, cloth, cloth, backCover, cloth, cloth]);
  rightBoard.position.set(0.855, 0.02, 0);
  rightBoard.castShadow = rightBoard.receiveShadow = true;
  book.add(rightBoard);
  // the front cover is the left board's underside: it faces up once shut
  const leftBoard = new THREE.Mesh(new THREE.BoxGeometry(1.71, 0.04, 2.34), [cloth, cloth, cloth, frontCover, cloth, cloth]);
  leftBoard.position.set(-0.855, 0.02, 0);
  leftBoard.castShadow = leftBoard.receiveShadow = true;
  leftHalf.add(leftBoard);
  const spinePivot = new THREE.Group();
  book.add(spinePivot);
  const spineTex = heroSpine();
  spineTex.center.set(0.5, 0.5);
  spineTex.rotation = Math.PI;
  const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.55 });
  const spineBox = new THREE.Mesh(new THREE.BoxGeometry(2 * YH + 0.006, 0.03, 2.352), [cloth, cloth, cloth, spineMat, cloth, cloth]);
  spineBox.position.set(-YH, 0.017, 0);
  spineBox.castShadow = true;
  spinePivot.add(spineBox);
  const edgeMat = new THREE.MeshStandardMaterial({ color: "#d9cdb5", roughness: 0.9 });
  // § 2017, typeset and flowing on into § 2018: each lifting leaf is a
  // recto with its verso behind; the book shows the next recto underneath
  const S2017 = BOOK.find((b) => b.no === "2017")!;
  const S2018 = BOOK.find((b) => b.no === "2018")!;
  const flow = typesetPages(
    [{ section: S2017 }, { section: S2018 }],
    ["recto", "verso", "recto", "verso", "recto", "verso", "recto", "verso", "recto"],
    { hot: "30 per centum" },
  );
  const right = flow[0];
  const contents = contentsPage(9);
  const tops: THREE.Mesh[] = [];
  ([-1, 1] as const).forEach((side) => {
    const parent = side < 0 ? leftHalf : book;
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.13, 2.2), edgeMat);
    block.position.set(side * 0.82, 0.105, 0);
    // it shades the table, not itself or the paper on it: at this low
    // light, paper a hair above the block shadows in broken stripes
    block.castShadow = true;
    parent.add(block);
    const top = new THREE.Mesh(
      sheet(1.62, 2.2, 0.0, 0, 0),
      new THREE.MeshStandardMaterial({ map: side < 0 ? contents : right, roughness: 0.92 }),
    );
    // the open spread dips into the gutter
    const pos = top.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / 1.62 + 0.5;
      const t = side < 0 ? 1 - x : x;
      pos.setY(i, 0.075 * (1 - Math.exp(-t * 9)) + 0.012 * Math.sin(t * Math.PI));
    }
    top.geometry.computeVertexNormals();
    top.position.set(side * 0.82, 0.172, 0);
    top.receiveShadow = false;
    // the page under the leaves sits a step back in depth: a leaf lying on
    // it always draws in front
    const tm = top.material as THREE.MeshStandardMaterial;
    tm.polygonOffset = true;
    tm.polygonOffsetFactor = 2;
    tm.polygonOffsetUnits = 8;
    parent.add(top);
    tops.push(top);
  });
  // θ = π: shut; θ = 0: open flat
  const setOpen = (theta: number) => {
    hinge.rotation.z = -theta;
    spinePivot.rotation.z = -theta / 2;
    spineBox.visible = theta > 0.04;
    tops.forEach((t) => (t.visible = theta < 0.85 * Math.PI));
  };
  setOpen(0);

  // pages lifting away, each further gone than the last
  const pages = [
    { p: [0.95, 0.42, -0.1], r: [0.08, 0.05, 0.18], curl: 0.16, amount: 0.0 },
    { p: [1.45, 1.05, -0.55], r: [-0.25, 0.3, 0.42], curl: 0.3, amount: 0.22 },
    { p: [2.15, 1.75, -1.25], r: [-0.55, 0.62, 0.7], curl: 0.42, amount: 0.48 },
    // clear of the page below it, with room for both to drift and turn
    { p: [3.3, 2.75, -2.6], r: [-0.85, 0.95, 0.95], curl: 0.5, amount: 0.74 },
  ];
  const pageMeshes: THREE.Mesh[] = [];
  const pageShapes: Array<{ flightY: Float32Array; restY: Float32Array; last: number }> = [];
  const pageAmounts: Array<{ value: number }> = [];
  const pageRest: Array<{ p: THREE.Vector3; r: THREE.Euler }> = [];
  // the pages leave highest slot first: each next page stops below the
  // ones already out, so no page flies through another. The k-th page to
  // leave carries the k-th recto of the text.
  const liftOrder = (i: number) => pages.length - 1 - i;
  pages.forEach((pg, i) => {
    const k = liftOrder(i);
    const { mat, uAmount } = dissolveMaterial(flow[2 * k], dissolveField(31 + i), flow[2 * k + 1]);
    uAmount.value = pg.amount;
    const m = new THREE.Mesh(sheet(1.6, 2.2, pg.curl, 0.06, i), mat);
    // its shape in the air, and the shape of the page it lay on
    const ps = m.geometry.attributes.position;
    const flightY = new Float32Array(ps.count);
    const restY = new Float32Array(ps.count);
    for (let v = 0; v < ps.count; v++) {
      flightY[v] = ps.getY(v);
      const tt = ps.getX(v) / 1.6 + 0.5;
      restY[v] = 0.075 * (1 - Math.exp(-tt * 9)) + 0.012 * Math.sin(tt * Math.PI);
    }
    pageShapes.push({ flightY, restY, last: -1 });
    const local = new THREE.Vector3(...(pg.p as [number, number, number]));
    m.position.copy(book.localToWorld(local.clone()));
    m.rotation.set(pg.r[0], pg.r[1] + 0.22, pg.r[2]);
    // no hard shadow on the page below: at this angle it reads as a
    // ragged dark band
    m.castShadow = false;
    m.updateMatrixWorld();
    scene.add(m);
    pageMeshes.push(m);
    pageAmounts.push(uAmount);
    pageRest.push({ p: m.position.clone(), r: m.rotation.clone() });
  });
  // where each page is coming apart: its fore-edge, far corner
  const front = (i: number, u = 0, v = 0) => pageMeshes[i].localToWorld(new THREE.Vector3(0.8 - u, 0.1, -1.1 + v));

  // the stream of letters
  // the stream leaves the most-dissolved page and rises away, up and
  // back into the dark, where the rest of the corpus waits
  const s0 = front(3, 0.4, 0.5);
  const curve = new THREE.CatmullRomCurve3([
    s0,
    s0.clone().add(new THREE.Vector3(-0.5, 0.9, -0.9)),
    s0.clone().add(new THREE.Vector3(-1.8, 1.9, -3.2)),
    s0.clone().add(new THREE.Vector3(-4.2, 2.7, -7.5)),
    s0.clone().add(new THREE.Vector3(-7.8, 3.3, -15)),
    s0.clone().add(new THREE.Vector3(-13, 3.7, -27)),
  ]);
  const chars = STATUTE_TEXT.replace(/\s+/g, "");
  const atlas = glyphAtlas(chars, fontVar("--font-serif"));
  const r = rng(7);
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  const streamT = sortedRandoms(16000, r, 1.35);
  const letters = particleGeometry(16000, (i, o) => {
    const t = streamT[i];
    const p = curve.getPoint(t);
    // it widens as it rises, to the width the corpus stream takes it on at
    const rad = 0.1 + 0.5 * t + 0.4 * t * t;
    o.p.set(p.x + gauss() * rad, p.y + gauss() * rad * 0.5, p.z + gauss() * rad);
    o.c.copy(STREAM).multiplyScalar(0.9 + 0.35 * (1 - t) + r() * 0.15);
    o.size = 0.07 + r() * 0.05;
    o.glyph = Math.floor(r() * 256);
    o.alpha = (0.55 + 0.45 * r()) * (1 - Math.pow(t, 3) * 0.7);
  });
  const letterPts = new THREE.Points(letters, particleMaterial({ atlas, focus: focus + 1.5, aperture: 1.3 }));
  fx.add(letterPts);
  // cells off the breaking pages. Each lives on its own curve that bends
  // up into the head of the stream; once its page has come apart it
  // travels the curve and is taken into the stream, so the cloud drains
  // into the line instead of hanging where the page was
  const head = curve.getPoint(0.015);
  const NC = 5200;
  const cA = new Float32Array(NC * 3);
  const cC = new Float32Array(NC * 3);
  const cB = new Float32Array(NC * 3);
  const cJ = new Float32Array(NC * 3);
  const cPage = new Uint8Array(NC);
  const cReveal = new Float32Array(NC);
  const cStart = new Float32Array(NC);
  const cSize = new Float32Array(NC);
  const cells = particleGeometry(NC, (i, o) => {
    const k = i % 4;
    const a = front(k, r() * 1.2, r() * 1.6);
    const b = curve.getPoint(r() * 0.04);
    const ctl = a.clone().lerp(head, 0.35).add(new THREE.Vector3(0, 0.45 + r() * 0.25, 0));
    a.toArray(cA, i * 3);
    ctl.toArray(cC, i * 3);
    b.toArray(cB, i * 3);
    cJ.set([gauss(), gauss(), gauss()], i * 3);
    cPage[i] = k;
    cReveal[i] = r();
    cStart[i] = 0.12 * r();
    o.p.copy(a);
    o.c.copy(STREAM).multiplyScalar(1.0 + r() * 0.35);
    cSize[i] = 0.022 + r() * 0.016;
    o.size = 0;
    o.alpha = 0.9;
  });
  const cellPos = cells.attributes.position as THREE.BufferAttribute;
  const cellSize = cells.attributes.aSize as THREE.BufferAttribute;
  let cellsAt = -1;
  const moveCells = (t: number) => {
    if (Math.abs(t - cellsAt) < 1e-5) return;
    cellsAt = t;
    const pos = cellPos.array as Float32Array;
    const size = cellSize.array as Float32Array;
    for (let i = 0; i < NC; i++) {
      const k = cPage[i];
      const ds = 0.54 + 0.1 * (pages.length - 1 - k);
      const rv = cReveal[i];
      // a cell appears as its part of the page dissolves, lifts a little,
      // then rides into the stream
      const born = pageAmounts[k].value >= rv * 0.98 && pageAmounts[k].value > 0;
      const go = ease(seg(t, ds + 0.03 + 0.1 * rv, ds + 0.26 + 0.1 * rv));
      const tau = cStart[i] + (1 - cStart[i]) * go;
      if (!born || tau > 0.985) {
        size[i] = 0;
        continue;
      }
      const m = 1 - tau;
      const w0 = m * m;
      const w1 = 2 * m * tau;
      const w2 = tau * tau;
      const sp = 0.09 * m + 0.012;
      const j = i * 3;
      for (let q = 0; q < 3; q++) pos[j + q] = w0 * cA[j + q] + w1 * cC[j + q] + w2 * cB[j + q] + sp * cJ[j + q];
      size[i] = cSize[i] * (1 - 0.45 * tau);
    }
    cellPos.needsUpdate = true;
    cellSize.needsUpdate = true;
  };
  const cellPts = new THREE.Points(cells, particleMaterial({ square: true, focus: focus + 0.5, aperture: 1.3 }));
  fx.add(cellPts);
  // far haze: the rest of the corpus, out of focus
  const haze = particleGeometry(9000, (i, o) => {
    o.p.set(-6 + r() * 40, 0.5 + r() * 9, -6 - r() * 40);
    o.c.copy(AMBER).multiplyScalar(0.5 + r() * 0.6);
    o.size = 0.03 + r() * 0.05;
    o.alpha = 0.25 + r() * 0.35;
  });
  // far haze: light in the dark; on paper it would only smudge the page
  if (!THEME.paper) fx.add(new THREE.Points(haze, particleMaterial({ focus, aperture: 2.6 })));

  // light: one warm key, the glow of the stream on the paper
  const key = new THREE.SpotLight("#ffd3a0", 140, 30, 0.42, 0.85, 2);
  key.position.set(-4.5, 6.5, 3.5);
  key.target.position.set(-0.6, 0, 0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 10;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const glow = new THREE.PointLight("#ff9f45", 4, 9, 2);
  glow.position.set(1.4, 1.9, -0.4);
  scene.add(glow);
  const rim = new THREE.PointLight("#ff8a3a", 18, 20, 2);
  rim.position.set(4, 3.5, -4);
  scene.add(rim);
  // on paper the shadows are soft and warm, not night
  scene.add(new THREE.AmbientLight("#ffe2c0", THEME.paper ? 1.3 : 0.035));

  // the motion: pages lift off one after another and come apart; the
  // letters stream away
  const restPos = book.localToWorld(new THREE.Vector3(0.82, 0.176, 0));
  const restRot = new THREE.Euler(0, 0.22, 0);
  const camFrom = new THREE.Vector3(-1.4, 2.6, 6.6);
  const camTo = camera.position.clone();
  const aimFrom = new THREE.Vector3(1.0, 0.8, -0.2);
  const aimTo = new THREE.Vector3(0.55, 1.5, -1.3);
  const update = (t: number) => {
    const c = ease(t);
    camera.position.lerpVectors(camFrom, camTo, c);
    camera.lookAt(new THREE.Vector3().lerpVectors(aimFrom, aimTo, c));
    let lifted = 0;
    pages.forEach((pg, i) => {
      // first all four float out, one at a time; nothing breaks apart yet
      const start = 0.02 + 0.11 * liftOrder(i);
      const raw = seg(t, start, start + 0.22);
      const lift = ease(raw);
      if (raw > 0) lifted++;
      const m = pageMeshes[i];
      // it peels into its own curl as it leaves the page
      const shape = ease(seg(raw, 0, 0.7));
      const sh = pageShapes[i];
      if (Math.abs(shape - sh.last) > 1e-4) {
        const ps = m.geometry.attributes.position;
        for (let v = 0; v < ps.count; v++) ps.setY(v, lerp(sh.restY[v], sh.flightY[v], shape));
        ps.needsUpdate = true;
        m.geometry.computeVertexNormals();
        sh.last = shape;
      }
      // a smooth arc: straight up off the page first, then out to its
      // place; once there it keeps drifting up and turning, never still
      const P = pageRest[i].p;
      const path = new THREE.CubicBezierCurve3(
        restPos,
        restPos.clone().add(new THREE.Vector3(0, 0.7, 0)),
        P.clone().add(new THREE.Vector3(-0.35, -0.3, 0.45)),
        P,
      );
      const since = Math.max(0, t - start);
      m.position.copy(path.getPoint(lift)).add(new THREE.Vector3(0.1 * since, 0.28 * since, -0.18 * since));
      const qa = new THREE.Quaternion().setFromEuler(restRot);
      const qb = new THREE.Quaternion().setFromEuler(pageRest[i].r);
      m.quaternion.copy(qa.slerp(qb, lift));
      // a slow turn in the air, small enough never to swing into a neighbour
      m.rotateZ(0.05 * since + 0.02 * Math.sin(since * 6 + i));
      m.visible = raw > 0;
      // it comes apart only once it is clear of the book
      // then, once all are out, they turn to light one by one from the top
      // page down, each fully
      const ds = 0.54 + 0.1 * (pages.length - 1 - i);
      pageAmounts[i].value = ease(seg(t, ds, ds + 0.16));
      void pg;
    });
    const rightMat = tops[1].material as THREE.MeshStandardMaterial;
    if (rightMat.map !== flow[2 * lifted]) {
      rightMat.map = flow[2 * lifted];
      // (a new map on a material that already has one: no new shader needed)
    }
    // the light leaves only once the pages start to come apart
    moveCells(t);
    drawShare(letterPts, ease(seg(t, 0.58, 1)));
    look.dof!.focus = camera.position.distanceTo(new THREE.Vector3(1.4, 0.7, 0.4));
  };
  return {
    camera,
    look,
    update,
    parts: { book, setOpen, pages: pageMeshes, tops, key, glow, rim, stream: curve, letters: letterPts, camFrom, aimFrom, camTo, aimTo, closedCenter: new THREE.Vector3(0.855, YH, 0) },
  };
}

// ── beat 5: the graph, made of the same light ────────────────────────

const VALUE_COLOR = "#ffb45c";

function nodeCard(label: string, kind: string, value: string, hero: boolean, w: number) {
  const mono = fontVar("--font-mono");
  const h = 300;
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    const rr = (x: number, y: number, ww: number, hh: number, r: number) => {
      g.beginPath();
      g.roundRect(x, y, ww, hh, r);
    };
    rr(6, 6, w - 12, h - 12, 26);
    g.fillStyle = hero ? "rgba(70, 36, 10, 0.92)" : "rgba(26, 20, 15, 0.9)";
    g.fill();
    g.lineWidth = hero ? 5 : 3;
    g.strokeStyle = hero ? "#ffb45c" : kind === "import" ? "rgba(255, 220, 180, 0.35)" : "rgba(255, 190, 120, 0.55)";
    if (kind === "import") g.setLineDash([14, 10]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(255, 225, 190, 0.5)";
    g.font = `500 30px ${mono}`;
    g.fillText(kind.toUpperCase(), 48, 82);
    g.fillStyle = "#f6ead8";
    g.font = `500 ${label.length > 34 ? 38 : 44}px ${mono}`;
    g.fillText(label, 48, 158);
    g.fillStyle = VALUE_COLOR;
    g.font = `600 ${hero ? 66 : 50}px ${mono}`;
    g.fillText(value, 48, hero ? 252 : 238);
  }, 2, true);
}

export function lamplightBeat5(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 300);
  camera.position.set(-2.6, 1.9, 12.4);
  camera.lookAt(0.7, -0.1, 0);
  const focus = camera.position.distanceTo(new THREE.Vector3(0.6, 0, 0));
  const look: Look = themedLook({
    background: "#070504",
    exposure: 1.0,
    dof: { focus, aperture: 0.0002, maxblur: 0.002 },
    bloom: { strength: 0.7, radius: 0.6, threshold: 0.82 },
    grain: 0.05,
    vignette: 0.55,
  });
  const { scene, fx } = ctx;
  const r = rng(21);

  // node positions: a left-to-right dependency layout, given depth by level
  const level: Record<string, number> = { imp2014: 0, impUsda: 0, rate30: 1, size2: 1, rate8: 1, net: 1, contrib: 2, minimum: 2, before: 3, regular: 4 };
  const P2: Record<string, [number, number]> = {
    imp2014: [250, 110], impUsda: [250, 340], net: [600, 50], rate30: [600, 195], size2: [640, 470], rate8: [700, 600],
    contrib: [960, 130], minimum: [1010, 520], before: [1290, 300], regular: [1330, 600],
  };
  const SCALE = 0.0074;
  const pos = new Map<string, THREE.Vector3>();
  GRAPH_NODES.forEach((n) => {
    const [x, y] = P2[n.id];
    pos.set(n.id, new THREE.Vector3((x - 760) * SCALE, (300 - y) * SCALE, -1.8 + level[n.id] * 0.8));
  });

  // cards: opaque, sized to their label; each faces the camera
  const cards = new Map<string, { mesh: THREE.Mesh; w: number }>();
  GRAPH_NODES.forEach((n) => {
    const hero = n.kind === "output";
    const wpx = Math.round(Math.max(560, 120 + n.label.length * 25));
    const tex = nodeCard(n.label, n.kind, n.value, hero, wpx);
    const w = (wpx / 1024) * 2.45;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 0.72),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.02,
        color: new THREE.Color(1, 1, 1).multiplyScalar(THEME.paper ? 1 : hero ? 1.3 : 1.0),
        toneMapped: !hero,
      }),
    );
    m.position.copy(pos.get(n.id)!);
    m.lookAt(camera.position.clone().setY(m.position.y));
    m.updateMatrixWorld();
    scene.add(m);
    cards.set(n.id, { mesh: m, w });
    if (n.id === "regular") ctx.link(m, "/demos", "Run this case yourself", { when: [0.62, 1.4] });
    if (n.id === "imp2014") ctx.link(m, "/us/statute/7/2014", "§ 2014 · where net income comes from", { when: [0.1, 1.4] });
  });

  // edges: from the right edge of one card to the left edge of the next;
  // the path that sets $182 burns brightest
  const hot = new Set(["imp2014-net", "net-contrib", "rate30-contrib", "contrib-before", "impUsda-before", "before-regular"]);
  const edgePoint = (id: string, side: 1 | -1) => {
    const c = cards.get(id)!;
    return c.mesh.localToWorld(new THREE.Vector3((side * c.w) / 2, 0, 0));
  };
  const edges: Array<{ tube: THREE.Mesh; packet: THREE.Mesh | null; ports: THREE.Mesh[]; c: THREE.Curve<THREE.Vector3>; from: number; to: number }> = [];
  GRAPH_EDGES.forEach(([a, b]) => {
    const A = edgePoint(a, 1);
    const B = edgePoint(b, -1);
    const dx = Math.max(0.5, (B.x - A.x) * 0.5);
    const c = new THREE.CubicBezierCurve3(A, A.clone().add(new THREE.Vector3(dx, 0, 0)), B.clone().add(new THREE.Vector3(-dx, 0, 0)), B);
    const isHot = hot.has(`${a}-${b}`);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(c, 90, isHot ? 0.011 : 0.006, 8, false),
      new THREE.MeshBasicMaterial({
        color: themed(new THREE.Color(isHot ? "#ffae55" : "#8a6440").multiplyScalar(isHot ? 2.0 : 0.9)),
        toneMapped: false,
      }),
    );
    scene.add(tube);
    let packet: THREE.Mesh | null = null;
    if (isHot) {
      packet = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshBasicMaterial({ color: themed(new THREE.Color("#ffd29a").multiplyScalar(4)), toneMapped: false }),
      );
      packet.position.copy(c.getPoint(0.5));
      scene.add(packet);
    }
    // ports: a small bright dot where the wire meets each card
    const ports = [A, B].map((p) => {
      const d = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 12, 12),
        new THREE.MeshBasicMaterial({ color: themed(new THREE.Color(isHot ? "#ffc27a" : "#b08560").multiplyScalar(isHot ? 2.5 : 1)), toneMapped: false }),
      );
      d.position.copy(p);
      scene.add(d);
      return d;
    });
    edges.push({ tube, packet, ports, c, from: level[a], to: level[b] });
  });

  // the rest of the graph, out past the focal plane
  const far = particleGeometry(14000, (i, o) => {
    const th = r() * Math.PI * 2;
    const rad = 5 + Math.pow(r(), 0.6) * 26;
    o.p.set(Math.cos(th) * rad + 3, (r() - 0.5) * 14, -5 - r() * 34 + Math.sin(th) * 4);
    const warm = r() < 0.18;
    o.c.set(warm ? "#ffb45c" : "#ead8c0").multiplyScalar(warm ? 1.4 : 0.7);
    o.size = 0.06 + r() * 0.07;
    o.alpha = 0.35 + r() * 0.45;
  });
  // far haze: light in the dark; on paper it would only smudge the page
  if (!THEME.paper) fx.add(new THREE.Points(far, particleMaterial({ focus, aperture: 3.2 })));
  // faint wiring between nearby far nodes
  const fp = far.attributes.position;
  const wires: number[] = [];
  for (let i = 0; i < 2600; i++) {
    const a = Math.floor(r() * fp.count);
    let best = -1;
    let bd = 1e9;
    for (let k = 0; k < 40; k++) {
      const b = Math.floor(r() * fp.count);
      const d = (fp.getX(a) - fp.getX(b)) ** 2 + (fp.getY(a) - fp.getY(b)) ** 2 + (fp.getZ(a) - fp.getZ(b)) ** 2;
      if (b !== a && d < bd) {
        bd = d;
        best = b;
      }
    }
    if (best >= 0 && bd < 9) wires.push(fp.getX(a), fp.getY(a), fp.getZ(a), fp.getX(best), fp.getY(best), fp.getZ(best));
  }
  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(wires, 3));
  scene.add(
    new THREE.LineSegments(
      lines,
      new THREE.LineBasicMaterial({ color: themed(new THREE.Color("#a86a30")), transparent: true, opacity: THEME.paper ? 0.22 : 0.16, blending: THEME.paper ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false }),
    ),
  );

  // the motion: the rules come up level by level, inputs first; each
  // wire draws once both ends are lit; then the values run the hot path
  // toward $182 while the camera eases in
  const at = (lv: number) => 0.04 + lv * 0.14;
  const camTo = camera.position.clone();
  const camFrom = camTo.clone().add(new THREE.Vector3(-1.2, 0.5, 2.4));
  const update = (t: number) => {
    camera.position.lerpVectors(camFrom, camTo, ease(t));
    camera.lookAt(0.7, -0.1, 0);
    GRAPH_NODES.forEach((n) => {
      const c = cards.get(n.id)!;
      const on = ease(seg(t, at(level[n.id]), at(level[n.id]) + 0.1));
      const mat = c.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = on;
      c.mesh.visible = on > 0.002;
      c.mesh.scale.setScalar(0.92 + 0.08 * on);
    });
    edges.forEach((e) => {
      const d = seg(t, at(e.to) - 0.04, at(e.to) + 0.06);
      drawShare(e.tube, d);
      e.ports[0].visible = d > 0;
      e.ports[1].visible = d >= 1;
      // one value travels each wire once: it rides the tip of the wire as
      // the wire draws in, and is gone when it reaches the next card
      if (e.packet) {
        const start = at(e.to) - 0.04;
        const run = seg(t, start, start + 0.1);
        e.packet.visible = run > 0 && run < 1;
        e.packet.position.copy(e.c.getPoint(ease(run)));
      }
    });
  };
  return { camera, look, update };

}
