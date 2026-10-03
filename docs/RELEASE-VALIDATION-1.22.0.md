# Yoke 1.22.0 validation — 2026-10-03

Implementation was based on `f2d9180f4e72afe79c9930c62625874d734db3c6`
(1.21.1). Parallel implementation and independent reviews covered routing and
telemetry, goals, worker recovery, Code Intelligence, benchmark provenance and
delivery evidence. This record separates deterministic regression evidence from
provider performance or publication claims.

## Local release gates

Environment: Linux, Node.js **24.19.0**, npm **11.9.0**.

| Gate | Result |
| --- | --- |
| Baseline before changes | 1,426 tests in 156 files passed. |
| `npm run prepublishOnly` | Passed: lint, build, complete test suite, README metadata and package dry-run. |
| Complete corrected suite | **1,610 tests in 177 files passed**, no skipped tests; 63.75 seconds in this run. |
| Canon validation | Passed with `node --import tsx src/cli.ts validate canon`. |
| Dependency audit | `npm audit --audit-level=high`: **0 vulnerabilities**. |
| Whitespace validation | `git diff --check` passed. |
| Tarball installation | Passed in a fresh prefix with lifecycle scripts disabled: installed binary starts and validates its packaged Canon. |
| Package contents | 376 files; all five packaged version manifests report 1.22.0; new runtime modules are included, with no root test suite, dependency tree or `.yoke` runtime state. |

The usual `npm run yoke -- validate canon` wrapper was blocked by this host's
restriction on the tsx CLI's local IPC socket (`EPERM`). Loading the same source
CLI through Node's tsx import hook passed. No project permission or verification
policy was weakened to accommodate that environment restriction.

The first integrated runs exposed issues added during concurrent implementation;
the corrected final suite above passed. A registry-eviction test additionally
needed an explicit clock advance: equal-millisecond event filenames have UUID
tie ordering, so wall-clock timing could leave an older observation in its
fixture. The test now establishes eviction deterministically and still verifies
that the independent durable attempt account remains exhausted.

## Regressions covered

- Durable implementation admission across restarts, registry write failures and
  eviction of more than 1,000 optional observations; concurrent reservations and
  interrupted attempts retain their spent slots.
- Per-call goal budget checks before dispatch, planning consumption before worker
  admission, native/ordinary provider selection and complete or partial usage
  through failure paths.
- Stable usage IDs, reviewer/critic/repair joins, partial provider telemetry and
  dashboard aggregates that preserve known child calls.
- Economic selection of comparable complete execution sequences, including
  failed attempts and escalation, model/policy changes, cold starts, missing
  costs and all three objectives. Synthetic observations test the decision
  rules; they do not measure model superiority.
- Real temporary Git repositories for incomplete-worker recovery and candidate
  retention. Pause, cancellation, failed gates and selection errors preserve
  work; ownership, contract, base and repository validation guard reuse.
- Unchanged gate reuse, invalidation after relevant changes, typed completion
  repair, persistent no-progress blocking and separate candidate scopes.
- Code Intelligence reference direction, unknown freshness, incomplete traversal,
  total response budgets, shared deadlines and pre-mutation receipt admission.
- Delivery artifact/source/acceptance binding, bounded hashing, unsafe paths,
  command outcomes and secret-safe multi-step browser proof reports.
- Benchmark manifests binding actual source/build identity, fixture, acceptance,
  model and startup policy; incompatible and legacy rows stay out of verified
  comparison groups.

## Limits and operational behavior

No paid LLM calls, authenticated provider benchmarks, production deployments or
real-browser end-to-end application runs were performed for this release. Browser
journey tests use deterministic browser seams. Model cost/latency observations
are fixtures, and there is no claimed percentage saving or general speedup.

Old routing configurations retain their ranking unless optimization is enabled.
New setup configurations choose `balanced`, requiring 20 comparable complete
samples for baseline and alternative; the supported minimum is 10. Cost tiers
and versioned setup profiles are configuration priors. Missing actual costs,
partial usage or ambiguous role attribution prevent economic promotion.

Provider counters reported only at call completion cannot impose an in-flight
hard token cap. Known overruns are retained and block further dispatch; unknown
interrupted usage needs an explicit budget decision. Separately prepared project
planning and human time are not amortized into execution-sequence comparisons.

Recovery preserves code and evidence, not a previous process's callback closures.
A recovered integration cannot manufacture a missing economic success outcome.
Candidate races resume the first retained alternative through ordinary recovery;
additional alternatives remain available for inspection and explicit cleanup.
Custom lifecycles without `retain` preserve their prior cleanup contract.

Artifact hashes compare pre-check and post-check contents. They do not detect a
change reverted between snapshots, establish reproducible builds or prove that a
particular deployed binary or device was exercised. Hashing is bounded to 512 MiB
per artifact, 1 GiB and 10 seconds per snapshot; checks run between synchronous
reads and cannot preempt an individual blocked filesystem read. Delivery commands
and declared environment labels remain project-authored evidence.

Code Intelligence uses a conservative UTF-8 byte-based token estimate, not
provider token accounting. Tiny budgets may only return the documented bounded
error envelope. Backend freshness remains unknown without independent evidence.

## Remote verification and publication

The repository CI matrix runs Linux and Windows with Node 20 and 24. Its status
is attached to the pushed release commit and pull request in GitHub Actions;
local success alone does not establish cross-platform success.

The dated [changelog](../CHANGELOG.md#1220--2026-10-03) is the source of release
notes. A Git commit, push or tag does not imply npm publication. Publishing a
GitHub Release triggers the separate trusted npm workflow; publication must be
verified independently before reporting this version as available from npm.
