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
 expect(sourceRelationships('rules: [{name: link, data_relation: {arity: 2}}]')).toMatchObject([{name: "link", supported: false}]);
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

const rel = (file: string, name: string, args: string, extra = "") =>
  `{name: ${name}, kind: data_relation, ${extra}data_relation: {arity: 2, arguments: [${args}]}}`;
const EITC_CLOSURE: Record<string, string> = {
  // The four relations the us:statutes/26/32 closure declares (rulespec-us main).
  "statutes/26/32.yaml": `rules: [${rel("32", "qualifying_child_of_tax_unit", "TaxUnit, Person")}, {name: eitc, kind: derived}]`,
  "statutes/26/7703.yaml": `rules: [${rel("7703", "living_apart_child_of_tax_unit", "TaxUnit, Person")}]`,
  "statutes/26/151.yaml": `rules: [${rel("151", "exemption_individual_of_tax_unit", "TaxUnit, Person")}, ${rel("151", "senior_deduction_individual_of_tax_unit", "TaxUnit, Person")}]`,
};
const closureRows = (files: Record<string, string>) => ({data: Object.entries(files).map(([file_path, raw_yaml]) => ({file_path, raw_yaml}))});

it("asks for explicit roles when a closure declares several typed Person–unit relations", async () => {
 const {compositionScope} = await import("./composition-readiness");
 mocks.compose.mockResolvedValue({status:200,body:{data:{files:["us:statutes/26/7703","us:statutes/26/151"],graph:{relations:[]}}}});
 mocks.rows.mockResolvedValue(closureRows(EITC_CLOSURE));
 const scope = await compositionScope("us:statutes/26/32");
 expect(scope.readiness).toBe("roles_required");
 expect(scope.relations.map(relation => relation.relationId).sort()).toEqual([
  "us:statutes/26/151#relation.exemption_individual_of_tax_unit",
  "us:statutes/26/151#relation.senior_deduction_individual_of_tax_unit",
  "us:statutes/26/32#relation.qualifying_child_of_tax_unit",
  "us:statutes/26/7703#relation.living_apart_child_of_tax_unit",
 ]);
 expect(scope.relations.find(relation => relation.name === "qualifying_child_of_tax_unit")).toMatchObject({
  legalId: "us:statutes/26/32#qualifying_child_of_tax_unit", fileLegalId: "us:statutes/26/32", personSlot: 1, unitEntity: "TaxUnit", supported: true,
 });
});

it("asks for roles and payment tuples for 26 USC 22's TaxUnit–Payment relation", async () => {
 const {compositionScope} = await import("./composition-readiness");
 mocks.compose.mockImplementation(async (root: string) => ({status:200,body:{data:{files:[root],graph:{relations:[]}}}}));
 // 26 USC 22: a typed Person relation beside a TaxUnit–Payment relation.
 mocks.rows.mockResolvedValueOnce(closureRows({"statutes/26/22.yaml": `rules: [${rel("22", "taxpayer_or_spouse_of_tax_unit", "TaxUnit, Person")}, ${rel("22", "section_22_payment_of_tax_unit", "TaxUnit, Payment")}]`}));
 const scope = await compositionScope("us:statutes/26/22");
 expect(scope.readiness).toBe("roles_required");
 expect(scope.relations.find(relation => relation.name === "section_22_payment_of_tax_unit")).toMatchObject({
  supported: true, instanceEntity: "Payment", instanceSlot: 1, unitEntity: "TaxUnit", relationId: "us:statutes/26/22#relation.section_22_payment_of_tax_unit",
 });
 expect(scope.relations.find(relation => relation.name === "taxpayer_or_spouse_of_tax_unit")).toMatchObject({personSlot: 1, unitEntity: "TaxUnit"});
});

it("still refuses a closure with any relation a scenario cannot represent", async () => {
 const {compositionScope} = await import("./composition-readiness");
 mocks.compose.mockImplementation(async (root: string) => ({status:200,body:{data:{files:[root],graph:{relations:[]}}}}));
 // A payment related to a person directly: no unit slot to hang it on.
 mocks.rows.mockResolvedValueOnce(closureRows({"statutes/26/x.yaml": `rules: [${rel("x", "payee", "Person, Payment")}]`}));
 expect((await compositionScope("us:statutes/26/x")).readiness).toBe("relationships_unsupported");
 // 26 USC 25A: arity 2 with no declared slot entities.
 mocks.rows.mockResolvedValueOnce(closureRows({"statutes/26/25A.yaml": "rules: [{name: education_credit_member_of_tax_unit, kind: data_relation, data_relation: {arity: 2}}]"}));
 expect((await compositionScope("us:statutes/26/25A")).readiness).toBe("relationships_unsupported");
});

it("classifies relation shapes without reading names or descriptions", async () => {
 const {sourceRelationships} = await import("./composition-readiness");
 const {classifyRelations} = await import("./relation-roles");
 const one = (args: string) => sourceRelationships(`rules: [${rel("x", "r", args)}]`, "us:x");
 expect(classifyRelations([])).toBe("ready");
 expect(classifyRelations(one("Person, Household"))).toBe("ready");
 expect(classifyRelations([...one("TaxUnit, Person"), ...sourceRelationships(`rules: [${rel("y", "s", "Person, TanfUnit")}]`, "us:y")])).toBe("roles_required");
 for (const args of ["Person, Person", "Person, Payment", "SnapUnit, Person", "TaxUnit, Household", "SnapUnit, Payment"]) {
  expect(classifyRelations([...one("TaxUnit, Person"), ...sourceRelationships(`rules: [${rel("z", "t", args)}]`, "us:z")])).toBe("relationships_unsupported");
 }
 // A unit–instance relation always needs its instances stated, even alone.
 expect(classifyRelations(one("TaxUnit, Payment"))).toBe("roles_required");
 expect(classifyRelations(one("Payment, Household"))).toBe("roles_required");
 // The same declaration twice is not two relations.
 expect(classifyRelations([...one("TaxUnit, Person"), ...one("TaxUnit, Person")])).toBe("relationships_unsupported");
 // A name or description that sounds like a household role changes nothing.
 const described = sourceRelationships(`rules: [${rel("x", "spouse_of_taxpayer", "TaxUnit, Person", "label: Spouse of the taxpayer, description: The spouse on a joint return, source: 26 USC 63(f), ")}]`, "us:x")[0]!;
 expect(described).toMatchObject({label: "Spouse of the taxpayer", description: "The spouse on a joint return", source: "26 USC 63(f)", personSlot: 1});
});
