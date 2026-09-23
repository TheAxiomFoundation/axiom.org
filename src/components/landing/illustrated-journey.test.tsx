import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IllustratedJourney } from './illustrated-journey';

const engine=vi.hoisted(()=>({create:vi.fn(),dispose:vi.fn(),setProgress:vi.fn(),setVisible:vi.fn()}));
vi.mock('./journey-3d',()=>({createJourneyScene:engine.create}));
let observers: Array<IntersectionObserverCallback>;
beforeEach(()=>{
  observers=[];vi.clearAllMocks();
  engine.create.mockImplementation(()=>({dispose:engine.dispose,setProgress:engine.setProgress,setVisible:engine.setVisible}));
  vi.stubGlobal('IntersectionObserver',class { constructor(callback:IntersectionObserverCallback){observers.push(callback);} observe(){} disconnect(){} });
  vi.spyOn(window,'matchMedia').mockReturnValue({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const enter=()=>act(()=>{observers.forEach(cb=>cb([{isIntersecting:true} as IntersectionObserverEntry],{} as IntersectionObserver));});

describe('3D journey lifecycle',()=>{
  it('loads the renderer near the section and disposes it on unmount',async()=>{
    const view=render(<IllustratedJourney/>);
    expect(engine.create).not.toHaveBeenCalled();
    enter();await waitFor(()=>expect(engine.create).toHaveBeenCalledTimes(1));
    expect(engine.setVisible).toHaveBeenCalledWith(true);
    view.unmount();expect(engine.dispose).toHaveBeenCalledTimes(1);
  });
  it('keeps a readable source when WebGL cannot start',async()=>{
    engine.create.mockImplementation(()=>{throw Error('WebGL unavailable');});
    render(<IllustratedJourney/>);enter();
    await waitFor(()=>expect(screen.queryByRole('navigation',{name:'Encoding journey chapters'})).not.toBeInTheDocument());
    expect(screen.getByRole('heading',{name:'Value of allotment'})).toBeVisible();
  });
  it('does not create a WebGL context for reduced-motion readers',()=>{
    vi.mocked(window.matchMedia).mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
    render(<IllustratedJourney/>);enter();
    expect(engine.create).not.toHaveBeenCalled();
    expect(screen.getByRole('heading',{name:'Value of allotment'})).toBeVisible();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
