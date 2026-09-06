import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { parseSettings, prepareGeminiEnvironment } from '../../hooks/bounded-gemini.mjs'
const roots=[]
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))

it('forwards arguments and stdin to the child and removes its private settings after exit',()=>{
  const root=mkdtempSync(join(tmpdir(),'yoke-gemini-child-'));roots.push(root)
  const fake=join(root,'fake.mjs')
  writeFileSync(fake,`import {readFileSync} from 'node:fs';const settings=JSON.parse(readFileSync(process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8'));console.log(JSON.stringify({args:process.argv.slice(2),input:readFileSync(0,'utf8'),enabled:settings.experimental.enableAgents,file:process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH}));`)
  if(process.platform==='win32')writeFileSync(join(root,'gemini.cmd'),'@"'+process.execPath+'" "%~dp0fake.mjs" %*\r\n')
  else {writeFileSync(join(root,'gemini'),'#!/usr/bin/env node\n'+readFileSync(fake,'utf8'));chmodSync(join(root,'gemini'),0o755)}
  const env={...process.env,PATH:root+delimiter+(process.env.PATH??''),GEMINI_CLI_SYSTEM_SETTINGS_PATH:join(root,'absent.json')}
  // Windows environment names are case-insensitive: retain one PATH entry.
  for(const key of Object.keys(env))if(key!=='PATH'&&key.toLowerCase()==='path')delete env[key]
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('../../hooks/bounded-gemini.mjs',import.meta.url)),'--example'],{cwd:root,env,input:'test prompt',encoding:'utf8'})
  const value=JSON.parse(output)
  expect(value).toMatchObject({args:['--example'],input:'test prompt',enabled:false})
  expect(existsSync(value.file)).toBe(false)
})

it('parses comments without altering quoted URLs or escapes',()=>{
  expect(parseSettings('/* start */ { "url":"https://example.test/a//b", "escaped":"a\\\"b", // comment\n "flag":true }')).toEqual({url:'https://example.test/a//b',escaped:'a"b',flag:true})
  expect(()=>parseSettings('/* unfinished')).toThrow()
})
it('preserves system restrictions, defaults and credentials while disabling native agents in a separate temporary copy',()=>{
  const root=mkdtempSync(join(tmpdir(),'yoke-gemini-test-'));roots.push(root)
  const original=join(root,'system.json')
  const source='// policy\n'+JSON.stringify({security:{auth:{selectedType:'test-only'}},tools:{exclude:['write_file']},experimental:{enableAgents:true,otherFlag:true}})
  writeFileSync(original,source)
  const prepared=prepareGeminiEnvironment({GEMINI_CLI_SYSTEM_SETTINGS_PATH:original,EXAMPLE:'preserved'},'linux')
  try {
    expect(prepared.env.EXAMPLE).toBe('preserved')
    expect(prepared.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH).toBe(join(root,'system-defaults.json'))
    expect(JSON.parse(readFileSync(prepared.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8'))).toEqual({security:{auth:{selectedType:'test-only'}},tools:{exclude:['write_file']},experimental:{enableAgents:false,otherFlag:true},agents:{overrides:{codebase_investigator:{enabled:false},cli_help:{enabled:false}}}})
    expect(readFileSync(original,'utf8')).toBe(source)
  } finally {prepared.cleanup()}
  expect(existsSync(prepared.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH)).toBe(false)
})
it('fails closed on malformed existing policy and preserves explicit system-default paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'yoke-gemini-test-'));roots.push(root)
  const original=join(root,'system.json');writeFileSync(original,'{invalid secret content')
  expect(()=>prepareGeminiEnvironment({GEMINI_CLI_SYSTEM_SETTINGS_PATH:original})).toThrow('Cannot safely preserve existing Gemini system settings')
  const prepared=prepareGeminiEnvironment({GEMINI_CLI_SYSTEM_SETTINGS_PATH:join(root,'absent.json'),GEMINI_CLI_SYSTEM_DEFAULTS_PATH:join(root,'custom-defaults.json')})
  try { expect(prepared.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH).toBe(join(root,'custom-defaults.json')) }
  finally {prepared.cleanup()}
})
