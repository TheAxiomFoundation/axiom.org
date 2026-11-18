"use client";

// The modelled aisle, as a mock: a see-through canvas on the page, a
// scrubber for the move down the aisle. Not the production beat.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadFonts } from "@/components/landing/style-frames/kit";
import { buildAisle, type AisleLook } from "@/components/landing/style-frames/aisle";

const LOOKS: Array<{ id: AisleLook; name: string }> = [
  { id: "blend", name: "Gallery + Before" },
  { id: "gallery", name: "1 Gallery" },
  { id: "paper", name: "2 Paper model" },
  { id: "fade", name: "3 Old to new" },
  { id: "classic", name: "Before" },
];

export function AisleMock() {
  const hostRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const [t, setT] = useState(0);
  const [ready, setReady] = useState(false);
  const [look, setLook] = useState<AisleLook>("blend");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      await loadFonts();
      if (dead) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.02;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.VSMShadowMap;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      host.appendChild(renderer.domElement);
      const aisle = buildAisle(look);
      const draw = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) {
          renderer.setSize(w, h, false);
          aisle.camera.aspect = w / h;
          aisle.camera.updateProjectionMatrix();
        }
        aisle.update(tRef.current);
        renderer.render(aisle.scene, aisle.camera);
      };
      drawRef.current = draw;
      draw();
      requestAnimationFrame(draw);
      setReady(true);
      const onResize = () => draw();
      window.addEventListener("resize", onResize);
      Object.assign(window, { __aisle: (v: number) => ((tRef.current = v), draw()) });
      cleanup = () => {
        window.removeEventListener("resize", onResize);
        aisle.dispose();
        renderer.dispose();
        host.innerHTML = "";
      };
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, [look]);

  return (
    <div className="lm-3d">
      <div ref={hostRef} className="lm-3d__host" data-ready={ready ? "1" : "0"} />
      <div className="lm-3d__looks" role="group" aria-label="Look">
        {LOOKS.map((l) => (
          <button key={l.id} type="button" aria-pressed={look === l.id} onClick={() => setLook(l.id)}>
            {l.name}
          </button>
        ))}
      </div>
      <label className="lm-3d__scrub">
        <span>Scroll</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.002}
          value={t}
          onChange={(e) => {
            const v = Number(e.target.value);
            tRef.current = v;
            setT(v);
            drawRef.current();
          }}
        />
      </label>
    </div>
  );
}
