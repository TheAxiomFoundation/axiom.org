/** Offline verification: bun scripts/verify-snap-metadata-repair.ts ENGINE_JS ORIGINAL_MODULES_JSON REPAIRED_MODULES_JSON
 * Module maps must be captured from the same published import closure.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';
const [enginePath,originalPath,repairedPath]=process.argv.slice(2);
if(!enginePath||!originalPath||!repairedPath)throw new Error('Expected engine JS, original closure JSON, repaired closure JSON');
const engine=createRequire(import.meta.url)(resolve(enginePath));
const original=JSON.parse(await readFile(originalPath,'utf8'));
const repaired=JSON.parse(await readFile(repairedPath,'utf8'));
const root='us-co:regulations/10-ccr-2506-1/4.207.2';
assert.deepEqual(Object.keys(repaired).sort(),Object.keys(original).sort());
let changed=0;
for(const id of Object.keys(original)){
 if(original[id]===repaired[id])continue;
 changed++;
 const before=load(original[id]) as any;
 const after=load(repaired[id]) as any;
 const expected=structuredClone(before);
 assert(expected.module.source_verification.values);
 assert(!('source_values' in expected.module));
 expected.module.source_values=expected.module.source_verification.values;
 delete expected.module.source_verification.values;
 assert.deepEqual(after,expected,`${id}: only relocate supplemental metadata; preserve every rule, value, and citation`);
}
assert.equal(changed,2);
assert.throws(()=>engine.compile(JSON.stringify(original),root),/unknown field `values`/);
const artifact=engine.compile(JSON.stringify(repaired),root);
const output=`${root}#snap_days_in_application_month`;
for(const [start,end,expected] of [['2026-01-01','2026-01-31',31],['2026-02-01','2026-02-28',28]] as const){
 const response=JSON.parse(engine.execute(artifact,JSON.stringify({mode:'explain',dataset:{inputs:[],relations:[]},queries:[{entity_id:'household-1',period:{period_kind:'month',start,end},outputs:[output]}]})));
 assert.equal(response.results[0].outputs[output].value.value,expected);
}
console.log(`PASS: engine ${engine.engine_version()}, two metadata-only corrections, full closure compiles, January=31 and February=28`);
