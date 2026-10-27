import fc from "fast-check";
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
    textures: new Map<number, number>(), // how many MOCK textures a scene carries
    latency: new Map<number, { ready: number; compile: number }>(), // ms a scene's assets and compiles take
    ticks: new Map<number, number>(), // microtasks a scene's assets come late by
    noAssets: new Set<number>(), // a scene with no assets to wait for: its beat has no ready, as most real ones don't
    links: new Set<number>(), // a scene with one MOCK link, square in front of its camera
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
    log(gone: boolean, call: string) {
      kit.calls.push(call);
      if (gone) kit.late.push(call);
      kit.during?.(call);
    },
  };
  return kit;
});
vi.mock("../style-frames/kit", async () => {
  const THREE = await import("three");
  const wait = (ms: number) => (ms ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
  return {
    THEME: { paper: false },
    loadFonts: async () => {},
    makeRenderer: () => {
      let gone = false;
      const log = (call: string) => kit.log(gone, call);
      return {
        setPixelRatio: (r: number) => log(`setPixelRatio ${r}`),
        setSize: (w: number, h: number) => log(`setSize ${w}x${h}`),
        initTexture: (t: { userData: { scene: number } }) => log(`initTexture ${t.userData.scene}`),
        // as three's does: it compiles at once, then polls its programs until they're
        // ready, at once if it can ask the driver and then every 10 ms. A poll on a
        // disposed renderer throws there, so the compile never settles; here that
        // poll is logged as late, and stops.
        compileAsync: (sc: { userData: { mock: string; index: number } }) => {
          const name = `compileAsync ${sc.userData.mock}`;
          log(name);
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
            const poll = () => {
              if (round !== kit.round) return;
              if (ready === false && !gone) return void setTimeout(poll, 10);
              kit.polling--;
              if (gone) log(`compile poll ${sc.userData.mock}`);
              else if (ready === true) resolve();
              else reject(ready);
            };
            if (kit.parallel) poll();
            else setTimeout(poll, 10);
          });
        },
        render: () => log("render"),
        setRenderTarget: () => log("setRenderTarget"),
        getContext: () => (log("getContext"), { finish() {} }),
        dispose: () => {
          log("dispose");
          gone = true;
        },
      };
    },
    Pipeline: class {
      texture = null;
      gone = false;
      composer = {
        dispose: () => {
          kit.log(this.gone, "composer.dispose");
          this.gone = true;
        },
      };
      constructor(_: unknown, w: number, h: number) {
        kit.pipelines++;
        kit.log(false, `pipeline ${w}x${h}`);
      }
      render(b: { scene: { userData: { mock: string } } }) {
        kit.log(this.gone, `pipeline.render ${b.scene.userData.mock}`);
      }
      setSize() {
        kit.log(this.gone, "pipeline.setSize");
      }
    },
    createBeat: (build: { index: number }) => {
      const i = build.index;
      kit.made.push(i);
      if (kit.breaks.has(i)) throw new Error(`MOCK: scene ${i} broke as it was made`);
      const camera = new THREE.PerspectiveCamera();
      Object.assign(camera.userData, { basePos: new THREE.Vector3(), baseQuat: new THREE.Quaternion(), baseFocus: 8 });
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
      for (let k = 0; k < (kit.textures.get(i) ?? 0); k++) {
        const map = new THREE.Texture();
        map.userData.scene = i;
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map })));
      }
      // the link's hit box faces the camera from 5 units ahead, so a pointer at the canvas's middle finds it
      const links = kit.links.has(i)
        ? [{ hit: new THREE.Mesh(new THREE.PlaneGeometry(10, 10).translate(0, 0, -5)), href: "#mock", text: "MOCK link", external: false, glow: 0, hover: false, focus: false }]
        : [];
      return { ready, camera, scene, fx, labels: [], links, look: {} };
    },
    fitCamera() {},
    placeLabels() {},
    lightLink() {},
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
  kit.textures.clear();
  kit.latency.clear();
  kit.ticks.clear();
  kit.noAssets.clear();
  kit.links.clear();
  kit.gates.clear();
  kit.throws.clear();
  kit.parallel = false;
  kit.calls.length = 0;
  kit.late.length = 0;
  kit.pipelines = 0;
  kit.during = null;
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
 * Logs each step a caller can see, with its microtask count from the start of
 * the task it came in: each renderer and pipeline call, each request for a
 * frame or an idle moment, and what the test stamps. The clock stands still
 * unless the test moves it (`clock.now`).
 *
 * With `timers`, the director's timers wait for the test, which runs each as a
 * task of its own (`fire`): an upload's yield (0 ms), an idle moment where there
 * is no requestIdleCallback (60 ms), and the MOCK compile's polls (10 ms, not
 * logged: three's, not the director's).
 */
function stepLog({ timers = false, idleCallback = true } = {}) {
  takeTime();
  const clock = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  let tick = 0;
  const log: string[] = [];
  const stamp = (what: string) => void log.push(`${tick} ${what}`);
  kit.during = stamp;
  let id = 0;
  vi.stubGlobal("requestIdleCallback", idleCallback ? (cb: () => void) => (stamp("requestIdleCallback"), idles.push(cb)) : undefined);
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => (stamp("requestAnimationFrame"), frames.set(++id, cb), id));
  vi.stubGlobal("cancelAnimationFrame", (n: number) => (stamp("cancelAnimationFrame"), frames.delete(n)));
  const held: Array<{ ms: number; fn: () => void }> = [];
  if (timers) {
    const real = setTimeout;
    vi.stubGlobal("setTimeout", (fn: (...a: unknown[]) => void, ms = 0, ...a: unknown[]) => {
      if (ms !== 0 && ms !== 10 && ms !== 60) return real(fn, ms, ...a);
      if (ms !== 10) stamp(`setTimeout ${ms}`);
      held.push({ ms, fn: () => fn(...a) });
      return 0;
    });
  }
  /** Runs the oldest timer held for `ms`. */
  const fire = (ms: number) => {
    const i = held.findIndex((t) => t.ms === ms);
    expect(i, `a ${ms} ms timer is waiting`).toBeGreaterThanOrEqual(0);
    held.splice(i, 1)[0].fn();
  };
  /** Runs fn as a task of its own: a ticker counts its microtasks from 0. Then lets it settle. */
  const task = async (what: string, fn: () => unknown) => {
    log.push(`-- ${what}`);
    tick = 0;
    let n = 0;
    const count = () => {
      tick++;
      if (++n < 100) queueMicrotask(count);
    };
    queueMicrotask(count);
    fn();
    await settle();
  };
  return { log, stamp, task, clock, fire };
}

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
    // rest (see stepLog). Scenes 1 to 5 have no assets to wait for, as most real
    // scenes don't
    const { log, stamp, task } = stepLog();
    kit.parallel = true;
    for (let i = 1; i < SPANS.length; i++) kit.noAssets.add(i);
    const frame = (t: number) => () => {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((f) => f(t));
    };
    let d!: Director;
    await task("start", () =>
      make({ onError: (e) => stamp(`onError ${(e as Error).message}`), onFirstFrame: () => stamp("onFirstFrame") }).then((x) => {
        d = x;
        stamp("started");
      }),
    );
    await task("frame", frame(1000)); // draws scene 0, and fetches scene 1 ahead
    await task("idle", () => idles.shift()?.()); // the background builds move on from scene 0
    await task("idle", () => idles.shift()?.()); // builds scene 1, fetched ahead
    await task("idle", () => idles.shift()?.()); // the background builds move on from scene 1
    await task("jump", () => d.jump(SCENE_START[3])); // to scene 3, not built yet
    await task("frame", frame(1100));
    await task("jump", () => d.jump(SCENE_START[3] - OVERLAP / 2)); // into the cut from scene 2, not built yet
    await task("frame", frame(1200));
    await task("prepareAll", () => d.prepareAll().then(() => stamp("prepareAll resolved")));
    await task("dispose", () => d.dispose());
    // recorded from the director before compiles were counted (0944c0aa)
    expect(log).toEqual([
      "-- start",
      "1 setPixelRatio 1",
      "1 setSize 800x450",
      ...Array(2).fill("1 pipeline 800x450"),
      "3 compileAsync 0 scene",
      "4 compileAsync 0 fx",
      ...Array(4).fill("5 pipeline.render 0 scene"),
      "7 requestAnimationFrame",
      "7 requestIdleCallback",
      "8 started",
      "-- frame",
      "0 pipeline.render 0 scene",
      "0 setRenderTarget",
      "0 render",
      "0 requestIdleCallback",
      "0 onFirstFrame",
      "-- idle",
      "3 requestIdleCallback",
      "-- idle",
      "1 compileAsync 1 scene",
      "2 compileAsync 1 fx",
      ...Array(4).fill("3 pipeline.render 1 scene"),
      "-- idle",
      "3 requestIdleCallback",
      "-- jump",
      "1 compileAsync 3 scene",
      "2 compileAsync 3 fx",
      ...Array(4).fill("3 pipeline.render 3 scene"),
      "5 requestAnimationFrame",
      "-- frame",
      "0 pipeline.render 3 scene",
      "0 setRenderTarget",
      "0 render",
      "0 requestIdleCallback",
      "-- jump",
      "0 pipeline.render 3 scene",
      "0 setRenderTarget",
      "0 render",
      "0 requestIdleCallback",
      "1 compileAsync 2 scene",
      "2 compileAsync 2 fx",
      ...Array(4).fill("3 pipeline.render 2 scene"),
      "5 requestAnimationFrame",
      "-- frame",
      "0 pipeline.render 3 scene",
      "0 pipeline.render 2 scene",
      "0 setRenderTarget",
      "0 render",
      "0 requestIdleCallback",
      "-- prepareAll",
      "1 compileAsync 4 scene",
      "1 compileAsync 5 scene",
      "2 compileAsync 4 fx",
      "2 compileAsync 5 fx",
      ...Array(4).fill("3 pipeline.render 4 scene"),
      ...Array(4).fill("3 pipeline.render 5 scene"),
      "6 prepareAll resolved",
      "-- dispose",
      ...Array(2).fill("0 composer.dispose"),
      "0 dispose",
    ]);
  });

  it("takes every step of the reader's moves in the microtask it did before, where there's no requestIdleCallback", async () => {
    // as above, in a browser without requestIdleCallback (Safari's): an idle moment
    // is a 60 ms timer. Scene 1's textures upload in slices; scene 2 fails, and
    // scene 3 breaks as it's made, with nothing listening for either. The reader
    // points at a link, which glints; a scene asks to be drawn again; the story
    // cuts away from the link, glides on a slow GPU, and is profiled, resized and
    // let go with a frame queued
    const { log, stamp, task, clock, fire } = stepLog({ timers: true, idleCallback: false });
    kit.parallel = true;
    kit.links.add(0);
    kit.textures.set(1, 2);
    kit.fail.add(2);
    kit.breaks.add(3);
    for (let i = 4; i < SPANS.length; i++) kit.noAssets.add(i);
    // each upload takes 10 ms, past the 8 ms slice, so the build yields after it
    kit.during = (c) => {
      if (c.startsWith("initTexture")) clock.now += 10;
      stamp(c);
    };
    const { canvas, overlays } = stage();
    const box = canvas.parentElement!;
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
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450, x: 0, y: 0, toJSON: () => ({}) });
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    let glint!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void) => ((glint = fn), 7)) as unknown as typeof window.setInterval);
    vi.spyOn(window, "clearInterval").mockImplementation((n) => stamp(`clearInterval ${n}`));
    vi.spyOn(console, "error").mockImplementation((m: unknown) => stamp(`console.error ${m}`));
    const frame = (t: number) => () => {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((f) => f(t));
    };
    const point = () => canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 400, clientY: 225 }));
    let d!: Director;
    await task("start", () =>
      make({ canvas, overlays, onFirstFrame: () => stamp("onFirstFrame") }).then((x) => {
        d = x;
        stamp("started");
      }),
    );
    await task("frame", frame(1000)); // draws scene 0 and its link, and fetches scene 1 ahead
    await task("idle", () => fire(60)); // the background builds move on from scene 0
    await task("idle", () => fire(60)); // builds scene 1, fetched ahead: its first texture, then a yield
    await task("upload yield", () => fire(0)); // its second texture, and a yield
    await task("upload yield", () => fire(0)); // its compiles and warm-up
    await task("idle", () => fire(60)); // the background builds move on from scene 1
    await task("idle", () => fire(60)); // scene 2, which fails
    await task("idle", () => fire(60)); // scene 3, which breaks
    clock.now = 5000;
    await task("pointer", point); // over the link: it lights up
    await task("frame", frame(5100)); // and asks for another frame while it does
    await task("frame", frame(5600));
    await task("glint", () => glint());
    await task("frame", frame(7000)); // past the glint
    const beats = (window as unknown as { __jlBeats: Array<{ invalidate(): void } | null> }).__jlBeats;
    await task("invalidate", () => beats[0]!.invalidate()); // scene 0 asks to be drawn again
    await task("frame", frame(7100));
    await task("jump", () => d.jump(SCENE_START[1] - OVERLAP / 2)); // into the cut to scene 1: the link goes dark
    await task("frame", frame(7200));
    await task("pointer", point); // nothing to point at in a cut
    await task("frame", frame(7300));
    await task("leave", () => canvas.dispatchEvent(new MouseEvent("pointerleave")));
    await task("frame", frame(7400));
    // a small step on a GPU that can't keep up: it glides at the lower resolution,
    // and comes back to full resolution a moment after it rests
    vi.stubGlobal("__jlSlow", true);
    await task("setProgress", () => d.setProgress(SCENE_START[1] - OVERLAP / 2 + 0.001));
    for (const t of [7500, 7600, 7700, 7800, 7900, 8200]) await task("frame", frame(t));
    await task("profile", () => d.profile([SCENE_START[1]]));
    await task("resize", () => d.resize(640, 360));
    await task("dispose", () => d.dispose()); // the resize's frame still queued
    // recorded from the director before compiles were counted (0944c0aa)
    const drawn = (...scenes: number[]) => [...scenes.map((s) => `0 pipeline.render ${s} scene`), "0 setRenderTarget", "0 render"];
    const STEPS = [
      "-- start",
      "1 setPixelRatio 1",
      "1 setSize 800x450",
      ...Array(2).fill("1 pipeline 800x450"),
      "1 appendChild jl-tip",
      "1 addEventListener pointermove",
      "1 addEventListener pointerleave",
      "1 addEventListener click",
      "3 compileAsync 0 scene",
      "4 compileAsync 0 fx",
      ...Array(4).fill("5 pipeline.render 0 scene"),
      "7 requestAnimationFrame",
      "7 setTimeout 60",
      "8 started",
      "-- frame",
      ...drawn(0),
      "0 setTimeout 60",
      "0 onFirstFrame",
      "-- idle",
      "3 setTimeout 60",
      "-- idle",
      "2 initTexture 1",
      "2 setTimeout 0",
      "-- upload yield",
      "1 initTexture 1",
      "1 setTimeout 0",
      "-- upload yield",
      "1 compileAsync 1 scene",
      "2 compileAsync 1 fx",
      ...Array(4).fill("3 pipeline.render 1 scene"),
      "-- idle",
      "3 setTimeout 60",
      "-- idle",
      "4 console.error journey: a scene could not be built",
      "5 setTimeout 60",
      "-- idle",
      "2 console.error journey: a scene could not be built",
      "3 setTimeout 60",
      "-- pointer",
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(0),
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(0),
      "-- glint",
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(0),
      "-- invalidate",
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(0),
      "-- jump",
      "0 requestAnimationFrame",
      ...drawn(1, 0),
      "-- frame",
      ...drawn(1, 0),
      "-- pointer",
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(1, 0),
      "-- leave",
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(1, 0),
      "-- setProgress",
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 1",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize"),
      ...drawn(1, 0),
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(1, 0),
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(1, 0),
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(1, 0),
      "0 requestAnimationFrame",
      "-- frame",
      ...drawn(1, 0),
      "0 requestAnimationFrame",
      "-- frame",
      "0 setPixelRatio 1",
      "0 setSize 800x450",
      ...Array(2).fill("0 pipeline.setSize"),
      ...drawn(1, 0),
      "-- profile",
      "0 getContext",
      ...drawn(1),
      "-- resize",
      "0 setSize 640x360",
      "0 setPixelRatio 1",
      "0 setSize 640x360",
      ...Array(2).fill("0 pipeline.setSize"),
      "0 requestAnimationFrame",
      "-- dispose",
      "0 clearInterval 7",
      "0 removeEventListener pointermove",
      "0 removeEventListener pointerleave",
      "0 removeEventListener click",
      "0 remove jl-tip",
      "0 cancelAnimationFrame",
      ...Array(2).fill("0 composer.dispose"),
      "0 dispose",
    ];
    expect(log).toEqual(STEPS);
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
    await steps.task("start", () => make().catch((e: Error) => steps.stamp(`start rejected ${e.message}`)));
    expect(steps.log).toEqual([
      "-- start",
      "1 setPixelRatio 1",
      "1 setSize 800x450",
      ...Array(2).fill("1 pipeline 800x450"),
      ...Array(2).fill("4 composer.dispose"),
      "4 dispose",
      "5 start rejected MOCK: scene 0 failed",
    ]);
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

  it("lets go of its renderer, and settles prepareAll, in the microtask #366's director did", async () => {
    // each step a caller can see (see stepLog), once disposed: a compile in flight
    // lets go of the renderer as it's done, and prepareAll settles at once. Before
    // #366 the director did neither, so the log is the one #366's director made (79f2304e)
    const { log, stamp, task, fire } = stepLog({ timers: true });
    kit.parallel = true;
    const open = gate("compileAsync 1 scene");
    let d!: Director;
    await task("start", () => make().then((x) => (d = x)));
    await task("idle", () => idles.shift()?.()); // the background builds move on from scene 0
    await task("idle", () => idles.shift()?.()); // scene 1, whose compile three polls until it's done
    await task("dispose", () => d.dispose());
    await task("prepareAll", () => d.prepareAll().then(() => stamp("prepareAll resolved")));
    await task("compile done", open);
    await task("poll", () => fire(10)); // three's poll finds it done
    expect(log.slice(log.indexOf("-- dispose"))).toEqual([
      "-- dispose",
      "0 cancelAnimationFrame", // the start's frame, never run
      ...Array(2).fill("0 composer.dispose"),
      "-- prepareAll",
      "1 prepareAll resolved",
      "-- compile done",
      "-- poll",
      "1 dispose",
    ]);
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
