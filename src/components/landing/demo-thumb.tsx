"use client";

import { useEffect, useState } from "react";

const DESKTOP_QUERY =
  "(hover: hover) and (pointer: fine) and (min-width: 1024px)";
const ANY_COARSE_QUERY = "(any-pointer: coarse)";

/** True only for devices we treat as able to afford live embeds:
 *  wide, hover-capable, fine-pointer, and with no touch input at all
 *  (`any-pointer: coarse` or a nonzero maxTouchPoints excludes
 *  touchscreen laptops and trackpad tablets, not just phones). Too
 *  strict only costs a device the live preview — it still gets the
 *  poster; too loose risks the crash loop below. */
function canAffordLiveEmbeds(): boolean {
  return (
    window.matchMedia(DESKTOP_QUERY).matches &&
    !window.matchMedia(ANY_COARSE_QUERY).matches &&
    navigator.maxTouchPoints === 0
  );
}

/**
 * Demo preview thumb: a static poster that upgrades to the live
 * scaled-iframe preview only on desktop-class devices.
 *
 * The gate is a crash guard, not a bandwidth nicety. Each live thumb
 * boots a full app document — and the /about thumb embeds the demo
 * gallery, which embeds six more apps, all laid out in the 5×
 * oversized viewport the 0.2-scale thumb creates. iPhone visitors
 * reported forced-reload loops on exactly these surfaces (/about
 * 9/1, landing 7/25) — consistent with the tab exceeding WebKit's
 * memory budget and Safari's crash-reload restoring scroll straight
 * back into the lazy thumb. That on-device chain is inferred, not
 * proven; the guard errs strict and never mounts live embeds on any
 * touch-capable device.
 *
 * The poster stays rendered underneath the live iframe so the upgrade
 * never shows a blank frame while the embed loads.
 */
export function DemoThumb({
  src,
  poster,
  title,
}: {
  /** The live surface the desktop preview embeds. */
  src: string;
  /** Static screenshot of the same surface, served to everyone else
   *  (regenerate with `bun run posters:capture`). */
  poster: string;
  title: string;
}) {
  const [live, setLive] = useState(false);

  useEffect(() => {
    const queries = [
      window.matchMedia(DESKTOP_QUERY),
      window.matchMedia(ANY_COARSE_QUERY),
    ];
    const apply = () => setLive(canAffordLiveEmbeds());
    apply();
    for (const q of queries) q.addEventListener("change", apply);
    return () => {
      for (const q of queries) q.removeEventListener("change", apply);
    };
  }, []);

  return (
    <span className="landing-demo-thumb" aria-hidden>
      <img src={poster} alt="" loading="lazy" decoding="async" />
      {live ? (
        <iframe src={src} title={title} loading="lazy" tabIndex={-1} />
      ) : null}
    </span>
  );
}
