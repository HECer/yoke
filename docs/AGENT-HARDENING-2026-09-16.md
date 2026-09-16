# Agent and skill hardening — 2026-09-16

This is a bounded source/contract audit, not a guarantee of defect-free operation or a seven-provider model benchmark. Pi was already supported in 1.13.0. The npm release observed at the start of this audit was 1.15.0; the fixes below are included in the 1.15.1 release changeset.

## Implemented fixes

- Pi telemetry now sums finalized assistant messages across tool turns. Streaming snapshots, turn-end echoes and agent-end transcript replays are not double-counted. Model switches remain visible; missing turn measurements produce partial usage, not a complete total. Optional cost/cache fields are reported as full totals only when every finalized turn measures them. An interrupted unfinalized turn remains unknown.
- Pi successful tool completions and OpenCode/Kilo completed tool envelopes reset the progress watchdog. Failed tools and streaming updates do not. Total, idle and progress budgets remain enforced; no timeout defaults were relaxed.
- Structured results from Claude, Codex, Gemini, OpenCode and Kilo are rejected when followed by a terminal error. Pi errored/aborted assistant messages cannot supply a verdict. Claude child-agent events cannot masquerade as parent verdicts or parent usage. Qwen's existing parent/result handling remains in place.
- OpenCode/Kilo conflicting effort/variant aliases fail before process launch; matching aliases produce one flag.
- Pi settings use a skill path relative to `.pi/settings.json`. Manual-only skills receive Pi's native `disable-model-invocation` marker, just as Claude/Qwen already did.
- Schedule estimation simulates typical/lower/upper per-story durations with dependency and write-conflict constraints. A sparse per-story sample no longer inherits stronger confidence from unrelated pooled samples. These are empirical scenarios, not calibrated probabilities or deadlines.
- Eight missing supporting files are now packaged and linked: three delegation templates, a review template, three debugging guides and a testing anti-pattern guide. Shared instructions prohibit nested orchestration inside Yoke workers, explain host capability fallbacks, preserve acceptance/review gates, and distinguish budgets from time estimates. Removed unsupported claims about guaranteed subagent quality and fixed debugging speed/success rates.
- The Code Intelligence coordinator unit test now replaces the separate sandbox adapter too, avoiding accidental real Serena startup. It checks an actual rename in the isolated transaction output, approval gating, and that the source project remains untouched (apply does not merge).

## Compatibility and operation

Existing projects can refresh the canonical skills with `yoke retrofit . --agent=all`, or select one harness. Inspect the merge-aware retrofit diff and backups. Existing custom skill paths remain user-owned; remove an obsolete `.pi/skills` settings entry only after confirming it is the old Yoke-generated entry. The correct settings-relative entry is `./skills`.

Current Pi also requires project trust before loading project-local skills in headless runs. Trust is an explicit user decision, not something Yoke grants automatically. See [the harness guide](HARNESSES.md). Tool allowlists are not an OS sandbox: extensions and native configuration still require review.

## Evidence and limits

Final local validation: 1,281 tests passed, two platform-specific tests skipped, 140 test files passed. TypeScript lint/build, Canon validation, README metadata check and npm package dry run passed; npm audit reported zero vulnerabilities. A follow-up Canon run after the supporting-document additions passed (36 passed, one platform-specific skip). The subsequent release request targets 1.15.1; publication status is recorded by the matching GitHub release and npm registry, not inferred from these local checks.

Regression cases were observed failing before their fixes, then passing in targeted runs. Coverage includes multi-turn/chunked Pi usage, missing measurements, model changes, terminal errors, effort conflicts, sparse timing samples, manual invocation and packaged templates. Canon validation scans all registered skill packages; the content audit focused on orchestration, execution and verification instructions, not a formal proof of every skill's behavior.

The local Pi 0.85.1 CLI help confirms JSON mode, tool allowlists, provider/model/thinking selection and project-trust controls. Qwen and Kilo were not found on this machine's PATH. No paid/authenticated seven-agent task matrix, cross-platform native sandbox comparison, measured speedup or quality benchmark was performed. Faster feedback is a workflow recommendation, not a measured improvement claim. Existing full verification gates remain required.

A read-only README provenance scan found no supported C2PA structure and completed the supported scan. Cryptographic verification and signer trust remain unknown because no conforming verifier/trust policy was supplied. Metadata privacy was unsupported for this text format. Proprietary keyed watermark detection was unavailable; no authorship conclusion follows. No marks were removed.

Primary references: [Pi JSON mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md), [Pi event types](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts), [Pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md), [OpenCode run implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts).
