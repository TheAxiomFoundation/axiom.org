import fc from "fast-check";
import type { BufferGeometry, Camera, Mesh, Object3D, Scene, ShaderMaterial } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAP, SCENE_START, SPANS, TOTAL } from "./captions";
import { createDirector, type Director } from "./director";

// MOCK rendering kit and scenes: jsdom has no WebGL. Each scene is empty, and
// the test decides which ones fail to build, and which it holds to settle later.
// The MOCK renderer and pipelines log every call, and set apart the calls made
// on them after their dispose().
const kit = vi.hoisted(() => {
  const kit = {
    fail: new Set<number>(),
    breaks: new Set<number>(), // a scene whose code throws as it's made, so its build rejects at once
    hold: new Set<number>(),
    held: new Map<number, { resolve: () => void; reject: (e: Error) => void }>(),
    made: [] as number[],
    beats: new Map<number, { camera: { userData: { span?: number } }; invalidate?: () => void }>(), // each scene's beat as it's made
    textures: new Map<number, number>(), // how many MOCK textures a scene carries
    latency: new Map<number, { ready: number; compile: number }>(), // ms a scene's assets and compiles take
    ticks: new Map<number, number>(), // microtasks a scene's assets come late by
    noAssets: new Set<number>(), // a scene with no assets to wait for: its beat has no ready, as most real ones don't
    // a scene with MOCK links in front of its camera: a page's and a site's side by
    // side, and a note's behind the page's
    links: new Set<number>(),
    // a scene with code of its own, as real scenes have: an update, a way in and a
    // way out, a depth of field, and a part it shows only later
    code: new Set<number>(),
    gates: new Map<string, Promise<void>>(), // a compile, by its logged name, waits on this
    throws: new Set<string>(), // a compile, by its logged name, throws as it's called
    parallel: false, // three can ask the driver whether a compile is done (KHR_parallel_shader_compile)
    calls: [] as string[],
    late: [] as string[],
    pipelines: 0,
    polling: 0, // compiles still polling, of every director so far
    round: 0, // the test now running: a compile left polling by an earlier one stops
    // runs inside each call, so a test can dispose in the middle of a build
    during: null as ((call: string) => void) | null,
    // holds the MOCK compile's polls for the test to run (see stepLog)
    later: null as ((poll: () => void) => void) | null,
    // a call, and for the step logs what it draws or sets
    log(gone: boolean, call: string, detail?: string) {
      kit.calls.push(call);
      if (gone) kit.late.push(call);
      kit.during?.(detail ? `${call} ${detail}` : call);
    },
    // a call of the kit's helpers, or of a scene's own code: only the step logs see it
    see(call: string) {
      kit.during?.(call);
    },
  };
  return kit;
});
vi.mock("../style-frames/kit", async () => {
  const THREE = await import("three");
  const wait = (ms: number) => (ms ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
  // the theme the scenes are drawn for, which every director shares: each read and
  // write of it is a step the logs see, since a second director can come in between
  let paper = false;
  const THEME = {
    get paper() {
      kit.see(`THEME.paper read: ${paper}`);
      return paper;
    },
    set paper(v: boolean) {
      kit.see(`THEME.paper = ${v}`);
      paper = v;
    },
  };
  const n = (v: number) => +v.toFixed(3);
  // what a render of a scene draws, as far as the director sets it: its camera's
  // pose (each part away from its rest), its focus, and how many of its objects
  // are shown and culled
  const shot = (b: { camera: Camera; scene: Object3D; fx: Object3D; look: { dof?: { focus: number } } }) => {
    const { position: p, quaternion: q } = b.camera;
    const pose = Object.entries({ x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z }).filter(([, v]) => Math.abs(v) >= 0.0005);
    let shown = 0;
    let culled = 0;
    for (const sc of [b.scene, b.fx])
      sc.traverse((o) => {
        if (o.visible) shown++;
        if (o.frustumCulled) culled++;
      });
    const focus = b.look.dof ? ` focus ${n(b.look.dof.focus)}` : "";
    return `at ${pose.map(([k, v]) => `${k}${n(v)}`).join(" ") || "rest"}${focus} shows ${shown} culls ${culled}`;
  };
  return {
    THEME,
    loadFonts: async () => kit.see("loadFonts"),
    makeRenderer: () => {
      kit.see("makeRenderer");
      let gone = false;
      const log = (call: string, detail?: string) => kit.log(gone, call, detail);
      return {
        setPixelRatio: (r: number) => log(`setPixelRatio ${r}`),
        setSize: (w: number, h: number) => log(`setSize ${w}x${h}`),
        initTexture: (t: { userData: { scene: number } }) => log(`initTexture ${t.userData.scene}`),
        // as three's does: it compiles at once, then polls its programs until they're
        // ready, at once if it can ask the driver and then every 10 ms. A poll on a
        // disposed renderer throws there, so the compile never settles; here that
        // poll is logged as late, and stops. three's compile takes the lights from
        // what's shown, so the step logs see how many objects are
        compileAsync: (sc: Object3D & { userData: { mock: string; index: number } }) => {
          const name = `compileAsync ${sc.userData.mock}`;
          let shown = 0;
          sc.traverseVisible(() => shown++);
          log(name, `shows ${shown}`);
          if (kit.throws.has(name)) throw new Error(`MOCK: scene ${sc.userData.index} failed to set up its shaders`);
          const gate = kit.gates.get(name);
          const ms = kit.latency.get(sc.userData.index)?.compile ?? 0;
          let ready: boolean | Error = !gate && !ms;
          if (!ready)
            Promise.resolve(gate)
              .then(() => wait(ms))
              .then(
                () => (ready = true),
                (e: Error) => (ready = e),
              );
          kit.polling++;
          const round = kit.round;
          return new Promise<void>((resolve, reject) => {
            const later = () => (kit.later ? kit.later(poll) : void setTimeout(poll, 10));
            const poll = () => {
              if (round !== kit.round) return;
              if (ready === false && !gone) return later();
              kit.polling--;
              if (gone) log(`compile poll ${sc.userData.mock}`);
              else if (ready === true) resolve();
              else reject(ready);
            };
            if (kit.parallel) poll();
            else later();
          });
        },
        // the blend of the two scenes' images: whose images, how far mixed, and the dip
        render: (scene: Scene) => {
          const u = (scene.children[0] as Mesh<BufferGeometry, ShaderMaterial>).material.uniforms;
          log("render", `${u.tA.value?.mock}${u.tB.value?.mock} mix ${n(u.uMix.value)} dip ${u.uDip.value}`);
        },
        setRenderTarget: () => log("setRenderTarget"),
        getContext: () => (log("getContext"), { finish: () => kit.see("finish") }),
        dispose: () => {
          log("dispose");
          gone = true;
        },
      };
    },
    Pipeline: class {
      texture: { mock: string };
      gone = false;
      composer = {
        dispose: () => {
          kit.log(this.gone, "composer.dispose");
          this.gone = true;
        },
      };
      constructor(_: unknown, w: number, h: number) {
        kit.pipelines++;
        // a director's two pipelines' images, a and b, in the order they're made
        this.texture = { mock: kit.pipelines % 2 ? "a" : "b" };
        kit.log(false, `pipeline ${w}x${h}`);
      }
      render(b: Parameters<typeof shot>[0] & { scene: { userData: { mock: string } } }) {
        kit.log(this.gone, `pipeline.render ${b.scene.userData.mock}`, shot(b));
      }
      setSize(w: number, h: number) {
        kit.log(this.gone, "pipeline.setSize", `${w}x${h}`);
      }
    },
    createBeat: (build: { index: number }) => {
      const i = build.index;
      kit.made.push(i);
      kit.see(`createBeat ${i}${paper ? " for paper" : ""}`);
      if (kit.breaks.has(i)) throw new Error(`MOCK: scene ${i} broke as it was made`);
      const camera = new THREE.PerspectiveCamera();
      Object.assign(camera.userData, { basePos: new THREE.Vector3(), baseQuat: new THREE.Quaternion(), baseFocus: 8, index: i });
      let late = wait(kit.latency.get(i)?.ready ?? 0);
      for (let k = 0; k < (kit.ticks.get(i) ?? 0); k++) late = late.then(() => {});
      const ready = kit.hold.has(i)
        ? new Promise<void>((resolve, reject) => kit.held.set(i, { resolve, reject }))
        : kit.noAssets.has(i)
          ? undefined
          : late.then(() => {
              if (kit.fail.has(i)) throw new Error(`MOCK: scene ${i} failed`);
            });
      const scene = new THREE.Scene();
      Object.assign(scene.userData, { mock: `${i} scene`, index: i });
      const fx = new THREE.Scene();
      Object.assign(fx.userData, { mock: `${i} fx`, index: i });
      // every other texture is a shader's uniform, as the post effects' are
      for (let k = 0; k < (kit.textures.get(i) ?? 0); k++) {
        const map = new THREE.Texture();
        map.userData.scene = i;
        const material = k % 2 ? new THREE.ShaderMaterial({ uniforms: { map: { value: map } } }) : new THREE.MeshBasicMaterial({ map });
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
      }
      const own = kit.code.has(i);
      // the part shown only later, which the director's warm-up draws all the same
      if (own) scene.add(Object.assign(new THREE.Mesh(), { visible: false }));
      // each link's hit box faces the camera: a pointer a quarter of the way across the
      // canvas, from either side, finds the page's or the site's 5 units ahead; behind
      // the page's, 7 units ahead, is the note's
      const link = (text: string, x: number, external: boolean, z = -5) => ({
        hit: new THREE.Mesh(new THREE.PlaneGeometry(4, 4).translate(x, 0, z)),
        href: `#${text.replace(" ", "-")}`,
        text,
        external,
        glow: 0,
        hover: false,
        focus: false,
      });
      const links = kit.links.has(i) ? [link("MOCK page", -2.5, false), link("MOCK site", 2.5, true), link("MOCK note", -2.5, false, -7)] : [];
      const code = own
        ? {
            update: (t: number) => kit.see(`update ${i} ${n(t)}`),
            cutIn: (k: number) => kit.see(`cutIn ${i} ${n(k)}`),
            cutOut: (k: number, next?: { camera: Camera }) => kit.see(`cutOut ${i} ${n(k)} to ${next?.camera.userData.index}`),
          }
        : {};
      const beat = { ready, camera, scene, fx, labels: [], links, look: own ? { dof: { focus: 8, aperture: 0, maxblur: 0 } } : {}, ...code };
      kit.beats.set(i, beat);
      return beat;
    },
    fitCamera: (camera: Camera, w: number, h: number) => kit.see(`fitCamera ${camera.userData.index} ${w}x${h}`),
    placeLabels: (b: { camera: Camera }, w: number, h: number, t = 1) => kit.see(`placeLabels ${b.camera.userData.index} ${w}x${h} ${n(t)}`),
    lightLink: (l: { text: string }, h: number) => kit.see(`lightLink ${l.text} ${n(h)}`),
  };
});
vi.mock("./beats", async () => {
  const { SPANS } = await import("./captions");
  return { SCENES: SPANS.map((_, index) => ({ build: { index }, beats: 1 })) };
});

// MOCK idle moments and animation frames, for the tests that take the time
// over: nothing queued runs until the test runs it
const idles: Array<() => void> = [];
const frames = new Map<number, (t: number) => void>();
function takeTime() {
  let id = 0;
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => idles.push(cb));
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => (frames.set(++id, cb), id));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
}

const unhandled = vi.fn();
beforeEach(() => {
  kit.fail.clear();
  kit.breaks.clear();
  kit.hold.clear();
  kit.held.clear();
  kit.made.length = 0;
  kit.beats.clear();
  kit.textures.clear();
  kit.latency.clear();
  kit.ticks.clear();
  kit.noAssets.clear();
  kit.links.clear();
  kit.code.clear();
  kit.gates.clear();
  kit.throws.clear();
  kit.parallel = false;
  kit.calls.length = 0;
  kit.late.length = 0;
  kit.pipelines = 0;
  kit.during = null;
  kit.later = null;
  process.on("unhandledRejection", unhandled);
});
afterEach(async () => {
  try {
    // a director disposed while it compiles lets go of its renderer later: not in the next test
    await vi.waitFor(() => expect(kit.polling).toBe(0));
    await settle(1);
  } finally {
    // a test that fails while it holds a compile leaves that compile polling: it
    // stops here, so the failure stays with that test
    kit.round++;
    kit.polling = 0;
    process.off("unhandledRejection", unhandled);
    unhandled.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    idles.length = 0;
    frames.clear();
    document.body.replaceChildren();
  }
});

function stage() {
  const canvas = document.createElement("canvas");
  const box = document.createElement("div");
  box.append(canvas);
  document.body.append(box);
  return { canvas, overlays: SPANS.map(() => document.createElement("div")) };
}

function make(
  opts: { onError?: (e: unknown) => void; onFirstFrame?: () => void; canvas?: HTMLCanvasElement; overlays?: HTMLElement[] } = {},
) {
  const where = opts.canvas ? { canvas: opts.canvas, overlays: opts.overlays! } : stage();
  return createDirector({ ...where, width: 800, height: 450, paper: true, onError: opts.onError, onFirstFrame: opts.onFirstFrame });
}

/** Lets idle builds, timers and rejections run their course. */
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
/** Runs the oldest queued idle moment, and lets what it starts settle. */
const idleStep = async () => {
  idles.shift()?.();
  await settle(20);
};
const runIdle = async () => {
  for (let n = 0; idles.length && n < 50; n++) await idleStep();
};
const runFrame = async (t: number) => {
  const due = [...frames.values()];
  frames.clear();
  due.forEach((f) => f(t));
  await settle(20);
};
/** Holds the compile logged as `call`; the function returned lets it finish. */
const gate = (call: string) => {
  let open!: () => void;
  kit.gates.set(call, new Promise<void>((r) => (open = r)));
  return () => open();
};
/** Runs fn inside the first renderer or pipeline call logged as `call`. */
const at = (call: string, fn: () => void) => {
  kit.during = (c) => {
    if (c !== call) return;
    kit.during = null;
    fn();
  };
};

/**
 * Spies on what a director sets up on its canvas and the window; the check it
 * returns asserts that all of it was let go.
 */
function watch(canvas: HTMLCanvasElement) {
  takeTime();
  const setInterval = vi.spyOn(window, "setInterval");
  const clearInterval = vi.spyOn(window, "clearInterval");
  const on = vi.spyOn(canvas, "addEventListener");
  const off = vi.spyOn(canvas, "removeEventListener");
  const host = canvas.parentElement!;
  // a listener is removed by its type, its function and its capture flag
  const capture = (o?: boolean | EventListenerOptions) => (typeof o === "boolean" ? o : !!o?.capture);
  // every node the director adds to the page
  const added: Node[] = [];
  const page = new MutationObserver((rs) => rs.forEach((r) => added.push(...r.addedNodes)));
  page.observe(document.body, { childList: true, subtree: true });
  return () => {
    // the glint's interval, and the pointer's three listeners
    expect(setInterval).toHaveBeenCalledTimes(1);
    for (const { value } of setInterval.mock.results) expect(clearInterval).toHaveBeenCalledWith(value);
    expect(on.mock.calls.map(([type]) => type).sort()).toEqual(["click", "pointerleave", "pointermove"]);
    for (const [type, fn, o] of on.mock.calls) {
      const gone = off.mock.calls.some(([t, f, p]) => t === type && f === fn && capture(p) === capture(o));
      expect(gone, `the ${type} listener is removed`).toBe(true);
    }
    expect(frames.size).toBe(0);
    expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(kit.pipelines).toBeGreaterThan(0);
    expect(kit.calls.filter((c) => c === "composer.dispose")).toHaveLength(kit.pipelines);
    // the tooltip, taken off the page, and only the tooltip: the stage stays
    page.takeRecords().forEach((r) => added.push(...r.addedNodes));
    page.disconnect();
    expect(added).toHaveLength(1);
    for (const n of added) expect(n.isConnected).toBe(false);
    expect(host.isConnected).toBe(true);
    expect(canvas.parentElement).toBe(host);
  };
}

/**
 * Makes a stage, and logs each step a caller or the reader can see on it, with
 * its microtask count from the start of the task it came in:
 * - each renderer and pipeline call, with what each render draws, and each call
 *   of the kit's helpers and of a scene's own code (see the MOCK kit);
 * - each request for a frame or an idle moment, the director's timers, and the
 *   glint's interval, which waits for the test to run it (`glint`);
 * - the listeners on the canvas, the tooltip put on the page and taken off it, a
 *   link opened in a new tab, and what's logged as an error;
 * - each read and write of the theme, which every director shares (see the MOCK kit);
 * - the page as it changes: each label layer's opacity, visibility and inert, the
 *   tooltip's class, text and place, the cursor, the location's hash, and the dev
 *   globals; each scene's camera span, which the scene's own code can read; and
 *   what the test watches (`watch`). A change is logged at the next step, or as
 *   its microtask ends;
 * - and what the test stamps.
 * The clock stands still unless the test moves it (`clock.now`); `frame` runs the
 * frames queued at its time, and moves the clock there.
 *
 * With `timers`, the director's own timers (those director.ts sets itself) wait
 * for the test, which runs each as a task of its own (`fire`): an upload's yield
 * (0 ms), and an idle moment where there is no requestIdleCallback (60 ms). So do
 * the MOCK compile's polls (10 ms, not logged: three's, not the director's). Any
 * other timer, jsdom's own as a link is followed among them, runs as it would.
 */
function stepLog({ timers = false, idleCallback = true } = {}) {
  takeTime();
  const clock = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  let tick = 0;
  const log: string[] = [];
  const { canvas, overlays } = stage();
  const box = canvas.parentElement!;
  // the page before the director: an earlier test's director left the dev globals set
  const dev = window as unknown as Record<string, unknown>;
  delete dev.__jlBeats;
  delete dev.__jlRenderer;
  history.replaceState(null, "", location.pathname);
  let tip: Element | undefined;
  const spans = () =>
    [...kit.beats]
      .sort(([a], [b]) => a - b)
      .map(([i, b]) => `${i} ${b.camera.userData.span ?? "-"}`)
      .join(", ") || "-";
  const watched: Array<[string, () => string]> = [["camera spans", spans]];
  const page = () => {
    const state = new Map(overlays.map((o, q) => [`labels ${q}`, `${o.style.opacity || "-"} ${o.style.visibility || "-"}${o.hasAttribute("inert") ? " inert" : ""}`]));
    state.set("cursor", canvas.style.cursor || "-");
    tip ??= [...box.children].find((n) => n !== canvas);
    if (tip instanceof HTMLElement) state.set("tip", `${tip.isConnected ? "" : "off the page: "}${tip.className} "${tip.textContent}" ${tip.style.transform || "-"}`);
    state.set("location", location.hash || "-");
    state.set("dev globals", "__jlBeats" in dev && "__jlRenderer" in dev ? "set" : "-");
    for (const [name, get] of watched) state.set(name, get());
    return state;
  };
  let shown = page();
  const flush = () => {
    const now = page();
    for (const [k, v] of now) if (shown.get(k) !== v) log.push(`${tick} ${watched.some(([name]) => name === k) ? "" : "page "}${k}: ${v}`);
    shown = now;
  };
  const stamp = (what: string) => {
    flush();
    log.push(`${tick} ${what}`);
  };
  kit.during = stamp;
  let id = 0;
  vi.stubGlobal("requestIdleCallback", idleCallback ? (cb: () => void) => (stamp("requestIdleCallback"), idles.push(cb)) : undefined);
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => (stamp("requestAnimationFrame"), frames.set(++id, cb), id));
  vi.stubGlobal("cancelAnimationFrame", (n: number) => (stamp("cancelAnimationFrame"), frames.delete(n)));
  const append = box.appendChild.bind(box);
  vi.spyOn(box, "appendChild").mockImplementation(<T extends Node>(n: T) => (stamp(`appendChild ${(n as unknown as Element).className}`), append(n)));
  const on = canvas.addEventListener.bind(canvas);
  const off = canvas.removeEventListener.bind(canvas);
  vi.spyOn(canvas, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => (stamp(`addEventListener ${type}`), on(type, fn, o)));
  vi.spyOn(canvas, "removeEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => (stamp(`removeEventListener ${type}`), off(type, fn, o)));
  const remove = Element.prototype.remove;
  vi.spyOn(Element.prototype, "remove").mockImplementation(function (this: Element) {
    stamp(`remove ${this.className}`);
    remove.call(this);
  });
  let glint: (() => void) | undefined;
  vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void, ms?: number) => (stamp(`setInterval ${ms}`), (glint = fn), 7)) as unknown as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation((n) => stamp(`clearInterval ${n}`));
  vi.spyOn(window, "open").mockImplementation(((url?: string | URL) => (stamp(`open ${url}`), null)) as typeof window.open);
  vi.spyOn(console, "error").mockImplementation((m: unknown) => stamp(`console.error ${m}`));
  // the canvas fills the top of the window, which is in front
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450, x: 0, y: 0, toJSON: () => ({}) });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const held: Array<{ ms: number; fn: () => void }> = [];
  if (timers) {
    const real = setTimeout;
    vi.stubGlobal("setTimeout", (fn: (...a: unknown[]) => void, ms = 0, ...a: unknown[]) => {
      // the director's own: set by director.ts itself, not by a library it calls
      const caller = new Error().stack?.split("\n")[2] ?? "";
      if (!/journey-lamplight\/director\.ts:/.test(caller)) return real(fn, ms, ...a);
      stamp(`setTimeout ${ms}`);
      held.push({ ms, fn: () => fn(...a) });
      return 0;
    });
    kit.later = (poll) => void held.push({ ms: 10, fn: poll });
  }
  /** Runs the oldest timer held for `ms`. */
  const fire = (ms: number) => {
    const i = held.findIndex((t) => t.ms === ms);
    expect(i, `a ${ms} ms timer is waiting`).toBeGreaterThanOrEqual(0);
    held.splice(i, 1)[0].fn();
  };
  /** Runs the frames queued, at time t. */
  const frame = (t: number) => () => {
    clock.now = t;
    const due = [...frames.values()];
    frames.clear();
    due.forEach((f) => f(t));
  };
  /** Runs fn as a task of its own: a ticker counts its microtasks from 0. Then lets it settle. */
  const task = async (what: string, fn: () => unknown) => {
    flush();
    log.push(`-- ${what}`);
    tick = 0;
    let n = 0;
    const count = () => {
      flush();
      tick++;
      if (++n < 100) queueMicrotask(count);
    };
    queueMicrotask(count);
    fn();
    await settle();
    flush();
  };
  /** Logs a value as it changes, with the page. */
  const watch = (name: string, get: () => string) => {
    watched.push([name, get]);
    shown.set(name, get());
  };
  return { log, stamp, task, clock, fire, frame, glint: () => glint!(), watch, canvas, overlays };
}

/** What a profile hands back, for the step logs. */
const times = (ps: Array<{ p: number; ms: number }>) => ps.map(({ p, ms }) => `${+p.toFixed(3)} in ${ms} ms`).join(", ");

describe("the journey's director", () => {
  it("sizes its renderer and pipelines to its stage, and tells its caller of its first frame, once", async () => {
    takeTime();
    // a screen denser than Retina: the director renders at twice the stage's size, no more
    vi.stubGlobal("devicePixelRatio", 3);
    const onFirstFrame = vi.fn();
    const d = await make({ onFirstFrame });
    expect(kit.calls.filter((c) => /^(setPixelRatio|setSize|pipeline) /.test(c))).toEqual([
      "setPixelRatio 2",
      "setSize 800x450",
      "pipeline 1600x900",
      "pipeline 1600x900",
    ]);
    expect(onFirstFrame).not.toHaveBeenCalled();
    await runFrame(1000);
    expect(kit.calls).toContain("render");
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
    d.jump(1);
    await runFrame(1100);
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
    d.resize(640, 360);
    expect(kit.calls.filter((c) => c.startsWith("setSize")).at(-1)).toBe("setSize 640x360");
    d.dispose();
  });

  it("reports a scene that fails after the first, once, builds the others, and leaves no rejection unhandled", async () => {
    kit.fail.add(2);
    const onError = vi.fn();
    const d = await make({ onError });
    await vi.waitFor(() => expect(kit.made).toHaveLength(SPANS.length), { timeout: 3000 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0][0] as Error).message).toBe("MOCK: scene 2 failed");
    // Drawing the failed scene asks for it again, which neither reports it again nor rejects unhandled.
    d.jump(TOTAL / 2);
    d.setProgress(TOTAL);
    await settle(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    d.dispose();
  });

  it("rejects, without reporting, when the first scene can't be built", async () => {
    kit.fail.add(0);
    const onError = vi.fn();
    await expect(make({ onError })).rejects.toThrow("MOCK: scene 0 failed");
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("reports a later scene whose shaders can't be set up, and still lets go of its renderer", async () => {
    takeTime();
    kit.throws.add("compileAsync 1 scene");
    const onError = vi.fn();
    const d = await make({ onError });
    await idleStep(); // scene 0, already built at the start
    await idleStep(); // scene 1, whose compile throws as it's called
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toBe("MOCK: scene 1 failed to set up its shaders");
    // nothing is left counted in flight, so dispose() lets go of the renderer at once
    d.dispose();
    expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("keeps each scene's warm-up in step with its compiles, when scenes build together", async () => {
    // three settles a compile within the call when it can ask the driver whether
    // the compile is done, and it is. Scene 2's assets come a moment after scene
    // 1's: each build's steps interleave exactly as they did before compiles were
    // counted, with nothing waiting an extra turn behind another scene's work
    takeTime();
    kit.parallel = true;
    kit.ticks.set(2, 1);
    const d = await make();
    kit.calls.length = 0;
    await d.prepareAll();
    const order = kit.calls.filter((c) => / [12] (scene|fx)$/.test(c));
    expect(order).toEqual([
      "compileAsync 1 scene",
      "compileAsync 1 fx",
      "compileAsync 2 scene",
      ...Array(4).fill("pipeline.render 1 scene"),
      "compileAsync 2 fx",
      ...Array(4).fill("pipeline.render 2 scene"),
    ]);
    d.dispose();
  });

  it("keeps every step of scenes that build together in its old place, with the failures' reports and prepareAll's", async () => {
    // as above, across whole builds: texture uploads, assets that come late or
    // fail, a compile that fails, the failures' reports and prepareAll's rejection
    // each keep their place among the other scenes' steps. The clock stands
    // still, so no upload yields
    takeTime();
    vi.spyOn(performance, "now").mockReturnValue(0);
    kit.parallel = true;
    kit.textures.set(1, 2);
    kit.textures.set(2, 1);
    kit.ticks.set(2, 1);
    kit.ticks.set(4, 2);
    kit.fail.add(3);
    kit.throws.add("compileAsync 5 scene");
    const d = await make({ onError: (e) => kit.calls.push(`onError ${(e as Error).message}`) });
    kit.calls.length = 0;
    await d.prepareAll().then(
      () => kit.calls.push("prepareAll resolved"),
      (e: Error) => kit.calls.push(`prepareAll rejected ${e.message}`),
    );
    await vi.waitFor(() => expect(kit.made).toHaveLength(SPANS.length));
    await settle();
    const order = kit.calls.filter((c) => / [1-5]( scene| fx)?$|^(onError|prepareAll) /.test(c));
    // the order the director made before compiles were counted (0944c0aa)
    expect(order).toEqual([
      "initTexture 1",
      "initTexture 1",
      "compileAsync 1 scene",
      "compileAsync 5 scene",
      "compileAsync 1 fx",
      "initTexture 2",
      "compileAsync 2 scene",
      "onError MOCK: scene 3 failed",
      ...Array(4).fill("pipeline.render 1 scene"),
      "compileAsync 2 fx",
      "prepareAll rejected MOCK: scene 3 failed",
      "compileAsync 4 scene",
      "onError MOCK: scene 5 failed to set up its shaders",
      ...Array(4).fill("pipeline.render 2 scene"),
      "compileAsync 4 fx",
      ...Array(4).fill("pipeline.render 4 scene"),
    ]);
    d.dispose();
  });

  it("keeps its background builds' place among the scenes it fetches ahead of the reader", async () => {
    // both wait for idle moments, in one queue, in the order they ask. The
    // background builds move on from scene 0, and a few microtasks later a draw
    // of scene 3, built out of turn, asks for scene 4: at each depth, the next
    // idle moment builds the scene it did before compiles were counted
    takeTime();
    kit.parallel = true;
    const next: number[] = [];
    for (let depth = 0; depth < 6; depth++) {
      kit.made.length = 0;
      idles.length = 0;
      const d = await make();
      d.jump(SCENE_START[3]);
      await settle();
      expect(kit.made).toEqual([0, 3]);
      idles.shift()?.(); // the background builds' turn for scene 0, built at the start
      let wait = depth;
      const draw = () => (wait-- ? queueMicrotask(draw) : d.jump(SCENE_START[3]));
      queueMicrotask(draw);
      await settle();
      expect(idles).toHaveLength(2);
      idles.shift()?.();
      await settle();
      next.push(kit.made[2]);
      d.dispose();
    }
    // recorded from the director before compiles were counted (0944c0aa)
    expect(next).toEqual([4, 4, 1, 1, 1, 1]);
  });

  it("draws a scene as soon as its warm-up is done", async () => {
    // a draw of scene 1 comes a few microtasks after its build begins: at each
    // depth, it draws the scene, or only asks for it, as it did before compiles
    // were counted
    takeTime();
    kit.parallel = true;
    const drew: boolean[] = [];
    for (let depth = 0; depth < 9; depth++) {
      const d = await make();
      d.jump(SCENE_START[1]); // not built yet: its build begins
      let wait = depth;
      let calls: string[] = [];
      const draw = () => {
        if (wait--) return queueMicrotask(draw);
        const from = kit.calls.length;
        d.jump(SCENE_START[1]);
        calls = kit.calls.slice(from);
      };
      queueMicrotask(draw);
      await settle();
      drew.push(calls.includes("render"));
      d.dispose();
    }
    // recorded from the director before compiles were counted (0944c0aa)
    expect(drew).toEqual([false, false, false, false, true, true, true, true, true]);
  });

  it("takes every step a caller can see in the microtask it did before", async () => {
    // each promise the director settles, and each report, is logged with the
    // rest (see stepLog). Every scene has code of its own, as real scenes do;
    // scenes 1 to 5 have no assets to wait for, as most real scenes don't. The
    // screen has twice the stage's pixels
    vi.stubGlobal("devicePixelRatio", 2);
    const { log, stamp, task, frame, canvas, overlays } = stepLog();
    kit.parallel = true;
    for (let i = 0; i < SPANS.length; i++) kit.code.add(i);
    for (let i = 1; i < SPANS.length; i++) kit.noAssets.add(i);
    let d!: Director;
    await task("start", () =>
      make({ canvas, overlays, onError: (e) => stamp(`onError ${(e as Error).message}`), onFirstFrame: () => stamp("onFirstFrame") }).then((x) => {
        d = x;
        stamp("started");
      }),
    );
    // draws scene 0, and fetches scene 1 ahead; then, in the same task, a profile draws
    // scene 0 a little way in, and at its start again: each shot puts the camera and
    // the focus back for the next. The clock stands still, so each takes 0 ms
    await task("frame", () => {
      frame(1000)();
      stamp(`profiled ${times(d.profile([0.25, 0]))}`);
    });
    await task("idle", () => idles.shift()?.()); // the background builds move on from scene 0
    await task("idle", () => idles.shift()?.()); // builds scene 1, fetched ahead
    await task("idle", () => idles.shift()?.()); // the background builds move on from scene 1
    // a small step on a GPU marked slow: it glides at the lower resolution, and comes
    // back to full resolution a moment after it rests
    vi.stubGlobal("__jlSlow", true);
    await task("setProgress", () => d.setProgress(0.001));
    for (const t of [1100, 1200, 1300, 1400, 1500]) await task("frame", frame(t));
    await task("frame", frame(1800)); // at rest
    vi.stubGlobal("__jlSlow", undefined);
    await task("jump", () => d.jump(SCENE_START[3])); // to scene 3, not built yet
    await task("frame", frame(1900));
    await task("jump", () => d.jump(SCENE_START[3] - OVERLAP / 2)); // into the cut from scene 2, not built yet
    await task("frame", frame(2000)); // scene 2 hands over to scene 3 its own way
    await task("prepareAll", () => d.prepareAll().then(() => stamp("prepareAll resolved")));
    await task("dispose", () => d.dispose());
    // recorded from the director before compiles were counted (0944c0aa)
    const STEPS = [
      "-- start",
      "0 THEME.paper = true",
      "0 loadFonts",
      "1 makeRenderer",
      "1 setPixelRatio 2",
      "1 setSize 800x450",
      ...Array(2).fill("1 pipeline 1600x900"),
      "1 THEME.paper read: true",
      "1 page dev globals: set",
      "1 appendChild jl-tip",
      "1 page tip: jl-tip \"\" -",
      "1 addEventListener pointermove",
      "1 addEventListener pointerleave",
      "1 addEventListener click",
      "1 setInterval 4200",
      "1 createBeat 0 for paper",
      "1 camera spans: 0 -",
      "3 camera spans: 0 6.05",
      "3 fitCamera 0 800x450",
      "3 compileAsync 0 scene shows 2",
      "4 compileAsync 0 fx shows 1",
      "5 pipeline.render 0 scene at rest focus 8 shows 3 culls 0",
      "5 update 0 0",
      "5 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "5 update 0 0.5",
      "5 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "5 update 0 1",
      "5 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "5 update 0 0",
      "7 requestAnimationFrame",
      "7 requestIdleCallback",
      "8 started",
      "-- frame",
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 page labels 0: 1 visible",
      "0 page labels 1: 0 hidden inert",
      "0 page labels 2: 0 hidden inert",
      "0 page labels 3: 0 hidden inert",
      "0 page labels 4: 0 hidden inert",
      "0 page labels 5: 0 hidden inert",
      "0 placeLabels 0 800x450 0",
      "0 requestIdleCallback",
      "0 onFirstFrame",
      "0 getContext",
      "0 finish",
      "0 update 0 0.048",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.028 focus 7.972 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0.048",
      "0 requestIdleCallback",
      ...Array(2).fill("0 finish"),
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestIdleCallback",
      "0 finish",
      "0 profiled 0.25 in 0 ms, 0 in 0 ms",
      "-- idle",
      "3 requestIdleCallback",
      "-- idle",
      "0 createBeat 1 for paper",
      "0 camera spans: 0 6.05, 1 -",
      "1 camera spans: 0 6.05, 1 3",
      "1 fitCamera 1 800x450",
      "1 compileAsync 1 scene shows 2",
      "2 compileAsync 1 fx shows 1",
      "3 pipeline.render 1 scene at rest focus 8 shows 3 culls 0",
      "3 update 1 0",
      "3 pipeline.render 1 scene at rest focus 8 shows 2 culls 3",
      "3 update 1 0.5",
      "3 pipeline.render 1 scene at rest focus 8 shows 2 culls 3",
      "3 update 1 1",
      "3 pipeline.render 1 scene at rest focus 8 shows 2 culls 3",
      "3 update 1 0",
      "-- idle",
      "-- setProgress",
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 1.6",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize 1280x720"),
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 2",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize 1600x900"),
      "0 update 0 0",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at rest focus 8 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "-- jump",
      "0 createBeat 3 for paper",
      "0 camera spans: 0 6.05, 1 3, 3 -",
      "1 camera spans: 0 6.05, 1 3, 3 1.4",
      "1 fitCamera 3 800x450",
      "1 compileAsync 3 scene shows 2",
      "2 compileAsync 3 fx shows 1",
      "3 pipeline.render 3 scene at rest focus 8 shows 3 culls 0",
      "3 update 3 0",
      "3 pipeline.render 3 scene at rest focus 8 shows 2 culls 3",
      "3 update 3 0.5",
      "3 pipeline.render 3 scene at rest focus 8 shows 2 culls 3",
      "3 update 3 1",
      "3 pipeline.render 3 scene at rest focus 8 shows 2 culls 3",
      "3 update 3 0",
      "5 requestAnimationFrame",
      "-- frame",
      "0 update 3 0.5",
      "0 fitCamera 3 800x450",
      "0 pipeline.render 3 scene at z-0.242 focus 7.758 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 page labels 0: 0 hidden inert",
      "0 page labels 3: 1 visible",
      "0 placeLabels 3 800x450 0.5",
      "0 requestIdleCallback",
      "-- jump",
      "0 createBeat 2 for paper",
      "0 camera spans: 0 6.05, 1 3, 2 -, 3 1.4",
      "0 update 3 0.25",
      "0 fitCamera 3 800x450",
      "0 pipeline.render 3 scene at z-0.121 focus 7.879 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 3 800x450 0.25",
      "0 requestIdleCallback",
      "1 camera spans: 0 6.05, 1 3, 2 1.4, 3 1.4",
      "1 fitCamera 2 800x450",
      "1 compileAsync 2 scene shows 2",
      "2 compileAsync 2 fx shows 1",
      "3 pipeline.render 2 scene at rest focus 8 shows 3 culls 0",
      "3 update 2 0",
      "3 pipeline.render 2 scene at rest focus 8 shows 2 culls 3",
      "3 update 2 0.5",
      "3 pipeline.render 2 scene at rest focus 8 shows 2 culls 3",
      "3 update 2 1",
      "3 pipeline.render 2 scene at rest focus 8 shows 2 culls 3",
      "3 update 2 0",
      "5 requestAnimationFrame",
      "-- frame",
      "0 update 3 0.25",
      "0 fitCamera 3 800x450",
      "0 cutIn 3 0.5",
      "0 pipeline.render 3 scene at z-0.121 focus 7.879 shows 2 culls 3",
      "0 update 2 1",
      "0 fitCamera 2 800x450",
      "0 cutOut 2 0.5 to 3",
      "0 pipeline.render 2 scene at z-0.737 focus 7.263 shows 2 culls 3",
      "0 setRenderTarget",
      "0 render ab mix 0.156 dip 0",
      "0 page labels 2: 0.8437499999999989 visible",
      "0 page labels 3: 0.15625000000000114 visible inert",
      "0 placeLabels 3 800x450 0.25",
      "0 placeLabels 2 800x450 1",
      "0 requestIdleCallback",
      "-- prepareAll",
      "0 createBeat 4 for paper",
      "0 camera spans: 0 6.05, 1 3, 2 1.4, 3 1.4, 4 -",
      "0 createBeat 5 for paper",
      "0 camera spans: 0 6.05, 1 3, 2 1.4, 3 1.4, 4 -, 5 -",
      "1 camera spans: 0 6.05, 1 3, 2 1.4, 3 1.4, 4 1.4, 5 -",
      "1 fitCamera 4 800x450",
      "1 compileAsync 4 scene shows 2",
      "1 camera spans: 0 6.05, 1 3, 2 1.4, 3 1.4, 4 1.4, 5 1.3",
      "1 fitCamera 5 800x450",
      "1 compileAsync 5 scene shows 2",
      "2 compileAsync 4 fx shows 1",
      "2 compileAsync 5 fx shows 1",
      "3 pipeline.render 4 scene at rest focus 8 shows 3 culls 0",
      "3 update 4 0",
      "3 pipeline.render 4 scene at rest focus 8 shows 2 culls 3",
      "3 update 4 0.5",
      "3 pipeline.render 4 scene at rest focus 8 shows 2 culls 3",
      "3 update 4 1",
      "3 pipeline.render 4 scene at rest focus 8 shows 2 culls 3",
      "3 update 4 0",
      "3 pipeline.render 5 scene at rest focus 8 shows 3 culls 0",
      "3 update 5 0",
      "3 pipeline.render 5 scene at rest focus 8 shows 2 culls 3",
      "3 update 5 0.5",
      "3 pipeline.render 5 scene at rest focus 8 shows 2 culls 3",
      "3 update 5 1",
      "3 pipeline.render 5 scene at rest focus 8 shows 2 culls 3",
      "3 update 5 0",
      "6 prepareAll resolved",
      "-- dispose",
      "0 clearInterval 7",
      "0 removeEventListener pointermove",
      "0 removeEventListener pointerleave",
      "0 removeEventListener click",
      "0 remove jl-tip",
      "0 page tip: off the page: jl-tip \"\" -",
      ...Array(2).fill("0 composer.dispose"),
      "0 dispose",
    ];
    expect(log).toEqual(STEPS);
  });

  it("takes every step of the reader's moves in the microtask it did before, where there's no requestIdleCallback", async () => {
    // as above, on a screen with twice the stage's pixels, in a browser without
    // requestIdleCallback (Safari's): an idle moment is a 60 ms timer. These scenes
    // have no code of their own. Scene 1 has three textures, one a shader's uniform,
    // and its uploads pass the 8 ms slice once; scene 2 fails, and scene 3 breaks as
    // it's made, with nothing listening for either. The build times are logged too
    vi.stubGlobal("devicePixelRatio", 2);
    const { log, stamp, task, clock, fire, frame, glint, watch, canvas, overlays } = stepLog({ timers: true, idleCallback: false });
    kit.parallel = true;
    kit.links.add(0);
    kit.textures.set(1, 3);
    kit.fail.add(2);
    kit.breaks.add(3);
    for (let i = 4; i < SPANS.length; i++) kit.noAssets.add(i);
    // each upload takes 5 ms: a build's second runs past the 8 ms slice, so it yields,
    // and its third starts a new slice. Making a scene takes 3 ms. As scene 1's first
    // texture uploads, the scene asks to be drawn again, as it would if one of its
    // links took focus then
    let asked = false;
    kit.during = (c) => {
      if (c.startsWith("initTexture")) clock.now += 5;
      if (c.startsWith("createBeat")) clock.now += 3;
      if (c === "initTexture 1" && !asked) {
        asked = true;
        kit.beats.get(1)!.invalidate?.();
      }
      stamp(c);
    };
    // the page's link is a quarter of the way in from the left, the site's from the right
    const point = (x: number, y = 225) => () => canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
    const click = (x: number, y = 225) => () => canvas.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y }));
    const leave = () => canvas.dispatchEvent(new MouseEvent("pointerleave"));
    let d!: Director;
    await task("start", () =>
      make({ canvas, overlays, onFirstFrame: () => stamp("onFirstFrame") }).then((x) => {
        d = x;
        watch("build times", () => x.buildTimes.join(" "));
        stamp("started");
      }),
    );
    await task("frame", frame(1000)); // draws scene 0 and its links, and fetches scene 1 ahead
    await task("idle", () => fire(60)); // the background builds move on from scene 0
    await task("idle", () => fire(60)); // builds scene 1, fetched ahead: two textures, then a yield
    await task("upload yield", () => fire(0)); // its third texture, its compiles and its warm-up
    await task("idle", () => fire(60)); // the background builds move on from scene 1
    await task("idle", () => fire(60)); // scene 2, which fails
    await task("idle", () => fire(60)); // scene 3, which breaks
    clock.now = 5000;
    await task("pointer", point(200)); // over the page's link, and the note's behind it: the page's lights, and the tooltip names it
    await task("frame", frame(5100));
    await task("pointer", point(220, 230)); // along the link: the tooltip follows
    await task("frame", frame(5200));
    await task("click", click(220, 230)); // follows the link
    await task("pointer", point(600)); // over the site's link: it lights instead
    await task("frame", frame(5300));
    await task("click", click(600)); // opens the site in a new tab
    // in one task, back over the page's link and on to the site's: the site's stays lit,
    // and the page's goes dark again
    await task("pointer, twice", () => {
      point(200)();
      point(600)();
    });
    await task("frame", frame(5350));
    await task("leave", leave); // both links go dark
    await task("frame", frame(5400));
    await task("frame", frame(5900)); // at rest
    await task("glint", glint); // the glint passes from link to link
    for (const t of [6250, 6600, 6950, 7300]) await task("frame", frame(t));
    await task("frame", frame(7900)); // past the glint: no more frames
    const beats = (window as unknown as { __jlBeats: Array<{ invalidate(): void } | null> }).__jlBeats;
    // scene 0 asks to be drawn again, and in the same task the pointer comes back over
    // the page's link: the link's 500 ms of frames outlast the redraw's 400
    await task("invalidate, then pointer", () => {
      beats[0]!.invalidate();
      point(200)();
    });
    await task("frame", frame(8000));
    await task("frame", frame(8350)); // past the redraw's 400 ms, not the link's 500
    await task("frame", frame(8450)); // past both: the last frame
    // the other way round: the pointer leaves, and then scene 0 asks to be drawn again,
    // so the redraw's 400 ms are the last word
    await task("leave, then invalidate", () => {
      leave();
      beats[0]!.invalidate();
    });
    await task("frame", frame(8550));
    await task("frame", frame(8900)); // past the redraw's 400 ms, not the pointer's 500: the last frame
    await task("pointer", point(200)); // over the page's link again
    // into the cut to scene 1, and the pointer moves in the same task: the link goes dark,
    // and there's nothing to point at in a cut
    await task("jump, then pointer", () => {
      d.jump(SCENE_START[1] - OVERLAP / 2);
      point(200)();
    });
    await task("frame", frame(9000));
    await task("leave", leave);
    await task("frame", frame(9100));
    // a target, and then a jump elsewhere, in one task: the jump wins
    await task("setProgress, then jump", () => {
      d.setProgress(SCENE_START[1] - OVERLAP / 2 + 0.05);
      d.jump(SCENE_START[1] - OVERLAP / 2);
    });
    await task("frame", frame(9200));
    await task("frame", frame(9600)); // at rest
    // a small step from rest, on frames 95 ms apart: a few frames in, the director finds
    // the GPU can't keep up, glides on at the lower resolution, and comes back to full
    // resolution a moment after it rests
    await task("setProgress", () => d.setProgress(SCENE_START[1] - OVERLAP / 2 + 0.003));
    for (let t = 9700; t <= 10460; t += 95) await task("frame", frame(t));
    await task("frame", frame(10800));
    // the middle of the cut into scene 1, both scenes tilted, and then scene 1 alone:
    // each pose starts from the camera's rest
    await task("profile", () => stamp(`profiled ${times(d.profile([SCENE_START[1] - OVERLAP / 2, SCENE_START[1]]))}`));
    await task("resize", () => d.resize(640, 360)); // at rest: the next frame draws the stage anew
    await task("frame", frame(10850));
    // in one task the stage resizes again, scene 1 asks to be drawn again, and a new
    // target comes: the redraw starts the glide from where the scene was
    await task("resize, invalidate, then setProgress", () => {
      d.resize(800, 450);
      beats[1]!.invalidate();
      d.setProgress(SCENE_START[1] - OVERLAP / 2 + 0.05);
    });
    await task("frame", frame(10900));
    await task("resize", () => d.resize(640, 360));
    await task("dispose", () => d.dispose()); // the glide's next frame still queued
    // recorded from the director before compiles were counted (0944c0aa)
    const MOVES = [
      "-- start",
      "0 THEME.paper = true",
      "0 loadFonts",
      "1 makeRenderer",
      "1 setPixelRatio 2",
      "1 setSize 800x450",
      ...Array(2).fill("1 pipeline 1600x900"),
      "1 THEME.paper read: true",
      "1 page dev globals: set",
      "1 appendChild jl-tip",
      "1 page tip: jl-tip \"\" -",
      "1 addEventListener pointermove",
      "1 addEventListener pointerleave",
      "1 addEventListener click",
      "1 setInterval 4200",
      "1 createBeat 0 for paper",
      "1 camera spans: 0 -",
      "3 camera spans: 0 6.05",
      "3 fitCamera 0 800x450",
      "3 compileAsync 0 scene shows 1",
      "4 compileAsync 0 fx shows 1",
      "5 pipeline.render 0 scene at rest shows 2 culls 0",
      ...Array(3).fill("5 pipeline.render 0 scene at rest shows 2 culls 2"),
      "7 requestAnimationFrame",
      "7 setTimeout 60",
      "8 started",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 page labels 0: 1 visible",
      "0 page labels 1: 0 hidden inert",
      "0 page labels 2: 0 hidden inert",
      "0 page labels 3: 0 hidden inert",
      "0 page labels 4: 0 hidden inert",
      "0 page labels 5: 0 hidden inert",
      "0 placeLabels 0 800x450 0",
      "0 setTimeout 60",
      "0 onFirstFrame",
      "-- idle",
      "3 setTimeout 60",
      "-- idle",
      "0 createBeat 1 for paper",
      "0 camera spans: 0 6.05, 1 -",
      "0 build times: 3 3 0 0 0 0",
      "2 camera spans: 0 6.05, 1 3",
      "2 fitCamera 1 800x450",
      "2 requestAnimationFrame",
      ...Array(2).fill("2 initTexture 1"),
      "2 setTimeout 0",
      "-- upload yield",
      "1 initTexture 1",
      "1 compileAsync 1 scene shows 4",
      "2 compileAsync 1 fx shows 1",
      "3 pipeline.render 1 scene at rest shows 5 culls 0",
      ...Array(3).fill("3 pipeline.render 1 scene at rest shows 5 culls 5"),
      "-- idle",
      "3 setTimeout 60",
      "-- idle",
      "1 createBeat 2 for paper",
      "1 camera spans: 0 6.05, 1 3, 2 -",
      "1 build times: 3 3 3 0 0 0",
      "4 console.error journey: a scene could not be built",
      "5 setTimeout 60",
      "-- idle",
      "1 createBeat 3 for paper",
      "2 console.error journey: a scene could not be built",
      "3 setTimeout 60",
      "-- pointer",
      "0 page cursor: pointer",
      "0 page tip: jl-tip is-on \"MOCK page \u2192\" translate(218px, 239px)",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0.35",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- pointer",
      "0 page tip: jl-tip is-on \"MOCK page \u2192\" translate(238px, 244px)",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0.577",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- click",
      "0 page location: #MOCK-page",
      "-- pointer",
      "0 page tip: jl-tip is-on \"MOCK site \u2192\" translate(618px, 239px)",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0.35",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- click",
      "0 open #MOCK-site",
      "-- pointer, twice",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0.577",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- leave",
      "0 page cursor: -",
      "0 page tip: jl-tip \"\" translate(618px, 239px)",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "-- glint",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0.45",
      "0 lightLink MOCK site 0.364",
      "0 lightLink MOCK note 0.139",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0.265",
      "0 lightLink MOCK note 0.428",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "-- invalidate, then pointer",
      "0 requestAnimationFrame",
      "0 page cursor: pointer",
      "0 page tip: jl-tip is-on \"MOCK page \u2192\" translate(218px, 239px)",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0.35",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0.577",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0.725",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "-- leave, then invalidate",
      "0 page cursor: -",
      "0 page tip: jl-tip \"\" translate(218px, 239px)",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 0 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 0 scene at rest shows 2 culls 2",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 placeLabels 0 800x450 0",
      "-- pointer",
      "0 page cursor: pointer",
      "0 page tip: jl-tip is-on \"MOCK page \u2192\" translate(218px, 239px)",
      "0 requestAnimationFrame",
      "-- jump, then pointer",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0.35",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 page cursor: -",
      "0 page tip: jl-tip \"\" translate(218px, 239px)",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 page labels 0: 0.5000000000000062 visible inert",
      "0 page labels 1: 0.4999999999999938 visible inert",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- leave",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- setProgress, then jump",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "-- setProgress",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.083 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.502 dip 0.45",
      "0 page labels 0: 0.4983691773315241 visible inert",
      "0 page labels 1: 0.5016308226684759 visible inert",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.083 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.788 qx0.328 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.51 dip 0.45",
      "0 page labels 0: 0.49045684495002717 visible inert",
      "0 page labels 1: 0.5095431550499728 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.082 qx0.352 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.788 qx0.328 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.516 dip 0.45",
      "0 page labels 0: 0.4844746299228676 visible inert",
      "0 page labels 1: 0.5155253700771324 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.081 qx0.352 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.789 qx0.329 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.52 dip 0.45",
      "0 page labels 0: 0.47995198037605435 visible inert",
      "0 page labels 1: 0.5200480196239456 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 1.6",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize 1280x720"),
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.081 qx0.351 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.789 qx0.329 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.523 dip 0.45",
      "0 page labels 0: 0.47653277587275245 visible inert",
      "0 page labels 1: 0.5234672241272476 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.081 qx0.351 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.789 qx0.329 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.526 dip 0.45",
      "0 page labels 0: 0.47394771753958287 visible inert",
      "0 page labels 1: 0.5260522824604171 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.081 qx0.351 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.79 qx0.329 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.528 dip 0.45",
      "0 page labels 0: 0.47199323167360663 visible inert",
      "0 page labels 1: 0.5280067683263934 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.08 qx0.351 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.79 qx0.329 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.529 dip 0.45",
      "0 page labels 0: 0.4705154457966456 visible inert",
      "0 page labels 1: 0.5294845542033544 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.08 qx0.351 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.79 qx0.329 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.531 dip 0.45",
      "0 page labels 0: 0.46939805400701573 visible inert",
      "0 page labels 1: 0.5306019459929843 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 2",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize 1600x900"),
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.08 qx0.35 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.79 qx0.33 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.534 dip 0.45",
      "0 page labels 0: 0.4659325694966244 visible inert",
      "0 page labels 1: 0.5340674305033756 visible inert",
      "0 placeLabels 1 800x450 0.113",
      "0 placeLabels 0 800x450 1",
      "-- profile",
      "0 getContext",
      "0 finish",
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.084 qx0.353 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.787 qx0.327 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.5 dip 0.45",
      "0 page labels 0: 0.5000000000000062 visible inert",
      "0 page labels 1: 0.4999999999999938 visible inert",
      "0 placeLabels 1 800x450 0.112",
      "0 placeLabels 0 800x450 1",
      ...Array(2).fill("0 finish"),
      "0 fitCamera 1 800x450",
      "0 pipeline.render 1 scene at z-0.113 shows 5 culls 5",
      "0 setRenderTarget",
      "0 render bb mix 1 dip 0.45",
      "0 page labels 0: 0 hidden inert",
      "0 page labels 1: 1 visible",
      "0 placeLabels 1 800x450 0.224",
      "0 finish",
      "0 profiled 5.775 in 0 ms, 6.05 in 0 ms",
      "-- resize",
      "0 setSize 640x360",
      "0 setPixelRatio 2",
      "0 setSize 640x360",
      ...Array(2).fill("0 pipeline.setSize 1280x720"),
      "0 fitCamera 0 640x360",
      "0 fitCamera 1 640x360",
      "0 requestAnimationFrame",
      "-- frame",
      "0 fitCamera 1 640x360",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.08 qx0.35 shows 5 culls 5",
      "0 fitCamera 0 640x360",
      "0 pipeline.render 0 scene at z-0.79 qx0.33 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.534 dip 0.45",
      "0 page labels 0: 0.4659325694966244 visible inert",
      "0 page labels 1: 0.5340674305033756 visible inert",
      "0 placeLabels 1 640x360 0.113",
      "0 placeLabels 0 640x360 1",
      "-- resize, invalidate, then setProgress",
      "0 setSize 800x450",
      "0 setPixelRatio 2",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize 1600x900"),
      "0 fitCamera 0 800x450",
      "0 fitCamera 1 800x450",
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 1.6",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize 1280x720"),
      "0 fitCamera 1 800x450",
      "0 lightLink MOCK page 0",
      "0 lightLink MOCK site 0",
      "0 lightLink MOCK note 0",
      "0 pipeline.render 1 scene at z0.077 qx0.348 shows 5 culls 5",
      "0 fitCamera 0 800x450",
      "0 pipeline.render 0 scene at z-0.793 qx0.332 shows 2 culls 2",
      "0 setRenderTarget",
      "0 render ab mix 0.56 dip 0.45",
      "0 page labels 0: 0.440485208488537 visible inert",
      "0 page labels 1: 0.559514791511463 visible inert",
      "0 placeLabels 1 800x450 0.114",
      "0 placeLabels 0 800x450 1",
      "0 requestAnimationFrame",
      "-- resize",
      "0 setSize 640x360",
      "0 setPixelRatio 1.6",
      "0 setSize 640x360",
      ...Array(2).fill("0 pipeline.setSize 1024x576"),
      "0 fitCamera 0 640x360",
      "0 fitCamera 1 640x360",
      "-- dispose",
      "0 clearInterval 7",
      "0 removeEventListener pointermove",
      "0 removeEventListener pointerleave",
      "0 removeEventListener click",
      "0 remove jl-tip",
      "0 page tip: off the page: jl-tip \"\" translate(218px, 239px)",
      "0 cancelAnimationFrame",
      ...Array(2).fill("0 composer.dispose"),
      "0 dispose",
    ];
    expect(log).toEqual(MOVES);
  });

  it("logs a later scene's failure where nothing listens for it", async () => {
    kit.fail.add(3);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await make();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("journey: a scene could not be built", expect.any(Error)), { timeout: 3000 });
    expect(unhandled).not.toHaveBeenCalled();
    d.dispose();
  });

  it("reports nothing for a scene that fails once it's disposed", async () => {
    kit.hold.add(1);
    const onError = vi.fn();
    const d = await make({ onError });
    await vi.waitFor(() => expect(kit.held.has(1)).toBe(true), { timeout: 3000 });
    d.dispose();
    kit.held.get(1)!.reject(new Error("MOCK: scene 1 failed late"));
    await settle(100);
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the journey's director lets go of what it set up", () => {
  it("on dispose()", async () => {
    const { canvas, overlays } = stage();
    const released = watch(canvas);
    const d = await make({ canvas, overlays });
    d.dispose();
    released();
  });

  it("once, if disposed twice", async () => {
    const { canvas, overlays } = stage();
    const released = watch(canvas);
    const d = await make({ canvas, overlays });
    d.dispose();
    d.dispose();
    released();
  });

  it("once, if disposed twice while a scene compiles", async () => {
    const { canvas, overlays } = stage();
    const released = watch(canvas);
    const open = gate("compileAsync 1 scene");
    const d = await make({ canvas, overlays });
    await idleStep(); // scene 0, already built at the start
    await idleStep(); // scene 1 starts
    await vi.waitFor(() => expect(kit.calls).toContain("compileAsync 1 scene"));
    d.dispose();
    d.dispose();
    open();
    await vi.waitFor(() => expect(kit.calls).toContain("dispose"));
    await settle();
    released();
  });

  // how the first scene fails: each arms the failure, and returns what sets it off
  const FAILED_STARTS: Array<[string, () => () => void]> = [
    [
      "can't load its assets",
      () => {
        kit.hold.add(0);
        return () => kit.held.get(0)!.reject(new Error("MOCK: scene 0 failed to load"));
      },
    ],
    [
      "can't compile its shaders",
      () => {
        let reject!: (e: Error) => void;
        kit.gates.set("compileAsync 0 scene", new Promise((_, r) => (reject = r)));
        return () => {
          expect(kit.calls).toContain("compileAsync 0 scene");
          reject(new Error("MOCK: scene 0 failed to compile"));
        };
      },
    ],
    [
      "can't set up its shaders",
      () => {
        // its compile throws as it's called, so no compile is left counted in flight
        kit.hold.add(0);
        kit.throws.add("compileAsync 0 scene");
        return () => kit.held.get(0)!.resolve();
      },
    ],
  ];
  it.each(FAILED_STARTS)("when the first scene %s, as its start rejects", async (_, arm) => {
    const { canvas, overlays } = stage();
    const released = watch(canvas);
    const fail = arm();
    const started = make({ canvas, overlays });
    await settle(10);
    // the reader's pointer crosses the canvas while the first scene builds: a frame is queued
    canvas.dispatchEvent(new MouseEvent("pointermove"));
    expect(frames.size).toBe(1);
    fail();
    await expect(started).rejects.toThrow(/^MOCK: scene 0 failed/);
    expect(kit.calls.filter((c) => c.startsWith("pipeline.render"))).toEqual([]);
    released();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("when its start fails, in the microtask #366's director did", async () => {
    // each step a caller can see (see stepLog). Before #366 the director let go
    // of nothing here, so the log is the one #366's director made (79f2304e)
    const steps = stepLog();
    kit.fail.add(0);
    const { canvas, overlays } = steps;
    await steps.task("start", () => make({ canvas, overlays }).catch((e: Error) => steps.stamp(`start rejected ${e.message}`)));
    const STEPS = [
      "-- start",
      "0 THEME.paper = true",
      "0 loadFonts",
      "1 makeRenderer",
      "1 setPixelRatio 1",
      "1 setSize 800x450",
      ...Array(2).fill("1 pipeline 800x450"),
      "1 THEME.paper read: true",
      "1 page dev globals: set",
      "1 appendChild jl-tip",
      "1 page tip: jl-tip \"\" -",
      "1 addEventListener pointermove",
      "1 addEventListener pointerleave",
      "1 addEventListener click",
      "1 setInterval 4200",
      "1 createBeat 0 for paper",
      "1 camera spans: 0 -",
      "4 clearInterval 7",
      "4 removeEventListener pointermove",
      "4 removeEventListener pointerleave",
      "4 removeEventListener click",
      "4 remove jl-tip",
      "4 page tip: off the page: jl-tip \"\" -",
      ...Array(2).fill("4 composer.dispose"),
      "4 dispose",
      "5 start rejected MOCK: scene 0 failed",
    ];
    expect(steps.log).toEqual(STEPS);
  });
});

describe("the journey's director, once disposed", () => {
  it("doesn't build a scene that was queued ahead of the reader", async () => {
    takeTime();
    const d = await make();
    // the first frame asks for the next scene in an idle moment
    await runFrame(1000);
    expect(kit.calls).toContain("render");
    expect(idles.length).toBeGreaterThan(1);
    d.dispose();
    await runIdle();
    expect(kit.made).toEqual([0]);
    expect(kit.late).toEqual([]);
  });

  it("stops building the scenes in the background", async () => {
    // no frame runs, so only the background builds wait for idle moments
    takeTime();
    const d = await make();
    await idleStep(); // scene 0, already built at the start
    await idleStep(); // scene 1
    expect(kit.made).toEqual([0, 1]);
    await vi.waitFor(() => expect(idles).toHaveLength(1)); // waits to build scene 2
    d.dispose();
    await runIdle();
    expect(kit.made).toEqual([0, 1]);
    expect(kit.late).toEqual([]);
  });

  // three's compile polls the renderer until its programs are ready, so the
  // renderer is let go only once the compile is done
  const midCompile = (call: string) => (d: Director) => {
    const open = gate(call);
    return async () => {
      await vi.waitFor(() => expect(kit.calls).toContain(call));
      d.dispose();
      expect(kit.calls).not.toContain("dispose");
      open();
    };
  };
  // the same, but the compile then fails. three's own can't fail this late, but
  // the renderer is let go all the same
  const midCompileFails = (call: string) => (d: Director) => {
    let fail!: (e: Error) => void;
    kit.gates.set(call, new Promise<void>((_, r) => (fail = r)));
    return async () => {
      await vi.waitFor(() => expect(kit.calls).toContain(call));
      d.dispose();
      expect(kit.calls).not.toContain("dispose");
      fail(new Error(`MOCK: ${call} failed`));
    };
  };
  // where in a scene's build the director is disposed, and what lets the build go on
  const MID_BUILD: Array<[string, (d: Director) => (() => Promise<void> | void) | void]> = [
    [
      "while it waits for its assets",
      (d) => {
        kit.hold.add(1);
        return () => {
          expect(kit.held.has(1)).toBe(true);
          d.dispose();
          kit.held.get(1)!.resolve();
        };
      },
    ],
    [
      "between two of its texture uploads",
      (d) => {
        kit.textures.set(1, 2);
        // the first upload runs past the 8 ms slice, so the build yields after it
        at("initTexture 1", () => {
          d.dispose();
          const t = performance.now();
          while (performance.now() - t < 10);
        });
      },
    ],
    [
      "while it yields between two of its texture uploads",
      (d) => {
        kit.textures.set(1, 2);
        // as above, but the director is disposed while the build waits for its next slice
        at("initTexture 1", () => {
          queueMicrotask(() => d.dispose());
          const t = performance.now();
          while (performance.now() - t < 10);
        });
      },
    ],
    ["as its meshes compile", midCompile("compileAsync 1 scene")],
    ["as its particles compile", midCompile("compileAsync 1 fx")],
    ["as its meshes compile, which then fails", midCompileFails("compileAsync 1 scene")],
  ];
  it.each(MID_BUILD)("stops a build in flight %s, before it touches the renderer again", async (_, arm) => {
    takeTime();
    const onError = vi.fn();
    const d = await make({ onError });
    const release = arm(d);
    await idleStep(); // scene 0, already built at the start
    await idleStep(); // scene 1 starts
    await release?.();
    await vi.waitFor(() => expect(kit.calls).toContain("dispose"));
    await settle();
    expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(kit.made).toEqual([0, 1]);
    expect(kit.late).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("lets go of its renderer only once the last compile in flight is done", async () => {
    takeTime();
    const d = await make();
    const open = [gate("compileAsync 1 scene"), gate("compileAsync 2 scene")];
    // what waits on the scenes hears that they won't come
    const prepared = d.prepareAll().then(
      () => "built",
      (e: Error) => e.message,
    );
    await vi.waitFor(() => expect(kit.calls).toEqual(expect.arrayContaining(["compileAsync 1 scene", "compileAsync 2 scene"])));
    d.dispose();
    open[0]();
    await settle();
    expect(kit.calls).not.toContain("dispose");
    open[1]();
    await vi.waitFor(() => expect(kit.calls).toContain("dispose"));
    expect(await prepared).toBe("journey: the director was disposed");
    await settle();
    expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(kit.late).toEqual([]);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("lets go of its renderer only once a compile that started just before is done", async () => {
    takeTime();
    kit.textures.set(1, 1);
    const d = await make();
    const open = gate("compileAsync 1 scene");
    await idleStep(); // the background builds move on from scene 0
    // scene 1's upload queues a dispose, which runs after its build has started the compile
    kit.during = (c) => {
      if (c === "initTexture 1") queueMicrotask(() => d.dispose());
    };
    await idleStep();
    expect(kit.calls).toContain("compileAsync 1 scene");
    await settle();
    expect(kit.calls).not.toContain("dispose");
    open();
    await vi.waitFor(() => expect(kit.calls).toContain("dispose"));
    await settle();
    expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
    expect(kit.late).toEqual([]);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("lets go of its renderer, and settles prepareAll, in the microtask #366's director did", async () => {
    // each step a caller can see (see stepLog), once disposed: a compile in flight
    // lets go of the renderer as it's done, and prepareAll settles at once. Before
    // #366 the director did neither, so the log is the one #366's director made (79f2304e)
    const { log, stamp, task, fire, canvas, overlays } = stepLog({ timers: true });
    kit.parallel = true;
    const open = gate("compileAsync 1 scene");
    let d!: Director;
    await task("start", () => make({ canvas, overlays }).then((x) => (d = x)));
    await task("idle", () => idles.shift()?.()); // the background builds move on from scene 0
    await task("idle", () => idles.shift()?.()); // scene 1, whose compile three polls until it's done
    await task("dispose", () => d.dispose());
    await task("prepareAll", () => d.prepareAll().then(() => stamp("prepareAll resolved")));
    await task("compile done", open);
    await task("poll", () => fire(10)); // three's poll finds it done
    // the start's frame, never run, is let go too
    const STEPS = [
      "-- dispose",
      "0 clearInterval 7",
      "0 removeEventListener pointermove",
      "0 removeEventListener pointerleave",
      "0 removeEventListener click",
      "0 remove jl-tip",
      "0 page tip: off the page: jl-tip \"\" -",
      "0 cancelAnimationFrame",
      ...Array(2).fill("0 composer.dispose"),
      "-- prepareAll",
      "1 prepareAll resolved",
      "-- compile done",
      "-- poll",
      "1 dispose",
    ];
    expect(log.slice(log.indexOf("-- dispose"))).toEqual(STEPS);
  });

  it("draws nothing, and builds no scene it's asked to draw", async () => {
    takeTime();
    const d = await make();
    d.jump(0.5);
    expect(kit.calls).toContain("render");
    d.dispose();
    d.jump(1);
    d.jump(TOTAL); // the last scene, not built yet
    d.setProgress(2);
    await runFrame(1000);
    await runIdle();
    expect(kit.made).toEqual([0]);
    expect(kit.late).toEqual([]);
  });

  it.each<[string, (d: Director) => unknown]>([
    ["resize", (d) => d.resize(640, 360)],
    ["profile", (d) => d.profile([0, 1])],
    ["prepareAll", (d) => d.prepareAll()],
  ])("does nothing on %s", async (_, call) => {
    takeTime();
    const d = await make();
    d.dispose();
    await call(d);
    await runIdle();
    expect(kit.made).toEqual([0]);
    expect(kit.late).toEqual([]);
  });

  // the reader's actions, as the homepage and the slide make them
  const action = fc.oneof(
    fc.record({ kind: fc.constant("frame" as const), ms: fc.integer({ min: 1, max: 120 }) }),
    fc.record({ kind: fc.constantFrom("idle" as const, "profile" as const, "prepareAll" as const) }),
    fc.record({ kind: fc.constantFrom("setProgress" as const, "jump" as const), p: fc.double({ min: -1, max: TOTAL + 1, noNaN: true }) }),
    fc.record({ kind: fc.constant("resize" as const), w: fc.integer({ min: 1, max: 2400 }) }),
    fc.record({ kind: fc.constantFrom("pointermove" as const, "pointerleave" as const, "click" as const) }),
  );
  it("touches nothing after dispose(), wherever it comes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(action, { maxLength: 30 }),
        fc.array(action, { maxLength: 10 }),
        // dispose as soon as the n-th renderer or pipeline call after the start returns (at the next
        // await of whatever made it: nothing in a call disposes the director), if before the actions run out
        fc.option(fc.nat({ max: 300 }), { nil: null }),
        fc.subarray([1, 2, 3, 4, 5]),
        fc.array(fc.nat({ max: 4 }), { minLength: SPANS.length, maxLength: SPANS.length }),
        // so that a dispose between two actions can find a build waiting on its assets or a compile
        fc.array(fc.record({ ready: fc.nat({ max: 4 }), compile: fc.nat({ max: 3 }) }), { minLength: SPANS.length, maxLength: SPANS.length }),
        async (before, after, inCall, failing, textures, latency) => {
          kit.fail.clear();
          kit.made.length = kit.calls.length = kit.late.length = 0;
          failing.forEach((i) => kit.fail.add(i));
          textures.forEach((n, i) => kit.textures.set(i, n));
          latency.forEach((l, i) => kit.latency.set(i, l));
          idles.length = 0;
          frames.clear();
          takeTime();
          let clock = 0;
          vi.spyOn(performance, "now").mockImplementation(() => clock);
          const onError = vi.fn();
          const { canvas, overlays } = stage();
          const d = await make({ canvas, overlays, onError });
          let then: { made: number; reported: number } | null = null;
          const dispose = () => {
            if (then) return;
            then = { made: kit.made.length, reported: onError.mock.calls.length };
            d.dispose();
          };
          const start = kit.calls.length;
          let queued = false;
          kit.during = (c) => {
            if (c.startsWith("initTexture")) clock += 3; // uploads take time, so builds yield
            if (queued || inCall === null || kit.calls.length - start <= inCall) return;
            queued = true;
            queueMicrotask(dispose);
          };
          const run = async (a: (typeof before)[number]) => {
            if (a.kind === "frame") {
              clock += a.ms;
              const due = [...frames.values()];
              frames.clear();
              due.forEach((f) => f(clock));
            } else if (a.kind === "idle") idles.shift()?.();
            else if (a.kind === "setProgress" || a.kind === "jump") d[a.kind](a.p);
            else if (a.kind === "resize") d.resize(a.w, Math.max(1, Math.round(a.w * 0.56)));
            else if (a.kind === "profile") d.profile([0, TOTAL / 2]);
            else if (a.kind === "prepareAll") void d.prepareAll().catch(() => undefined);
            else canvas.dispatchEvent(new MouseEvent(a.kind));
            await settle(1);
          };
          for (const a of before) await run(a);
          dispose();
          for (const a of after) await run(a);
          // whatever is still queued gets its chance
          await runIdle();
          await run({ kind: "frame", ms: 16 });
          // the renderer is let go once, when the last compile in flight is done
          await vi.waitFor(() => expect(kit.calls).toContain("dispose"));
          await settle(20);
          expect(kit.calls.filter((c) => c === "dispose")).toHaveLength(1);
          expect(kit.late).toEqual([]);
          expect(kit.made).toHaveLength(then!.made);
          expect(onError).toHaveBeenCalledTimes(then!.reported);
          expect(unhandled).not.toHaveBeenCalled();
          document.body.replaceChildren();
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
