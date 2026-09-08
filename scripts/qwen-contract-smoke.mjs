import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { buildProviderInvocation } from '../dist/agents/providers.js'
import { parseProviderResult, parseProviderTelemetry } from '../dist/agents/telemetry.js'

// Manual only: the normal test suite never launches a real agent CLI.
const cli = process.argv[2]
if (!cli) throw Error('Usage: node scripts/qwen-contract-smoke.mjs /absolute/path/to/qwen/cli-entry.js (run npm run build first)')
const root = mkdtempSync(join(tmpdir(), 'yoke-qwen-contract-'))
const requests = []
const server = createServer(async (req,res) => {
  let body = ''; for await (const chunk of req) body += chunk
  if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
  const request = JSON.parse(body); requests.push(request)
  const toolReply = request.messages.find(m => m.role === 'tool')
  const choice = toolReply
    ? { delta: { role: 'assistant', content: JSON.stringify({ schemaVersion: 1, verdict: 'pass' }) }, finish_reason: 'stop' }
    : { delta: { role: 'assistant', reasoning_content: 'Read the fixture before answering.', tool_calls: [{ index: 0, id: 'read-fixture', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ file_path: join(root, 'fixture.txt') }) } }] }, finish_reason: 'tool_calls' }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.write('data: ' + JSON.stringify({ id: 'mock-1', object: 'chat.completion.chunk', created: 1, model: request.model, choices: [{ index: 0, ...choice }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }) + '\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  writeFileSync(join(root,'fixture.txt'), 'Synthetic fixture; no user data.\n')
  for (const model of ['qwen3.7-plus', 'deepseek-v4-flash', 'deepseek-v4-pro', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3']) {
    const qwenHome = join(root, model + '-home'); mkdirSync(qwenHome, {recursive:true})
    writeFileSync(join(qwenHome,'settings.json'), JSON.stringify({ telemetry:{enabled:false}, modelProviders:{openai:[{id:model,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,envKey:'YOKE_MOCK_KEY'}]}, general:{chatRecording:false} }))
    const start = requests.length
    const inv = buildProviderInvocation('qwen', 'Read fixture.txt using read_file, then emit the JSON verdict.', root, 'unsafe', {model:'openai::'+model,nativeMultiAgent:false})
    const child = spawn(process.execPath, [resolve(cli),...inv.args], {cwd:root,env:{PATH:process.env.PATH,QWEN_HOME:qwenHome,YOKE_MOCK_KEY:'mock-only-no-real-credentials',QWEN_CODE_SUPPRESS_YOLO_WARNING:'1'},stdio:['pipe','pipe','pipe']})
    let stdout='',stderr=''; child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.stdin.end(inv.input)
    const timer=setTimeout(()=>child.kill('SIGKILL'),40000)
    const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer)
    writeFileSync(join(root,model+'.jsonl'),stdout);writeFileSync(join(root,model+'.stderr'),stderr)
    assert.equal(code,0,stderr.slice(-2000))
    assert.deepEqual(parseProviderResult('qwen',stdout),{schemaVersion:1,verdict:'pass'})
    assert(requests.length-start >= 2,'tool roundtrip occurred')
    const followup=requests.slice(start).find(r=>r.messages.some(m=>m.role==='tool'))
    assert(followup.messages.some(m=>m.role==='assistant'&&m.reasoning_content),'reasoning_content preserved through tool calls')
    assert(JSON.stringify(followup.messages.filter(m=>m.role==='tool')).includes('Synthetic fixture; no user data.'), 'read_file tool actually succeeded')
    assert(!stdout.split('\n').some(line => { try { const event=JSON.parse(line); return event.type==='user' && event.message?.content?.some(part => part.type==='tool_result' && part.is_error===true) } catch { return false } }), 'no tool errors')
    const telemetry = parseProviderTelemetry('qwen',stdout.split('\n'))
    assert.equal(telemetry.tokens?.model,model)
    console.log(JSON.stringify({model,code,requests:requests.length-start,resultParsed:true,reasoningPreserved:true,telemetry}))
  }
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); rmSync(root, {recursive:true, force:true}) }
