import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpStdioClient } from '../../src/code-intelligence/mcp-client.js'

const fakeServer = `
let buffer = Buffer.alloc(0)
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)])
  while (buffer.length) {
    let raw
    if (buffer.toString('ascii', 0, 14).toLowerCase().startsWith('content-length:')) {
      const end = buffer.indexOf('\\r\\n\\r\\n'); if (end < 0) return
      const length = Number(/content-length:\\s*(\\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))[1]); if (buffer.length < end + 4 + length) return
      raw = buffer.subarray(end + 4, end + 4 + length).toString(); buffer = buffer.subarray(end + 4 + length)
    } else {
      const end = buffer.indexOf(10); if (end < 0) return
      raw = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 1)
    }
    const message = JSON.parse(raw); if (message.id === undefined) continue
    const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25' } : { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }
    const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result })
    if (raw.startsWith('{')) process.stdout.write(payload + '\\n')
    else process.stdout.write('Content-Length: ' + Buffer.byteLength(payload) + '\\r\\n\\r\\n' + payload)
  }
})
`

describe('MCP stdio client', () => {
  it('honors each caller deadline while another caller owns initialization', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-shared-deadline-')), file = join(root, 'server.mjs'), release = join(root, 'release')
    writeFileSync(file, `import{createInterface}from'node:readline';import{existsSync}from'node:fs';
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const reply=()=>console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'ready'}]}}));
if(m.method==='initialize'){const timer=setInterval(()=>{if(existsSync(${JSON.stringify(release)})){clearInterval(timer);reply();}},10);}else reply();});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line')
    try {
      const first = client.call('first', {}, 2000).catch(error => error)
      await expect(client.call('second', {}, 80)).rejects.toThrow(/deadline/)
      writeFileSync(release, 'initialize now')
      expect((await first).content?.[0]?.text).toBe('ready')
    } finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('shares initialization across simultaneous calls and records the reported backend version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-concurrent-')), file = join(root, 'server.mjs')
    writeFileSync(file, `import {createInterface} from 'node:readline';let ready=false;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
if(m.method==='initialize'){setTimeout(()=>{ready=true;console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{serverInfo:{version:'observed-version'}}}));},100);return;}
console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,...(ready?{result:{content:[{type:'text',text:'ready'}]}}:{error:{message:'not initialized'}})}));});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line')
    try {
      const results = await Promise.all([client.call('first', {}, 2000), client.call('second', {}, 2000)])
      expect(results.every(result => result.content?.[0]?.text === 'ready')).toBe(true)
      expect(client.serverVersion).toBe('observed-version')
    } finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('starts with a fresh parser after a previous process exits mid-frame', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-restart-')), file = join(root, 'server.mjs'), marker = join(root, 'started')
    writeFileSync(file, `import{createInterface}from'node:readline';import{existsSync,writeFileSync}from'node:fs';
const marker=${JSON.stringify(marker)},first=!existsSync(marker);writeFileSync(marker,'yes');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
if(m.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}}));
else if(first){process.stdout.write('{unfinished');setTimeout(()=>process.exit(1),10);}
else console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'recovered'}]}}));});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line')
    try {
      await expect(client.call('first', {}, 2000)).rejects.toThrow(/exited/)
      expect((await client.call('second', {}, 2000)).content?.[0]?.text).toBe('recovered')
    } finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects oversized partial frames without waiting for the request timeout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-frame-')), file = join(root, 'server.mjs')
    writeFileSync(file, `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;if(m.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}}));else process.stdout.write('x'.repeat(2000));});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line', 1024)
    try { await expect(client.call('read', {}, 3000)).rejects.toThrow(/frame exceeds byte limit/) }
    finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform === 'win32')('terminates a backend descendant in the owned process group', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-tree-')), file = join(root, 'server.mjs'), heartbeat = join(root, 'heartbeat')
    writeFileSync(file, `import{createInterface}from'node:readline';import{spawn}from'node:child_process';
const child=spawn(process.execPath,['-e',${JSON.stringify(`const{writeFileSync}=require('node:fs');setInterval(()=>writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),10);`)}],{stdio:'ignore'});
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}}));});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line')
    try {
      await client.call('read', {}, 2000)
      for (let i = 0; i < 100 && !existsSync(heartbeat); i++) await new Promise(resolve => setTimeout(resolve, 10))
      expect(existsSync(heartbeat)).toBe(true)
      await client.close()
      await new Promise(resolve => setTimeout(resolve, 40))
      const stopped = readFileSync(heartbeat, 'utf8')
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(readFileSync(heartbeat, 'utf8')).toBe(stopped)
    } finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('discovers advertised capabilities using tools/list without invoking backend code queries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-list-'))
    const file = join(root, 'server.mjs')
    writeFileSync(file, `import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(m.id===undefined)return;
 if(!['initialize','tools/list'].includes(m.method))process.exit(2);
 const result=m.method==='initialize'?{protocolVersion:'2025-11-25'}:{tools:[{name:'find_symbol'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line')
    try {
      expect((client as any).listTools).toBeTypeOf('function')
      expect(await (client as any).listTools(2000)).toEqual(['find_symbol'])
    } finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })
  it('shares the call deadline with initialization instead of resetting the timeout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-deadline-')); const file = join(root, 'server.mjs')
    writeFileSync(file, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
 const message = JSON.parse(line); if (message.id === undefined) return;
 const delay = message.method === 'initialize' ? 100 : 250;
 setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'too late' }] } }) + '\\n'), delay);
});`)
    const client = new McpStdioClient(process.execPath, [file], root, 'line')
    try { await expect(client.call('read', {}, 300)).rejects.toThrow(/timed out|deadline/i) }
    finally { await client.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('speaks newline JSON-RPC for Graft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yoke-ci-mcp-')); const file = join(root, 'server.mjs'); writeFileSync(file, fakeServer)
    const client = new McpStdioClient(process.execPath, [file], root, 'line'); const result = await client.call('graft_find_code', { query: 'answer' }, 2000)
    expect(result.content?.[0]?.text).toContain('ok'); await client.close()
  })
})
