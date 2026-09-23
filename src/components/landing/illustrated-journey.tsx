"use client";

import { useEffect, useRef, useState } from "react";
import "./illustrated-journey.css";
import type { createJourneyScene } from "./journey-3d";

const CHAPTERS = [
  ["The library", "Start with the law itself.", "One volume in a much larger collection."],
  ["The volume", "Title 7, off the shelf.", "The source comes forward. Nothing is detached from it."],
  ["The provision", "Open to § 2017.", "The words that will become an executable rule."],
];

export function IllustratedJourney() {
  const track=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null);
  const [active,setActive]=useState(0),[ready,setReady]=useState(false),[fallback,setFallback]=useState(false);
  useEffect(()=>{
    const root=track.current,canvasHost=host.current;if(!root||!canvasHost)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    let disposed=false,loading=false,inRange=false,visible=false,scene:ReturnType<typeof createJourneyScene>|undefined,lastChapter=-1;
    const update=()=>{const rect=root.getBoundingClientRect();const p=Math.max(0,Math.min(1,-rect.top/Math.max(1,rect.height-innerHeight)));scene?.setProgress(p);};
    const load=async()=>{
      if(loading||scene||disposed||media.matches||!inRange)return;loading=true;
      try{const {createJourneyScene}=await import('./journey-3d');if(disposed||media.matches)return;
        scene=createJourneyScene(canvasHost,p=>{const index=p<.33?0:p<.72?1:2;if(index!==lastChapter){lastChapter=index;setActive(index);}root.style.setProperty('--ij-progress',String(p));},()=>{setFallback(true);scene?.dispose();scene=undefined;});
        scene.setVisible(visible);update();setReady(true);
      }catch{if(!disposed)setFallback(true);}finally{loading=false;}
    };
    const preference=()=>{setFallback(media.matches);if(media.matches){scene?.dispose();scene=undefined;setReady(false);}else void load();};preference();
    const preload=new IntersectionObserver(([entry])=>{inRange=entry.isIntersecting;if(inRange)void load();},{rootMargin:'500px'});preload.observe(root);
    const viewport=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;scene?.setVisible(visible);if(visible)update();});viewport.observe(root);
    addEventListener('scroll',update,{passive:true});addEventListener('resize',update);media.addEventListener('change',preference);
    return()=>{disposed=true;preload.disconnect();viewport.disconnect();removeEventListener('scroll',update);removeEventListener('resize',update);media.removeEventListener('change',preference);scene?.dispose();};
  },[]);
  const goTo=(index:number)=>{const e=track.current;if(e)scrollTo({top:scrollY+e.getBoundingClientRect().top+[0,.47,1][index]*(e.offsetHeight-innerHeight),behavior:'smooth'});};
  return <div className={`ij-track${fallback?' ij-static':''}`} ref={track}>
    <div className="ij-stage">
      <div className="ij-canvas" ref={host}/>
      <div className="ij-vignette" aria-hidden="true"/>
      <header className="ij-caption"><span className="ij-kicker">0{(fallback?2:active)+1} / {CHAPTERS[fallback?2:active][0]}</span><h3>{CHAPTERS[fallback?2:active][1]}</h3><p>{CHAPTERS[fallback?2:active][2]}</p></header>
      {(!ready||fallback)&&<div className="ij-fallback"><div className="ij-fallback-cover"><small>UNITED STATES CODE</small><strong>Title 7</strong><span>Agriculture</span></div><article><span>7 USC § 2017(a)</span><h4>Value of allotment</h4><p>…reduced by an amount equal to <mark>30 per centum of the household’s income</mark>…</p></article></div>}
      <div className={`ij-source${active===2||fallback?' is-visible':''}`}><span>7 USC § 2017(a)</span><p>“…reduced by an amount equal to <mark>30 per centum of the household’s income</mark>…”</p></div>
      <div className="ij-footer"><span>THE ENCODING JOURNEY <b>·</b> MATERIAL & MOTION STUDY</span>{!fallback&&<span>Scroll to open the book ↓</span>}</div>
      {!fallback&&<nav className="ij-navigation" aria-label="Encoding journey chapters">{CHAPTERS.map(([label],i)=><button key={label} onClick={()=>goTo(i)} aria-current={active===i?'step':undefined}><span>0{i+1}</span>{label}</button>)}<i className="ij-progress"/></nav>}
      <p className="ij-accessible">A three-dimensional law library. Title 7 moves off its shelf, turns toward the reader, and opens to section 2017. Its source passage is preserved above as readable text.</p>
    </div>
  </div>;
}
