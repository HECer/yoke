/** Round 2 refines the audit harness only; production source remains untouched.
 * Keeps the original script and materializes every change in an artifact. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve(process.env.AUDIT_OUT||'audit-results');mkdirSync(out,{recursive:true});
let source=readFileSync('audit/live-backend-audit.mjs','utf8');
function replaceOnce(before,after){if(source.split(before).length!==2)throw new Error('Audit refinement anchor not unique: '+before.slice(0,100));source=source.replace(before,after);}
replaceOnce("import { mkdirSync,", "import { cpSync, readdirSync, mkdirSync,");
replaceOnce("command(cli,['extract','.'],liveRoot,180000)","command(cli,['extract','.','--code-only'],liveRoot,180000)");
replaceOnce("command('rg',['-n','calculateTotal','src'],liveRoot,5000)","command('git',['grep','-n','calculateTotal','--','src'],liveRoot,5000)");
replaceOnce("if(label==='symbol'){", "if(label==='reference_trace'){const native=countNamed(unwrap(direct.serena?.calls.references?.value));ok=ok&&(native===0||r.data?.edges?.length>0);message='Facade trace must retain reference edges when native Serena supplies references';}if(label==='symbol'){");
replaceOnce("const direct={};", "if(existsSync(join(liveRoot,'graphify-out/graph.json')))dump('graphify-extracted-graph.json',JSON.parse(readFileSync(join(liveRoot,'graphify-out/graph.json'),'utf8')));\nconst direct={};");
replaceOnce(" await client.close();dump(`${name}-stderr.json`,{stderr:client.stderr});",`
 if(name==='serena'&&direct[name])await probe('serena_native_definition_and_references_bundle',async()=>{const trials=[];let definition,references;for(let i=0;i<5;i++){const r=await measure(async()=>{definition=await client.request('tools/call',{name:'find_symbol',arguments:{name_path_pattern:'calculateTotal',relative_path:'src/math.ts',include_body:false,max_matches:20}});references=await client.request('tools/call',{name:'find_referencing_symbols',arguments:{name_path:'calculateTotal',relative_path:'src/math.ts'}});});trials.push(r.ms);}return check(!definition.isError&&!references.isError,'Native sequential definition plus references; no facade snapshots',{trials_ms:trials,reference_records:countNamed(unwrap(references)),definition,references});});
 await client.close();dump(name+'-stderr.json',{stderr:client.stderr});
`);
replaceOnce("report.finished_at=new Date().toISOString();",`
// A real-source workload: the complete 174-file Yoke src tree, not a toy graph.
// Copy into an ephemeral workspace; only dependencies are linked read-only by convention.
const actualRoot=join(scratch,'actual-yoke-src');mkdirSync(actualRoot,{recursive:true});
cpSync(join(repo,'src'),join(actualRoot,'src'),{recursive:true});
writeFileSync(join(actualRoot,'package.json'),readFileSync(join(repo,'package.json')));
writeFileSync(join(actualRoot,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:true},include:['src/**/*.ts']}));
writeFileSync(join(actualRoot,'.gitignore'),'.yoke/\\n.serena/\\n.graft/\\n.context/\\n.context-graph/\\ngraphify-out/\\nnode_modules/\\n');
symlinkSync(join(repo,'node_modules'),join(actualRoot,'node_modules'),'dir');
command('git',['init','-q'],actualRoot);command('git',['add','src','package.json','tsconfig.json','.gitignore'],actualRoot);command('git',['-c','user.name=Audit','-c','user.email=audit@example.invalid','commit','-qm','unmodified Yoke source workload'],actualRoot);
const actualSymbol=serenaSymbolId('createSnapshot','src/code-intelligence/snapshots.ts');
const actualRaw={};
for(const[name,cfg]of Object.entries(configs)){
 if(!cfg.available)continue;
 if(name==='graft')await probe('actual_yoke_graft_index',()=>{const r=command(cfg.command,[cfg.args[0],'build'],actualRoot,180000);dump('actual-yoke-graft-index.json',r);return check(r.status===0,'Build structural index of actual Yoke sources',r);},'real-source');
 if(name==='graphify')await probe('actual_yoke_graphify_index',()=>{const cli=join(resolve(cfg.command,'..'),'graphify');const r=command(cli,['extract','.','--code-only'],actualRoot,180000);dump('actual-yoke-graphify-index.json',r);if(existsSync(join(actualRoot,'graphify-out/graph.json')))dump('actual-yoke-graphify-graph.json',JSON.parse(readFileSync(join(actualRoot,'graphify-out/graph.json'),'utf8')));return check(r.status===0,'Build AST graph of actual Yoke sources, no LLM',r);},'real-source');
 const raw=new RawClient(cfg.command,cfg.args,actualRoot);
 await probe('actual_yoke_'+name+'_query',async()=>{const init=await measure(()=>raw.start());const trials=[];let values;for(let i=0;i<5;i++){const r=await measure(async()=>{if(name==='serena')return{definition:await raw.request('tools/call',{name:'find_symbol',arguments:{name_path_pattern:'createSnapshot',relative_path:'src/code-intelligence/snapshots.ts',include_body:false,max_matches:20}}),references:await raw.request('tools/call',{name:'find_referencing_symbols',arguments:{name_path:'createSnapshot',relative_path:'src/code-intelligence/snapshots.ts'}})};return{query:await raw.request('tools/call',{name:name==='graft'?'graft_find_code':'query_graph',arguments:name==='graft'?{query:'createSnapshot',limit:8}:{question:'createSnapshot snapshots',depth:3,token_budget:2400}})};});trials.push(r.ms);values=r.value;if(Object.values(values).some(v=>v.isError))break;}actualRaw[name]=values;dump('actual-yoke-'+name+'-native.json',{startup_ms:init.ms,trials_ms:trials,values});return check(!Object.values(values).some(v=>v.isError),'Real backend query over unchanged Yoke sources',{startup_ms:init.ms,trials_ms:trials,reference_records:countNamed(unwrap(values.references)),values});},'real-source');
 await raw.close();
}
for(const budget of[2400,16000]){
 const coordinator=new CodeIntelligenceCoordinator(actualRoot,{...opts,limits:{tokenBudget:budget,timeoutMs:60000,maxBackends:3}});
 await probe('actual_yoke_facade_symbol_'+budget,async()=>{const trials=[];let response;for(let i=0;i<5;i++){const r=await measure(()=>coordinator.dispatch('code_symbol',{workspace_id:workspaceId(actualRoot),snapshot_id:createSnapshot(actualRoot).snapshot_id,symbol_id:actualSymbol,include:['definition','references'],token_budget:budget,timeout_ms:60000}));trials.push(r.ms);response=r.value;if(response.error)break;}const native=countNamed(unwrap(actualRaw.serena?.references));const retained=response.data?.references?.length??0;return check(native>0&&retained===native,'Preserve actual source references through facade',{trials_ms:trials,native_reference_records:native,facade_reference_records:retained,response});},'real-source');
 await coordinator.close();
}
// Native semantic editing is probed separately from synthetic fault injection.
if(configs.serena.available){const editRoot=fixture('native-serena-edit');const c=new CodeIntelligenceCoordinator(editRoot,{mode:'active',serena:configs.serena,limits:{tokenBudget:16000,timeoutMs:60000}});await probe('native_serena_rename_preview',async()=>{const response=await c.dispatch('code_edit_preview',{workspace_id:workspaceId(editRoot),snapshot_id:createSnapshot(editRoot).snapshot_id,operations:[{kind:'rename',symbol_id:symbolId,new_name:'sumOrderPrices'}],validation_profile:'default',timeout_ms:60000});return check(response.data?.changed_paths?.includes('src/math.ts')&&response.data?.changed_paths?.includes('src/order.ts'),'Real Serena rename preview must include definition and imported callers',{response});},'live-edit');await c.close();}
report.finished_at=new Date().toISOString();
`);
const target=join(out,'refined-live-backend-audit.mjs');writeFileSync(target,source);await import(pathToFileURL(target).href);
