# SoL-Pi with Yoke

Yoke can add NVIDIA's SoL-Pi extension to opted-in Pi invocations. The extension is off by default. This guide records the published evidence and the limits of Yoke's integration so you can decide whether to enable it.

## What the paper measured

The [SoL-Pi paper](https://arxiv.org/abs/2609.20519) reports benchmark runs on fixed tasks, models, harness configurations, and API prices. “Token traffic” below is recorded model-token traffic; scores are benchmark scores. The authors tested 51 publicly released tasks from EdgeBench, a subset of its 134 tasks.

On EdgeBench with GPT-5.6 Sol, the paper reports:

| Configuration | Recorded token traffic | API cost | Average score |
| --- | ---: | ---: | ---: |
| Pi baseline | 2.1538 billion | $1,339 | 44.833 |
| SoL-Pi Efficiency, all four mechanisms | 1.0990 billion (49.0% lower) | $894 (33.2% lower) | 42.003 (93.7% of Pi) |
| SoL-Pi Performance, ObservationPack alone | 2.0224 billion (6.1% lower) | $1,271 | 47.208 (5.3% above Pi) |

The complete efficiency configuration used fewer tokens and cost less in those runs, but scored lower than Pi. The separate performance configuration was the best-scoring single mechanism for GPT-5.6 Sol; it was not the full four-mechanism stack.

The paper also ran the complete stack with Opus 5, a backend not used to search for the mechanisms. It reports 44.7% less token traffic and 33.5% lower API cost than Pi ($1,158 versus $1,741), with an average score of 42.224 versus Pi's 44.756 (94.3% of Pi's score).

Results vary by benchmark. On 63 CPU-only Terminal-Bench 4 tasks, SoL-Pi solved 15 of 63 while Pi solved 18 of 63; total API cost was $211.12 versus $286.45 (26.3% lower), and cost per solved task was $14.07 versus $15.91 (11.6% lower). On six IMO 2026 problems, both systems passed three; SoL-Pi's reported cost per passed problem was $20.90 versus Pi's $25.32.

These are the paper's measurements, not measurements of Yoke's pinned extension build. They are not a project-level prediction or guarantee of savings. Your tasks, models, provider prices, cache billing, and enabled mechanisms can produce different cost and capability results. Yoke does not measure or promise a savings percentage for an individual project.

## Defaults and runtime

The `solpi.enabled` project setting defaults to `false`. Yoke adds the pinned SoL-Pi extension only to a Pi invocation when that setting is enabled. Each mechanism—`actionFusion`, `observationPack`, `evidencePreservingReducer`, and `onlineContextCompact`—also defaults to `false`; enabling the extension does not turn those mechanisms on. `cacheWriteReadRatio` defaults to `12.5` and is an input to the compaction decision, not a live price lookup or bill estimate.

Yoke pins SoL-Pi to [`d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0`](https://github.com/NVlabs/SoL-Pi/tree/d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0). The invocation requires Node.js 22.19 or newer and a compatible Pi CLI that you have installed and configured. Yoke does not install Pi or set up provider authentication. The Node.js minimum does not guarantee compatibility with every Pi release; review the [pinned extension source](https://github.com/NVlabs/SoL-Pi/tree/d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0) and the Pi version you use.

## Trust, permissions, and data

Pi project trust and extension approval remain Pi's responsibility. Yoke does not grant trust or add an automatic approval flag. If Pi requires the project to be trusted before loading project-local settings or an extension, trust it through Pi yourself.

SoL-Pi runs inside the Pi process with that process's filesystem, process, network, and credential permissions. It is not a separate sandbox or permission boundary. Pi's selected tool permissions still apply: Yoke's safe Pi profile allows `read,bash,edit,write`, while its read-only profile allows `read,grep,find,ls`; the unsafe profile does not add an explicit tool allowlist. Action Fusion can run a model-requested validation command through Pi's shell tool. Review the extension at its pinned revision and choose Pi permissions appropriate for the project before enabling it.

When enabled, Evidence-Preserving Reducer may send eligible diagnostic-log content to its configured reducer model using Pi-managed authentication. Logs can contain project data. Its evidence checks validate the reduced receipt against the archived source; they do not make the source private or act as a complete redaction step. Leave the reducer off for logs that must stay local, and follow the data rules for the provider that receives the request. See the upstream [SoL-Pi security policy](https://github.com/NVlabs/SoL-Pi/blob/d7ecfc089944f0d04b80122a0a9a6ca0d786f3d0/SECURITY.md).

## Configuration ownership

The project's `.yoke/config.yaml` is the durable source for Yoke's SoL-Pi settings; the dashboard edits the same project settings. For an enabled Pi invocation, Yoke writes the corresponding temporary Pi settings to `.pi/agent/settings.json` in that invocation's workspace. When the invocation ends, Yoke restores the file's previous contents or removes the temporary file and directories it created. Keep persistent SoL-Pi choices in Yoke's project configuration. Pi installation, project trust, and provider credentials remain owned by Pi and the user.
