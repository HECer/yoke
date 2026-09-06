import { dashboardPanels } from './panels.js'
export function dashboardPage(token: string, nonce: string): string {
  if (!/^[a-f0-9]{64}$/u.test(token) || !/^[A-Za-z0-9+/=]+$/u.test(nonce)) throw new Error('Invalid dashboard session')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yoke · Project workspace</title>
<style nonce="${nonce}">
:root{color-scheme:light;--ink:#15242d;--muted:#647077;--line:#dce1df;--paper:#f4f5f0;--accent:#c34c27;--green:#167452}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #dc734a;outline-offset:3px}.layout{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:100vh}aside{background:#142b32;color:#eef5f1;padding:34px 22px;display:flex;flex-direction:column;gap:30px}.brand{font-size:31px;font-weight:780;letter-spacing:-1.5px}.brand span{color:#ffb185}aside p{color:#afc3c6;font-size:13px}.label{text-transform:uppercase;font-size:11px;letter-spacing:1.7px;font-weight:750;color:var(--muted)}aside .label{color:#91a9ad}nav{display:grid;gap:7px}.nav-button{border:0;background:transparent;color:#cad8d9;text-align:left;padding:11px 12px;border-radius:8px;overflow-wrap:anywhere}.nav-button[aria-current=true]{background:#29444b;color:#fff}.aside-foot{margin-top:auto;border-top:1px solid #355057;padding-top:20px}main{max-width:1500px;width:100%;padding:40px 5vw 70px}.top{display:flex;justify-content:space-between;align-items:center;gap:20px}.local{font-size:12px;color:var(--green);background:#e2ece1;border-radius:30px;padding:6px 12px}.button{border:1px solid #bcc7c5;background:#fff;border-radius:7px;padding:9px 15px;color:var(--ink)}.button.primary{background:var(--ink);color:#fff;border-color:var(--ink)}h1{font-size:clamp(27px,3vw,40px);line-height:1.2;margin:17px 0 8px;letter-spacing:-1.4px}h2{font-size:18px;margin:0 0 18px}h3{font-size:16px;margin:0 0 8px}p{margin:6px 0}.muted{color:var(--muted)}.summary{max-width:850px;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:28px 0}.metric,.panel,.project-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px}.metric strong{display:block;font-size:28px;letter-spacing:-.8px;margin:8px 0 4px}.metric p{font-size:12px;color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:28px 0}.project-card{display:flex;flex-direction:column;align-items:flex-start;gap:12px}.project-card p{color:var(--muted);overflow-wrap:anywhere}.project-card button{margin-top:auto}.columns{display:grid;grid-template-columns:1.2fr 1fr;gap:22px}.panel{margin-bottom:22px}.row{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:13px 0;border-top:1px solid #edf0eb}.row:first-child{border-top:0}.row-main{min-width:0;overflow-wrap:anywhere}.row small{display:block;color:var(--muted);margin-top:4px}.badge{font-size:11px;font-weight:650;background:#edf0ed;padding:4px 9px;border-radius:20px;white-space:nowrap}.badge.good{color:#166343;background:#e4f0e7}.badge.attention{color:#a43e22;background:#fff0e7}.notice{padding:13px 16px;margin:18px 0;border-left:3px solid var(--accent);background:#fff2e9;overflow-wrap:anywhere}.actions{display:flex;align-items:center;gap:12px;margin:22px 0}.path{font:12px/1.5 ui-monospace,monospace;word-break:break-all}.empty{padding:26px 0;color:var(--muted)}details{font-size:12px;margin-top:8px}details p{white-space:pre-wrap;max-height:220px;overflow:auto}.timeline .row{font-size:13px}.loading{padding:50px;color:var(--muted)}.overview-tools{display:flex;flex-wrap:wrap;align-items:end;gap:14px;margin:24px 0}.field{display:grid;gap:5px;flex:1 1 260px}.field input{margin:0;width:100%}.filter-group{display:flex;flex-wrap:wrap;gap:7px}.filter-group .button[aria-pressed=true]{background:var(--ink);color:#fff}.state-line{font-size:13px}.comparison{font-weight:650}.chart-gap-note{margin-top:12px}@media(max-width:900px){.layout{grid-template-columns:1fr}aside{padding:16px 24px;gap:12px}.brand{font-size:25px}aside>p,.aside-foot,aside>.label{display:none}nav{display:flex;overflow:auto}.nav-button{white-space:nowrap}.metrics{gap:9px}.metric{padding:15px}.columns{grid-template-columns:1fr}main{padding:25px 22px}.metric strong{font-size:23px}}@media(max-width:520px){.metrics{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.local{white-space:nowrap}.metric strong{font-size:26px}.metric p{font-size:13px}.overview-tools{align-items:stretch}.filter-group{display:grid;grid-template-columns:1fr}}
main,aside,.panel{min-width:0}.actions{flex-wrap:wrap}.table-scroll{overflow-x:auto;max-width:100%}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line)}select,input{font:inherit;padding:8px;margin:4px;border:1px solid var(--line);border-radius:6px;max-width:100%}</style></head><body><div class="layout"><aside><div class="brand">yoke<span>.</span></div><p>Work you can verify.<br>Projects you can pick up again.</p><div class="label">Your workspace</div><nav id="navigation" aria-label="Projects"></nav><div class="aside-foot"><div class="label">Local workspace</div><p>Project data stays on this machine.</p></div></aside><main><div class="top"><div class="label">Project workspace</div><div><span class="local">● Local session</span> <button id="refresh" class="button">Refresh</button></div></div><div id="content" aria-live="polite"><p class="loading">Loading your projects…</p></div></main></div>
<script nonce="${nonce}">
const sessionToken = ${JSON.stringify(token)};
const content=document.getElementById('content'), navigation=document.getElementById('navigation');
const defaultNavigation={screen:'overview',project:null,view:'now',period:30,group:'day',from:'',to:''};
let navigationState=parseNavigationHash(typeof location==='undefined'?'':location.hash);
let selected=navigationState.screen==='project'?navigationState.project:null, projects=[];
let projectView=navigationState.view,periodDays=navigationState.period,bucket=navigationState.group,customFrom=navigationState.from,customTo=navigationState.to;
let overviewQuery='',overviewFilter='all',requestVersion=0,activeController=null;
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node}
function append(parent,...children){for(const child of children)parent.append(child);return parent}
function badge(state){return el('span',state||'unknown','badge '+(['complete','passed'].includes(state)?'good':['blocked','failed','paused','unverified','unconfirmed','unavailable'].includes(state)?'attention':''))}
function button(label,action,primary=false){const node=el('button',label,'button'+(primary?' primary':''));node.addEventListener('click',()=>Promise.resolve().then(action).catch(error=>content.append(el('p',error.message,'notice'))));return node}
function duration(ms){if(!Number.isFinite(ms))return 'Unknown';if(ms<60000)return Math.round(ms/1000)+'s';if(ms<3600000)return Math.round(ms/60000)+'m';return (ms/3600000).toFixed(1)+'h'}
function tokenText(value){return Number.isFinite(value)?value.toLocaleString('en-US'):'Unknown'}
function taskTiming(task,estimate){const planned=estimate?.available?estimate.tasks.find(item=>item.storyId===task.id):undefined;return planned?'Predicted '+duration(planned.endMs-planned.startMs)+' · planned start +'+duration(planned.startMs):task.passes?'Completed · timing unknown':'Duration and planned start unknown'}
function unknownCallCount(status){return Number.isFinite(status?.measurement?.unknownCalls)?status.measurement.unknownCalls:Array.isArray(status?.tokens?.calls)?status.tokens.calls.filter(call=>call.usageAvailable!==true).length:undefined}
function renderUsage(project){const status=project.status,usage=status?.tokens,measurement=status?.measurement;const panel=append(el('section',undefined,'panel'),el('h2','Token usage'));panel.append(el('p','Recorded input: '+tokenText(usage?.inputTokens)+' · recorded output: '+tokenText(usage?.outputTokens)));panel.append(el('p','Calls with unknown usage: '+tokenText(unknownCallCount(status))+' · unmeasured attempts: '+tokenText(measurement?.unmeasuredAttempts),'muted'));if(usage?.measurementComplete===false)panel.append(el('p','Partial measurement. These counts are the reported portion; total usage is unknown.','muted'));if(!usage)panel.append(el('p','No token totals have been reported.','muted'));content.append(panel)}
function metric(title,value,note){return append(el('div',undefined,'metric'),el('div',title,'label'),el('strong',value),el('p',note))}
function validDate(value){if(!/^\\d{4}-\\d{2}-\\d{2}$/u.test(value))return false;const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value}
function parseNavigationHash(hash){
  const params=new URLSearchParams(String(hash||'').replace(/^#/u,''));
  const screen=params.get('screen')||'overview',project=params.get('project'),view=params.get('view')||'now';
  const period=Number(params.get('period')||30),group=params.get('group')||'day',from=params.get('from')||'',to=params.get('to')||'';
  const datesValid=(!from&&!to)||(validDate(from)&&validDate(to)&&from<=to&&Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')<=365*86400000);
  if(!['overview','workspace','project'].includes(screen)||!['now','usage','results'].includes(view)||![1,7,30,90,365].includes(period)||!['day','week','month'].includes(group)||!datesValid||(screen==='project'&&!/^[a-f0-9]{32}$/u.test(project||'')))return {...defaultNavigation};
  return {screen,project:screen==='project'?project:null,view,period,group,from,to};
}
function serializeNavigationHash(state){
  const params=new URLSearchParams({screen:state.screen,view:state.view,period:String(state.period),group:state.group});
  if(state.project)params.set('project',state.project);
  if(state.from&&state.to){params.set('from',state.from);params.set('to',state.to)}
  return '#'+params.toString();
}
function setNavigation(change,replace=false){
  const next=parseNavigationHash(serializeNavigationHash({...navigationState,...change}));
  navigationState=next;selected=next.screen==='project'?next.project:null;projectView=next.view;periodDays=next.period;bucket=next.group;customFrom=next.from;customTo=next.to;
  if(typeof history!=='undefined'&&typeof location!=='undefined')history[replace?'replaceState':'pushState'](null,'',serializeNavigationHash(next));
  renderRoute();
}
function restoreNavigation(){
  const restored=parseNavigationHash(location.hash);
  // Back/forward can emit both popstate and hashchange for one transition.
  if(serializeNavigationHash(restored)===serializeNavigationHash(navigationState))return;
  navigationState=restored;selected=navigationState.screen==='project'?navigationState.project:null;projectView=navigationState.view;periodDays=navigationState.period;bucket=navigationState.group;customFrom=navigationState.from;customTo=navigationState.to;
  if(selected&&!projects.some(project=>project.id===selected)){navigationState={...navigationState,screen:'overview',project:null};selected=null}
  if(typeof history!=='undefined'&&location.hash!==serializeNavigationHash(navigationState))history.replaceState(null,'',serializeNavigationHash(navigationState));
  renderRoute();
}
function beginRequest(){requestVersion++;if(activeController)activeController.abort();activeController=new AbortController();return {version:requestVersion,signal:activeController.signal}}
function currentRequest(version){return version===requestVersion}
function isAbort(error){return error&&error.name==='AbortError'}
async function api(path,options={},signal){const response=await fetch(path,{...options,signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data}
function projectStatus(project,now=Date.now()){
  const goal=project.goal?.status||null,loop=project.status?.state||null,attentionStates=['blocked','failed','paused'],activeStates=['active','running'];
  const observed=(project.status?.supervision||[]).filter(p=>p.liveness==='alive'&&now-Date.parse(p.heartbeatAt)<15000).map(p=>Date.parse(p.lastProgressAt||'')).filter(Number.isFinite);
  const updated=Math.max(Date.parse(project.status?.updatedAt||''),...observed),stale=activeStates.includes(loop)&&Number.isFinite(updated)&&now-updated>20*60000;
  const attention=Boolean(project.errors?.length)||attentionStates.includes(loop)||attentionStates.includes(goal)||stale;
  const active=activeStates.includes(loop)||activeStates.includes(goal);
  let primary=project.errors?.length?'unavailable':attentionStates.includes(loop)?loop:attentionStates.includes(goal)?goal:activeStates.includes(loop)?loop:activeStates.includes(goal)?goal:goal||loop||'ready';
  if(stale&&!project.errors?.length&&!attentionStates.includes(goal))primary='unconfirmed';
  return {primary,goal,loop,attention,active,stale};
}
function visibleProjects(values,query,filter,now=Date.now()){
  const needle=query.trim().toLowerCase();
  return values.filter(project=>{
    const status=projectStatus(project,now),matches=!needle||[project.name,project.root,project.goal?.objective].some(value=>String(value||'').toLowerCase().includes(needle));
    return matches&&(filter==='all'||filter==='active'&&status.active||filter==='attention'&&status.attention);
  }).map((project,index)=>({project,index,status:projectStatus(project,now)})).sort((a,b)=>Number(b.status.attention)-Number(a.status.attention)||Number(b.status.active)-Number(a.status.active)||a.index-b.index).map(item=>item.project);
}
function nav(){
  navigation.replaceChildren();
  const all=el('button','All projects','nav-button');all.setAttribute('aria-current',String(navigationState.screen==='overview'));all.onclick=()=>setNavigation({screen:'overview',project:null});navigation.append(all);
  const compare=el('button','Compare consumption','nav-button');compare.setAttribute('aria-current',String(navigationState.screen==='workspace'));compare.onclick=()=>setNavigation({screen:'workspace',project:null});navigation.append(compare);
  for(const project of projects){const item=el('button',project.name,'nav-button');item.setAttribute('aria-current',String(navigationState.screen==='project'&&selected===project.id));item.onclick=()=>setNavigation({screen:'project',project:project.id});navigation.append(item)}
}
function heading(title,subtitle){content.replaceChildren(el('h1',title),el('p',subtitle,'summary muted'))}
function renderOverview(){
  beginRequest();nav();heading('A clear view of the work.','Goals, loops, independent checks and the next thing that needs your attention.');
  const statuses=projects.map(project=>projectStatus(project)),attention=statuses.filter(status=>status.attention).length,active=statuses.filter(status=>status.active).length;
  content.append(append(el('div',undefined,'metrics'),metric('Projects',projects.length,'Registered on this machine'),metric('In progress',active,'Active goals or reported loops'),metric('Needs attention',attention,'Blocked, paused, stale or unavailable')));
  const tools=el('div',undefined,'overview-tools'),field=el('label',undefined,'field'),searchLabel=el('span','Search projects','label'),search=el('input');search.type='search';search.value=overviewQuery;search.placeholder='Name, path or objective';field.append(searchLabel,search);tools.append(field);
  const filters=el('div',undefined,'filter-group');filters.setAttribute('role','group');filters.setAttribute('aria-label','Project status filter');
  const cards=el('div',undefined,'cards');
  function draw(){
    cards.replaceChildren();
    const visible=visibleProjects(projects,overviewQuery,overviewFilter);
    for(const project of visible){const status=projectStatus(project),card=append(el('article',undefined,'project-card'),badge(status.primary),el('h2',project.name),el('p',project.goal?.objective||'No active objective yet.'),el('p',project.root,'path'));
      if(status.goal&&status.loop&&status.goal!==status.loop)card.append(el('p','Goal: '+status.goal+' · Loop: '+(status.stale?'unconfirmed (last reported '+status.loop+')':status.loop),'state-line'));
      else if(status.stale)card.append(el('p','Loop activity is unconfirmed; last report was '+status.loop+'.','state-line notice'));
      if(['active','running'].includes(status.loop)&&project.status?.storyTitle)card.append(el('p','Reported task: '+project.status.storyTitle,'state-line'));
      const reason=['blocked','failed','paused'].includes(status.loop)?project.status?.reason:['blocked','paused'].includes(status.goal)?project.goal?.reason:null;
      if(reason)card.append(el('p',reason,'notice'));
      if(project.errors.length)card.append(el('p',project.errors.join('; '),'notice'));
      card.append(button('Open project →',()=>setNavigation({screen:'project',project:project.id})));cards.append(card);
    }
    if(!visible.length){const empty=append(el('div',undefined,'empty'),el('p',projects.length?'No projects match this search and filter.':'No registered projects. Run yoke dashboard from a project directory.'));if(projects.length)empty.append(button('Clear search and filters',()=>{overviewQuery='';overviewFilter='all';renderOverview()}));cards.append(empty)}
    for(const child of filters.children)child.setAttribute('aria-pressed',String(child.dataset.filter===overviewFilter));
  }
  for(const [value,label] of [['all','All'],['active','Active'],['attention','Needs attention']]){const control=button(label,()=>{overviewFilter=value;draw()});control.dataset.filter=value;filters.append(control)}
  search.oninput=()=>{overviewQuery=search.value;draw()};tools.append(filters);content.append(tools,cards);draw();
}
function row(title,note,state){return append(el('div',undefined,'row'),append(el('div',undefined,'row-main'),el('div',title),el('small',note)),badge(state))}

${dashboardPanels()}
function renderRoute(){if(navigationState.screen==='workspace')showWorkspaceUsage();else if(navigationState.screen==='project'&&selected&&projects.some(project=>project.id===selected))showProject(selected);else renderOverview()}
async function refresh(){
  const request=beginRequest();
  try{
    const loaded=await api('/api/projects',{},request.signal);if(!currentRequest(request.version))return;projects=loaded;
    if(selected&&!projects.some(project=>project.id===selected)){navigationState={...navigationState,screen:'overview',project:null};selected=null}
    if(typeof location!=='undefined'&&typeof history!=='undefined'&&location.hash!==serializeNavigationHash(navigationState))history.replaceState(null,'',serializeNavigationHash(navigationState));
    renderRoute();
  }catch(error){if(currentRequest(request.version)&&!isAbort(error))heading('Workspace unavailable',error.message)}
}
document.getElementById('refresh').onclick=refresh;
if(typeof window!=='undefined'){window.addEventListener('popstate',restoreNavigation);window.addEventListener('hashchange',restoreNavigation)}
refresh();
</script></body></html>`
}
