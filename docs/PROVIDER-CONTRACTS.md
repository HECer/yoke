# Provider contract evidence

Yoke's adapter tests and `<cli> --version` availability probe establish different things. Argument and parser fixtures verify Yoke's implementation against known inputs. A successful version command establishes that an executable responds. Neither proves that the installed version accepts every flag, enforces permissions, prevents native delegation, or returns the expected events on an authenticated task.

## Versioned smoke

Run the model-free inventory after building:

```sh
npm run bench:provider-contracts
```

The report uses contract ID `yoke-provider-contract/2026-11/v1`. It records the actual CLI version response, Node version, platform, time, availability, and `contract.status: not-run`. It never converts a missing CLI into a pass. The [November inventory](../bench/results/provider-contract-availability-2026-11-01.json) found none of the eight provider executables in the audit environment; no live result is claimed.

Run a single authenticated provider deliberately:

```sh
node bench/provider-contract-smoke.mjs --live --agent=codex --model=YOUR_MODEL --out=provider-contract.json
```

Replace `YOUR_MODEL` with an installed/account-supported model. A live call can incur provider charges. The smoke creates a disposable Git project, selects read-only controls, reserves one project-budget call, asks for an exact nonce-bearing result, and allows at most 60 seconds. It requests native structured output for Codex and non-Windows Claude. Other adapters receive an explicit output contract validated by the host parser. A pass requires process success, complete retained output, the exact result shape and nonce, and unchanged non-runtime workspace/configuration fingerprints. Runtime supervision files are excluded from that fingerprint. Full provider output is not printed or retained by the report; its hash is recorded.

The result keeps unknown usage/model identity visible. A benign pass does **not** certify permission denial, tool execution, cancellation, or native-agent restrictions; those fields remain `not-tested`. Nonzero/unavailable live runs exit 2. The script does not install CLIs, grant project trust, or authenticate accounts.

## Support dimensions

| Dimension | Current local evidence | Required before a stronger support claim |
|---|---|---|
| Argument construction and event decoding | Unit/contract fixtures across eight adapters | Recorded output from each supported actual version |
| Benign structured response | Versioned executable smoke is available | Authenticated result with actual CLI/model identity |
| Read-only and safe controls | Adapter flags and host source checks | Negative write/process/network cases on each OS and provider |
| Native delegation | Explicit Codex/Claude controls; Gemini settings adapter; Qwen exclusions; partial controls elsewhere | Provider/version-specific negative delegation tests including extensions |
| Cancellation | Local real-child POSIX regressions, retained unresolved ownership | Native Windows lifecycle and authenticated provider interruption cases |
| Economic benefit | Deterministic host measurements and historical live studies | Current paired native/Yoke runs with accepted outcomes and complete usage |

Keep the existing immutable acceptance replay and comparison manifest in `bench/compare-codex.mjs` for economic studies. A passing smoke is a prerequisite for those studies, not a substitute. Pin the tested CLI/model/permissions, alternate arm order, retain failures, and compare tokens and elapsed time **per accepted outcome**. Report fresh, cached, and unknown usage separately. Do not infer hidden provider-internal calls from Yoke's submitted-call count.
