/** Reproducible Yoke CI audit. All workspaces are disposable; no model calls. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
const repo=resolve(process.env.YOKE_REPO||process.cwd());
const out=resolve(process.env.AUDIT_OUT||join(repo,'audit-results'));
mkdirSync(out,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'yoke-ci-audit-'));
const rows=[];
const report={schema:1,started_at:new Date().toISOString(),scope:'pinned Yoke source, local deterministic probes; no agent/model API calls',environment:{node:process.version,platform:platform(),cpu:cpus()[0]?.model,logical_cpus:cpus().length,total_memory:totalmem()},repo_commit:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim(),rows};
const dump=(name,data)=>writeFileSync(join(out,name),JSON.stringify(data,null,2));
const save=()=>dump('audit.json',report);
const measure=async fn=>{const start=performance.now();const value=await fn();return{ms:performance.now()-start,value};};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function check(condition,message,details={}){return{outcome:condition?'pass':'fail',message,...details};}
async function probe(id,fn,category='live-backend'){try{const r=await measure(fn);rows.push({id,category,...r.value,elapsed_ms:r.ms});}catch(e){rows.push({id,category,outcome:'error',error:String(e.stack||e)});}save();console.log(JSON.stringify(rows.at(-1)));}
function command(bin,args,cwd,timeout=120000){const s=performance.now();const p=spawnSync(bin,args,{cwd,encoding:'utf8',timeout,maxBuffer:8e6,env:{...process.env,DO_NOT_TRACK:'1',GRAFT_TELEMETRY:'off',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:'',GOOGLE_API_KEY:''}});return{command:[bin,...args],status:p.status,error:p.error?.message,signal:p.signal,ms:performance.now()-s,stdout:p.stdout||'',stderr:p.stderr||''};}
function fixture(name){
 const root=join(scratch,name);mkdirSync(join(root,'src'),{recursive:true});mkdirSync(join(root,'docs'),{recursive:true});
 writeFileSync(join(root,'.gitignore'),'.yoke/\n.serena/\n.graft/\n.context/\n.context-graph/\ngraphify-out/\nnode_modules/\n');
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'audit-fixture',version:'1.0.0',type:'module'}));
 writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true},include:['src/**/*.ts']}));
 writeFileSync(join(root,'src/math.ts'),'export function calculateTotal(prices: number[]): number {\n  return prices.reduce((sum, price) => sum + price, 0);\n}\n');
 writeFileSync(join(root,'src/order.ts'),'import { calculateTotal } from "./math.js";\nexport function checkout(prices: number[]): number {\n  return calculateTotal(prices);\n}\nexport function estimate(prices: number[]): number {\n  return calculateTotal(prices) * 1.19;\n}\n');
 writeFileSync(join(root,'src/shadow.ts'),'function calculateTotal(a: string): string { return a.trim(); }\nexport function unrelated(a: string): string { return calculateTotal(a); }\n');
 writeFileSync(join(root,'docs/ARCHITECTURE.md'),'# Order pricing\ncheckout and estimate use calculateTotal in src/math.ts. The string helper in src/shadow.ts is unrelated.\n');
 command('git',['init','-q'],root);command('git',['add','.'],root);command('git',['-c','user.name=Audit','-c','user.email=audit@example.invalid','commit','-qm','fixture'],root);
 return root;
}
const m=async name=>import(pathToFileURL(join(repo,`dist/code-intelligence/${name}.js`)).href);
const{CodeIntelligenceCoordinator}=await m('coordinator');
const{createSnapshot,workspaceId}=await m('snapshots');
const{serenaSymbolId}=await m('evidence');
const symbolId=serenaSymbolId('calculateTotal','src/math.ts');
// Independent raw client separates native backend behavior from Yoke transport.
class RawClient{
 constructor(bin,args,cwd){this.bin=bin;this.args=args;this.cwd=cwd;this.id=1;this.pending=new Map();this.buffer='';this.stderr='';}
 async start(){this.p=spawn(this.bin,this.args,{cwd:this.cwd,stdio:['pipe','pipe','pipe'],env:{...process.env,OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:'',GOOGLE_API_KEY:'',DO_NOT_TRACK:'1',GRAFT_TELEMETRY:'off'}});this.p.stderr.on('data',b=>{this.stderr=(this.stderr+b.toString()).slice(-40000);});this.p.stdout.on('data',b=>{this.buffer+=b.toString();let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);try{const m=JSON.parse(line);const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}catch{}}});this.p.on('error',e=>this.fail(e));this.p.on('close',code=>this.fail(new Error(`process exited ${code}: ${this.stderr.slice(-4000)}`)));const r=await this.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'yoke-independent-audit',version:'1'}},60000);this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return r;}
 fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 request(method,params,timeout=60000){const id=this.id++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timeout`));},timeout);this.pending.set(id,{resolve,reject,timer});this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 async close(){this.fail(new Error('audit closed'));if(this.p&&!this.p.killed){this.p.kill('SIGTERM');await delay(100);if(this.p.exitCode===null)this.p.kill('SIGKILL');}}
}
function unwrap(v){if(v?.structuredContent!==undefined)v=v.structuredContent;else if(v?.content)v=v.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');for(let i=0;i<3;i++){if(v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.result==='string')v=v.result;if(typeof v==='string'){try{v=JSON.parse(v);}catch{break;}}else break;}return v;}
function countNamed(v){if(Array.isArray(v))return v.reduce((s,x)=>s+countNamed(x),0);if(v&&typeof v==='object')return(typeof v.name_path==='string'?1:0)+Object.entries(v).filter(([k])=>k!=='name_path').reduce((s,[,x])=>s+countNamed(x),0);return 0;}
const liveRoot=fixture('live');
const configs={graft:{command:process.execPath,args:[process.env.GRAFT_CLI||'/missing/graft','mcp'],available:existsSync(process.env.GRAFT_CLI||'/missing/graft')},graphify:{command:process.env.GRAPHIFY_PYTHON||'/missing/graphify',args:['-m','graphify.serve'],available:existsSync(process.env.GRAPHIFY_PYTHON||'/missing/graphify')},serena:{command:process.env.SERENA_BIN||'/missing/serena',args:['start-mcp-server','--project-from-cwd','--context','codex'],available:existsSync(process.env.SERENA_BIN||'/missing/serena')}};
if(configs.graft.available){const r=command(configs.graft.command,[configs.graft.args[0],'build'],liveRoot,180000);dump('graft-index-build.json',r);rows.push({id:'graft_index_build',category:'live-backend',outcome:r.status===0?'pass':'error',...r});save();}
if(configs.graphify.available){
 const cli=join(resolve(configs.graphify.command,'..'),'graphify');
 const build=command(cli,['extract','.'],liveRoot,180000);dump('graphify-index-build.json',build);
 let graphMode='extracted';
 if(!existsSync(join(liveRoot,'graphify-out/graph.json'))){graphMode='manually_seeded_protocol_fixture';mkdirSync(join(liveRoot,'graphify-out'),{recursive:true});writeFileSync(join(liveRoot,'graphify-out/graph.json'),JSON.stringify({directed:true,multigraph:false,graph:{schema_version:'1',graphify_version:'audit-fixture'},nodes:[{id:'math',label:'calculateTotal',type:'function',source_file:'src/math.ts',source_location:'src/math.ts:1',description:'Calculate order price total',community:0},{id:'order',label:'checkout',type:'function',source_file:'src/order.ts',source_location:'src/order.ts:2',community:0},{id:'estimate',label:'estimate',type:'function',source_file:'src/order.ts',community:0},{id:'doc',label:'Order pricing architecture',type:'document',source_file:'docs/ARCHITECTURE.md',community:0}],links:[{source:'order',target:'math',relation:'calls',confidence:'EXTRACTED',weight:1},{source:'estimate',target:'math',relation:'calls',confidence:'EXTRACTED',weight:1},{source:'doc',target:'math',relation:'documents',confidence:'EXTRACTED',weight:1}]}));}
 rows.push({id:'graphify_index_build',category:'live-backend',outcome:build.status===0?'pass':'error',graph_mode:graphMode,...build});report.graphify_graph_mode=graphMode;save();
}
const direct={};
for(const[name,cfg]of Object.entries(configs)){
 if(!cfg.available){rows.push({id:`${name}_runtime`,category:'live-backend',outcome:'unavailable',message:'Runtime installation absent; not simulated'});save();continue;}
 const client=new RawClient(cfg.command,cfg.args,liveRoot);
 await probe(`${name}_initialize_and_tools`,async()=>{const start=await measure(()=>client.start());const tools=await client.request('tools/list',{});direct[name]={initialize:start.value,startup_ms:start.ms,tools,calls:{}};dump(`${name}-native.json`,direct[name]);return check(Array.isArray(tools.tools)&&tools.tools.length>0,'Real backend advertises tools',{startup_ms:start.ms,server_info:start.value.serverInfo,tools:tools.tools.map(x=>x.name)});});
 if(direct[name]){
 const calls=name==='graft'?[['find_code','graft_find_code',{query:'calculateTotal',limit:8}],['trace','graft_trace_calls',{symbol:'calculateTotal',direction:'in',depth:3}],['file_api','graft_file_api',{file:'src/math.ts'}],['freshness','graft_check_freshness',{}]]:name==='serena'?[['definition','find_symbol',{name_path_pattern:'calculateTotal',relative_path:'src/math.ts',include_body:false,max_matches:20}],['body','find_symbol',{name_path_pattern:'calculateTotal',relative_path:'src/math.ts',include_body:true,max_matches:20}],['references','find_referencing_symbols',{name_path:'calculateTotal',relative_path:'src/math.ts'}],['diagnostics','get_diagnostics_for_file',{relative_path:'src/math.ts'}]]:[['query','query_graph',{question:'calculateTotal checkout',depth:3,token_budget:2400}]];
 for(const[label,tool,args]of calls)await probe(`${name}_native_${label}`,async()=>{const trials=[];let value;for(let i=0;i<5;i++){const r=await measure(()=>client.request('tools/call',{name:tool,arguments:args}));trials.push(r.ms);value=r.value;if(value.isError===true)break;}direct[name].calls[label]={tool,args,trials_ms:trials,value};dump(`${name}-native.json`,direct[name]);return check(value.isError!==true,'Real backend tool call succeeds',{trials_ms:trials,bytes:Buffer.byteLength(JSON.stringify(value)),named_records:countNamed(unwrap(value)),value});});
 }
 await client.close();dump(`${name}-stderr.json`,{stderr:client.stderr});
}
const opts={mode:'shadow',graft:configs.graft,graphify:configs.graphify,serena:configs.serena};
for(const budget of[2400,16000]){
 const c=new CodeIntelligenceCoordinator(liveRoot,{...opts,limits:{tokenBudget:budget,timeoutMs:15000,maxBackends:3}});
 for(const[label,tool,args]of[['context','code_context',{query:'calculateTotal',include_docs:false}],['context_with_docs','code_context',{query:'calculateTotal checkout',include_docs:true}],['symbol','code_symbol',{symbol_id:symbolId,include:['definition','references']}],['reference_trace','code_trace',{symbol_id:symbolId,direction:'in',relations:['references'],max_depth:2}],['call_trace','code_trace',{symbol_id:symbolId,direction:'in',relations:['calls'],max_depth:3}],['impact','code_impact',{targets:[{path:'src/math.ts'}],include_docs:true,require_semantic:true}]]){
 await probe(`facade_${label}_${budget}`,async()=>{const trials=[];let r;for(let i=0;i<5;i++){const x=await measure(()=>c.dispatch(tool,{workspace_id:workspaceId(liveRoot),snapshot_id:createSnapshot(liveRoot).snapshot_id,token_budget:budget,timeout_ms:60000,...args}));trials.push(x.ms);r=x.value;if(r.coverage.backends_missing.length||r.status==='error'||r.status==='blocked')break;}dump(`facade-${label}-${budget}.json`,{trials_ms:trials,response:r});let ok=r.status!=='error'&&r.status!=='blocked'&&r.coverage.backends_missing.length===0;let message='Facade execution without missing backends; partial coverage is not by itself failure';if(label==='symbol'){const native=countNamed(unwrap(direct.serena?.calls.references?.value));ok=ok&&(native===0||r.data?.references?.length>0);message='Facade must retain references when native Serena supplies them';}return check(ok,message,{trials_ms:trials,response:r});},'live-facade');
 }
 await c.close();
}
await probe('literal_search_baseline',()=>{const trials=[];let r;for(let i=0;i<7;i++){r=command('rg',['-n','calculateTotal','src'],liveRoot,5000);trials.push(r.ms);}return{outcome:r.status===0?'measurement':'unavailable',trials_ms:trials,bytes:Buffer.byteLength(r.stdout),stdout:r.stdout,notes:'Literal search includes shadowed/unrelated name; not equivalent to resolved references or tested agent-task quality'};},'performance');
report.finished_at=new Date().toISOString();report.summary=rows.reduce((a,r)=>(a[r.outcome]=(a[r.outcome]||0)+1,a),{});save();console.log('AUDIT_SUMMARY '+JSON.stringify(report.summary));
