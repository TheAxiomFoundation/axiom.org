"use client";

// Internal: the typeset pages of the journey's book, flat, for proofing.
import { useEffect, useRef } from "react";
import { BOOK } from "@/components/landing/style-frames/book-text";
import { loadFonts } from "@/components/landing/style-frames/kit";
import { typesetPages } from "@/components/landing/style-frames/pages";

export default function BookPagesPreview() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    (async () => {
      await loadFonts();
      const sec = (no: string) => BOOK.find((b) => b.no === no)!;
      const s2016 = sec("2016");
      const pages = [
        ...typesetPages([{ section: sec("2011") }, { section: sec("2012") }], ["recto", "verso"]),
        ...typesetPages([{ section: s2016 }], ["recto"]),
        ...typesetPages([{ continuation: { no: "2016", text: s2016.end!, subheads: s2016.subheads } }], ["verso"]),
        ...typesetPages([{ section: sec("2017") }, { section: sec("2018") }], ["recto", "verso", "recto"], { hot: "30 per centum" }),
      ];
      const host = ref.current!;
      host.innerHTML = "";
      pages.forEach((t) => {
        const c = t.image as HTMLCanvasElement;
        c.style.width = "512px";
        c.style.margin = "8px";
        host.appendChild(c);
      });
      (window as unknown as { __frameReady?: boolean }).__frameReady = true;
    })();
  }, []);
  return <div ref={ref} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#222", display: "flex", flexWrap: "wrap", alignContent: "flex-start", overflow: "auto" }} />;
}
