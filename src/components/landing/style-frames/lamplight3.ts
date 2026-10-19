// Direction A — LAMPLIGHT, the end state. When the scroll story is done
// the eight steps settle into two rows of cards; each is a link to the
// real thing behind it. This frame shows one card (5, cited code) in its
// hover state: lifted, lit, with its note open.

import * as THREE from "three";
import { EXPLORE } from "../journey-digital/data";
import { canvasTexture, particleGeometry, particleMaterial, rng, W, H, type BeatCtx, type BeatSpec, type Look } from "./kit";

const HOVER = 5;

export function lamplightExplore(ctx: BeatCtx): BeatSpec {
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  camera.position.set(0, 0.35, 9.6);
  camera.lookAt(0, 0.55, 0);
  const focus = 9.4;
  const look: Look = {
    background: "#070504",
    exposure: 1.0,
    dof: { focus, aperture: 0.0008, maxblur: 0.006 },
    bloom: { strength: 0.6, radius: 0.6, threshold: 0.82 },
    grain: 0.05,
    vignette: 0.55,
  };
  const { scene, fx } = ctx;
  const r = rng(9);
  const haze = particleGeometry(7000, (i, o) => {
    o.p.set(-20 + r() * 40, -8 + r() * 16, -6 - r() * 30);
    o.c.set("#ffab4a").multiplyScalar(0.3 + r() * 0.45);
    o.size = 0.04 + r() * 0.05;
    o.alpha = 0.25 + r() * 0.3;
  });
  fx.add(new THREE.Points(haze, particleMaterial({ focus, aperture: 3 })));

  const CW = 1.86;
  const CH = CW * (9 / 16);
  const XS = [-3.2, -1.07, 1.07, 3.2];
  const YS = [1.98, 0.3];
  const loader = new THREE.TextureLoader();
  const loads: Promise<unknown>[] = [];
  const frameTex = (hot: boolean) =>
    canvasTexture(640, 380, (g) => {
      g.clearRect(0, 0, 640, 380);
      g.beginPath();
      g.roundRect(3, 3, 634, 374, 14);
      g.fillStyle = "rgba(24, 18, 13, 0.95)";
      g.fill();
      g.lineWidth = hot ? 5 : 2;
      g.strokeStyle = hot ? "#ffb45c" : "rgba(255, 190, 120, 0.4)";
      g.stroke();
    });
  EXPLORE.forEach((e, i) => {
    const hot = e.n === HOVER;
    const col = i % 4;
    const row = Math.floor(i / 4);
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(CW + 0.08, CH + 0.08), new THREE.MeshBasicMaterial({ map: frameTex(hot), transparent: true, color: new THREE.Color(1, 1, 1).multiplyScalar(hot ? 1.5 : 1), toneMapped: !hot }));
    back.position.z = -0.01;
    g.add(back);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(hot ? 1.0 : 0.62) });
    loads.push(
      loader.loadAsync(`/journey/posters/beat-${e.n}.jpg`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 16;
        mat.map = t;
        mat.needsUpdate = true;
      }),
    );
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), mat));
    const x = XS[col];
    g.position.set(x, YS[row], (-0.22 * Math.abs(x)) / 3.2);
    g.lookAt(camera.position.clone().setY(g.position.y));
    if (hot) {
      // the hovered card pops out toward the viewer
      g.position.z += 0.5;
      g.position.y += 0.05;
      g.scale.setScalar(1.05);
      const halo = canvasTexture(256, 256, (c) => {
        const gr = c.createRadialGradient(128, 128, 0, 128, 128, 128);
        gr.addColorStop(0, "rgba(255, 170, 80, 0.5)");
        gr.addColorStop(1, "rgba(255, 170, 80, 0)");
        c.fillStyle = gr;
        c.fillRect(0, 0, 256, 256);
      });
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(CW * 2.2, CH * 2.6),
        new THREE.MeshBasicMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(1, 1, 1).multiplyScalar(0.5) }),
      );
      glow.position.set(g.position.x, g.position.y, g.position.z - 0.3);
      fx.add(glow);
    }
    scene.add(g);
    g.updateMatrixWorld();
    const under = g.localToWorld(new THREE.Vector3(-CW / 2, -CH / 2 - 0.2, 0));
    ctx.label(
      under,
      `<span class="sf-x-n">${e.n}</span><span class="sf-x-name">${e.name}</span><span class="sf-x-go">${e.go} →</span>`,
      `sf-x${hot ? " sf-x--hot" : ""}`,
    );
    if (hot) {
      const side = g.localToWorld(new THREE.Vector3(CW / 2 + 0.18, CH / 2, 0));
      ctx.label(
        side,
        `<div class="sf-pop__k">${e.n} · ${e.name}</div><div class="sf-pop__t">${e.about}</div><div class="sf-pop__a">Open us/statutes/7/2017/a.yaml on GitHub →</div>`,
        "sf-pop",
      );
    }
  });
  return { camera, look, ready: Promise.all(loads) };
}
