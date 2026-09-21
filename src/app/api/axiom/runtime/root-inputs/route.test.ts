import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { runtimeProxyGet } from '@/lib/axiom/runtime/api';
vi.mock('@/lib/axiom/runtime/api', () => ({ runtimeProxyGet: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const request = () => new Request('http://localhost/api/axiom/runtime/root-inputs?root=us%3Astatutes%2F26%2F22');
it('checks the compiled input catalog without running an empty household', async () => {
 vi.mocked(runtimeProxyGet).mockResolvedValue({status:200,body:{status:'ok',data:{inputs:[{name:'income'}]}}});
 const response=await GET(request());
 expect(runtimeProxyGet).toHaveBeenCalledWith('/runtime/root-inputs?root=us%3Astatutes%2F26%2F22',{timeoutMs:20000,fresh:true});
 expect(response.status).toBe(200);
});
it.each([422,429,502,503])('does not cache a failed capability check (%s)',async status=>{
 vi.mocked(runtimeProxyGet).mockResolvedValue({status,body:{status:'error'}});
 const response=await GET(request());
 expect(response.status).toBe(status);
 expect(response.headers.get('cache-control')).toBe('no-store');
});
it('preserves declared metadata without inventing choices for inferred values', async () => {
 const declared = {name:'declared_status',entity:'Person',dtype:'integer',default:7,choices:[{value:7,label:'Declared A'},{value:9,label:'Declared B'}],category:'Declared category',order:2};
 const inferred = {name:'filing_status',entity:'TaxUnit',dtype:'integer',default:0,values:[0,1,2]};
 vi.mocked(runtimeProxyGet).mockResolvedValue({status:200,body:{status:'ok',data:{inputs:[declared,inferred]}}});
 const response = await GET(request());
 const inputs = (await response.json()).data.inputs;
 expect(inputs).toEqual([declared,inferred]);
 expect(inputs[1].choices).toBeUndefined();
});
