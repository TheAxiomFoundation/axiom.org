import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPANS, TOTAL } from "./captions";
import { createDirector } from "./director";

// MOCK rendering kit and scenes: jsdom has no WebGL. Each scene is empty, and
// the test decides which ones fail to build, and which it holds to fail later.
const kit = vi.hoisted(() => ({
  fail: new Set<number>(),
  hold: new Set<number>(),
  held: new Map<number, (e: Error) => void>(),
  made: [] as number[],
}));
vi.mock("../style-frames/kit", async () => {
  const THREE = await import("three");
  return {
    THEME: { paper: false },
    loadFonts: async () => {},
    makeRenderer: () => ({
      setPixelRatio() {},
      setSize() {},
      initTexture() {},
      compileAsync: async () => {},
      render() {},
      setRenderTarget() {},
      dispose() {},
      getContext: () => ({ finish() {} }),
    }),
    Pipeline: class {
      texture = null;
      composer = { dispose() {} };
      render() {}
      setSize() {}
    },
    createBeat: (build: { index: number }) => {
      kit.made.push(build.index);
      const camera = new THREE.PerspectiveCamera();
      Object.assign(camera.userData, { basePos: new THREE.Vector3(), baseQuat: new THREE.Quaternion(), baseFocus: 8 });
      const ready = kit.hold.has(build.index)
        ? new Promise<void>((_, reject) => kit.held.set(build.index, reject))
        : kit.fail.has(build.index)
          ? Promise.reject(new Error(`MOCK: scene ${build.index} failed`))
          : Promise.resolve();
      return {
        ready,
        camera,
        scene: new THREE.Scene(),
        fx: new THREE.Scene(),
        labels: [],
        links: [],
        look: {},
      };
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

const unhandled = vi.fn();
beforeEach(() => {
  kit.fail.clear();
  kit.hold.clear();
  kit.held.clear();
  kit.made.length = 0;
  process.on("unhandledRejection", unhandled);
});
afterEach(() => {
  process.off("unhandledRejection", unhandled);
  unhandled.mockReset();
  vi.restoreAllMocks();
});

function make(onError?: (e: unknown) => void) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const overlays = SPANS.map(() => document.createElement("div"));
  return createDirector({ canvas, overlays, width: 800, height: 450, paper: true, onError });
}

/** Lets idle builds, timers and rejections run their course. */
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe("the journey's director", () => {
  it("reports a scene that fails after the first, once, builds the others, and leaves no rejection unhandled", async () => {
    kit.fail.add(2);
    const onError = vi.fn();
    const d = await make(onError);
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
    await expect(make(onError)).rejects.toThrow("MOCK: scene 0 failed");
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
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
    const d = await make(onError);
    await vi.waitFor(() => expect(kit.held.has(1)).toBe(true), { timeout: 3000 });
    d.dispose();
    kit.held.get(1)!(new Error("MOCK: scene 1 failed late"));
    await settle(100);
    expect(onError).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
