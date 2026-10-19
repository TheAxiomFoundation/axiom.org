// Opt-in integration check against the configured runtime (not part of offline CI).
// Run: bun --env-file=.env.local scripts/checks/person-unit-runtime.ts
import {runCalculateRoot} from '../../src/lib/axiom/runtime/api';
const cases = [
 ...[0,1,2].map(count => ({name:`TaxUnit-count-${count}`,root:"us:statutes/26/21",facts:{age:8,is_cdcc_child_dependent:count>0},people:{person_2:{age:10,is_cdcc_child_dependent:count>1}},variables:["cdcc_qualifying_individual_count","cdcc_qualifying_individual"],expected:count})),
 ...[false,true].map(all => ({name:`Household-all-${all}`,root:'us-co:regulations/10-ccr-2506-1/4.208.2',facts:{household_is_snap_household:true,person_receives_colorado_supplement_to_ssi_grant:true},people:{person_2:{person_receives_colorado_supplement_to_ssi_grant:all}},variables:['pa_household','person_receives_pa_benefit'],expected:all})),
 ...[false,true].map(child => ({name:`Tanf-child-${child}`,root:'us-ma:regulations/106-cmr/703/200/block-1',facts:{age_years:30,person_is_child:false},people:{person_2:{age_years:10,person_is_child:child}},variables:['tafdc_dependent_child_requirement_met','dependent_child'],expected:child})),
 ...[false,true].map(include => ({name:`Tanf-sum-${include}`,root:'us-ma:regulations/106-cmr/704/500/block-1',facts:{member_gross_earned_income:100,filing_unit_member_included_in_grant_calculation:true},people:{person_2:{member_gross_earned_income:250,filing_unit_member_included_in_grant_calculation:include}},variables:['tafdc_filing_unit_countable_earned_income','tafdc_member_countable_earned_income'],expected:include?350:100})),
];
let failed = false;
for (const c of cases) {
  const result = await runCalculateRoot(c);
  const actual = result.kind === "ok" ? result.result.outputs[c.variables[0]] : null;
  const personTrace = result.kind === "ok" ? result.result.trace?.find(row => row.variable === c.variables[1]) : undefined;
  const instances = personTrace && "instances" in personTrace ? personTrace.instances : undefined;
  const pass = actual === c.expected && Array.isArray(instances) && instances.length === 2;
  console.log(JSON.stringify({name:c.name, expected:c.expected, actual, instances, pass}));
  if (!pass) failed = true;
}

// Explicit relation roles (roles_required scopes). Needs a runtime that
// honors household.relations (axiom-api#267): every relation the closure
// declares is named, because a relation left unnamed keeps the membership
// convention. Each case must come back with relationMembership "explicit"
// (the runtime echoed every relation) or it fails. Expected values are the
// rulespec-us tests' own outputs for the same inputs
// (us/statutes/26/32.test.yaml one_child_phase_in_and_allowed;
// us/statutes/26/63/c.test.yaml joint case).
const EITC_CHILD = {individual_is_child_of_taxpayer_or_descendant_of_such_child:true,individual_principal_place_of_abode_with_taxpayer_fraction:1,individual_is_younger_than_taxpayer:true,individual_age_at_close_of_calendar_year:8,taxpayer_is_parent_of_individual:true,parents_filing_status:1,qualifying_child_principal_place_of_abode_is_in_united_states:true,qualifying_child_name_age_and_tin_included_on_return:true};
type Answers = Record<string, number | boolean>;
type Entry = {name: string; tuples: string[][]};
const rel = (file: string, name: string, people: number[]): Entry =>
  ({name: `${file}#relation.${name}`, tuples: people.map(n => ['household:1', `person:1:${n}`])});
const explicitCases: Array<{name: string; root: string; facts: Answers; people: Record<string, Answers>; relations: Entry[]; variables: string[]; expected: number}> = [
 {name:'EITC-one-child-explicit',root:'us:statutes/26/32',facts:{filing_status:0,employee_compensation_includible_in_gross_income:10000,adjusted_gross_income:10000,taxpayer_includes_required_social_security_number_on_return:true,taxable_year_is_full_12_months:true},people:{person_2:EITC_CHILD},relations:[
  rel('us:statutes/26/32','qualifying_child_of_tax_unit',[2]),
  rel('us:statutes/26/7703','living_apart_child_of_tax_unit',[]),
  rel('us:statutes/26/151','exemption_individual_of_tax_unit',[1]),
  rel('us:statutes/26/151','senior_deduction_individual_of_tax_unit',[1]),
 ],variables:['eitc'],expected:3400},
 // Under the membership convention the filer also lands in 63(c)(5)'s
 // exemption_individual_of_another_tax_unit and the deduction collapses to 500.
 {name:'63c-filer-is-not-another-units-dependent',root:'us:statutes/26/63/c',facts:{filing_status:1,increased_basic_standard_deduction_inflation_adjustment_applies:true,increased_basic_standard_deduction_cost_of_living_adjustment:0.1,taxpayer_has_attained_age_65_before_close_of_taxable_year:true,additional_amount_for_each_aged_or_blind_entitlement:600,is_taxpayer:true,tin_included_on_return_claiming_exemption:true},people:{},relations:[
  rel('us:statutes/26/63/f','spouse_of_taxpayer_for_subsection_f',[]),
  rel('us:statutes/26/63/c/5','exemption_individual_of_another_tax_unit',[]),
  rel('us:statutes/26/151','exemption_individual_of_tax_unit',[1]),
  rel('us:statutes/26/151','senior_deduction_individual_of_tax_unit',[1]),
 ],variables:['basic_standard_deduction'],expected:34600},
];
for (const c of explicitCases) {
  const result = await runCalculateRoot(c);
  const actual = result.kind === "ok" ? result.result.outputs[c.variables[0]] : null;
  const membership = result.kind === "ok" ? result.relationMembership : result.kind;
  const pass = actual === c.expected && membership === "explicit";
  console.log(JSON.stringify({name:c.name, expected:c.expected, actual, membership, pass}));
  if (!pass) failed = true;
}
if (failed) process.exitCode = 1;
