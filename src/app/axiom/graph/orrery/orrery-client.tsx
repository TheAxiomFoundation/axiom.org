"use client";

import dynamic from "next/dynamic";

const OrreryApp = dynamic(() => import("./orrery-app").then(module => module.OrreryApp), {
  ssr: false,
  loading: () => <p className="p-8" role="status">Loading Orrery…</p>,
});

export function OrreryClient() {
  return <OrreryApp />;
}
