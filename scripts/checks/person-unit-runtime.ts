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
if (failed) process.exitCode = 1;
