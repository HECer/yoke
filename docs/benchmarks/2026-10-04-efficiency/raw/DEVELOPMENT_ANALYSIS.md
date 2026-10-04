# NEXUS: Entwicklungsanalyse mit Yoke

Messstand: 2026-10-04T09:27:32.214737+00:00 (UTC). Ein realer Benchmark-Lauf; keine Vergleichsmessung gegen direkten Codex. Rohdaten enthalten beobachtbare Metadaten und Messwerte, keine verborgenen Reasoning-Inhalte.

## Kompakte Auswertung

7/7 Stories bestanden; acht Implementierungsversuche, maximal zwei parallele Worker. Summierte Yoke-Loop-Laufzeit 56,4 Minuten. Implementierungsworker: 11.234.592 Input-Tokens einschließlich 10.621.952 Cache-Tokens, 82.193 Output-Tokens. Alle gemessenen Rollen zusammen zum Cutoff: 28,094,098 Input, davon 26,848,896 Cache-Lesen; 1,245,202 Input ohne Cache und 195,930 Output. Die große kumulierte Input-Zahl zählt wiederholten Kontext bei jedem Aufruf; sie entspricht nicht der Menge einmalig gelesener Inhalte.

Die wichtigsten belegten Bremsen waren Einrichtungs-/Kompatibilitätsprobleme, wiederholte Prüfung und Browserarbeit, eine Observer-verursachte Integrationswiederholung und ein erst unabhängig entdeckter Layoutfehler. Shell-Prüfungen der Implementierungsworker beanspruchten summiert 461,3 Prozesssekunden; diese Zeit ist teilweise in den Implementierungsphasen enthalten. Eine belastbare Aufteilung jeder Sekunde in Modelllatenz, Denken und Tool-Wartezeit ist mit den verfügbaren Daten nicht möglich.

## Messverfahren und Grenzen

- Provider-Tokens stammen aus Yokes History und nativen Codex-Tokenereignissen. Beide Ansichten werden nicht addiert. Eingabetokens enthalten Cache-Lese-Tokens; Reasoning-Ausgabetokens sind eine Teilmenge der Ausgabetokens.
- Ausgabebytes sind serialisierte Tool- bzw. Shell-Ausgaben, keine Provider-Tokens. Tool-Bytes können Bilddaten und Metadaten enthalten; daraus lässt sich keine Textkontextgröße ableiten. Gezählt werden eindeutige Usage-Ereignisse, keine unabhängig verifizierten HTTP-Requests.
- Aufteilung nach Story/Rolle ist direkt beobachtbar. Zweck einzelner Modellaufrufe in model-calls.jsonl und Shell-Kategorien ist eine Heuristik aus sichtbaren Tool-Aufrufen; gemischte Befehle sind nicht exakt zerlegbar.
- Shell-Zeiten sind Prozesslaufzeiten. Hintergrundserver, parallele Worker und Prüfungen können sich überlappen; ihre Summe ist keine Entwicklungs-Gesamtzeit. Verschachtelte Yoke-Phasen ebenfalls nicht doppelt addieren.
- RTK-Savings und Code-Intelligence-Tokenbudgets sind Schätzungen des Tools, keine zusätzlich gemessenen Provider-Tokens oder Geldbeträge. Geldkosten fehlen und werden als unbekannt geführt.
- Coordinator enthält Einrichtung, laufende Kommunikation, Instrumentierung und eigenständige Kontrolle. Dieser zusätzliche Messaufwand wird separat ausgewiesen. Werte enden am Messstand; spätere Aufrufe und Schlussantwort sind nicht enthalten.

## Messumfang, Umgebung und Instrumentierungsaufwand

Seit Start des 10-Sekunden-Observers bis zum Messstand: 91.7 Minuten. Das ist die erfasste verstrichene Zeit einschließlich Einrichtung, Unterbrechungen, Kontrolle und Analyse; kein reiner Produktentwicklungswert. Der Observer wurde vor der finalen Auswertung gestoppt. Sein letzter CPU-/RSS-Snapshot steht in observer-resources-final.txt.

Yoke 1.22.0; codex-cli 0.160.0; rtk 0.51.0; Runner gpt-6.1-sol / medium. Isolierte Worktrees, automatische Parallelität und Entscheidungen aktiv. Kein --explore. Code-Intelligence-Facade in ACTIVE: MCP-Handshake erfolgreich, tatsächliche semantische Backends graft/graphify/serena fehlen. Ein semantischer Effizienzgewinn wurde deshalb nicht nachgewiesen.

RTK-Datenbank für Root und sämtliche projektbezogenen Worktrees: 42 Befehle; geschätzte Input-/Output-Tokens 13.752/11.635; geschätzte Einsparung 2.117 (15.4 %). Diese lokalen Schätzungen betreffen registrierte RTK-Befehle und beweisen keinen prozentualen Rückgang des gesamten Modellverbrauchs. Native automatische Umschreibung verschachtelter Code-Mode-Aufrufe war nicht nachweisbar; explizite RTK-Nutzung ist ab den letzten Workern belegt.

| Instrumentierte Befehlsphase | Befehle | Fehler | Wall s | Child CPU s |
|---|---:|---:|---:|---:|
| environment | 4 | 1 | 0.9 | 0.6 |
| code-intelligence | 3 | 0 | 2.0 | 1.3 |
| planning | 5 | 1 | 61.4 | 11.0 |
| dependency-setup | 2 | 1 | 10.0 | 6.8 |
| yoke-smoke | 1 | 1 | 0.4 | 0.3 |
| execution | 4 | 2 | 3384.7 | 1277.9 |
| recovery | 1 | 0 | 0.5 | 0.3 |
| dev-server | 1 | 1 | 0.8 | 0.5 |
| browser-inspection | 2 | 0 | 14.3 | 5.4 |
| final-validation | 1 | 0 | 20.0 | 30.0 |
| final-yoke-smoke | 2 | 2 | 5.5 | 4.2 |

Dies umfasst nur über measure.py gestartete Prozesse. Child CPU kann überlappende Unterprozesse einschließen; Messskript-Ausführung, Tool-Roundtrips und Provider-Latenz sind nicht vollständig getrennt. Der Coordinator-Tokenverbrauch umfasst sowohl nötige Orchestrierung als auch zusätzliche Messarbeit; diese sind rückwirkend nicht exakt auseinanderzurechnen.

## Tokenverbrauch nach beobachtetem Zweck

Die folgende Aufteilung ist ausdrücklich eine Heuristik anhand des zuletzt sichtbaren Tool-Aufrufs. Ein Aufruf kann Lesen, Editieren und Prüfen verbinden. Werte sind keine exakte Trennung zwischen Denkzeit, Schreiben und Tool-Ergebnisverarbeitung. Vollständige Rolle/Zweck-Matrix: model-purpose-hints.csv.

| Implementierungsworker: Zweckhinweis | Usage-Ereignisse | Input | Cache | Output |
|---|---:|---:|---:|---:|
| discovery | 35 | 2.015.491 | 1.824.896 | 6.669 |
| checks | 63 | 3.377.368 | 3.130.624 | 44.163 |
| code_intelligence | 6 | 263.056 | 252.160 | 785 |
| dependency_setup | 6 | 270.273 | 244.480 | 2.947 |
| dev_server_or_mixed | 12 | 809.495 | 797.184 | 4.029 |
| waiting_or_polling | 26 | 1.668.311 | 1.642.752 | 1.869 |
| browser_validation | 41 | 2.830.598 | 2.729.856 | 21.731 |

### Direkt belegte Nacharbeit

Eine zusätzliche STORY-5-Implementierungsphase entstand durch den Observer-Commit während einer Integration. STORY-7 ist eine zusätzliche Reparatur innerhalb des ursprünglichen Produktscopes: Die unabhängige Prüfung fand trotz bestandener erster Gates 938px Desktop-Höhe bei 900px Viewport. Nach Reparatur misst der korrekt zugeordnete Root-Server 900px; Eventpanel-Unterkante 884px. Beide Messstände und Server-Provenienz sind archiviert. Fehlmessungen gegen den fremden Server wurden ausdrücklich invalidiert.

Guardian-Sessions sind separat ausgewiesen, weil sie in der Yoke-Story-Tokenansicht nicht enthalten waren. Für Kapazitäts-/Kostenplanung muss Yoke diese Kontrollkosten zusätzlich sichtbar machen. Keine erfundenen Geldkosten; keine Gegenrechnung von Cache-Lesetokens als kostenlos.

## Tokens nach Rolle

| Rolle | Sessions gemessen/gesamt | Modellaufrufe | Input inkl. Cache | Cache gelesen | Input ohne Cache | Output |
|---|---:|---:|---:|---:|---:|---:|
| guardian | 7/7 | 48 | 1.281.675 | 1.073.152 | 208.523 | 5.404 |
| implementation | 8/8 | 189 | 11.234.592 | 10.621.952 | 612.640 | 82.193 |
| coordinator | 1/1 | 127 | 15.525.113 | 15.139.456 | 385.657 | 107.118 |
| planner_or_review | 2/2 | 2 | 52.718 | 14.336 | 38.382 | 1.215 |

## Stories und Zeit

| Story | bestanden | Implementierungsaufrufe | Implementierung s | Gate-Prüfung s | Integration s | Input | Cache | Output |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| STORY-1 | True | 1 | 565.9 | 3.1 | 6.3 | 1.435.585 | 1.314.176 | 12.725 |
| STORY-2 | True | 1 | 367.4 | 2.8 | 8.7 | 698.268 | 643.968 | 8.663 |
| STORY-3 | True | 1 | 696.3 | 5.2 | 9.2 | 2.080.455 | 1.994.752 | 15.192 |
| STORY-4 | True | 1 | 505.8 | 4.1 | 11.8 | 921.789 | 857.088 | 12.190 |
| STORY-5 | True | 2 | 566.1 | 11.6 | 35.7 | 1.347.301 | 1.245.568 | 11.899 |
| STORY-6 | True | 1 | 683.2 | 28.8 | 28.3 | 2.950.211 | 2.853.888 | 13.068 |
| STORY-7 | True | 1 | 484.2 | 18.4 | 0.0 | 1.800.983 | 1.712.512 | 8.456 |

Abgeschlossene Loop-Prozesse: 4, davon fehlgeschlagen: 2. Summierte Loop-Laufzeit: 3384.7 s. Summierte Implementierungsphasen: 3868.9 s; Vereinigungsdauer dieser Intervalle: 3184.7 s. Beobachtete überlappende Worker-Zeit: 684.2 s. Dies ist keine gemessene Beschleunigung gegenüber einem seriellen Kontrolllauf.
Parallelitätsstichproben: 530, Intervall 10 s, beobachtete Spitze 2 Implementierungsworker und 2 gemeinsame Einheiten. Kurze Spitzen zwischen Stichproben können fehlen.

## Shell-Arbeit der Implementierungsworker

| Kategorie (heuristisch) | Aufrufe | Exit != 0 / abgebrochen | Prozesslaufzeit s | Ausgabebytes |
|---|---:|---:|---:|---:|
| discovery | 73 | 12 | 32.2 | 452.893 |
| dependency_setup | 10 | 5 | 114.5 | 6.349 |
| checks | 92 | 25 | 461.3 | 420.588 |
| browser_validation | 23 | 9 | 103.3 | 109.393 |
| dev_server_or_mixed | 12 | 12 | 677.8 | 4.534 |
| other | 17 | 3 | 86.7 | 4.748 |
| file_editing | 1 | 0 | 0.3 | 0 |

Fehlgeschlagene Testbefehle umfassen bewusst rote TDD-Tests. Sie sind nicht automatisch Produktfehler oder zusätzliche Yoke-Story-Versuche. dev_server_or_mixed enthält langlebige bzw. gemischte Befehle.

## Konkrete Findings und Verbesserungen

| ID | Beobachtung | Auswirkung / Verbesserung |
|---|---|---|
| CLI-HELP-MUTATION | yoke setup --help created 95 files and enabled loop; yoke retrofit --help then disabled loop | Read-only discovery mutated configuration and required explicit correction Handle help before command dispatch; reject unknown flags before mutation |
| RTK-INIT-FLAGS | rtk init --codex --auto-patch exits 1: cannot be combined | One failed setup call Document per-runner incompatible flags and expose compatibility validation |
| CI-WORKSPACE-ID | code_context rejects absolute path and configured codeIntelligence.workspaceId; MCP server computes hash workspace ID and ignores configured workspaceId | Two failed probes before reading implementation to determine identifier Expose workspace identifier in initialization/tool listing, honor config or document discovery method |
| CI-BACKENDS-MISSING | graft, graphify and serena executables absent on PATH | Facade can be enabled but semantic/structural backend functionality unavailable Add preflight that distinguishes configured active mode from operational backend coverage and provides pinned installation guidance |
| RTK-DUPLICATE-HOOKS | Yoke legacy hook and rtk init native Codex hook both present; rtk hook check is supported (exit 0) | Double hook registration observed; rewrite effectiveness with actual Codex tool schema needs separate measurement Use idempotent native Codex hook integration and provide actual rewrite/adoption telemetry |
| COMPACT-STATUS-MISSING | yoke loop status --compact prints story=none phase=undefined while loop-status.json reports active STORY-1 implementing | Compact progress unsuitable for reliable supervision; detailed status file required Summarize parallel workers in compact status and avoid undefined values |
| WRITE-SCOPE-DRIFT | STORY-2 declared src/simulation and tests/simulation.test.ts but commit writes src/simulation.ts, src/useSimulation.ts, src/types.ts, tests/simulation.test.tsx; scheduler scopes are advisory | Declared non-overlap does not prove actual non-overlap; shared type file changed during parallel topology work Compare candidate changes against writes declarations, surface deviations and recheck collision risk before integration |
| SMOKE-MISDIAGNOSIS | Yoke flow-smoke reports Playwright not found while node_modules/playwright/package.json exists; launchPlaywright catches both import and chromium.launch errors and returns null | Package absence and browser launch/sandbox failures have the same actionable error; worker reads harness source to diagnose Return structured import/browser-binary/sandbox/launch failure causes and preserve underlying error |
| EPHEMERAL-PROOF | After isolated STORY-1/2 integration, target .yoke/proof directory absent; earlier worker smoke screenshot was in removed worktree | Intermediate manual proof lost on cleanup; root must preserve required screenshots in tracked artifact path Copy and content-bind selected verification artifacts to target before deleting isolated worktrees |
| RTK-LEGACY-ALLOW | Yoke-generated rtk.mjs emits updatedInput without permissionDecision allow; official RTK Codex documentation requires allow for replacement to take effect | Legacy transparent command rewriting incompatible with documented Codex response contract; native RTK integration is also registered but worker adoption not observed Use current native rtk hook codex; verify an actual verbose Codex command records compressed output and RTK history |
| RTK-NATIVE-CORRECTION | Removed legacy Yoke hook registration; native rtk hook codex remains sole active hook and manual exact-schema probe rewrites git status correctly | Future workers receive native integration without duplicate response; effectiveness measured separately |
| SHARED-DEPS-SANDBOX | STORY-5 Vitest fails EPERM mkdir at target root node_modules/.vite-temp while executing in isolated worker; tests succeed after worker retries | Dependency reuse caused additional startup failure and approval/escalation path Share immutable package download cache, provide per-worktree writable dependency/runtime cache or explicit allowed paths |
| NETWORK-RETRY-CACHE | Target npm ci fails ECONNRESET downloading why-is-node-running; npm ci --offline --cache /private/tmp/nexus-npm-cache then installs 105 packages in 4s | At least one failed installation and repeated dependency setup; cached recovery successful Preflight and reuse exact lockfile package cache, classify network failures separately from code failures; n=1 does not establish general speedup |
| GUARDIAN-USAGE-GAP | Native Codex sessions with source.subagent.other=guardian report token usage separately; Yoke worker token event matches implementation session and excludes those sessions | Harness totals omit observable approval-model usage; independent observer reports it separately Expose approval/guardian call coverage and distinguish implementation usage from full provider-session cost; unknown charge remains unknown |
| OBSERVER-HEAD-RACE | Observer committed AGENTS.md during STORY-5 integrated gates; Yoke rejected changed target HEAD, retained candidate, and stopped loop | One failed integration and explicit recovery; prior source preserved; recovery invalidates proof and reruns implementation/gates Observer should make harness changes only between loop batches; CLI should expose integration busy state and avoid premature integration complete message |
| VISUAL-COMPOSITION | INVALIDATED: first observer screenshots came from another pre-existing NEXUS on port 4173; expected root Vite process exited with port-in-use error | Those visual conclusions are excluded from this project assessment Verify owning process cwd, successful server startup and source identity before collecting browser evidence |
| OBSERVER-WRONG-SERVER | First browser probe navigated occupied port 4173 before checking Vite process had started. Different NEXUS app names and styles exposed mismatch. Target process exit 1 confirmed port conflict. Existing listener left untouched. | One invalid browser run; screenshots and prior visual finding invalidated; its time/tokens remain observer overhead Require startup success plus bound process cwd and served source signature; use unique port and record provenance |
| RUNTIME-IGNORE-GAP | yoke prd assess creates .yoke/supervision/<uuid>.json but retrofit .gitignore lacks this directory. New loop blocked as dirty before any iteration. Initial planner supervision file was already tracked. | One zero-iteration loop failure; runtime ignore corrected and tracked runtime file untracked without deleting it Include all watchdog/supervision runtime state in generated ignore rules and distinguish harness-owned dirtiness from user code |
| COMPLETION-DIRTY-PROOFS | After loop complete 6/6, overview.png and selected-machine.png are modified because completion reexecutes screenshot-writing tests after story commit | Next loop starts dirty and requires explicit artifact commit even though previous loop reported completion Store rerun proofs outside tracked final assets, promote deterministic final proof once, or finalize generated artifact commit after completion verification |
| VERIFIED-VISUAL-GAP | Correctly bound app on port 6317 has document scrollHeight 938 for viewport 900; event panel bottom 914. All original six stories and design-scan passed. | Full-screen layout still incomplete; finite original-scope repair STORY-7 added, preserving existing functionality and tests Assert panel bottom bounds and populated incident/event states, not only horizontal overflow or panel top visibility; use independent visually bound review |
| OBSERVER-FINAL-SMOKE-DIRTY | Two final root smoke attempts had 1/1 successful browser flows but source evidence was rejected: first because observer config was uncommitted; second because observer report generation created an untracked root file during the gate. | Observer interference, not product failure. Root smoke must run only after artifact writes and commit are finished. Treat integrated source gates as a write lock for all coordinator tasks; keep measurement generation outside that interval. |

Priorität für Yoke: (1) sichere CLI-Hilfe und klare Preflight-Prüfung tatsächlicher RTK/CI-Funktion, (2) korrekte Zuordnung von Provider-, Approval-, Kontroll- und Integrationsfehlern, (3) konkrete Ursachen bei Browserfehlern und wiederverwendbare Paket-Caches mit isolierten Schreibverzeichnissen, (4) überprüfbare Schreibbereiche und dauerhafte Proof-Artefakte, (5) verlässliche kompakte Live-Status- und Tokeninformationen.

Die HEAD-Race wurde vom Observer verursacht. Yokes Ablehnung war eine richtige Sicherheitsentscheidung; die dadurch entstandene Zeit und Wiederholung dürfen nicht als spontanes Modellversagen interpretiert werden. Der erhaltene Kandidat wurde über Yokes Recovery-APIs in eine erneute Implementierungsprüfung überführt; Integrationsnachweise wurden nicht als weiter gültig ausgegeben.

Der native RTK-Codex-Vertrag wurde mit der [offiziellen RTK-Dokumentation](https://github.com/rtk-ai/rtk/blob/develop/hooks/codex/README.md) abgeglichen. Alle übrigen konkreten Findings stammen aus lokalen Befehlen, Laufzeitdateien und der installierten Yoke-Implementierung 1.22.0.

## Daten für Folgeanalysen

measurements/summary.json, stories.csv, roles.csv, yoke-phases.csv, shell-categories.csv, model-calls.jsonl, shell-metrics.jsonl, sessions.json, yoke-history.jsonl, commands.jsonl, status-samples.jsonl, observations.jsonl und Code-Intelligence-/Recovery-Probes. Screenshots liegen separat unter screenshots/. Observer- und Auswerteskripte liegen unter tools/.

Für belastbare Verbesserungsnachweise: gleiche Aufgabe und Testgates mit/ohne Änderung, gleiche Modellversion, mehrere Wiederholungen, frischer und warmer Cache, kontrollierte Netzwerk-/Sandboxbedingungen sowie getrennte Erfassung des Beobachtungsaufwands. Dieser Lauf liefert konkrete Fehlerbelege und Messdaten, aber keine kausale Aussage über allgemeine Yoke-Effizienz.

## Abschlussprüfung nach dem Mess-Cutoff

Yoke Flow-Smoke gegen den unveränderten, committed Root-Server bestand am 2026-10-04T09:28:21.392Z: 1/1, 2,156 Sekunden Gesamtzeit, stabile Source-Fingerprints. Bericht in measurements/final-yoke-smoke.json. Das bestätigt, dass die zuvor korrekt abgelehnten Observer-Prüfungen nach Ende aller Schreibvorgänge funktionieren. Dieses zusätzliche Gate und die anschließende Artefaktverpackung sind nicht in den oben eingefrorenen Token-/Zeitaggregaten enthalten.
