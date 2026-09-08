import { expect, it } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { dashboardPage } from '../../src/dashboard/page.js'

function dashboardContext(options: { storage?: Record<string, string>; prefersDark?: boolean } = {}) {
  const html = dashboardPage('a'.repeat(64), 'validNonce')
  const script = /<script[^>]*>([\s\S]*?)<\/script>/u.exec(html)![1]
  const storage = {
    getItem: (key: string) => options.storage?.[key] ?? null,
    setItem: (key: string, value: string) => { if (options.storage) options.storage[key] = value },
  }
  const context = createContext({
    AbortController,
    URLSearchParams,
    document: { documentElement: { dataset: {}, style: {} }, getElementById: () => ({}) },
    fetch: () => new Promise(() => {}),
    localStorage: storage,
    matchMedia: () => ({ matches: options.prefersDark ?? false }),
    setTimeout,
  })
  runInContext(script, context)
  return context
}

it('formats planned task timing and missing token measurements explicitly', () => {
  const context = dashboardContext()
  expect(runInContext("taskTiming({id:'a'},{available:true,tasks:[{storyId:'a',startMs:60000,endMs:180000}]})", context)).toBe('Predicted 2m · planned start +1m')
  expect(runInContext("taskTiming({id:'a'},{available:false})", context)).toContain('unknown')
  expect(runInContext('tokenText(undefined)', context)).toBe('Unknown')
  expect(runInContext('tokenText(0)', context)).toBe('0')
  expect(runInContext('unknownCallCount({tokens:{calls:[{usageAvailable:true},{usageAvailable:false},{}]}})', context)).toBe(2)
  expect(runInContext('unknownCallCount({measurement:{unmeasuredAttempts:2}})', context)).toBeUndefined()
})

it('gives blocked and running loops precedence over a completed goal and marks stale activity unconfirmed', () => {
  const context = dashboardContext()
  const completedWithRunningLoop = runInContext("projectStatus({goal:{status:'complete'},status:{state:'running',updatedAt:'2026-09-06T11:55:00Z'},errors:[]},Date.parse('2026-09-06T12:00:00Z'))", context)
  expect({ ...completedWithRunningLoop }).toMatchObject({ primary: 'running', goal: 'complete', loop: 'running', attention: false, active: true, stale: false })

  const completedWithBlockedLoop = runInContext("projectStatus({goal:{status:'complete'},status:{state:'blocked'},errors:[]},Date.parse('2026-09-06T12:00:00Z'))", context)
  expect({ ...completedWithBlockedLoop }).toMatchObject({ primary: 'blocked', goal: 'complete', loop: 'blocked', attention: true })

  const stale = runInContext("projectStatus({goal:{status:'complete'},status:{state:'running',updatedAt:'2026-09-06T11:30:00Z'},errors:[]},Date.parse('2026-09-06T12:00:00Z'))", context)
  expect({ ...stale }).toMatchObject({ primary: 'unconfirmed', loop: 'running', attention: true, active: true, stale: true })
})

it('searches objective and path and orders attention before active work', () => {
  const context = dashboardContext()
  const result = runInContext(`visibleProjects([
    {id:'idle',name:'Idle',root:'C:/idle',errors:[]},
    {id:'active',name:'Active',root:'C:/active',goal:{status:'active',objective:'Ship routing'},errors:[]},
    {id:'blocked',name:'Blocked',root:'C:/blocked',status:{state:'blocked'},errors:[]}
  ],'', 'all', Date.parse('2026-09-06T12:00:00Z')).map(p=>p.id)`, context)
  expect([...result]).toEqual(['blocked', 'active', 'idle'])
  expect(runInContext(`visibleProjects([{id:'one',name:'One',root:'C:/one',goal:{objective:'Compare usage'},errors:[]}],'usage','all',0).length`, context)).toBe(1)
  expect(runInContext(`visibleProjects([{id:'one',name:'One',root:'C:/special-path',errors:[]}],'SPECIAL','all',0).length`, context)).toBe(1)
})

it('validates dashboard hash state and round-trips project comparison controls', () => {
  const context = dashboardContext()
  const state = runInContext("parseNavigationHash('#screen=project&project=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&view=usage&period=90&group=week&from=2026-08-01&to=2026-08-31')", context)
  expect({ ...state }).toEqual({ screen: 'project', project: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', view: 'usage', period: 90, group: 'week', from: '2026-08-01', to: '2026-08-31' })
  const roundTrip = runInContext('parseNavigationHash(serializeNavigationHash(' + JSON.stringify({ ...state }) + '))', context)
  expect({ ...roundTrip }).toEqual({ ...state })
  const invalid = runInContext("parseNavigationHash('#screen=project&project=../secret&view=other&period=999&group=hour&from=2026-09-02&to=2026-09-01')", context)
  expect({ ...invalid }).toEqual({ screen: 'overview', project: null, view: 'now', period: 30, group: 'day', from: '', to: '' })
})

it('renders one history transition once when both browser history events arrive', () => {
  const context = dashboardContext()
  const result = runInContext(`(()=>{
    let renders=0;renderRoute=()=>{renders++};
    globalThis.location={hash:'#screen=workspace&view=usage&period=7&group=week'};
    restoreNavigation();restoreNavigation();
    return {renders,screen:navigationState.screen,period:periodDays};
  })()`, context)
  expect({ ...result }).toEqual({ renders: 1, screen: 'workspace', period: 7 })
})

it('freezes equal current and previous period boundaries and compares zero or incomplete baselines honestly', () => {
  const context = dashboardContext()
  const windows = runInContext("periodWindows(Date.parse('2026-09-06T12:00:00Z'),30,'','')", context)
  expect(windows.current.to - windows.current.from).toBe(windows.previous.to - windows.previous.from)
  expect(windows.previous.to).toBe(windows.current.from)
  expect(runInContext('comparisonText(12,0)', context)).not.toMatch(/Infinity|%/u)
  expect(runInContext('comparisonText(0,0)', context)).toContain('both periods')
  expect(runInContext("costComparisonText({reportedCostUsd:2,costState:'measured'},{reportedCostUsd:1,costState:'partial'})", context)).not.toMatch(/%/u)
  expect(runInContext("costComparisonText({reportedCostUsd:2,costState:'measured'},{reportedCostUsd:1,costState:'partial'})", context)).toContain('unavailable')
  expect(runInContext("costComparisonText({reportedCostUsd:2,costState:'measured'},{reportedCostUsd:1,costState:'measured'})", context)).toBe('+100.0% vs previous period')
  expect(runInContext('usageCoverage({unknownCalls:2,unmeasuredAttempts:1})', context)).toContain('3')
})

it('keeps unavailable costs unknown when history is unreadable', () => {
  const context = dashboardContext()
  expect(runInContext("costText(historyCost({costState:'unknown',reportedCostUsd:0},['corrupt archive']))", context)).toBe('Unknown')
  expect(runInContext("historyCost({costState:'measured',reportedCostUsd:1},['corrupt archive']).costState", context)).toBe('partial')
  expect(runInContext("historyCost({costState:'measured',reportedCostUsd:1},[]).costState", context)).toBe('measured')
})

it('invalidates stale responses, bounds workspace work to three requests and stops obsolete scheduling', async () => {
  const context = dashboardContext()
  const navigation = runInContext(`(()=>{const first=beginRequest(),second=beginRequest();return {firstAborted:first.signal.aborted,firstCurrent:currentRequest(first.version),secondCurrent:currentRequest(second.version)}})()`, context)
  expect({ ...navigation }).toEqual({ firstAborted: true, firstCurrent: false, secondCurrent: true })
  const result = await runInContext(`(async()=>{
    let active=0,max=0,started=0,valid=true;
    const values=await mapLimited([1,2,3,4,5,6],3,()=>valid,async value=>{
      started++;active++;max=Math.max(max,active);
      await new Promise(resolve=>setTimeout(resolve,5));
      active--;if(value===1)valid=false;return value;
    });
    return {max,started,values};
  })()`, context)
  expect({ ...result, values: [...result.values] }).toEqual({ max: 3, started: 3, values: [1, 2, 3] })
})

it('renders the control-room shell and ranks project rows by the selected metric', () => {
  const html = dashboardPage('a'.repeat(64), 'validNonce')
  expect(html).toContain('class="control-room-shell"')
  expect(html).toContain('class="command-bar"')
  expect(html).toContain('id="attention-region"')
  expect(html).toContain('class="metric-strip"')
  expect(html).toContain('class="project-row"')
  expect(html).toContain('Ranked projects')

  const context = dashboardContext()
  const result = runInContext(`rankProjects([
    {id:'one',name:'One',attention:1,tokens:200},
    {id:'two',name:'Two',attention:3,tokens:100},
    {id:'three',name:'Three',attention:2,tokens:null}
  ],'tokens').map(project=>project.id)`, context)
  expect([...result]).toEqual(['one', 'two', 'three'])
})

it('uses system themes on first load and persists an explicit theme choice', () => {
  const html = dashboardPage('a'.repeat(64), 'validNonce')
  expect(html).toContain('--canvas:')
  expect(html).toContain('@media (prefers-color-scheme:dark)')
  expect(html).toContain('localStorage')

  const storage: Record<string, string> = {}
  const context = dashboardContext({ storage, prefersDark: true })
  expect(runInContext("themeState()", context)).toBe('dark')
  expect(storage['yoke-dashboard-theme']).toBeUndefined()
  runInContext("setTheme('light')", context)
  expect(storage['yoke-dashboard-theme']).toBe('light')
  expect(runInContext("themeState()", context)).toBe('light')
})

it('composes search, status, date scope, and project sort in URL navigation without secrets', () => {
  const context = dashboardContext()
  const state = runInContext("parseNavigationHash('#screen=overview&query=ship&status=attention&sort=tokens&period=7&group=week&from=2026-09-01&to=2026-09-07&token=secret')", context)
  expect({ ...state }).toMatchObject({ screen: 'overview', query: 'ship', status: 'attention', sort: 'tokens', period: 7, group: 'week', from: '2026-09-01', to: '2026-09-07' })
  const serialized = runInContext('serializeNavigationHash(' + JSON.stringify({ ...state }) + ')', context)
  expect(serialized).toContain('query=ship')
  expect(serialized).toContain('status=attention')
  expect(serialized).toContain('sort=tokens')
  expect(serialized).not.toContain('secret')
  expect({ ...runInContext('parseNavigationHash(' + JSON.stringify(serialized) + ')', context) }).toMatchObject({ query: 'ship', status: 'attention', sort: 'tokens', period: 7, group: 'week', from: '2026-09-01', to: '2026-09-07' })

  const result = runInContext(`visibleProjects([
    {id:'one',name:'One',root:'/one',goal:{objective:'Ship one'},errors:[],attention:1,tokens:200},
    {id:'two',name:'Two',root:'/two',goal:{objective:'Ship two'},status:{state:'blocked'},errors:[],attention:3,tokens:100},
    {id:'three',name:'Three',root:'/three',errors:[],attention:2,tokens:300}
  ],'ship','attention',Date.parse('2026-09-07T12:00:00Z'),'tokens').map(project=>project.id)`, context)
  expect([...result]).toEqual(['two'])
})
