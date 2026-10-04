# Yoke-Effizienz: Auswertung und notwendige Änderungen

Stand: 2026-10-04. Vom KI-Assistenten aus lokalen Messdaten und einer gezielten Quellcodeprüfung erstellt. Zielversion im Entwurf: **1.23.0**. Noch keine implementierte oder veröffentlichte Verbesserung.

## Aussage der Messung

Yoke 1.22.0 brachte das NEXUS-Projekt auf sieben bestandene Stories. Die vier Loop-Prozesse liefen zusammen **56:24,7 Minuten**. Der gesamte erfasste Zeitraum betrug **91:44,8 Minuten**, einschließlich Einrichtung, Unterbrechungen, zusätzlicher Beobachtung und Analyse. Es gibt **einen Produktlauf**, keinen direkten Codex-Kontrolllauf und keine gemessene allgemeine Beschleunigung.

Die wichtigsten notwendigen Änderungen betreffen sichere CLI-Erkundung, zutreffende Infrastrukturdiagnosen, korrekten Parallelstatus, saubere Laufzeitdateien, dauerhafte Prüfbelege und nachvollziehbare Verbrauchserfassung. Tests pauschal zu reduzieren oder mehr Worker einzuschalten wird durch diesen Lauf nicht begründet.

## Grundlage und Reproduzierbarkeit

Originale: `G:/NN-Developed/ToolTesting/Yoke/YokeEfficiencyTest1/benchmark-artifacts/`. Der ursprüngliche Lauf fand unter macOS statt; die aktuelle Analyse erfolgt unter Windows. Der `.git`-Verweis des kopierten Testprojekts zeigt auf einen nicht vorhandenen macOS-Worktree und wurde nicht verändert.

Ausgewählte Rohdaten liegen unverändert unter [raw/](raw/); [manifest.json](manifest.json) enthält Herkunft und SHA-256. Die vollständigen Sessions, Modellaufrufe, Shell-Metriken, Statusstichproben und Bilder bleiben im Originalverzeichnis. Der bisherige Bericht ist als `raw/DEVELOPMENT_ANALYSIS.md` erhalten.

Gezielte Prüfung des aktuellen Yoke-Codes: Commit `e2e3c18`, Paketversion 1.22.0. Der Hauptarbeitsbaum enthält Nutzeränderungen. Die Vorbereitung erfolgt deshalb auf `codex/yoke-1.23-efficiency` in einem separaten Worktree.

Messumgebung: Codex CLI 0.160.0, Modell `gpt-6.1-sol`, Effort `medium`, RTK 0.51.0, isolierte Worktrees, automatische Parallelität/Entscheidungen, keine kontinuierliche Exploration. Code-Intelligence-Facade aktiv und MCP-Handshake erfolgreich, aber graft/graphify/serena nicht verfügbar. Kein nachgewiesener semantischer Effizienzgewinn.

## Welche Arbeit wie lange dauerte

| Story | Aufgabe | Implementierung | Yoke-Gates | Integration | Versuche |
|---|---|---:|---:|---:|---:|
| 1 | React/TypeScript/Vite-Grundlage, Typen und Testinfrastruktur | 9:25,9 min | 3,058 s | 6,301 s | 1 |
| 2 | Deterministische Telemetrie, Incidents und Maschinenaktionen | 6:07,4 min | 2,816 s | 8,723 s | 1 |
| 3 | Interaktive SVG-Topologie, Gesten und visuelle Zustände | 11:36,3 min | 5,190 s | 9,183 s | 1 |
| 4 | Maschineninspektor, Fleet, Ereignisse und KPIs | 8:25,8 min | 4,124 s | 11,815 s | 1 |
| 5 | Integration der Oberfläche und Tastatur-Kommandopalette | 9:26,1 min | 11,580 s | 35,665 s | 2 |
| 6 | Integrierte Browserprüfung, Fehlerkorrektur und Bildbelege | 11:23,2 min | 28,821 s | 28,292 s | 1 |
| 7 | Nachträgliche Reparatur von Desktop-Höhe und mobiler Priorität | 8:04,2 min | 18,435 s | 0,000 s im separaten Integrationsfeld | 1 |

Alle sieben Stories bestanden. STORY-7 lief seriell; ihr Nullwert im separaten Integrationsfeld bedeutet nicht, dass kein Commit oder Abschluss stattfand. Der Loop meldete dort insgesamt 8m23s. Die Tabelle zeigt verschiedene Phasen, keine sieben unabhängigen Gesamtprojektzeiten.

Beobachtete Implementierungsdauer je Story: **6:07–11:36 Minuten**, sieben unterschiedliche Stories, STORY-5 mit zwei Versuchen. Das ist keine Prognosespanne für neue Aufgaben. Einzelne Implementierungsversuche: acht, darunter der Recovery-Versuch von STORY-5 mit 90,363 s.

Warum die längeren Stories länger dauerten: STORY-3 kombiniert visuelle Gestaltung und SVG-Interaktion; STORY-6 prüft die integrierte Anwendung im Browser und schreibt Belege. Dies ist eine aus Aufgaben und sichtbaren Aktionen abgeleitete Erklärung. Exakte Sekundenanteile für Modelllatenz, Reasoning, Tool-Wartezeit und Programmieren fehlen.

### Phasen des Loops

| Phase | Ereignisse | Summierte Zeit | Bedeutung |
|---|---:|---:|---|
| Implementierung | 8 | 3.868,892 s / 64:28,9 min | Summe der Workerintervalle, inklusive interner Tools/Tests |
| Verifikation | 9 | 74,024 s | Eigenständige Yoke-Gate-Phasen |
| Integration | 7 | 99,979 s | Enthält verschachtelte Phasen; nicht nochmals addieren |
| `waiting-resource` | 14 | 97,927 s | Teilweise innerhalb Integration; keine reine Schedulerwartezeit |
| Design | 4 | 14,082 s | Design-Gates, kein vollständiger UX-Nachweis |
| Commit | 8 | 2,701 s | Innerhalb übergeordneter Phasen |
| Ressourcenwartezeit vor Implementierung | 8 | 0,038 s | Hier kein belegter großer Engpass |
| Integrationswarteschlange | 7 | 0,019 s | Hier kein belegter großer Engpass |
| Ressourcenwartezeit vor Integration | 7 | 0,017 s | Hier kein belegter großer Engpass |

Die Vereinigungsdauer der Implementierungsintervalle beträgt **3.184,729 s / 53:04,7 min**. Die beobachtete Überlappung beträgt **684,163 s / 11:24,2 min**. Diese Differenz ist keine Einsparung gegenüber einem gemessenen seriellen Kontrolllauf. 530 Stichproben alle zehn Sekunden zeigen maximal zwei Implementierungsworker; kurze Zwischenpeaks können fehlen. Die Abhängigkeiten der Stories begrenzen Parallelität.

Vier abgeschlossene Loop-Aufrufe, davon zwei fehlgeschlagen: eine abgelehnte Integration nach Observer-Commit und ein Startabbruch bei verschmutztem Worktree. Das sind keine zwei fehlgeschlagenen Produktimplementierungen.

### Einrichtung, Beobachtung und Abschluss außerhalb der Workeransicht

Die folgenden Zeiten betreffen nur über `measure.py` gestartete Prozesse. Sie sind keine lückenlose Zerlegung der 91,7 Minuten und überlappen andere Tabellen.

| Instrumentierte Befehlsphase | Befehle | Fehler | Prozess-Wallzeit | Child-CPU |
|---|---:|---:|---:|---:|
| Umgebung | 4 | 1 | 0,914 s | 0,646 s |
| Code-Intelligence-Probe | 3 | 0 | 1,987 s | 1,251 s |
| Planung | 5 | 1 | 61,429 s | 11,040 s |
| Dependency-Setup | 2 | 1 | 10,049 s | 6,796 s |
| Erster Yoke-Smoke | 1 | 1 | 0,423 s | 0,271 s |
| Loop-Ausführung | 4 | 2 | 3.384,740 s | 1.277,859 s |
| Recoverybefehl | 1 | 0 | 0,531 s | 0,345 s |
| Serverstart | 1 | 1 | 0,826 s | 0,506 s |
| Observer-Browserkontrolle | 2 | 0 | 14,340 s | 5,432 s |
| Abschließende Projektprüfung | 1 | 0 | 19,997 s | 30,002 s |
| Zwei abgelehnte finale Smokes vor Cutoff | 2 | 2 | 5,513 s | 4,183 s |

Child-CPU kann durch parallele Unterprozesse größer als Wallzeit sein. Uninstrumentierte Tool-Roundtrips, Gespräche, Berichtserstellung und Providerwartezeit sind nicht vollständig getrennt. Die Differenz von ungefähr 35,3 Minuten zwischen erfasstem Gesamtzeitraum und summierten Loop-Prozessen darf deshalb nicht als exakt gemessener Yoke-Orchestrierungsaufwand ausgegeben werden.

## Wo Aufwand innerhalb der Worker entstand

| Shell-Kategorie | Aufrufe | Nicht erfolgreich/abgebrochen | Summierte Prozessdauer |
|---|---:|---:|---:|
| Repositoryerkundung | 73 | 12 | 32,161 s |
| Dependency-Setup | 10 | 5 | 114,453 s |
| Tests und Prüfungen | 92 | 25 | 461,324 s / 7:41,3 min |
| Browserverifikation | 23 | 9 | 103,280 s |
| Devserver/gemischte Befehle | 12 | 12 | 677,782 s / 11:17,8 min |
| Sonstiges | 17 | 3 | 86,671 s |
| Separate Dateiedits | 1 | 0 | 0,269 s |

Die Kategorien sind heuristisch. Ein gemischter Befehl kann mehrere Aufgaben enthalten. Langlebige Server werden am Ende abgebrochen; ihre Prozessdauer ist nicht automatisch blockierende Wartezeit. Rote TDD-Tests gehören zur korrekten Entwicklung. Ein einzelner separater Dateiedit sagt nichts über die gesamte Schreibarbeit aus.

Die 92 Workerprüfungen sind ein Kandidat für gezielte Wiederverwendung, aber nicht 92 überflüssige Prüfungen. Vor Optimierung muss Yoke Testzweck, geprüften Source-/Config-/Environment-Zustand und geschützte Gates unterscheiden. Die zusätzlichen 74 Sekunden Yoke-Gates sind eine andere Messgröße. Prüfzeiten sind teilweise bereits in Implementierungszeiten enthalten.

## Tokens und Messlücken

| Rolle | Sessions | Usage-Ereignisse | Input inkl. Cache | Cache-Lesen | Frischer Input | Output |
|---|---:|---:|---:|---:|---:|---:|
| Implementierung | 8 | 189 | 11.234.592 | 10.621.952 | 612.640 | 82.193 |
| Coordinator/Observer | 1 | 127 | 15.525.113 | 15.139.456 | 385.657 | 107.118 |
| Guardian/Approval | 7 | 48 | 1.281.675 | 1.073.152 | 208.523 | 5.404 |
| Planner/Review | 2 | 2 | 52.718 | 14.336 | 38.382 | 1.215 |
| Gesamt bis Cutoff | 18 | 366 | 28.094.098 | 26.848.896 | 1.245.202 | 195.930 |

**95,57 % des kumulierten Inputs sind Cache-Lesen.** Die 28 Millionen zählen wiederholt mitgesendeten Kontext bei Modellereignissen; sie sind keine 28 Millionen einmalig gelesenen Tokens. Cache-Tokens sind nicht nachgewiesen kostenlos. Geldkosten sind unbekannt. Reasoning-Output ist Teil des Outputs, nicht zusätzlich zu addieren. Native Usage und Yoke-Usage sind alternative Sichten und werden nicht addiert.

Der Coordinator verursacht 55,26 % der kumulierten Input-Tokens und 107.118 Output-Tokens. Er umfasst Messinstrumentierung, Kommunikation, Einrichtung und unabhängige Kontrolle. Daraus folgt **nicht**, dass Yoke im normalen Einsatz stets mehr Controller- als Workeraufwand benötigt. Routinebeobachtung sollte ohne neue Modellaufrufe erfolgen; die konkrete Einsparung muss ein Folgelauf messen.

Das Feld `measured_provider_calls` in der Story-CSV zählt aggregierte Worker-Usagemeldungen (meist eine pro Versuch). Es widerspricht den 189 nativen Implementierungs-Usage-Ereignissen nicht und darf nicht als eine einzige Modellanfrage je Story interpretiert werden. Eindeutige Usage-Ereignisse sind außerdem kein unabhängig bestätigter HTTP-Requestzähler.

Heuristischer Zweck der 189 Implementierungsereignisse:

| Zweckhinweis | Ereignisse | Input | Cache | Output |
|---|---:|---:|---:|---:|
| Erkundung | 35 | 2.015.491 | 1.824.896 | 6.669 |
| Tests/Checks | 63 | 3.377.368 | 3.130.624 | 44.163 |
| Code-Intelligence | 6 | 263.056 | 252.160 | 785 |
| Dependency-Setup | 6 | 270.273 | 244.480 | 2.947 |
| Server/gemischte Aktionen | 12 | 809.495 | 797.184 | 4.029 |
| Warten/Polling | 26 | 1.668.311 | 1.642.752 | 1.869 |
| Browserprüfung | 41 | 2.830.598 | 2.729.856 | 21.731 |

Polling beim Coordinator: 35 Ereignisse, 4.593.089 Input und 31.499 Output. Die Zuordnung beruht auf zuletzt sichtbaren Toolaktionen und beweist nicht, dass diese Tokens ausschließlich fürs Warten verwendet wurden. Ereignisbasierte Statusaktualisierung ist deshalb eine zu prüfende Optimierung.

RTK: 42 registrierte Befehle, Toolschätzung 13.752 Input-/11.635 Output-Tokens, 2.117 eingespart (**15,4 % dieser Befehle**). Kein Beleg für 15,4 % weniger Providerverbrauch im Gesamtprojekt. Automatische Umschreibung verschachtelter Code-Mode-Aufrufe wurde nicht nachgewiesen. Explizite RTK-Nutzung ist belegt.

## Konkrete Nacharbeit und Fehlerzuordnung

1. **STORY-5:** Observer änderte Target-HEAD während Integration. Yoke lehnte korrekt ab und behielt den Kandidaten. Erstversuch 475,741 s Implementierung; erneute Implementierungsphase 90,363 s, danach 5,504 s Gate und 17,627 s Integration. Diese Recovery-Phasen sind beobachtet, aber keine vollständig isolierte Schadensdauer. Die vier Minuten zwischen Versuchen sind nicht eindeutig in aktive Reparatur und andere Wartezeit zerlegt.
2. **STORY-7:** Unabhängige, korrekt dem Server zugeordnete Kontrolle entdeckte 938 px Dokumenthöhe bei 900 px Viewport; Eventpanel-Unterkante 914 px. Reparatur beanspruchte 484,220 s Implementierung und 18,435 s Gate. Danach 900 px Dokumenthöhe und Unterkante 884 px. Vermeidbarer Qualitätsrücklauf, wenn die ursprüngliche Abnahme sichtbare Panelgrenzen in befüllten Zuständen prüft.
3. **Dependency-Setup:** Ein `npm ci` scheiterte mit ECONNRESET. Offline-Installation aus einem vorhandenen Cache installierte 105 Pakete in vier Sekunden. Ein Einzelfall, keine allgemeine Cache-Beschleunigung.
4. **Sandbox:** Wiederverwendete Dependencies führten zu EPERM beim Schreiben in Root-`node_modules/.vite-temp`. Diese Ursache gehört zur Umgebung, nicht zur Simulation oder zum Modell.
5. **Falscher Browser-Server:** Der erste Observer prüfte einen bereits belegten Port 4173. Start des vorgesehenen Servers scheiterte; fremde Bilder wurden invalidiert. Zeit und Tokens bleiben Messaufwand, visuelle Aussagen sind kein Produktbefund.
6. **Finaler Smoke:** Zwei Browserabläufe bestanden, aber Source-Nachweise wurden wegen Observer-Schreibzugriffen korrekt abgelehnt. Nach stabilem committed Root-Zustand bestand ein weiterer Smoke am 09:28:21 UTC in 2,156 s, **nach dem Token-Cutoff**. Seine Konfiguration enthält einen Foundation-Flow ohne Interaktionsschritte; er ersetzt keine vollständige UX-Abnahme.

## Alle dokumentierten Findings und Handlungsbedarf

P0 = zuerst vor weiterem produktivem Ausbau; P1 = Bestandteil des geplanten Effizienz-Releases; P2 = anschließende messpflichtige Optimierung. Die Prioritäten sind Empfehlungen, keine CVSS-Schweregrade.

| Finding | Ursache und Änderung | Priorität / Zuordnung |
|---|---|---|
| CLI-HELP-MUTATION | Hilfe vor Dispatch behandeln; unbekannte Flags vor jedem Schreibzugriff ablehnen. Setup-Hilfe erzeugte 95 Dateien, Retrofit-Hilfe schaltete Loop ab. Im aktuellen `src/cli.ts` weiter plausibel bestätigt. | P0, Yoke |
| RTK-INIT-FLAGS | Inkompatible RTK-Init-Flags gezielt validieren und dokumentieren. | P1, Integration/Setup |
| CI-WORKSPACE-ID | Konfigurierten Workspace-Identifier berücksichtigen und gültige Kennung maschinenlesbar liefern. Aktueller Coordinator hasht Root, Server übergibt konfigurierte Kennung nicht. | P1, Yoke |
| CI-BACKENDS-MISSING | Konfigurierten Modus von tatsächlich verfügbaren Fähigkeiten trennen; Fallback und fehlende Backends ausweisen. | P1, Yoke/Umgebung |
| RTK-DUPLICATE-HOOKS | Native Hookeinrichtung idempotent machen; nur Yoke-eigene Legacyregistrierung migrieren, fremde Hooks erhalten. | P0, Yoke |
| COMPACT-STATUS-MISSING | Worker und Integrator aus Parallelstatus ausgeben; niemals `phase=undefined`. Aktueller Code interpoliert weiterhin nur Top-Level-Story/Phase. | P0, Yoke |
| WRITE-SCOPE-DRIFT | Tatsächlichen Diff gegen deklarierte `writes` prüfen; Abweichungen und Kollisionen vor Integration behandeln. Keine Sicherheitsgarantie aus Deklarationen ableiten. | P1, Yoke; aktuelle Durchsetzung erneut prüfen |
| SMOKE-MISDIAGNOSIS | Fehlendes Paket, Browserbinary, Sandbox und sonstige Launchfehler unterscheiden; Ursache behalten und sensible Inhalte redigieren. Aktuell gemeinsames `catch → null`. | P0, Yoke |
| EPHEMERAL-PROOF | Erforderliche Belege vor Worktree-Cleanup übernehmen, hash-/sourcegebunden manifestieren; Kopierfehler dürfen nicht als Abschluss gelten. | P1, Yoke; aktueller Lebenszyklus erneut prüfen |
| RTK-LEGACY-ALLOW | Aktueller Canonadapter enthält weiterhin `updatedInput` ohne `permissionDecision`; statt eigener veralteter Antwort native RTK-Integration mit echtem Host-Vertrag prüfen. | P0, Yoke/Host-Vertrag |
| RTK-NATIVE-CORRECTION | Bereits im Benchmark erfolgte lokale Hookkorrektur erhalten; sie ist kein ausgelieferter Yoke-Fix. | Korrekturbeleg |
| SHARED-DEPS-SANDBOX | Paketdownloadcache gemeinsam nutzen, beschreibbare Runtime-/Dependency-Verzeichnisse pro Worktree isolieren. Keine pauschale Rechteaufweitung. | P1, Umgebung/Isolation |
| NETWORK-RETRY-CACHE | Lockfilegebundenen Paketcache vorbereiten; Netzfehler getrennt melden, begrenzt wiederholen. | P1, Setup |
| GUARDIAN-USAGE-GAP | Implementierung und zusätzliche Approvalsessions getrennt erfassen; nicht verfügbare Kontrollkosten als unbekannt kennzeichnen. | P1, Yoke/Providertelemetrie |
| OBSERVER-HEAD-RACE | Busy-/Integrationszustand veröffentlichen, Observer-Schreiben koordinieren; erhaltenen Kandidaten mit neuen Nachweisen fortsetzen. HEAD-Schutz beibehalten. | P1, Observer verursacht; Yoke-Diagnose verbessern |
| VISUAL-COMPOSITION | Frühere visuelle Schlussfolgerung wurde wegen falschem Server invalidiert und bleibt ausgeschlossen. | Kein gültiger Produktbefund |
| OBSERVER-WRONG-SERVER | Erfolgreichen Serverstart, owning cwd und Source-Identität vor Browserbelegen prüfen; eigenen Port reservieren. | P1, Messharness/Browserbelege |
| RUNTIME-IGNORE-GAP | `.yoke/supervision/` in generierte Ignoreliste aufnehmen. `src/loop/git.ts` schließt es aktuell schon aus: Lücke betrifft Retrofit und externe Git-Sichten, keine neue pauschale Git-Ausnahme. | P0, Yoke |
| COMPLETION-DIRTY-PROOFS | Rerun-Belege in Runtimeverzeichnis; nur ausgewählte endgültige Artefakte explizit übernehmen. Keine automatische Aufnahme fremder Änderungen. | P1, Yoke/Projektprüfkommandos |
| VERIFIED-VISUAL-GAP | Layoutabnahme um Unterkanten, befüllte Incident-/Eventzustände und mobilen Prioritätsbereich erweitern. Design-Scan nicht als UX-Nachweis darstellen. | P1, Abnahme/Projektqualität |
| OBSERVER-FINAL-SMOKE-DIRTY | Source-Prüfintervalle als Schreibsperre für koordinierte Tools respektieren; Auswertung außerhalb des Intervalls erzeugen. | P1, Observer verursacht |

## Empfohlene neue Version

**1.23.0 „verlässliche Effizienzbasis“**: Zuerst P0-Regressionskorrekturen, dann Preflight, Integration/Belege und Telemetrie. Kein Versprechen eines bestimmten Sparprozentsatzes. Abnahmeentwurf und Storyreihenfolge stehen im [Versionsentwurf](../../superpowers/specs/2026-10-04-yoke-1.23-efficiency-design.md).

Die Alternativen sind ein kleiner 1.22.1-Hotfix nur für P0 oder ein umfassender Umbau von Scheduler/Routing. Der Hotfix lässt wesentliche Mess- und Beleglücken offen. Ein Schedulerumbau ist durch praktisch verschwindende Queuezeiten nicht begründet. 1.23.0 bündelt konkrete Reparaturen mit der Datenbasis für spätere Optimierung.

Anschließend gezielt untersuchen: weniger LLM-Polling, wiederverwendbare Erkundung/Kontextpakete, sichere Testwiederverwendung und nachweislich funktionierendes RTK. Vor jeder Codeänderung prüfen, welche dieser Fähigkeiten schon vorhanden sind. Keine vollständige Neuimplementierung existierender Kontext- oder Routingmodule.

## Nachweis einer tatsächlichen Verbesserung

Dieselbe Aufgabe, unveränderte geschützte Abnahmen, Modell/Effort/CLI-Versionen und vergleichbare Umgebung für 1.22.0 und 1.23.0. Mindestens drei gepaarte Wiederholungen pro kaltem/warmem Cachezustand als erste Untersuchungsstufe; kleine Stichprobe ausdrücklich benennen. Mehr Läufe nötig, wenn Streuung oder behauptete Effekte das verlangen.

Erfassen: Laufzeit bis unabhängiger Abnahme, Union/Summe der Phasen, Rework, Infrastrukturfehler, Observeraufwand, Usage aller verfügbaren Rollen, Coverage-Lücken, tatsächlich gestartete Worker, unveränderte Testqualität. Empirische Spanne und Stichprobenzahl berichten; Geldkosten nur bei verfügbaren Preis-/Usagebelegen. Kein direkter-Codex-Effizienzclaim ohne passenden Kontrollarm.

Keine feste Umsetzungsdauer aus diesem Lauf ableiten. Die sieben UI-Stories sind keine Vergleichsdaten für Harnessänderungen. Nutzerwartezeit, Modell-/Netzwerklatenz und neue Fehler bleiben unbekannt.

## Provenienz und aktueller Arbeitsstand

Read-only `audit-provenance` für den vorhandenen Bericht: keine unterstützte C2PA-Struktur gefunden; unterstützter Scan vollständig. Kryptographische Verifikation und Vertrauen unbekannt, weil Verifier und Trust-Policy fehlen. Text-Metadatenprivatsphäre unbekannt. Proprietäre/keyed Wasserzeichen nicht überprüfbar; kein beobachtetes Signal beweist keine menschliche Autorenschaft. Es wurden keine Herkunftsmerkmale entfernt. Dieser neue Bericht benennt seine KI-Erstellung explizit.

Vorbereitet: isolierter Versionszweig, unveränderte Evidenzkopien mit Hashmanifest, Analyse und testbarer Versionsentwurf. Produktionscode, Versionsnummer und Releaseartefakte sind noch unverändert. Designfreigabe ist gemäß `brainstorming` vor Implementierung erforderlich. Eine unabhängige Code-/Sicherheitsprüfung ist noch nicht erfolgt; Veröffentlichung und Merge werden erst mit den Releasegates bewertet.
