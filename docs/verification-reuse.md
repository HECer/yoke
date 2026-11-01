# Conservative verification reuse

Verification reuse is an optional, run-local optimization for explicitly approved pure commands. It is not an acceptance shortcut. A result can be reused only after a successful execution with unchanged inputs and a later identical identity. Failed or input-mutating commands are never cached. Integration, completion, and independent acceptance keep their own execution paths. The normal loop applies this optimization to opted-in criterion commands; the independent full verification gate still executes.

## Default input coverage

Set `verify.reusableCommands` only for commands known to have no network access, external mutable inputs, or relevant side effects. A shell command cannot automatically prove that property. With no input declaration, the identity includes regular workspace files, ignored fixtures, `.env` files, installed local dependencies and Yoke runtime state. It also binds the child environment, execution policy, Node runtime bytes, platform, architecture, Git HEAD, index and working-tree status. Internal `.git` directories are represented by those Git fields, rather than recursively fingerprinting the object database.

The previous implementation fingerprinted tracked workspace content and then fingerprinted the whole directory again. It also loaded the Node executable as one buffer before finding that a large input tree could not be reused. The current implementation inventories the input set first, rejects unsupported or oversized sets before reading file content, and hashes each selected file with one reusable 128 KiB buffer. Git subprocesses may perform their own filesystem reads. Runtime content is still checked per identity; it is not trusted solely because timestamps or `process.version` match.

Local limits are 10,000 regular files, 20,000 total inventory entries and 64 MiB of file content. The runtime has a separate 512 MiB limit. Symlinks, unsupported file types, Git errors and changes observed during hashing disable reuse. A post-command identity check prevents a successful command that changed its inputs from populating the cache. File permissions are included, and file boundaries are unambiguous. Up to 128 successful identities are retained in memory for the session.

## Explicit input declarations

An operator may supply `verify.reusableInputPaths` to avoid invalidation from unrelated runtime outputs. This is an assertion that the listed files/directories cover the **complete file input set for every command in `reusableCommands`**, including dependencies, fixtures, compiler settings and scripts that those commands use. It is not inferred from imports, lockfiles or Git status. Omitting a relevant input can make this opt-in unsafe; use the conservative default unless the input contract is known.

For example, a dependency-free source validation script could declare:

```yaml
verify:
  reusableCommands:
    - node scripts/check-source.mjs
  reusableInputPaths:
    - scripts/check-source.mjs
    - src
    - fixtures
    - package.json
```

If that script imports packages or reads other files, declare those inputs too. This example is not a sufficient declaration for an arbitrary project. All declared paths must exist and be workspace-relative files or directories. Globs, absolute paths, parent traversal and symlink ancestors are refused. Empty declarations and more than 256 paths disable reuse. Directory contents are inventoried recursively. Overlapping declarations do not cause duplicate content reads.

Environment, execution policy, runtime and Git identity remain bound with a declaration. Yoke's acceptance, configuration, requirements, PRD and plan files are always included when present; their absence is also recorded. This prevents a narrow source declaration from ignoring a changed acceptance contract. Git-visible changes still invalidate identity where they change status/index/HEAD, even if the changed path was not declared. Use normal ignored runtime state when that state is intentionally outside the command's file inputs.

## Diagnostics

`VerificationSession.stats()` retains executed/reused counts. `diagnostics()` adds identity-check count, workspace files/bytes hashed, runtime bytes hashed, elapsed identity time, reason counts and the last reason reuse was skipped. `createVerificationSession({ onDiagnostic })` can report each reason once per session. Messages omit input contents and environment values. Invalid declarations or a failed identity never skip the actual command; they disable reuse and execute it normally.

The identity does not make a concurrently mutable filesystem atomic, isolate the command, discover external tools' mutable data, or establish purity. These remain prerequisites for opting a command into reuse. Large or linked package installations may remain ineligible. The aim is to make that decision cheap and visible, not to silently remove dependencies from the identity.

## Local source profile

To rerun these fixtures with development dependencies installed and baseline commit `a97c5e0` available locally, run `node bench/verification-cache-profile.mjs`. It transpiles the baseline and current source locally and prints new JSON measurements to stdout; redirect that output to a new file rather than replacing the dated checked-in result.

The November 2026 remediation used two deterministic fixtures and separate Node 24.22.1 processes for the old and new implementations. Each process requested the same successful command twice. The eligible fixture produced one execution and one reuse in both versions; the oversized fixture executed twice in both versions. Counters exclude Git subprocess I/O. These are single observations in a shared environment, not an end-to-end performance guarantee or a Rust comparison.

| Fixture | Before | After |
| --- | ---: | ---: |
| 32 MiB workspace: Node workspace content read across three identities | 144 MiB | 96 MiB |
| 32 MiB workspace: largest content buffer/read | 121.06 MiB | 128 KiB |
| 32 MiB workspace: observed elapsed time | 781.9 ms | 485.7 ms |
| 32 MiB workspace: observed process peak RSS | 341.8 MiB | 38.6 MiB |
| Oversized 81 MiB workspace: workspace content read before rejection, two attempts | 32 MiB | 0 |
| Oversized workspace: runtime content read before rejection, two attempts | 242.1 MiB | 0 |
| Oversized workspace: observed elapsed time | 385.4 ms | 3.4 ms |

The Node executable was still fully hashed for every eligible identity in both versions. The reduced memory footprint comes from streaming, and reduced workspace bytes come from removing the duplicate content pass. The oversized fixture improvement comes from inventorying and applying the existing bounds before content reads.
