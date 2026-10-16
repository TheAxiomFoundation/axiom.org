// The director: one canvas, eight beats, driven by scroll — played as one
// continuous shot.
//
// Progress P runs 0..8 (see captions.ts for the clock). Beats overlap:
// for the last OVERLAP of each beat the next one is already running, and
// the two cross-fade while both keep moving. The camera never stops: every
// beat dollies slowly forward the whole time, the outgoing beat pushes on
// through the cut, and the incoming one arrives with the same momentum.
// Two shared pipelines render the two beats; a last pass blends them.
//
// Beats are built lazily, a little ahead of the reader, on idle time, so
// the canvas textures (paper fibre, leather, spines) never land on a
// scroll frame.

import * as THREE from "three";
import {
  createBeat,
  fitCamera,
  loadFonts,
  makeRenderer,
  Pipeline,
  placeLabels,
  lightLink,
  type Beat,
  type SceneLink,
  THEME,
} from "../style-frames/kit";
import { SCENES } from "./beats";
import { HOLDS, OVERLAP, SCENE_START, SPANS, TOTAL } from "./captions";

export const BEATS = TOTAL;
const N = SCENES.length;
const START = SCENE_START;
// the newest scene that has started by P, and its own clock (0..1 over
// its span; past 1 its exit through the next cut)
const sceneAt = (P: number) => {
  for (let q = N - 1; q > 0; q--) if (P >= START[q] - OVERLAP) return q;
  return 0;
};
// the scene's own motion clock: it reaches 1 before the hold, then rests
const motionTime = (j: number, P: number) => {
  const t = sceneTime(j, P);
  const span = j === 0 ? SPANS[0] - OVERLAP : SPANS[j];
  return Math.min(1, (t * span) / (span - HOLDS[j]));
};
const sceneTime = (j: number, P: number) =>
  j === 0 ? P / (SPANS[0] - OVERLAP) : (P - (START[j] - OVERLAP)) / SPANS[j];
// camera dolly, as a share of each beat's focus distance: a slow steady
// drift per unit of the beat's clock, and the push through each cut
const DRIFT = 0.07;
const PUSH = 0.07;
// every cut passes through the dark: the outgoing scene pans up into its
// night sky, the incoming one starts in its own sky and pans down to its
// subject; the two images meet only while both are near black
const TILT_OUT = 0.72;
const TILT_IN = 0.78;
const sstep = (a: number, b: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const smooth = (k: number) => k * k * (3 - 2 * k);

const BlendShader = {
  uniforms: {
    tA: { value: null as THREE.Texture | null },
    tB: { value: null as THREE.Texture | null },
    uMix: { value: 0 },
    uDip: { value: 0.45 },
    uPaper: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA, tB;
    uniform float uMix;
    uniform float uDip;
    uniform float uPaper;
    varying vec2 vUv;
    void main() {
      vec4 c = mix(texture2D(tA, vUv), texture2D(tB, vUv), uMix);
      if (uPaper < 0.5) {
        // a dip toward night at the middle of the sweep hides the change
        c.rgb *= 1.0 - uDip * sin(3.14159265 * uMix);
        gl_FragColor = vec4(c.rgb, 1.0);
        return;
      }
      // paper: the dip goes toward the page instead. Only the white around
      // the objects becomes see-through, over a narrow ramp (for soft edges
      // and shadows); everything else, pale cards included, stays solid
      c.rgb = mix(c.rgb, vec3(1.0), uDip * sin(3.14159265 * uMix));
      float a = smoothstep(0.0, 0.07, 1.0 - min(min(c.r, c.g), c.b));
      gl_FragColor = vec4(c.rgb * a, a);
    }
  `,
};

export type Director = {
  setProgress: (p: number) => void;
  jump: (p: number) => void; // draw p now, no glide
  profile: (ps: number[]) => Array<{ p: number; ms: number }>; // dev: GPU-synced draw cost
  buildTimes: number[];
  prepareAll: () => Promise<unknown>;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

export async function createDirector(opts: {
  canvas: HTMLCanvasElement;
  overlays: HTMLElement[]; // one label layer per beat
  width: number;
  height: number;
  onFirstFrame?: () => void;
  paper?: boolean; // draw the scenes for the light page (see THEME)
}): Promise<Director> {
  THEME.paper = !!opts.paper;
  await loadFonts();
  const { canvas, overlays } = opts;
  let w = opts.width;
  let h = opts.height;
  // full device resolution, up to Retina
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  const pa = new Pipeline(renderer, w * dpr, h * dpr, false);
  const pb = new Pipeline(renderer, w * dpr, h * dpr, false);
  // adaptive resolution, for machines whose GPU can't keep up: while the
  // story moves, frames render at a lower resolution; the moment it rests,
  // the frame is drawn again at full resolution. A machine that keeps up
  // never switches, and every still frame is always full resolution.
  // a small step down, and only for a GPU that truly can't keep up, so the
  // return to full resolution at rest is hard to notice
  const REDUCED = 0.8;
  let scale = 1;
  let slowGpu = false;
  let frameAvg = 16;
  // back to full resolution only after a short rest: a wheel that pauses
  // between ticks would otherwise flip the buffers back and forth
  let movedAt = 0;
  const applyScale = (sc: number) => {
    scale = sc;
    const px = Math.max(1, dpr * sc);
    renderer.setPixelRatio(px);
    renderer.setSize(w, h, false);
    pa.setSize(w * px, h * px);
    pb.setSize(w * px, h * px);
  };

  const blendScene = new THREE.Scene();
  const blendCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const blend = new THREE.ShaderMaterial({ ...BlendShader, uniforms: THREE.UniformsUtils.clone(BlendShader.uniforms), depthTest: false, depthWrite: false });
  blend.uniforms.uPaper.value = THEME.paper ? 1 : 0;
  // the shader writes premultiplied colour
  blend.premultipliedAlpha = true;
  blendScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blend));

  // lazy beats
  const beats: Array<Beat | null> = new Array(N).fill(null);
  const buildTimes: number[] = new Array(N).fill(0);
  const pending: Array<Promise<Beat> | null> = new Array(N).fill(null);
  const build = (i: number) => {
    if (i < 0 || i >= N) return null;
    if (!pending[i]) {
      pending[i] = (async () => {
        const t0 = performance.now();
        const b = createBeat(SCENES[i].build, overlays[i]);
        buildTimes[i] = performance.now() - t0;
        await b.ready;
        b.camera.userData.span = SPANS[i];
        b.invalidate = () => {
          current = current < 0 ? target : current;
          animUntil = performance.now() + 400;
          schedule();
        };
        fitCamera(b.camera, w, h);
        await warm(b);
        beats[i] = b;
        return b;
      })();
    }
    return pending[i];
  };
  // a scene's first frame must not pay for its setup: upload its textures,
  // compile its shaders and run it once through the post chain, all before
  // the reader gets there
  const warm = async (b: Beat) => {
    const seen = new Set<THREE.Texture>();
    [b.scene, b.fx].forEach((sc) =>
      sc.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(m) ? m : m ? [m] : []).forEach((mat) => {
          Object.values(mat as unknown as Record<string, unknown>).forEach((v) => {
            if (v instanceof THREE.Texture) seen.add(v);
          });
          const u = (mat as THREE.ShaderMaterial).uniforms;
          if (u) Object.values(u).forEach((x) => x?.value instanceof THREE.Texture && seen.add(x.value));
        });
      }),
    );
    seen.forEach((t) => renderer.initTexture(t));
    // compile what is hidden too: a scene that shows a part only later
    // would otherwise compile its shaders mid-scroll, on first sight
    const hidden: THREE.Object3D[] = [];
    [b.scene, b.fx].forEach((sc) => sc.traverse((o) => !o.visible && hidden.push(o)));
    hidden.forEach((o) => (o.visible = true));
    await renderer.compileAsync(b.scene, b.camera);
    await renderer.compileAsync(b.fx, b.camera);
    // and draw it all once, in view or not, so every pass (shadows, depth,
    // colour) has its shaders and buffers before the reader gets there
    const culled: THREE.Object3D[] = [];
    [b.scene, b.fx].forEach((sc) => sc.traverse((o) => o.frustumCulled && culled.push(o)));
    culled.forEach((o) => (o.frustumCulled = false));
    pb.render(b);
    culled.forEach((o) => (o.frustumCulled = true));
    hidden.forEach((o) => (o.visible = false));
    [0, 0.5, 1].forEach((t) => {
      b.update?.(t);
      pb.render(b);
    });
    b.update?.(0);
  };
  // build the scenes one after another, each in an idle moment, so no
  // single long task lands while the reader scrolls
  const buildAll = async () => {
    for (let i = 0; i < N && !dead; i++) {
      await new Promise<void>((r) => idle(() => r()));
      await build(i);
    }
  };
  const idle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 400 });
    else setTimeout(fn, 60);
  };
  const prefetch = (from: number) => {
    for (let k = from; k <= from + 1 && k < N; k++) if (!pending[k]) idle(() => void build(k));
  };

  let target = 0;
  let animUntil = 0;
  let current = -1;
  let raf = 0;
  let dead = false;
  let shown = false;

  const fwd = new THREE.Vector3();
  // pose a beat at its own time t, with an extra dolly (share of its
  // focus distance; + is forward); returns the distance moved
  const pose = (b: Beat, t: number, mt: number, extra: number, tilt = 0) => {
    const cam = b.camera;
    cam.position.copy(cam.userData.basePos);
    cam.quaternion.copy(cam.userData.baseQuat);
    b.update?.(Math.min(1, Math.max(0, mt)));
    fitCamera(cam, w, h);
    // a long scene drifts no further than a short one: its own camera
    // carries the move
    const span = Math.min(1.1, (b.camera.userData.span as number) ?? 1);
    const d = (cam.userData.baseFocus as number) * (DRIFT * span * Math.min(1.4, Math.max(0, t)) + extra);
    cam.getWorldDirection(fwd);
    cam.position.addScaledVector(fwd, d);
    if (tilt) cam.rotateX(tilt);
    return d;
  };
  // render with the focus pulled to follow the dolly
  // links: lit on hover or focus, and a soft glint now and then so the
  // reader can tell what is clickable
  let hovered: SceneLink | null = null;
  let glintAt = -1;
  const GLINT_MS = 1100;
  const linkOn = (l: SceneLink, t: number) => !l.when || (t >= l.when[0] && t <= l.when[1]);
  const lightLinks = (b: Beat, t: number, now: number) => {
    b.links.forEach((l, i) => {
      let h = 0;
      if (linkOn(l, t)) {
        if (l.hover || l.focus) h = 1;
        else if (glintAt >= 0) {
          // the glint passes from link to link
          const x = (now - glintAt - i * 140) / (GLINT_MS - 400);
          h = x > 0 && x < 1 ? 0.45 * Math.sin(Math.PI * x) : 0;
        }
      }
      l.glow += (h - l.glow) * (l.hover || l.focus ? 0.35 : 1);
      lightLink(l, l.glow);
    });
  };
  const shoot = (pipe: Pipeline, b: Beat, d: number) => {
    const dof = b.look.dof;
    const f = dof?.focus ?? 0;
    if (dof) dof.focus = Math.max(0.3, f - d);
    pipe.render(b);
    if (dof) dof.focus = f;
  };

  let front: { beat: Beat; t: number; mix: number } | null = null;
  if (process.env.NODE_ENV !== "production") Object.assign(window, { __jlBeats: beats, __jlRenderer: renderer });
  const draw = (P: number) => {
    const j = sceneAt(P);
    const b = beats[j];
    if (!b) {
      void build(j)?.then(() => schedule());
      return;
    }
    // the cut from j-1 into j, while P < j
    const k = j > 0 && P < START[j] ? (P - (START[j] - OVERLAP)) / OVERLAP : 1;
    const a = k < 1 ? beats[j - 1] : null;
    if (k < 1 && !a) void build(j - 1)?.then(() => schedule());
    // the images swap in the dark middle of the pan
    // a scene with its own way out hands over slowly, behind what matches
    const mix = a ? (a.cutOut ? sstep(0.35, 0.95, k) : sstep(0.38, 0.62, k)) : 1;

    const ownIn = !!(a && b.cutIn);
    const db = pose(b, sceneTime(j, P), motionTime(j, P), a && !ownIn ? -PUSH * (1 - k) * (1 - k) : 0, a && !ownIn ? TILT_IN * (1 - sstep(0.4, 1, k)) : 0);
    if (ownIn) b.cutIn!(k);
    const now = performance.now();
    lightLinks(b, motionTime(j, P), now);
    if (a) lightLinks(a, motionTime(j - 1, P), now);
    front = { beat: mix >= 0.5 || !a ? b : a, t: mix >= 0.5 || !a ? motionTime(j, P) : motionTime(j - 1, P), mix };
    shoot(pb, b, db);
    if (a) {
      const ownOut = !!a.cutOut;
      const da = pose(a, sceneTime(j - 1, P), motionTime(j - 1, P), ownOut ? 0 : PUSH * k * k, ownOut ? 0 : TILT_OUT * sstep(0, 0.6, k));
      if (ownOut) a.cutOut!(k, b.camera);
      shoot(pa, a, da);
    }
    blend.uniforms.tA.value = a ? pa.texture : pb.texture;
    blend.uniforms.tB.value = pb.texture;
    blend.uniforms.uMix.value = mix;
    // a scene with its own way out hides the change itself: no dip
    blend.uniforms.uDip.value = a?.cutOut ? 0 : 0.45;
    renderer.setRenderTarget(null);
    renderer.render(blendScene, blendCam);
    // labels: the outgoing beat's fade as the incoming beat's arrive
    overlays.forEach((o, q) => {
      const op = q === j ? mix : a && q === j - 1 ? 1 - mix : 0;
      o.style.opacity = String(op);
      o.style.visibility = op > 0.01 ? "visible" : "hidden";
      o.toggleAttribute("inert", op < 0.6);
    });
    placeLabels(b, w, h, motionTime(j, P));
    if (a) placeLabels(a, w, h, motionTime(j - 1, P));
    prefetch(j);
    if (!shown) {
      shown = true;
      opts.onFirstFrame?.();
    }
  };

  // scroll moves a target; each frame eases toward it, so a flick of the
  // wheel glides instead of jumping
  let last = 0;
  const tick = (now: number) => {
    raf = 0;
    if (dead) return;
    // the glide depends on elapsed time, not on frames: a slow frame does
    // not show as a stutter (time constant ~210 ms)
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const d = target - current;
    current = Math.abs(d) < 0.0004 || current < 0 ? target : current + d * (1 - Math.exp(-dt / 0.21));
    const moving = current !== target;
    // a steady run of long frames while moving marks a slow GPU (once)
    if (moving && dt < 0.1) {
      frameAvg = frameAvg * 0.95 + dt * 1000 * 0.05;
      if (frameAvg > 30) slowGpu = true;
    }
    if (process.env.NODE_ENV !== "production" && (window as unknown as { __jlSlow?: boolean }).__jlSlow) slowGpu = true;
    if (moving) movedAt = now;
    const resting = !moving && now - movedAt > 250;
    const want = slowGpu && !resting ? REDUCED : 1;
    if (want !== scale) applyScale(want);
    draw(current);
    // still reduced at rest: come back for the full-resolution frame
    if (!moving && scale !== 1) {
      schedule();
      return;
    }
    if (current !== target || now < animUntil) schedule();
    else last = 0;
  };
  const schedule = () => {
    if (!raf && !dead) raf = requestAnimationFrame(tick);
  };

  // the pointer over the scene
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tip = document.createElement("div");
  tip.className = "jl-tip";
  canvas.parentElement?.appendChild(tip);
  const setHover = (l: SceneLink | null, x = 0, y = 0) => {
    if (hovered && hovered !== l) hovered.hover = false;
    hovered = l;
    if (l) l.hover = true;
    canvas.style.cursor = l ? "pointer" : "";
    tip.textContent = l ? `${l.text} →` : "";
    tip.classList.toggle("is-on", !!l);
    if (l) tip.style.transform = `translate(${x + 18}px, ${y + 14}px)`;
    animUntil = performance.now() + 500;
    schedule();
  };
  const pick = (ev: PointerEvent) => {
    if (!front || front.mix < 0.85 && front.mix > 0.15) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const { beat, t } = front;
    ray.setFromCamera(ndc, beat.camera);
    let best: SceneLink | null = null;
    let bestD = Infinity;
    for (const l of beat.links) {
      if (!linkOn(l, t)) continue;
      const hit = ray.intersectObject(l.hit, true)[0];
      if (hit && hit.distance < bestD) {
        bestD = hit.distance;
        best = l;
      }
    }
    return { best, x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const onMove = (ev: PointerEvent) => {
    const p = pick(ev);
    if (!p) return setHover(null);
    if (p.best !== hovered) setHover(p.best, p.x, p.y);
    else if (p.best) tip.style.transform = `translate(${p.x + 18}px, ${p.y + 14}px)`;
  };
  const onLeave = () => setHover(null);
  const onClick = (ev: MouseEvent) => {
    const p = pick(ev as PointerEvent);
    const l = p?.best;
    if (!l) return;
    if (l.external) window.open(l.href, "_blank", "noopener,noreferrer");
    else window.location.assign(l.href);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);
  // a glint every few seconds, while the reader is here
  const glintTimer = window.setInterval(() => {
    if (document.hidden || !front) return;
    const r = canvas.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    if (!front.beat.links.some((l) => linkOn(l, front!.t))) return;
    glintAt = performance.now();
    animUntil = glintAt + GLINT_MS + 800;
    schedule();
  }, 4200);

  await build(0);
  schedule();
  void buildAll();

  return {
    setProgress(p: number) {
      target = Math.max(0, Math.min(BEATS, p));
      schedule();
    },
    jump(p: number) {
      target = current = Math.max(0, Math.min(BEATS, p));
      draw(current);
    },
    buildTimes,
    profile(ps: number[]) {
      const gl = renderer.getContext();
      return ps.map((p) => {
        gl.finish();
        const t0 = performance.now();
        draw(p);
        gl.finish();
        return { p, ms: Math.round((performance.now() - t0) * 10) / 10 };
      });
    },
    prepareAll() {
      return Promise.all(Array.from({ length: N }, (_, i) => build(i)));
    },
    resize(nw: number, nh: number) {
      w = nw;
      h = nh;
      renderer.setSize(w, h, false);
      applyScale(scale);
      beats.forEach((b) => b && fitCamera(b.camera, w, h));
      current = -1;
      schedule();
    },
    dispose() {
      dead = true;
      window.clearInterval(glintTimer);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      tip.remove();
      if (raf) cancelAnimationFrame(raf);
      pa.composer.dispose();
      pb.composer.dispose();
      renderer.dispose();
    },
  };
}
