import {fireEvent, render, screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {LibrarySearchResults} from './library-search-results';

it('finds CTC by its existing program aliases across sources and opens its graph', async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({programs:[{program:{displayName:'Child Tax Credit'},anchors:[{citationPath:'us/statute/26/24'}]}],encoded:[{citationPath:'us/statute/26/24',filePath:'statutes/26/24.yaml',label:'26 24',symbolMatches:[{label:'CTC After Advance Payments'}]}]})}));
 const onPick=vi.fn();
 render(<LibrarySearchResults query="CTC" local={[]} onPick={onPick}/>);
 fireEvent.click(await screen.findByRole('button',{name:/Child Tax Credit/}));
 expect(onPick).toHaveBeenCalledWith('us:statutes/26/24');
 expect(fetch).toHaveBeenCalledWith('/api/axiom/search?q=CTC&limit=40',expect.objectContaining({signal:expect.any(AbortSignal)}));
 expect(screen.getAllByRole('button')).toHaveLength(1);
});
it('keeps immediate local matches when broader search fails',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 render(<LibrarySearchResults query="local-only-test" local={[{target:'us:statutes/26/32',title:'Earned income tax credit'}]} onPick={vi.fn()}/>);
 expect(screen.getByText('Earned income tax credit')).toBeInTheDocument();
 expect(await screen.findByText(/Broader search is unavailable/)).toBeInTheDocument();
});

it('shows program matches immediately while the network is still pending',()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 render(<LibrarySearchResults query="child tax credit" local={[{target:'us:regulations/26-cfr/example',title:'Related rule'}]} availableTargets={['us:statutes/26/24']} onPick={vi.fn()}/>);
 expect(screen.getByRole('button',{name:/Child Tax Credit/})).toBeInTheDocument();
 expect(screen.getByRole('region',{name:'Statutes'})).toBeInTheDocument();
 expect(screen.getByRole('region',{name:'Regulations'})).toBeInTheDocument();
 expect(screen.getByRole('status')).toHaveTextContent('Finding more matches');
});

it('bounds initial rendering for broad queries instead of mounting every match',()=>{
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const local=Array.from({length:1000},(_,i)=>({target:`us:statutes/26/${i}`,title:`Matching rule ${i}`}));
 render(<LibrarySearchResults query="wide query" local={local} onPick={vi.fn()}/>);
 expect(screen.getAllByRole('button',{name:/Matching rule/})).toHaveLength(12);
 fireEvent.click(screen.getByRole('button',{name:'Show 988 more'}));
 expect(screen.getAllByRole('button',{name:/Matching rule/})).toHaveLength(1000);
});
