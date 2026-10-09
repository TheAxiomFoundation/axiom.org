import { compositionScope } from "@/lib/axiom/runtime/composition-readiness";
import { describeRelation } from "@/lib/axiom/runtime/relation-roles";
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
 const data = (await response.json()).data;
 const inputs = data.inputs;
 expect(inputs).toEqual([declared,inferred]);
 expect(data).toMatchObject({relations:[], relation_membership:'convention'});
 expect(inputs[1].choices).toBeUndefined();
});

vi.mock("@/lib/axiom/runtime/composition-readiness", () => ({compositionScope:vi.fn().mockResolvedValue({readiness:"ready",relations:[]})}));
it('does not advertise Run for unsupported relationship scopes', async () => {
 vi.mocked(runtimeProxyGet).mockResolvedValue({status:200,body:{status:'ok',data:{inputs:[]}}});
 vi.mocked(compositionScope).mockResolvedValueOnce({readiness:'relationships_unsupported',relations:[]});
 const response = await GET(request());
 expect(response.status).toBe(422);
 expect(response.headers.get('cache-control')).toBe('no-store');
});

const roles = (file: string, name: string) => describeRelation({name, kind:'data_relation', data_relation:{arity:2, arguments:['TaxUnit','Person']}}, file);
const EITC = [roles('us:statutes/26/32','qualifying_child_of_tax_unit'), roles('us:statutes/26/151','exemption_individual_of_tax_unit')];
it('offers Run for a several-relation scope only when the runtime accepts explicit roles', async () => {
 vi.mocked(compositionScope).mockResolvedValue({readiness:'roles_required',relations:EITC});
 vi.mocked(runtimeProxyGet).mockResolvedValueOnce({status:200,body:{status:'ok',data:{inputs:[]}}});
 const older = await GET(request());
 expect(older.status).toBe(422);
 const refusal = (await older.json()).error;
 expect(refusal.code).toBe('relationships_unsupported');
 expect(refusal.message).toMatch(/cannot take them yet/);
 const runtimeRelations = EITC.map(relation => ({name:relation.relationId, slot_entities:['TaxUnit','Person'], tuple:['household:1','person:1:{index}'], explicit:true}));
 vi.mocked(runtimeProxyGet).mockResolvedValueOnce({status:200,body:{status:'ok',data:{inputs:[],relation_membership:['convention','explicit'],relations:runtimeRelations.slice(1)}}});
 const mismatched = await GET(request());
 expect(mismatched.status).toBe(422);
 expect((await mismatched.json()).error.message).toMatch(/do not match/);
 vi.mocked(runtimeProxyGet).mockResolvedValueOnce({status:200,body:{status:'ok',data:{inputs:[],relation_membership:['convention','explicit'],relations:runtimeRelations}}});
 const newer = await GET(request());
 expect(newer.status).toBe(200);
 const data = (await newer.json()).data;
 expect(data.relation_membership).toBe('explicit');
 expect(data.relations.map((relation: {legalId: string}) => relation.legalId)).toEqual(['us:statutes/26/32#qualifying_child_of_tax_unit','us:statutes/26/151#exemption_individual_of_tax_unit']);
 vi.mocked(compositionScope).mockResolvedValue({readiness:'ready',relations:[]});
});
it('answers 503 when the closure evidence is unavailable', async () => {
 vi.mocked(runtimeProxyGet).mockResolvedValue({status:200,body:{status:'ok',data:{inputs:[]}}});
 vi.mocked(compositionScope).mockResolvedValueOnce({readiness:'unavailable',relations:[]});
 const response = await GET(request());
 expect(response.status).toBe(503);
 expect(response.headers.get('cache-control')).toBe('no-store');
});
