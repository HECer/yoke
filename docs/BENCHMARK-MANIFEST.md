# Benchmark comparison manifests

Yoke 1.22.0 adds a versioned provenance and comparability contract to the direct
Codex comparison tools. This changes the tooling, not the historical results.
No authenticated development run or new savings measurement is implied.

## What a new result records

The result document has schemaVersion 2 and a manifest with schemaVersion 1.
The manifest declares a unique comparison identity, its purpose (workflow or
controlled), the expected arms, the planned paired repeat count, and every
condition that is intentionally allowed to differ between arms. Each declared
difference needs a field name and a reason.

Each run contains its own context:

| Section | Recorded conditions |
| --- | --- |
| Source | Package version, Git commit, dirty state, SHA-256 build digest and whether source/build inputs stayed stable during the run |
| Fixture | Fixture identity and SHA-256 digests of the seed, original acceptance files and shared requirements |
| Execution | Provider, requested model, provider-reported model identities, effort, routing, native delegation, native goals, worker count and workflow |
| Prompt | Digest and scope of the submitted input: direct provider prompt or Yoke PRD/configuration bundle |
| Startup | Permissions, bare mode, ignore-rules, commit policy, isolation, timeout policy and user-state policy |
| Environment | Platform, architecture, Node version, provider CLI version, hashed host identity, background-load policy and whether skills/plugins were audited |

The build digest hashes the actual runtime files, canon, adapters/hooks, package
metadata, dependency lockfile and comparison tooling. It is recorded even for a
clean checkout, because an ignored dist directory can be stale. Dirty work is
therefore identified by both its base commit and runtime digest. Changes during a
run invalidate the stable-source condition. Missing Git or CLI provenance remains
unknown; it is never filled from a version written into an older report.

These digests identify recorded inputs. They are not signatures and do not prove
that a provider served a particular model. Reported model identity comes from
provider telemetry, never from the requested alias as a fallback.

## Submitted inputs and effective prompts

The direct arm records a digest of the prompt sent to the provider. The Yoke arm
records a digest of the PRD and generated configuration submitted to the workflow.
Those inputs are expanded into story prompts by the separately hashed runtime.
The manifest labels these different scopes explicitly.

The tool does not claim to capture every dynamically expanded prompt, retry
message, provider system instruction, discovered skill or native context.
The seed and requirement digests still have to agree across all arms. A prompt
digest difference is permitted only when the manifest declares it.

## Current workflow comparison

The comparison still measures one direct Codex session against Yoke's normal
story execution. Yoke can add worktrees, per-story provider starts, verification
and commits. These are deliberate workflow differences, not isolated measurements
of a scheduler or model-call overhead.

The existing direct-arm ignore-rules flag is retained and explicitly declared as
a startup-policy difference. Yoke retains its normal project rule handling.
Both arms request bare mode and disable native multi-agent delegation. The tool
does not silently modify global provider configuration or user rules.

Model and effort must match across arms unless a different experiment explicitly
declares those fields as variables. The same applies to actual model identities:
matching aliases alone do not establish a same-model comparison. An allowed
difference never makes a missing value valid. Fixture, requirement and acceptance
differences cannot be waived.

Conditions must stay stable within repeated runs of the same arm. A changing
adaptive model mix therefore needs a separately designed comparison contract;
this fixed-arm workflow tool does not silently pool such runs.

## Analysis and output states

Run the analyzer on already recorded result files:

    node bench/analyze-codex-comparison.mjs path/to/results.json

Files may contribute different arms of the same declared comparison. They must
agree on the manifest and supply every planned arm/repeat exactly once.
Different comparison identities are never pooled merely because their fixture
and arm labels match.

| State | Meaning |
| --- | --- |
| verified | All declared paired runs exist, recorded conditions match the contract, immutable acceptance passes, and input/cache/output telemetry is present |
| incompatible | Undeclared differences, changing within-arm conditions, conflicting manifests or duplicate measurements |
| incomplete | Some planned arms or repeats are missing |
| acceptance-failed | An arm did not pass immutable acceptance; its short failure time cannot count as a speedup |
| unverified | Missing/unknown provenance or telemetry, an unsupported schema, invalid context or an invalid variable declaration |
| legacy/unverified | The input predates manifests; its reported provenance and measurements remain readable but are not promoted to a verified comparison |

Only verified comparisons produce entries in the top-level groups array.
Other measurements remain in runs and explicitly labeled diagnostic summaries.
Missing or partial token measurements remain null. The analyzer does not invent
USD costs, CPU/memory measurements or savings percentages.

A successfully parsed diagnostic report can exit 0 while containing no verified
comparison. Consumers must inspect comparison status and groups. Malformed JSON,
impossible cache accounting, invalid timing and empty measurement inputs fail
the command.

## Historical records

The analyzer reads both older results arrays and the runs arrays in dated
aggregate reports. It preserves their reported version and commit under
legacyReports, marks them legacy/unverified and leaves performance groups empty.
It no longer hardcodes Yoke 1.19.0 or the September audit commit.

The September 29 comparison and September 30 corrected smoke remain historical
evidence with their original sample sizes and limitations. The latter has no
contemporaneous baseline and must not be combined with the former to claim a
new relative speedup.

## Measurement limits and authorized execution

Manifest verification establishes recorded comparability, not statistical
confidence, complete environment isolation or general product quality.
Current fixtures have visible tests and are small. Host load is uncontrolled,
skills/plugins are not exhaustively audited, and the dependency lockfile does
not certify every installed dependency or provider-internal setting.

Wall time starts after fixture preparation and ends when the runner exits.
Independent acceptance duration is separate; summaries also report elapsed time
through that acceptance. Source/environment hashing and fixture setup are
outside that timed interval.

The comparison launcher makes real authenticated provider calls. Run it only
under the user's authorized experiment scope. It accepts explicit arms, repeats,
model and effort; its default result root is a short OS-temporary directory
whose logs are retained. Tooling tests use synthetic records and do not launch
providers. An existing authorization for exactly two Curiuma development runs
is not permission for an additional fixture matrix or model-routing study.
