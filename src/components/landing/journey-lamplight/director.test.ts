import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPANS, TOTAL } from "./captions";
import { createDirector, type Director } from "./director";

// MOCK rendering kit and scenes: jsdom has no WebGL. Each scene is empty, and
// the test decides which ones fail to build, and which it holds to settle later.
// The MOCK renderer and pipelines log every call, and set apart the calls made
// on them after their dispose().
const kit = vi.hoisted(() => {
  const kit = {
    fail: new Set<number>(),
    hold: new Set<number>(),
    held: new Map<number, { resolve: () => void; reject: (e: Error) => void }>(),
    made: [] as number[],
    textures: new Map<number, number>(), // how many MOCK textures a scene carries
    latency: new Map<number, { ready: number; compile: number }>(), // ms a scene's assets and compiles take
    ticks: new Map<number, number>(), // microtasks a scene's assets come late by
    gates: new Map<string, Promise<void>>(), // a compile, by its logged name, waits on this
    throws: new Set<string>(), // a compile, by its logged name, throws as it's called
    parallel: false, // three can ask the driver whether a compile is done (KHR_parallel_shader_compile)
    calls: [] as string[],
    late: [] as string[],
    pipelines: 0,
    polling: 0, // compiles still polling, of every director so far
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
        setPixelRatio: () => log("setPixelRatio"),
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
          return new Promise<void>((resolve, reject) => {
            const poll = () => {
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
      const camera = new THREE.PerspectiveCamera();
      Object.assign(camera.userData, { basePos: new THREE.Vector3(), baseQuat: new THREE.Quaternion(), baseFocus: 8 });
      let late = wait(kit.latency.get(i)?.ready ?? 0);
      for (let k = 0; k < (kit.ticks.get(i) ?? 0); k++) late = late.then(() => {});
      const ready = kit.hold.has(i)
        ? new Promise<void>((resolve, reject) => kit.held.set(i, { resolve, reject }))
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
      return { ready, camera, scene, fx, labels: [], links: [], look: {} };
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
  kit.hold.clear();
  kit.held.clear();
  kit.made.length = 0;
  kit.textures.clear();
  kit.latency.clear();
  kit.ticks.clear();
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
  // a director disposed while it compiles lets go of its renderer later: not in the next test
  await vi.waitFor(() => expect(kit.polling).toBe(0));
  await settle(1);
  process.off("unhandledRejection", unhandled);
  unhandled.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  idles.length = 0;
  frames.clear();
  document.body.replaceChildren();
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

describe("the journey's director", () => {
  it("sizes its renderer and pipelines to its stage, and tells its caller of its first frame, once", async () => {
    takeTime();
    const onFirstFrame = vi.fn();
    const d = await make({ onFirstFrame });
    expect(kit.calls.filter((c) => /^(setSize|pipeline) /.test(c))).toEqual(["setSize 800x450", "pipeline 800x450", "pipeline 800x450"]);
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
    // three settles a compile at once when it can ask the driver whether the compile
    // is done. Scene 2's assets come a moment after scene 1's: each build's steps
    // interleave exactly as they did before compiles were counted, with nothing
    // waiting an extra turn behind another scene's work
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
    ["as its meshes compile", midCompile("compileAsync 1 scene")],
    ["as its particles compile", midCompile("compileAsync 1 fx")],
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

  it("draws nothing", async () => {
    takeTime();
    const d = await make();
    d.jump(0.5);
    expect(kit.calls).toContain("render");
    d.dispose();
    d.jump(1);
    d.setProgress(2);
    await runFrame(1000);
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
