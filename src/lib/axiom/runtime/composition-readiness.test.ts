import {beforeEach, expect, it, vi} from "vitest";
const mocks = vi.hoisted(() => ({compose:vi.fn(), rows:vi.fn()}));
vi.mock("./compose-cache", () => ({cachedCompose:mocks.compose}));
vi.mock("@/lib/supabase", () => ({supabaseEncodings:{from:()=>({select:()=>({eq:()=>({in:()=>({abortSignal:mocks.rows})})})})}}));
beforeEach(() => {vi.resetModules();mocks.compose.mockReset();mocks.rows.mockReset();});
it("blocks declared relations even when compose omits them", async () => {
 const {compositionReadiness} = await import("./composition-readiness");
 mocks.compose.mockResolvedValue({status:200,body:{data:{files:["us:law"],graph:{relations:[]}}}});
 mocks.rows.mockResolvedValue({data:[{file_path:"law.yaml",raw_yaml:"rules: [{name: member, kind: data_relation}]"}]});
 expect(await compositionReadiness("us:law")).toBe("relationships_unsupported");
 expect(await compositionReadiness("us:law")).toBe("relationships_unsupported");
 expect(mocks.rows).toHaveBeenCalledTimes(1);
});
it("permits a flat scope but requires complete closure source evidence", async () => {
 const {compositionReadiness} = await import("./composition-readiness");
 mocks.compose.mockResolvedValue({status:200,body:{data:{files:["us:law"],graph:{relations:[]}}}});
 mocks.rows.mockResolvedValueOnce({data:[]}).mockResolvedValueOnce({data:[{file_path:"law.yaml",raw_yaml:"rules: [{name: total, kind: derived}]"}]});
 expect(await compositionReadiness("us:law")).toBe("unavailable");
 expect(await compositionReadiness("us:law")).toBe("ready");
});
it("blocks relationships exposed by compose and refuses truncated scopes", async () => {
 const {compositionReadiness} = await import("./composition-readiness");
 mocks.compose.mockResolvedValueOnce({status:200,body:{data:{files:["us:law"],truncated:true}}}).mockResolvedValueOnce({status:200,body:{data:{files:["us:law"],graph:{relations:[{}]}}}});
 expect(await compositionReadiness("us:law")).toBe("unavailable");
 expect(await compositionReadiness("us:law")).toBe("relationships_unsupported");
 expect(mocks.rows).not.toHaveBeenCalled();
});
it("does not infer relationships from entity names or descriptive text", async () => {
 const {sourceRelationships} = await import("./composition-readiness");
 expect(sourceRelationships('rules: [{name: amount, entity: Payment, description: data_relation}]')).toEqual([]);
 expect(sourceRelationships('rules: [{name: link, data_relation: {arity: 2}}]')).toEqual([{name: "link", supported: false}]);
 expect(()=>sourceRelationships('module: {}')).toThrow();
});

it("allows one typed Person–TaxUnit membership in either slot order, but not arbitrary relationships", async () => {
 const {sourceRelationships, relationshipsSupported} = await import("./composition-readiness");
 const relations = (args: string) => sourceRelationships(`rules: [{name: member, kind: data_relation, data_relation: {arity: 2, arguments: [${args}]}}]`);
 expect(relationshipsSupported(relations("TaxUnit, Person"))).toBe(true);
 expect(relationshipsSupported(relations("Person, TaxUnit"))).toBe(true);
 for (const args of ["TaxUnit, Payment", "Person, Person", "SnapUnit, Person", "Person, TaxUnit, Payment"]) {
   expect(relationshipsSupported(relations(args))).toBe(false);
 }
 expect(relationshipsSupported([...relations("TaxUnit, Person"), ...relations("TaxUnit, Person")])).toBe(false);
});
it("permits the verified single-tax-unit membership through the source closure check", async () => {
 const {compositionReadiness} = await import("./composition-readiness");
 mocks.compose.mockResolvedValue({status:200,body:{data:{files:["us:law"],graph:{relations:[]}}}});
 mocks.rows.mockResolvedValue({data:[{file_path:"law.yaml",raw_yaml:"rules: [{name: member, kind: data_relation, data_relation: {arity: 2, arguments: [TaxUnit, Person]}}]"}]});
 expect(await compositionReadiness("us:law")).toBe("ready");
});

it("accepts verified household and TANF slots, including named slot metadata", async () => {
 const {sourceRelationships, relationshipsSupported} = await import("./composition-readiness");
 for (const unit of ["Household", "TanfUnit", "TaxUnit"]) {
   for (const argumentsText of [`[Person, ${unit}]`, `[${unit}, Person]`, `[{name: member, entity: Person}, {name: unit, entity: ${unit}}]`]) {
     expect(relationshipsSupported(sourceRelationships(`rules: [{name: member, kind: data_relation, data_relation: {arity: 2, arguments: ${argumentsText}}}]`))).toBe(true);
   }
 }
 expect(relationshipsSupported(sourceRelationships('rules: [{name: member, kind: data_relation, data_relation: {arity: 2, arguments: [{name: Person}, {entity: Household}]}}]'))).toBe(false);
});
