# Yoke skill capabilities and reliability design

**Date:** 2026-08-20  
**Target release:** 1.6.0  
**Status:** Approved design, awaiting written-spec review

## Goal

Yoke 1.6.0 will improve how skills are packaged, selected, and applied without removing an
existing capability or changing existing projects silently. The release will add a writing
quality skill, stronger domain and codebase design guidance, automatic UI quality checks for
detected UI projects, and a focused fix for the Windows provider-process test failures.

The work is split into independently verified layers. A layer may proceed only after its focused
tests pass. Release checks cover the integrated result.

## User outcomes

1. A skill can contain references, templates, assets, and scripts instead of being limited to one
   `SKILL.md` file.
2. Skill authors can state whether a skill may be selected automatically or must be started by the
   user.
3. Claude, Codex, and Gemini receive the closest native form of the same Canon policy.
4. Writers can invoke `no-ai-slop` to edit or inspect prose while keeping their meaning and voice.
5. UI projects receive `unslop-ui` checks automatically after Yoke detects a supported UI stack,
   unless the project disables or adjusts the check.
6. Agents use a shared domain vocabulary and design code through small, deliberate interfaces.
7. Merge conflicts are resolved from the intent of both changes and verified before completion.
8. Windows provider processes stop and release temporary directories within deterministic test
   bounds.
9. Users can install Yoke 1.6.0 through every existing release channel.

## Non-goals

- Importing every skill from `mattpocock/skills`.
- Adding an automatic upstream synchronization job.
- Claiming that prose was written by AI or assigning an AI probability score.
- Making qualitative prose style a build-blocking gate.
- Replacing Yoke's existing TDD, debugging, review, planning, or release skills.
- Redesigning the provider-process subsystem beyond the reproduced Windows failure.
- Changing the behavior of an installed project until the user runs a 1.6.0 setup, retrofit, or
  configuration command.

## Layer 1: complete skill packages

### Canon structure

Each manifest entry continues to point at a directory containing one required `SKILL.md`. Any
regular file below that directory belongs to the skill package. Nested directories are allowed.
Symbolic links are rejected so a package cannot escape its Canon directory.

The skill entry gains an invocation field:

```yaml
- id: no-ai-slop
  path: skills/no-ai-slop
  kind: methodology
  invocation: auto
```

Valid values are `auto` and `manual`. Omitted values resolve to `auto`, which preserves the current
manifest behavior. Before release, every Canon entry receives an explicit value so its intent is
reviewable.

### Package enumeration

One shared package enumerator will serve validation and all three Retrofit planners. It will:

1. Resolve the declared directory below the Canon root.
2. Walk entries in stable lexical order.
3. Reject symbolic links, sockets, devices, and paths outside the declared directory.
4. Return relative POSIX-style paths plus file bytes and whether the source file is executable.
5. Include dotfiles inside the skill package.

The action model will accept text or byte content and an optional executable flag. Existing text
actions remain valid. On POSIX systems, executable package files are written with user execution
permission. Windows ignores that flag. Existing backup, preserve-block, and idempotency behavior
continues to apply per generated file.

### Validation

`yoke validate canon` will fail when:

- `SKILL.md` is missing or is not a regular file;
- frontmatter lacks `name` or `description`;
- `invocation` has an unknown value;
- a package contains a symbolic link or unsupported file type;
- a relative Markdown reference points to a missing package file or escapes the package;
- two package files would map to the same target path.

External HTTP links are not fetched during validation. Markdown anchors are not validated. These
checks would make local validation depend on the network without protecting Retrofit integrity.

### Provider adapters

- **Claude:** Copy the complete package to `.claude/skills/<id>/`. For manual skills, emit
  `disable-model-invocation: true` in generated frontmatter. Canon source remains provider-neutral.
- **Codex:** Copy the complete package to `.agents/skills/<id>/`. Generate or merge
  `agents/openai.yaml` with `policy.allow_implicit_invocation` derived from the Canon invocation
  value. If a Canon package already provides that file, validation requires it to agree with the
  manifest.
- **Gemini:** Copy package resources next to the generated command and keep one command per skill.
  Manual skills remain command-only. Auto skills are listed in a short generated context index so
  Gemini can select the relevant command without loading every skill body into every turn.

`auto` means eligible for automatic selection where the provider supports it. It does not promise
identical provider internals. `manual` is strict: Yoke must not advertise that skill for automatic
selection.

## Layer 2: new and adapted capabilities

### `no-ai-slop`

Yoke will add an adapted copy of Peter Yang's MIT-licensed `no-ai-slop` package:

```text
canon/skills/no-ai-slop/
├── SKILL.md
└── eval.md
```

The package keeps its two modes:

- **Edit:** Make the minimum useful change, preserve the writer's meaning and voice, then report
  what changed.
- **Detect:** Name each observed pattern, quote the affected passage, and suggest a short fix
  without rewriting, scoring, or guessing authorship.

Yoke will preserve established technical terms and product names when they are precise. For
example, "coding harness" is part of Yoke's product language and must not be replaced merely
because "harness" can be empty marketing language elsewhere. The adaptation will document this
domain-term exception and otherwise retain the upstream workflow and evaluation checklist.

The skill is `auto`. Its description limits automatic selection to prose editing or inspection.
Code-only work does not trigger it. `document-release`, documentation-focused roles, and Yoke's
release-writing instructions will point to its evaluation checklist. Prose style remains advisory.

Attribution will name Peter Yang, link the source repository, state the MIT license, and describe
the Yoke-specific adaptation. The imported package and the completed local package will receive
read-only provenance audits. Missing provenance or watermark signals will be reported as unknown,
never as evidence of human authorship.

### `domain-modeling`

This `auto` skill will sharpen project terminology and record it in durable context. It will:

- distinguish reading an existing glossary from changing the domain model;
- challenge overloaded or contradictory terms;
- test relationships with concrete scenarios;
- compare stated behavior with the code;
- update a glossary when a term is settled;
- create an ADR only for a hard-to-reverse choice that is surprising without context and reflects
  a real trade-off.

Yoke keeps `.yoke/context/` as the source of truth. The existing `PROJECT.md`, `DECISIONS.md`, and
`KNOWLEDGE.md` files remain. The context layer gains `GLOSSARY.md` and optional `CONTEXT-MAP.md` for
projects with more than one domain context. `maintaining-context` owns persistence; this skill owns
the quality of domain language and ADR decisions.

### `codebase-design`

This `auto` reference skill will add a stable vocabulary for module, interface, implementation,
seam, adapter, depth, locality, and caller value. It will guide design toward:

- more behavior behind smaller interfaces;
- tests through the public interface;
- injected dependencies at real seams;
- a new seam only when at least two adapters or another demonstrated variation exists;
- designs that keep change and verification local.

The skill informs planning, TDD, architecture review, and code review. It does not mandate a
refactor unrelated to the current task.

### `resolving-merge-conflicts`

This `auto` skill triggers only during an in-progress merge or rebase conflict. It will inspect the
current operation, trace both sides to commits and available issue or spec evidence, preserve both
intents where compatible, and avoid inventing new behavior. It then runs discovered project checks
and completes the current merge or rebase. It will not abort an operation unless the user requests
that destructive reversal explicitly.

## Layer 3: automatic UI quality checks

### Configuration

The configuration gains:

```yaml
design:
  mode: auto
  max: 4
```

`mode` accepts `off`, `auto`, or `on`.

- `off` skips the integrated design scan.
- `auto` runs it only when Yoke detects a supported UI project.
- `on` runs it regardless of detection.

Missing configuration keeps current behavior and does not add a gate. `yoke new` and a 1.6.0
setup or retrofit write `mode: auto` only when detection succeeds. Users can change `max` or set
`mode: off` before running the loop.

### UI detection

Detection is deterministic and local. A project qualifies when at least one of these signals is
present:

- a framework dependency such as React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Astro, Angular, or
  a supported UI build plugin;
- a source file with `.tsx`, `.jsx`, `.vue`, `.svelte`, or `.astro` below a normal source root;
- an existing smoke-flow configuration.

Generated directories, dependencies, fixtures, and Yoke runtime directories are ignored. The
detector returns the evidence it used so setup output and tests can explain the decision.

### Gate behavior

The loop runs the existing design scanner as a named gate after ordinary verification and before
browser smoke flows. Failure output uses the existing bounded-preview and artifact rules. The
standalone `yoke design-scan` command remains unchanged.

The gate does not rewrite UI code. Its finding names and weighted score remain stable. A legitimate
design can raise the configured budget or disable the gate. Future per-rule suppression is outside
this release because no current use case requires another configuration format.

## Layer 4: Windows provider-process reliability

The existing failures must first be reproduced in focused tests. The diagnosis will distinguish:

- a child process that did not receive or honor termination;
- a parent that reports termination before the process tree exits;
- stdin or inherited handles that keep the child alive;
- Windows delaying directory release after process exit;
- a test timeout too short for the documented termination contract.

The fix must retain Yoke's ownership checks and fail-closed behavior. It may add bounded retries or
wait for confirmed process exit, but it may not kill by process-name pattern or remove a worktree
whose process ownership is uncertain.

Focused acceptance requires each affected test to pass repeatedly, including cleanup. The complete
suite must then pass without leftover provider processes or temporary directories.

## Data flow

```text
Canon manifest + complete skill directory
                │
                ▼
      validate and enumerate package
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
    Claude    Codex    Gemini
   package    package   command + resources
       │        │        │
       └────────┴────────┘
                │
                ▼
       project setup / retrofit
                │
       ┌────────┴────────┐
       ▼                 ▼
 durable skills     detected UI config
       │                 │
       ▼                 ▼
 interactive use    loop design gate
```

## Error handling and compatibility

- Package validation fails before Retrofit writes any project file.
- Retrofit continues to plan all actions before applying them, so an invalid package cannot leave
  a partial installation.
- Existing project files keep their backup and preserve-block behavior.
- A missing optional provider feature degrades to an explicit command and a documented warning.
- Existing manifests without `invocation` remain readable.
- Existing projects without `design` configuration keep their current verification behavior.
- No imported skill may run network commands during setup or Retrofit.
- New files are included in npm package checks and plugin manifests before release.

## Testing strategy

### Canon and package tests

- one-file skill remains valid;
- nested text and binary resources enumerate in stable order;
- executable metadata is preserved where supported;
- missing relative reference fails validation;
- external URL does not trigger a network request;
- path escape, symbolic link, and duplicate target fail closed;
- repeated Retrofit is idempotent.

### Provider tests

- Claude receives every package file and the correct manual frontmatter;
- Codex receives every package file and matching `agents/openai.yaml` policy;
- Gemini receives every package resource, command, and compact auto index entry;
- manual skills are not advertised for automatic selection;
- `no-ai-slop/eval.md` exists after all three Retrofit paths.

### Capability tests

- the manifest registers all four new skills;
- each skill has valid frontmatter and resolvable references;
- context initialization creates or safely introduces the glossary structure;
- existing context files remain unchanged unless their content requires an update;
- attribution covers every imported or adapted source.

### UI detection and gate tests

- supported dependencies and source files produce explained detection;
- non-UI TypeScript projects do not qualify;
- ignored directories and test fixtures do not qualify;
- missing design config preserves old behavior;
- `auto`, `on`, `off`, and custom budgets select the expected gate behavior;
- design failures use bounded output and preserve full artifacts.

### Windows tests

- targeted timeout, cancellation, and record-publication cases pass repeatedly;
- cleanup confirms process exit before removing directories;
- no broad process kill is introduced;
- the full suite passes on Windows.

### Release checks

The release requires:

```text
npm run lint
npm run yoke -- validate canon
npm test
npm run docs:update
npm run docs:check
npm run prepublishOnly
```

The focused suites run before the full suite so failures stay attributable.

## Documentation and release

README updates will explain complete skill packages, invocation modes, the difference between
`unslop-ui` and `no-ai-slop`, automatic UI detection, new context files, and the expanded skill
table. `CHANGELOG.md` will describe behavior changes and the default-preserving migration path.
`CONTRIBUTING.md` will document how to add package resources and choose an invocation mode.

The release version is 1.6.0 because the work adds user-facing capabilities without removing a
compatible interface. Version fields will be synchronized in the package, lockfile, Canon,
Claude plugin, Codex plugin, Gemini extension, and README metadata.

After checks pass, release actions are:

1. Commit the implementation and release metadata.
2. Push `main`.
3. Create and push `v1.6.0` at the verified release commit.
4. Create the GitHub Release.
5. Publish `@hecer/yoke@1.6.0` to npm.
6. Verify the GitHub release, remote tag, npm version, and packaged files.

If npm requires an interactive one-time password, implementation and GitHub publication may finish
first, but npm publication remains incomplete until the operator supplies the credential. Yoke
must report that state plainly rather than claiming the release is complete.

## Acceptance criteria

1. Existing one-file skills install exactly as before.
2. `no-ai-slop/SKILL.md` and `no-ai-slop/eval.md` install for Claude, Codex, and Gemini.
3. Every Canon skill has an explicit invocation policy and provider outputs reflect it.
4. New context and design skills are available without replacing current workflow skills.
5. Detected UI projects configured by 1.6.0 run the design gate automatically; other projects do
   not change behavior.
6. The reproduced Windows provider-process failures pass repeatedly and the full suite is green.
7. README, contributing guidance, changelog, attribution, package metadata, and plugin metadata
   describe the delivered behavior accurately.
8. GitHub and npm both expose Yoke 1.6.0, unless npm is waiting only for an operator-provided OTP
   that cannot be supplied through the active session.
