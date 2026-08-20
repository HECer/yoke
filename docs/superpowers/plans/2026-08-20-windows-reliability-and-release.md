# Windows Reliability and 1.6.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Make provider-process termination and cleanup reliable under Windows suite load, then document, package, and publish the verified 1.6.0 release.

**Architecture:** Preserve scoped PID ownership and fail-closed records. Treat `taskkill` success as a termination request, then confirm that the recorded PID is gone with a bounded wait before removing ownership evidence or allowing cleanup. Release only one commit through the documented GitHub and npm channels.

**Tech Stack:** Node child processes, Windows `taskkill`, Vitest, npm, GitHub CLI, Git.

---

## Task 1: Reproduce and pin the Windows race

**Files:** `tests/agents/provider-process.test.ts`, `tests/agents/provider-process-record-failure.test.ts`, `tests/loop/watchdog.test.ts`

1. Record the isolated baseline: both provider-process files pass together, establishing that the failure depends on suite load rather than basic semantics.
2. Run the affected files repeatedly and run the full suite with verbose failure output. Capture whether time is spent before `close`, during `taskkill`, or in temporary-directory removal.
3. Add a failing watchdog unit test where `taskkill` returns zero while the injected liveness probe remains true for two polls; termination must not yet be confirmed.
4. Add a failing provider test that completion after cancellation leaves neither a live recorded PID nor a removable-directory race.

## Task 2: Confirm termination before releasing ownership

**Files:** `src/loop/watchdog.ts`, `src/agents/process.ts`, `tests/loop/watchdog.test.ts`, `tests/agents/provider-process.test.ts`

1. Extend `killProcessTreeForCleanup` on Windows with an injectable liveness probe and bounded 25 ms polling after successful `taskkill`.
2. Return `true` only when the PID is confirmed absent; return `false` when the bounded confirmation expires. Keep POSIX process-group behavior unchanged.
3. In `startProviderProcess`, preserve the ownership record whenever confirmation is false; remove it only on natural close without requested termination or confirmed termination.
4. Ensure stdin is closed before the first termination request and force escalation remains bounded and PID-scoped.
5. Run watchdog and provider-process tests ten times. Do not add a process-name kill or unconditional record deletion.

## Task 3: Run the complete quality ladder

**Files:** all changed source and tests

1. Run focused Canon, Retrofit, context, scan, loop, and agent suites.
2. Run `rtk npm run lint` and `rtk npm run yoke -- validate canon`.
3. Run `rtk npm test` at least twice on Windows and check for remaining `yoke-provider-*` temporary directories or owned provider processes after each run.
4. Fix only attributable failures and repeat the narrowest failing test before returning to the full suite.

## Task 4: Update release documentation with the new prose skills

**Files:** `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/PUBLISHING.md`

1. Update README behavior, examples, skill count/table, complete-package installation, invocation policy, `unslop-ui` versus `no-ai-slop`, UI auto detection, and glossary context.
2. Document package resources and invocation-policy authoring in CONTRIBUTING; add a 1.6.0 changelog entry and only adjust publishing guidance when the actual workflow changed.
3. Run `no-ai-slop` Detect mode over changed prose, make only supported voice-preserving edits, then run the global read-only provenance audit.
4. Run `rtk npm run docs:update` and `rtk npm run docs:check`.

## Task 5: Synchronize and verify 1.6.0 metadata

**Files:** `package.json`, `package-lock.json`, `canon/manifest.yaml`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `gemini-extension.json`, generated README metadata

1. Set every documented release field to `1.6.0` and regenerate lock and documentation metadata through project scripts.
2. Run `rtk npm run prepublishOnly` and inspect `npm pack --dry-run` output for required skill resources, especially `no-ai-slop/eval.md`.
3. Review `rtk git diff --check`, `rtk git status`, and the release diff; exclude `.omo/` and unrelated user files.
4. Commit the verified implementation and metadata on `main`.

## Task 6: Publish and verify both channels

**Files:** no further source edits after the release commit

1. Push `main`, create annotated tag `v1.6.0` at the verified commit, and push the tag.
2. Create the GitHub Release from that tag and verify its URL and commit.
3. Publish `@hecer/yoke@1.6.0` to npm. If npm alone requires an operator OTP, stop that channel and report it precisely.
4. Verify `git ls-remote`, the GitHub Release, `npm view @hecer/yoke version`, and package contents all resolve to 1.6.0.

