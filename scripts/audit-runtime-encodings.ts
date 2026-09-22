/** Read-only audit of published metadata against the serving engine's strict source contract.
 * Usage: bun scripts/audit-runtime-encodings.ts [report.json]
 * Does not claim full compilability or rewrite provenance.
 */
import { load } from 'js-yaml';
import { supabaseEncodings } from '../src/lib/supabase';
import { writeFile } from 'node:fs/promises';
const rows: Array<{file_path:string;citation_path:string;raw_yaml:string}> = [];
for (let offset=0;;offset+=250) {
 const {data,error}=await supabaseEncodings.from('rulespec_files').select('file_path,citation_path,raw_yaml').order('citation_path').range(offset,offset+249);
 if(error) throw new Error(error.message);
 rows.push(...(data??[]));
 if(!data || data.length<250) break;
}
const importsById = new Map<string, string[]>();
const idFor = (row: typeof rows[number]) => `${row.citation_path.split('/')[0]}:${row.file_path.replace(/\.ya?ml$/, '')}`;
const findings: Array<{file:string;citation:string;issues:string[]}> = [];
for(const row of rows){
 const issues:string[]=[];
 try {
 const doc=load(row.raw_yaml) as any;
 importsById.set(idFor(row),(doc?.imports??[]).filter((id:unknown)=>typeof id==='string').map((id:string)=>id.split('#')[0]));
 const visit=(value:any,path:string)=>{
  if(!value || typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((v,i)=>visit(v,`${path}[${i}]`));return;}
  if('corpus_citation_paths' in value)issues.push(`${path}.corpus_citation_paths: removed plural citation field`);
  if(path==='module.source_verification'){
   for(const key of Object.keys(value))if(!['corpus_citation_path','source_sha256','upstream_source_check'].includes(key))issues.push(`${path}.${key}: unsupported field`);
   if(typeof value.corpus_citation_path!=='string'||!value.corpus_citation_path.trim())issues.push(`${path}: missing singular citation`);
  }
  for(const [key,v]of Object.entries(value))visit(v,path?`${path}.${key}`:key);
 };
 visit(doc,'');
 }catch(e){issues.push(`YAML parse failure: ${String(e)}`);}
 if(issues.length)findings.push({file:row.file_path,citation:row.citation_path,issues});
}
const affectedBy = (blockedId:string) => {
 const affected=new Set([blockedId]);
 let changed=true;
 while(changed){changed=false;for(const [id,imports]of importsById)if(!affected.has(id)&&imports.some(dep=>affected.has(dep))){affected.add(id);changed=true;}}
 return [...affected].sort();
};
const blockers=findings.map(f=>({...f,affectedModules:affectedBy(`${f.citation.split('/')[0]}:${f.file.replace(/\.ya?ml$/, '')}`)}));
const report={checkedAt:new Date().toISOString(),scope:'Published mirror metadata only; not a full compile/execution audit',filesChecked:rows.length,filesWithMetadataBlockers:findings.length,findings:blockers};
await writeFile(process.argv[2]??'docs/diagnostics/runtime-metadata-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({filesChecked:rows.length,filesWithMetadataBlockers:findings.length}));
