# Migrating to Yoke 1.4

Yoke 1.4 adds dependency-aware parallel workers, isolated candidate selection, and a reference-driven quality gauntlet. Existing projects remain serial and skip quality comparison unless you opt in.

Upgrade and refresh generated harness files:

```bash
npm install -g @hecer/yoke@1.4.0
yoke retrofit .
```

## Parallel execution

Run dependency-ready stories concurrently with an explicit worker limit:

```bash
yoke loop run . --isolate --parallel=3
```

Parallel runs use isolated worktrees, leased claims, and a FIFO integration queue. Every candidate must pass its worker gates and the merged result must pass the project gates again. Adaptive routing is disabled during parallel and multi-candidate runs so each worker has one auditable provider identity.

Use `--candidates=N` to produce and mechanically gate multiple implementations before an identity-blind comparison selects the winner. Candidate mode supports up to five candidates.

## Reference-driven quality

Quality remains disabled by default. A story must declare a trusted reference, candidate artifacts, and a rubric:

```yaml
quality:
  reference: { name: approved-home, source: design/home.png, kind: file }
  candidate: { kind: screenshots, paths: [.yoke/proof/STORY-1/home.png] }
  rubric: Match the approved layout, hierarchy, spacing, and states.
  policy: blocking
```

Project defaults can bound critic and repair work:

```yaml
quality:
  enabled: false
  policy: blocking
  maxRounds: 3
  maxMinutes: 60
  consistencyChecks: 2
  maxParallelCandidates: 2
  critic: { agent: codex, model: gpt-5.6-sol }  # model required for --candidates
  repair: { agent: claude }
```

Enable it for one run with:

```bash
yoke loop run . --quality
```

`consistencyChecks` is fixed at `2`: Yoke runs the swapped-label pair needed to detect identity-sensitive critic output. Advisory mode records both verdicts without blocking; blocking mode permits bounded repairs and reruns all mechanical gates.

## Cleanup behavior

`yoke loop cleanup` now retains Yoke-created worktrees by default so failed candidates remain inspectable. Remove them explicitly when no longer needed:

```bash
yoke loop cleanup . --remove-worktrees
```

Cleanup still reaps only provider processes recorded for the current project and removes stale loop locks. It never kills providers by machine-wide process name.

## Review verdicts

Review verdict files now require `schemaVersion: 1` and provenance containing the provider, provider-reported model, review role, prompt version, and permission profile. Custom reviewer integrations must emit the contract printed in the reviewer prompt. Legacy verdict files without this envelope fail closed.
