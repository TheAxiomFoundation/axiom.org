"use client";

import { useEffect, useRef, useState } from "react";
import "./illustrated-journey.css";

const CHAPTERS = [
  ["The library", "The law, before it becomes code.", "Follow one volume off the shelf."],
  ["The provision", "Open to the words that matter.", "Title 7 · § 2017 · Value of allotment"],
  ["The encoding", "The passage becomes a rule.", "The citation stays attached to the calculation."],
  ["The verification", "Test. Disagree. Correct. Repeat.", "Run → checks → independent comparison → review"],
  ["The connections", "The same rule, used again.", "Dependencies connect; programs share the underlying law."],
  ["The whole", "One connected body of law.", "Pull back to see the work that remains."],
];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type Pose = [number, number, number];
function poseAt(p: number, poses: Pose[]): Pose {
  const i = Math.min(Math.floor(p), poses.length - 2), t = ease(p - i);
  return poses[i].map((v, j) => mix(v, poses[i + 1][j], t)) as Pose;
}

export function IllustratedJourney() {
  const track = useRef<HTMLDivElement>(null);
  const drawing = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState(0);
  const [compact, setCompact] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change(); media.addEventListener("change", change);
    const size = () => setCompact((track.current?.clientWidth ?? innerWidth) < 650);
    size(); addEventListener("resize", size);
    return () => { media.removeEventListener("change", change); removeEventListener("resize", size); };
  }, []);
  useEffect(() => {
    if (!track.current || !drawing.current) return;
    const element = track.current, svg = drawing.current;
    const groups = Object.fromEntries(Array.from(svg.querySelectorAll<SVGElement>("[data-part]")).map(el => [el.dataset.part!, el]));
    let frame = 0, current = 0, target = 0, lastTime = 0, visible = false, chapter = -1;
    const transform = (name: string, pose: Pose) => groups[name].setAttribute("transform", `translate(${pose[0]} ${pose[1]}) scale(${pose[2]})`);
    const opacity = (name: string, value: number) => { groups[name].style.opacity = String(value); };
    const paint = (p: number) => {
      const c = Math.min(5, Math.round(p));
      if (chapter !== c) { chapter = c; setActive(c); }
      // These are the same objects throughout: the volume leaves its slot,
      // opens, remains as the citation, and the encoding becomes the graph node.
      const bookPoses: Pose[] = compact
        ? [[263,184,.27],[100,55,1.8],[110,35,.52],[110,20,.4],[85,260,.35],[187.5,315,.175]]
        : [[471,184,.27],[490,72,1.25],[270,126,.84],[160,200,.55],[120,218,.4],[316,259.9,.22]];
      const rulePoses: Pose[] = compact
        ? [[280,155,.1],[280,155,.1],[60,285,1.6],[60,200,1.6],[190,290,.75],[240,330,.375]]
        : [[490,72,.1],[490,72,.1],[605,140,1.05],[540,138,1.1],[400,210,.8],[470,255.5,.44]];
      const [bx, by, bs] = poseAt(p, bookPoses);
      const pull = ease(p / .8);
      groups.book.setAttribute("transform", `translate(${bx} ${by}) scale(${bs * mix(.667,1,pull)} ${bs * mix(1.556,1,pull)})`);
      transform("rule", poseAt(p, rulePoses));
      const open = ease((p - .3) / .6);
      groups.cover.setAttribute("transform", `scale(${Math.max(.001, 1 - open)} 1)`);
      groups.leftpage.setAttribute("transform", `scale(${Math.max(.001, open)} 1)`);
      opacity("paper", 1);
      opacity("shelves", 1 - ease((p - .2) / .85) * .96);
      groups.shelves.setAttribute("transform", `translate(0 ${-ease(p / 1.2) * 30})`);
      opacity("rule", ease((p - 1.25) / .65));
      opacity("transfer", ease((p - 1.2) / .5) * (1 - ease((p - 2.2) / .5)));
      opacity("checks", ease((p - 2.2) / .5) * (1 - ease((p - 3.55) / .4)));
      const fixed = ease((p - 2.85) / .3);
      opacity("wrong", 1 - fixed); opacity("correct", fixed);
      opacity("passed", fixed); opacity("failed", 1 - fixed);
      opacity("network", ease((p - 3.25) / .65));
      const zoom = ease(p - 4);
      groups.network.setAttribute("transform", compact ? `translate(${mix(0,145,zoom)} ${mix(0,185,zoom)}) scale(${mix(1,.5,zoom)})` : `translate(${mix(0,250,zoom)} ${mix(0,140,zoom)}) scale(${mix(1,.55,zoom)})`);
      opacity("registry", ease((p - 4.15) / .8));
      groups.registry.setAttribute("transform", `translate(${500 * (1 - mix(1.4,1,zoom))} ${285 * (1 - mix(1.4,1,zoom))}) scale(${mix(1.4,1,zoom)})`);
      element.style.setProperty("--ij-progress", String(p / 5));
    };
    const tick = (time: number) => {
      const dt = lastTime ? Math.min(time - lastTime, 64) : 16; lastTime = time;
      current += (target - current) * (1 - Math.exp(-dt / 130));
      if (Math.abs(target - current) < .0002) current = target;
      paint(current);
      if (visible && current !== target) frame = requestAnimationFrame(tick);
      else { frame = 0; lastTime = 0; }
    };
    const update = () => {
      const box = element.getBoundingClientRect();
      target = reduced ? 4 : clamp(-box.top / Math.max(1, box.height - innerHeight)) * 5;
      if (reduced) paint(target);
      else if (visible && !frame) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) update(); else { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
    });
    observer.observe(element); update(); current = target; paint(current);
    addEventListener("scroll", update, { passive: true }); addEventListener("resize", update);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); removeEventListener("scroll", update); removeEventListener("resize", update); };
  }, [compact, reduced]);
  const goTo = (index: number) => {
    const e = track.current;
    if (e) scrollTo({ top: scrollY + e.getBoundingClientRect().top + index / 5 * (e.offsetHeight - innerHeight), behavior: "smooth" });
  };
  const w = compact ? 600 : 1000;
  const rows = 3;
  return <div className="ij-track" ref={track}>
    <div className="ij-stage">
      <header className="ij-caption">
        <span className="ij-kicker">0{active + 1} / {CHAPTERS[active][0]}</span>
        <h3>{CHAPTERS[active][1]}</h3><p>{CHAPTERS[active][2]}</p>
      </header>
      <div className="ij-canvas">
        <svg ref={drawing} viewBox={`0 0 ${w} ${compact ? 740 : 570}`} role="img" aria-label="A continuous journey: Title 7 leaves the shelf, opens to section 2017, becomes a cited rule, and joins the graph">
          <defs>
            <linearGradient id="ij-cloth" x2="1" y2="0"><stop stopColor="#873d22"/><stop offset=".08" stopColor="#bb673b"/><stop offset=".15" stopColor="#a95730"/><stop offset="1" stopColor="#b76439"/></linearGradient>
            <linearGradient id="ij-page"><stop stopColor="#ddd2b8"/><stop offset=".08" stopColor="#faf6e8"/><stop offset="1" stopColor="#fffdf5"/></linearGradient>
            <linearGradient id="ij-shelf" x2="0" y2="1"><stop stopColor="#d7cabb"/><stop offset="1" stopColor="#ece4d6"/></linearGradient>
          </defs>
          <g data-part="shelves">
            {Array.from({length:rows},(_,r)=><g key={r}>
              <rect x="35" y={r*155+20} width={w-70} height="145" fill="#e9e1d4"/>
              <rect x="35" y={r*155+156} width={w-70} height="9" rx="1" fill="url(#ij-shelf)"/>
              {Array.from({length:compact ? 10 : 18},(_,i)=>{
                if(r===1 && i===(compact ? 4 : 8)) return null;
                const x=55+i*52, h=85+(i*17+r*11)%43;
                return <g key={i}><rect x={x+2} y={r*155+155-h+3} width="43" height={h} rx="2" fill="#4a3322" opacity=".08"/><rect x={x} y={r*155+155-h} width="43" height={h} rx="2" fill={['#b4a18a','#6e796d','#b38365','#d2c5ad','#8a8172'][i%5]}/><path d={`M${x+6} ${r*155+160-h}V${r*155+150}`} stroke="#fff" opacity=".18"/><path d={`M${x+9} ${r*155+170-h}h25 M${x+9} ${r*155+145}h25`} stroke="#eee5ce" opacity=".5"/>{h>100&&<text transform={`translate(${x+25} ${r*155+125}) rotate(-90)`} className="ij-spine">{['US CODE','REGULATIONS','GUIDANCE','STATE LAW'][i%4]}</text>}</g>;
              })}
            </g>)}
            <text x={w/2} y="520" textAnchor="middle" className="ij-shelf-label">THE LAW LIBRARY</text>
          </g>
          <g data-part="registry" opacity="0" aria-hidden="true">
            {Array.from({length:60},(_,i)=>{const cols=compact?6:10,x=28+(i%cols)*(compact?94:98),y=25+Math.floor(i/cols)*(compact?68:87);return <g key={i} opacity={i%5===0?.6:.3}><rect x={x} y={y} width="55" height="31" rx="3" fill={i%5===0?'#e1e6d9':'none'} stroke="#a29883"/>{i%cols!==cols-1&&<path d={`M${x+55} ${y+15}h43`} stroke="#b5aa93"/>}</g>;})}
          </g>
          <g data-part="network" opacity="0">
            <path className="ij-wire" d={compact?"M85 410V325H190 M310 235V290 M310 470V463 M415 370H495V180 M495 370V580":"M210 310H400 M325 120H375V260H400 M325 445H375V355H400 M640 303H735V155H790 M735 303H790 M735 303V440H790"}/>
            {(compact ? [[220,175,'Thrifty food plan'],[220,475,'Net income'],[425,110,'Colorado'],[425,560,'New York']] : [[170,82,'Thrifty food plan'],[170,407,'Net income'],[790,117,'Colorado'],[790,265,'New York'],[790,402,'North Carolina']]).map(([x,y,label])=><g key={label} transform={`translate(${x} ${y})`}><rect width={compact?145:155} height="76" rx="5" fill="#f9f5ea" stroke="#bcb29e"/><text x="14" y="23" className="ij-tiny">{String(label).includes('income')||String(label).includes('plan')?'DEPENDENCY':'PROGRAM'}</text><text x="14" y="49" className="ij-node-label">{label}</text></g>)}
          </g>
          <g data-part="book">
            <g data-part="leftpage"><path d="M0 4Q-115 -9 -230 4V300Q-115 287 0 300Z" fill="#ab5934"/><path d="M-4 7Q-110 -4 -224 7V290Q-110 280 -4 292Z" fill="url(#ij-page)"/><text x="-196" y="48" className="ij-running">UNITED STATES CODE</text><text x="-196" y="99" className="ij-page-heading">Title 7</text><text x="-196" y="125" className="ij-page-sub">Agriculture</text><path d="M-196 153H-28 M-196 174H-35 M-196 187H-42 M-196 200H-28 M-196 213H-50" stroke="#d8cfba"/><text x="-196" y="267" className="ij-running">CHAPTER 51 · SNAP</text></g>
            <rect x="3" y="5" width="230" height="300" rx="3" fill="#53301d" opacity=".12"/>
            <g data-part="paper"><rect width="230" height="300" rx="2" fill="url(#ij-page)" stroke="#d6c8aa"/><text x="20" y="30" className="ij-running">7 USC § 2017(a)</text><text x="20" y="66" className="ij-page-heading">Value of allotment</text><path d="M20 84H210" stroke="#d8cfba"/><text x="20" y="115" className="ij-law">…reduced by an amount</text><text x="20" y="140" className="ij-law">equal to</text><rect x="18" y="151" width="191" height="53" fill="#ecd197" opacity=".7"/><text x="20" y="172" className="ij-law">30 per centum of the</text><text x="20" y="196" className="ij-law">household’s income…</text><path d="M20 230H210 M20 240H192 M20 250H202" stroke="#e0d7c1"/><text x="20" y="281" className="ij-running">SOURCE PROVISION</text></g>
            <g data-part="cover"><rect width="230" height="300" rx="4" fill="url(#ij-cloth)"/><path d="M16 4V296 M20 4V296" stroke="#733c22" opacity=".35"/><rect x="37" y="26" width="173" height="248" fill="none" stroke="#e7bd83" strokeWidth=".7"/><text x="124" y="92" textAnchor="middle" className="ij-cover-small">UNITED STATES</text><text x="124" y="120" textAnchor="middle" className="ij-cover-small">CODE</text><text x="124" y="176" textAnchor="middle" className="ij-cover-title">Title 7</text><text x="124" y="213" textAnchor="middle" className="ij-cover-small">AGRICULTURE</text></g>
          </g>
          <g data-part="transfer" opacity="0"><path d={compact?"M245 225C410 230 470 310 400 370":"M465 274C540 274 548 284 605 284"} fill="none" stroke="#b77540" strokeWidth="1.5" strokeDasharray="4 5"/><circle cx={compact?400:605} cy={compact?370:284} r="4" fill="#b77540"/></g>
          <g data-part="rule" opacity="0">
            <rect x="3" y="8" width="300" height="240" rx="7" fill="#314132" opacity=".1"/><rect width="300" height="240" rx="6" fill="#34453b"/><text x="22" y="31" className="ij-code-eyebrow">RULESPEC / SNAP</text><text x="22" y="69" className="ij-code-title">Allotment</text><path d="M22 87H278" stroke="#667767"/><text x="22" y="111" className="ij-code-meta">Household · Money · Month</text><text x="22" y="147" className="ij-code-formula">max(0, tfp −</text><g data-part="wrong"><text x="38" y="177" className="ij-code-formula ij-bad">0.03</text></g><g data-part="correct"><text x="38" y="177" className="ij-code-formula ij-good">0.30</text></g><text x="93" y="177" className="ij-code-formula">× net_income)</text><path d="M22 193H278" stroke="#667767"/><text x="22" y="221" className="ij-citation">↳ 7 USC § 2017(a) · “30 per centum”</text>
          </g>
          <g data-part="checks" opacity="0" transform={compact?'translate(100 550)':'translate(280 440)'}>
            <g data-part="failed"><circle cx="0" cy="-5" r="12" fill="#a75330"/><text x="0" y="0" textAnchor="middle" fill="#fff" fontSize="18">×</text><text x="24" y="0" className="ij-check-label">Comparison disagrees: 0.03 ≠ 30%</text></g>
            <g data-part="passed"><circle cx="0" cy="-5" r="12" fill="#586f4b"/><text x="0" y="0" textAnchor="middle" fill="#fff" fontSize="16">✓</text><text x="24" y="0" className="ij-check-label">Corrected to 0.30 · checks rerun</text></g>
            <text x="24" y="30" className="ij-check-sub">RUN → CHECKS → COMPARE → REVIEW</text>
          </g>
        </svg>
      </div>
      <div className="ij-footer"><span>Illustrative encoding and network</span><span>Scroll to follow the rule ↓</span></div>
      {!reduced && <nav className="ij-navigation" aria-label="Encoding journey chapters">{CHAPTERS.map((chapter,i)=><button key={chapter[0]} onClick={()=>goTo(i)} aria-current={active===i?'step':undefined} aria-label={chapter[0]}><span>0{i+1}</span><b>{chapter[0]}</b></button>)}<i className="ij-progress"/></nav>}
      {reduced && <ol className="ij-transcript">{CHAPTERS.map(([label,title,text])=><li key={label}><strong>{title}</strong> {text}</li>)}</ol>}
    </div>
  </div>;
}
