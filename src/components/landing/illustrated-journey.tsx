"use client";

import { useEffect, useRef, useState } from "react";
import "./illustrated-journey.css";

const CHAPTERS = [
  { label: "The source", title: "It begins with the law.", text: "Before there is a model, there is a source. A book, a section, a sentence that says what must happen." },
  { label: "The provision", title: "Find the words that matter.", text: "Open Title 7 to § 2017. A single phrase establishes the relationship between a household’s income and its allotment." },
  { label: "The encoding", title: "Give those words structure.", text: "The provision becomes a typed, cited rule. Its formula stays connected to the language it represents." },
  { label: "The verification", title: "A disagreement is a way forward.", text: "Run it. Check it. Compare it independently. Review it. When a result disagrees, the encoding goes back for correction." },
  { label: "The connections", title: "One rule. Many connections.", text: "The verified rule joins its dependencies. Programs reuse the same underlying rules instead of encoding the same law again." },
  { label: "The whole", title: "A common foundation, growing.", text: "Every connected rule adds to an open, inspectable body of executable law. The wider collection is still being encoded." },
];
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

function Provision({ compact = false }: { compact?: boolean }) {
  return <div className={`ij-paper ${compact ? "ij-paper-small" : ""}`}>
    <div className="ij-paper-running">United States Code <span>Title 7</span></div>
    <div className="ij-paper-number">§ 2017</div>
    <h3>Value of allotment</h3>
    <p className="ij-paper-subtitle">Chapter 51 · Supplemental Nutrition Assistance Program</p>
    <div className="ij-paper-rule" />
    <p className="ij-excerpt">…reduced by an amount equal to <mark>30 per centum of the household’s income</mark>…</p>
    <div className="ij-paper-lines" aria-hidden="true"><i/><i/><i/><i/></div>
    <div className="ij-paper-footer">(a) Value of allotment <span>Source excerpt</span></div>
  </div>;
}
function Encoding({ corrected = true }: { corrected?: boolean }) {
  return <div className="ij-code">
    <div className="ij-code-top"><span>RuleSpec</span><span>snap / allotment</span></div>
    <div className="ij-code-meta"><span>Household</span><span>Money</span><span>Monthly</span></div>
    <p className="ij-code-comment">The rule, expressed as a calculation</p>
    <div className="ij-formula"><span>max</span>(0,<br/><span className="ij-indent">tfp − <b>{corrected ? "0.30" : "0.03"}</b> × net_income</span><br/>)</div>
    <div className="ij-source-link"><span>↳</span><div><b>{corrected ? "0.30" : "0.03"}</b> <span>← “30 per centum”</span><small>7 USC § 2017(a)</small></div></div>
    <p className="ij-example">Illustrative encoding · simplified for this story</p>
  </div>;
}
function Network({ wide = false }: { wide?: boolean }) {
  return <div className={`ij-network ${wide ? "ij-network-wide" : ""}`}>
    <svg viewBox="0 0 800 420" preserveAspectRatio="none" aria-hidden="true"><path d="M150 90H260V210H340M150 210H340M150 330H260V210M460 210H565V100H670M565 210H670M565 210V320H670"/></svg>
    <div className="ij-node ij-node-a"><small>DEPENDENCY</small>Thrifty food plan</div>
    <div className="ij-node ij-node-b"><small>DEPENDENCY</small>Net income</div>
    <div className="ij-node ij-node-c"><small>DEPENDENCY</small>Eligibility</div>
    <div className="ij-node ij-node-core"><span>§ 2017</span><strong>SNAP allotment</strong><small>Typed · cited · connected</small></div>
    <div className="ij-node ij-node-d">Colorado</div><div className="ij-node ij-node-e">New York</div><div className="ij-node ij-node-f">North Carolina</div>
    <p className="ij-network-note">Illustrative reuse across state programs</p>
  </div>;
}

export function IllustratedJourney() {
  const track = useRef<HTMLDivElement>(null);
  const scenes = useRef<Array<HTMLDivElement | null>>([]);
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (reduced || !track.current) return;
    const element = track.current;
    let frame = 0, current = 0, target = 0, previousTime = 0, visible = false, currentChapter = 0;
    const paint = () => {
      const position = current * (CHAPTERS.length - 1);
      const nextChapter = Math.round(position);
      if (nextChapter !== currentChapter) { currentChapter = nextChapter; setActive(nextChapter); }
      scenes.current.forEach((scene, i) => {
        if (!scene) return;
        const distance = Math.abs(position - i);
        const opacity = 1 - clamp((distance - .22) / .55);
        scene.style.opacity = String(opacity);
        scene.style.visibility = opacity > .001 ? "visible" : "hidden";
        scene.style.transform = `translate3d(0,${(i - position) * 22}px,0) scale(${1 - Math.min(distance, 1) * .018})`;
      });
      element.style.setProperty("--ij-progress", String(current));
    };
    const tick = (time: number) => {
      const dt = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      current += (target - current) * (1 - Math.exp(-dt / 110));
      if (Math.abs(target - current) < .0002) current = target;
      paint();
      if (visible && current !== target) frame = requestAnimationFrame(tick);
      else { frame = 0; previousTime = 0; }
    };
    const update = () => {
      const box = element.getBoundingClientRect();
      target = clamp(-box.top / Math.max(1, box.height - innerHeight));
      if (visible && !frame) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) update();
      else { cancelAnimationFrame(frame); frame = 0; }
    });
    observer.observe(element);
    update(); current = target; paint();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); removeEventListener("scroll", update); removeEventListener("resize", update); };
  }, [reduced]);
  const goTo = (index: number) => {
    if (!track.current) return;
    if (reduced) { scenes.current[index]?.scrollIntoView({ block: "center" }); return; }
    const box = track.current.getBoundingClientRect();
    scrollTo({ top: scrollY + box.top + index / (CHAPTERS.length - 1) * (box.height - innerHeight), behavior: "smooth" });
  };
  return <div className="ij-track" ref={track} data-reduced={reduced}>
    <div className="ij-stage">
      <div className="ij-topline"><span>FROM THE SOURCE TO THE SYSTEM</span><span>Axiom / The encoding journey</span></div>
      <div className="ij-scenes">
        {CHAPTERS.map((chapter, index) => <div key={chapter.label} className={`ij-scene ij-scene-${index}`} ref={el => { scenes.current[index] = el; }} aria-hidden={!reduced && active !== index}>
          <div className="ij-caption"><span className="ij-kicker">0{index + 1} / {chapter.label}</span><h2>{chapter.title}</h2><p>{chapter.text}</p></div>
          <div className="ij-art">
            {index === 0 && <><picture><source media="(max-width: 700px)" srcSet="/images/journey/library-800.webp"/><img src="/images/journey/library-1600.webp" alt="A terracotta-bound law book on a stone table in a quiet library" width="1600" height="900" loading="lazy" decoding="async"/></picture><span className="ij-volume-label">UNITED STATES CODE <b>Title 7</b><small>Agriculture</small></span></>}
            {index === 1 && <div className="ij-open-book"><div className="ij-book-underlay"/><Provision/></div>}
            {index === 2 && <div className="ij-translation"><Provision compact/><span className="ij-translation-arrow" aria-hidden="true">→</span><Encoding/></div>}
            {index === 3 && <div className="ij-verification"><Encoding/><div className="ij-checks"><span className="ij-checks-title">A correction, made visible</span><div><span className="ij-fail">×</span><p><strong>Compare</strong><small>0.03 disagrees with the source’s 30%.</small></p></div><div className="ij-correction"><s>0.03</s><span>→</span><b>0.30</b></div><div><span className="ij-pass">↻</span><p><strong>Correct and rerun</strong><small>The revised rule returns through the checks.</small></p></div><div className="ij-gates">Run <span>→</span> Checks <span>→</span> Compare <span>→</span> Review</div></div></div>}
            {index === 4 && <Network/>}
            {index === 5 && <div className="ij-whole"><div className="ij-unencoded" aria-hidden="true">{Array.from({length:72},(_,i)=><i key={i}/>)}</div><Network wide/><div className="ij-legend"><span><i/> Connected rules</span><span><i/> Still to encode</span></div></div>}
          </div>
        </div>)}
      </div>
      <nav className="ij-navigation" aria-label="Encoding journey chapters">{CHAPTERS.map((chapter,i)=><button key={chapter.label} onClick={()=>goTo(i)} aria-current={active===i ? "step" : undefined}><span>0{i+1}</span><b>{chapter.label}</b></button>)}<div className="ij-progress"/></nav>
      <span className="ij-scroll-hint" aria-hidden="true">Scroll to follow the rule ↓</span>
    </div>
  </div>;
}
