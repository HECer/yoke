# Windows runner correction — 2026-09-06

AI-assisted implementation and validation record for issue #5. These changes are
included in 1.10.0; installed 1.9.0 packages and existing processes must be updated/restarted to use them.

## Reproduction and correction

On this machine, Codex 0.153.4 running the Microsoft Store PowerShell executable
under `codex sandbox -P :workspace` reproduced `CreateProcessAsUserW failed:
-1073283067`. The System32 Windows PowerShell executable succeeded under the
same sandbox profile. A first end-to-end probe exposed a second entry point:
the WindowsApps `pwsh.exe` app-execution alias failed with access denied.

Yoke now filters Store PowerShell directories and their aliases from the provider's
own PATH, prefers an available native PowerShell executable and tests it in the
actual isolated working directory before starting the model. The same PATH is
passed to Codex and its shell environment. This changes neither machine/user PATH
nor sandbox privileges. Native PowerShell 7 is preferred; Windows PowerShell is
the fallback when no native `pwsh.exe` is available. Projects requiring PowerShell
7 should install a native distribution and make it available on PATH.

The preflight uses the installed CLI's built-in `:workspace` or `:read-only`
permission profile. An unsupported CLI/profile or failing shell blocks execution
with an actionable message. No permission escalation or unsandboxed retry occurs.
The preflight itself has a 30-second execution deadline, followed by bounded
process-tree cleanup; an outer 90-second guard bounds an unresponsive supervisor.
Environment values, prompts and raw authentication diagnostics are not stored in
the supervision record.

Windows npm launchers are resolved to their JavaScript entry point and invoked
with a native Node argv array; executable providers are launched directly. Unknown
batch launcher formats are rejected. This removes the provider/watchdog use of
`shell: true` and preserves spaces, quotes, percent signs and shell metacharacters
as literal arguments.

## Supervision and failure behavior

Both serial and parallel implementation providers have independent output,
successful-tool/edit progress and overall timers. Defaults:

```yaml
loop:
  timeoutMinutes: 20          # output inactivity; existing setting
  progressTimeoutMinutes: 20 # no observed successful tool result or edit
  maxCallMinutes: 30         # overall provider call
```

The two new settings accept positive values up to 1,440 minutes. Disabling the
old output timeout does not disable the other bounds. Successful tool/edit events
are evidence of activity, not proof that the product requirement has been met.

Codex structured failed-tool events and its actual `exec_command failed:
CreateProcess` stderr diagnostic stop the worker immediately. Terminal provider
authentication errors are separate from optional MCP startup warnings; the latter
alone do not fail the task. Failed infrastructure cannot produce a candidate or
story success merely because existing tests happen to pass, and does not train
capability escalation. Explicit `bare` startup settings now survive capability
profile selection.

Process records under `.yoke/supervision/` expose PID, process identity, supervisor
heartbeat, current attempt, last output, last successful tool/edit and terminal reason. Status CLI
and dashboard show these separately. Backlog ratios are labeled as backlog, not
overall product completion. Live identity checks distinguish an existing PID from
the recorded process. Tree termination checks that identity before reaping;
unconfirmed termination retains ownership/evidence and blocks a subsequent worker.
No retry/restart is triggered merely by an observer timing out. Failed worktrees
remain available for inspection.

## Validation

- Model-free reproduction: Store executable failed with the reported code;
  native System32 PowerShell passed in the same permission profile.
- Both safe and read-only preflights passed with a 30,707 UTF-16-character inherited
  environment in a path containing spaces. This simulates a large environment;
  it does not reconstruct every variable in the original Visual Studio session.
- Actual Yoke isolated safe-mode run: `codex-light`, requested `gpt-5.6-luna` at low
  effort; task started 18:49:44 UTC and completed 18:52:52 UTC. Real shell commands,
  file creation, two independent acceptance commands, verification and commit
  integration succeeded. One model call, no assessment call. Recorded input
  345,821 tokens (321,024 cached subset), output 2,353; monetary cost and actual
  reported model identity remain unknown.
- Regression tests cover literal argv, packaged aliases, streaming failure,
  optional MCP diagnostics, total timeout despite heartbeat output, retained
  redacted proof, no new worker after unconfirmed termination, and an actual
  child failure propagated through capability routing and the worker gate.
- Full suite: 1,170 passed, two skipped across 128 files at the recorded full-run
  checkpoint. Final focused validation: 119 passed across five files, plus a
  successful build and documentation consistency check.

The original DeviceLane process was observed alive. It was not restarted or
terminated, its retained worktree was not modified, and its application task was
not claimed complete. Issue #5 was not closed or externally commented on. The fix
must be installed before it can supervise a newly started DeviceLane run; it cannot
retrofit supervision into an already running old process.

Primary implementation reference consulted:
[OpenAI shell detection](https://github.com/openai/codex/blob/main/codex-rs/shell-command/src/shell_detect.rs).
The local executable probes above, rather than assumptions about upstream release
contents, establish the behavior observed here.

Read-only provenance audit: supported scan complete, no C2PA located; verification,
signer trust and Markdown metadata privacy unknown. The audit states: "No conforming
verifier was supplied." and "Keyed model-level watermarks cannot be checked without
the provider's key." No authorship inference or watermark removal was performed.
