# Delivery artifacts and executable user journeys

Use executable acceptance criteria to decide whether a release is ready. A build command shows that an artifact can be produced; a journey checks a specific user interaction. Yoke can now record the relationship between those criteria, named journeys and the exact artifact files present during a check.

The delivery declaration belongs in `.yoke/acceptance.yaml`. Browser smoke steps belong in `.yoke/config.yaml`. Existing smoke flows containing only `name`, `path` and an optional `landmark` continue to work.

## Optional browser steps

`yoke flow-smoke` uses the target project's Playwright installation and its Chromium browser. Start the application or preview server before running the command. Yoke does not start a development server or install a browser automatically.

For example, add this section to the project's existing `.yoke/config.yaml`:

```yaml
smoke:
  baseUrl: http://localhost:3000
  flows:
    - name: profile-survives-reload
      path: /login
      landmark: main
      timeoutMs: 60000
      steps:
        - action: fill
          selector: '[data-testid="email"]'
          value: smoke-user@example.invalid
        - action: fill
          selector: '[data-testid="password"]'
          valueEnv: SMOKE_TEST_PASSWORD
        - action: click
          selector: '[data-testid="sign-in"]'
        - action: expect-url
          url: /profile
        - action: fill
          selector: '[data-testid="display-name"]'
          value: Smoke User
        - action: press
          selector: '[data-testid="display-name"]'
          key: Tab
        - action: click
          selector: '[data-testid="save-profile"]'
        - action: expect-visible
          selector: '[data-testid="save-confirmation"]'
        - action: expect-text
          selector: '[data-testid="save-confirmation"]'
          text: Profile saved
          exact: true
          timeoutMs: 10000
        - action: reload
        - action: expect-text
          selector: '[data-testid="profile-name"]'
          text: Smoke User
          exact: true
```

Supply `SMOKE_TEST_PASSWORD` through the environment using credentials for a dedicated test account, then run:

```sh
yoke flow-smoke . --label=profile-release
```

`--url=http://localhost:4173` overrides `smoke.baseUrl`. Flow navigation keeps the existing `baseUrl + path` behavior, so configure their slashes consistently. Each flow gets a fresh browser context with a 1280 × 720 viewport. Steps within one flow share that context; different flows do not share their browser session.

### Supported steps

| Action | Fields | Behavior |
| --- | --- | --- |
| `click` | `selector` | Click the matching element using Playwright's action waiting. |
| `fill` | `selector`, exactly one of `value` or `valueEnv` | Fill a form control with a literal value or a captured environment value. Missing environment values fail the step. |
| `press` | `selector`, `key` | Press a key, such as `Enter` or `Tab`, on the matching element. |
| `expect-visible` | `selector` | Wait for the matching element to be visible. |
| `expect-text` | `selector`, `text`, optional `exact` | Wait for visible text. Whitespace is normalized. Matching is case sensitive and uses a literal substring by default; `exact: true` compares the complete normalized text. |
| `expect-url` | `url` | Wait for the exact resolved URL. A relative URL resolves against the effective base URL. This is not a glob or regular expression. |
| `reload` | No additional action fields | Reload the page, wait for its load event and reject a non-successful HTTP response. |

Each step may specify `timeoutMs`. Unknown actions and extra action fields are rejected before browser launch. There is no arbitrary JavaScript action, general scripting language, branch or loop. Use a project E2E test command for more complex behavior, multiple pages, downloads, native applications or specialized fixtures.

### Limits and failure behavior

A flow may contain **1–50 steps**. Its default total timeout is **60,000 ms**, with a configurable maximum of **120,000 ms**. This budget includes browser-context preparation, navigation, the optional landmark and all steps. Navigation has its own maximum of 30,000 ms. A landmark has a maximum of 10,000 ms.

A step defaults to **10,000 ms** and may request at most **30,000 ms**. Its actual allowance is capped by the remaining flow budget. Text waiting has both an attempt limit and a deadline. Screenshot capture, context closing and video finalization each have a separate 5,000 ms allowance after interaction ends; browser startup and shutdown also have bounded waits. The flow timeout is therefore not a promise that the whole multi-flow command, including evidence capture and cleanup, ends within that duration.

The first failed step stops the remaining steps of that flow. The report marks them `skipped`. Later flows still run. Non-successful navigation, page errors and error-level console events also fail a flow. A screenshot is required for a passing result. Failure video remains best-effort evidence and does not replace a missing screenshot.

Fill values are limited to 8,192 characters, including values read from the environment. Environment-backed fill values are captured once when the run begins.

## Evidence from a smoke run

Evidence is written to `.yoke/proof/<label>/`:

- A screenshot for each flow where screenshot capture succeeds.
- A `.webm` video for a failed flow when Playwright can finalize it.
- `report.json`, a versioned machine-readable report.

The default label is `YOKE_STORY` when present, otherwise `latest`; `--label` takes priority. Labels and filenames are sanitized, and colliding sanitized flow names receive distinct filenames. Running the same label replaces its previous evidence. A run that cannot start because its configuration, browser, source identity or proof location is unavailable does not erase the prior evidence during that preflight.

The report contains:

- Per-flow status, navigation status, optional landmark status and duration.
- Each configured step's index, action, status, duration and a bounded failure category.
- Relative screenshot and failure-video filenames.
- Source fingerprints before and after the run, and whether they match.
- A digest of the effective smoke configuration, URL override and captured fill inputs.
- Node version, operating-system platform, architecture, configured viewport, browser version when available and the effective URL's origin.

Raw configuration, selectors, expected text, fill values, environment-variable names and browser exception call logs are not serialized into the report. URL credentials, query strings and fragments are not included in its recorded origin. Driver errors are represented by categories such as `timeout`, `step-failed` or `navigation-failed`, because their original messages can contain form values. Screenshots and video still show what the application visibly displays; use test data appropriate for those visual artifacts.

Exit code `0` means all flows passed, their screenshots were captured, the source fingerprints before and after the run matched and no browser-cleanup failure was reported. Exit code `1` represents a failed run or invalidated evidence. Exit code `2` covers unavailable prerequisites or evidence storage. Invalid step configuration is rejected before browser launch.

The local source fingerprint does **not** prove that a remote server is running that source revision. Arrange the project's preview or deployment checks so the browser exercises the intended build. Record a separate deployment verification criterion when that relationship matters.

## Bind release artifacts and journeys to acceptance criteria

Add an optional `delivery` section to `.yoke/acceptance.yaml`:

```yaml
version: 1
protected:
  - .yoke/config.yaml
  - playwright.config.ts
  - tests/e2e/profile.spec.ts
criteria:
  - id: profile-e2e
    text: A signed-in user can save a profile and recover it after reloading.
    commands:
      - npm run test:e2e -- tests/e2e/profile.spec.ts
  - id: profile-smoke
    text: The release preview completes the configured profile journey.
    commands:
      - yoke flow-smoke . --label=profile-release
delivery:
  version: 1
  artifacts:
    - path: dist/release.zip
      criteria: [profile-e2e, profile-smoke]
  journeys:
    - id: profile-update
      text: Sign in, change a profile field, save it, reload and observe the saved value.
      criteria: [profile-e2e, profile-smoke]
  environment:
    name: Local release preview with Chromium
    url: http://localhost:3000
```

The script names, test files and artifact path in this example must exist in the application project. `delivery.journeys` names the intended user experience and references executable criteria; it does not execute browser steps by itself. The example executes smoke steps through the `profile-smoke` criterion's command.

**Build declared artifacts before starting `yoke check`:**

```sh
npm run build:release
# Start the project's preview server for that release in another terminal.
yoke check . --json
```

`build:release` here denotes the project's build script that creates `dist/release.zip`. A criterion that creates the declared artifact during `yoke check` is too late: the artifact must already exist for its initial snapshot.

The check report records artifact SHA-256 hashes and sizes before and after the commands. An artifact missing at either snapshot, differing between snapshots or using an unsafe path fails artifact binding. Declared artifacts must be regular project-relative files without symbolic links or path escapes. Explicit artifact hashing also covers ordinary ignored build outputs.

Artifact hashing accepts at most **512 MiB per file**. Each snapshot, before or after verification, has a combined **1 GiB byte budget** and a **10-second deadline**; an earlier enclosing check deadline also applies. Exceeding a limit or cancelling the check prevents a passing binding. Data is streamed in bounded chunks, with deadline and cancellation checks between synchronous reads. An individual blocked filesystem read is not preempted by that deadline. The declaration accepts at most 32 artifacts and 100 named journeys.

Artifact and journey status comes from their referenced criteria. All referenced criteria must pass for a passing status; a failed criterion fails the binding, while an unexecuted criterion remains unverified. Source-integrity, cancellation or artifact-binding problems also prevent a passing delivery result. Unknown criterion IDs and duplicate artifact paths or journey IDs are rejected.

The report labels this relationship **`binding: declared-criteria`**. Matching artifact hashes plus green criteria establish the declared relationship and the same artifact content at both snapshots. This is not continuous monitoring of the file between snapshots. The project command must actually exercise the intended artifact; Yoke cannot infer that a test which ignores its APK, ZIP or binary argument has verified that file.

Protect the acceptance manifest and the test infrastructure with the existing `yoke check . --protect` workflow after reviewing the contract. See [Verified projects](VERIFIED-PROJECTS.md) for protection and intentional-baseline-refresh behavior.

## Android example: verify the built APK on a specified device

A browser journey does not install an APK or validate Android permission handling. Use an application-owned executable test for that task and reference it from acceptance:

```yaml
version: 1
protected:
  - tools/check-apk-install.mjs
  - tests/android/tracking-fixture.json
criteria:
  - id: tracking-installed-apk
    text: The declared APK installs and completes the tracking fixture on the selected emulator.
    commands:
      - node tools/check-apk-install.mjs --apk=android/app/build/outputs/apk/debug/app-debug.apk --serial=emulator-5554
delivery:
  version: 1
  artifacts:
    - path: android/app/build/outputs/apk/debug/app-debug.apk
      criteria: [tracking-installed-apk]
  journeys:
    - id: record-and-reopen
      text: Grant the required permission, start tracking, receive fixture GPS points, stop, save and reopen the route after restarting the app.
      criteria: [tracking-installed-apk]
  environment:
    name: Android emulator emulator-5554 with the project's configured system image
```

`check-apk-install.mjs` and the fixture are **project-supplied tests**, not bundled Yoke commands. The script must install that exact APK, select and verify its device, perform the required permission and tracking actions, inspect the resulting route and process logs, and exit nonzero when an assertion fails. Build the APK first, prepare the emulator, then run `yoke check`.

The declared environment name is metadata. It does not detect the actual emulator image, phone model or OS version. Have the project test verify those properties when they are acceptance requirements. Passing on one emulator does not establish correct background tracking on a particular Vivo phone, and passing against one deployment does not certify every deployment.

## Validation scope

The smoke engine's repository tests use filesystem-backed browser doubles to verify step order, failure handling, timeout budgets, redaction, source/configuration binding and evidence persistence. They do not install browsers or certify an application. Application-level evidence comes from successfully running the configured commands with the project's actual browser, build, server or device.
