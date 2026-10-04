# Yoke 1.24: Folgeaufgaben und Messungen

Yoke 1.23 wurde auf npm und GitHub veröffentlicht. 1.24 wird als weiterer Release-Kandidat vorbereitet. Die ursprüngliche [Effizienzanalyse](../2026-10-04-efficiency/ANALYSE.md) bleibt die Grundlage; diese Messungen ergänzen sie.

## Was geändert werden muss

1. **Abhängigkeiten müssen zum gemessenen Projekt gehören.** Der große Benchmark verknüpfte bisher die `node_modules` eines anderen Projekts. Das konnte falsche Versionen und Plattformpakete übernehmen. Der Benchmark installiert jetzt anhand seiner eigenen Package-/Lockdateien. Er startet bei einem Setup-Fehler keinen Modelllauf. Yoke Core erhält dadurch keinen universellen Installer.
2. **Ein Erfolgsbeleg muss seine Eingaben und den vollständigen npm-Aufruf binden.** Lockdatei, Node/npm-Version, Plattform und Installationsparameter entscheiden über Wiederverwendung. Fehlgeschlagene Setups entwerten sicher erreichbare alte Belege. Geheimnisse in vorgeschalteten CLI-Argumenten werden nur gehasht. Ein Beleg attestiert nicht jedes installierte Byte.
3. **Bekannte Fehlerursachen dürfen beim Weiterreichen nicht verschwinden.** Produktion, Verifikation, Completion und Recovery erhalten strukturierte Kategorien und eine stabile Fehler-ID. Das Archiv erfasst auch Completion ohne aktive Story. Beliebige Exitcodes und Fehlertexte bleiben unbekannt; Abbruch durch Cancellation bleibt getrennt. Doppelte Ansichten desselben Fehlers werden nicht mehrfach gezählt.
4. **Messungen brauchen geprüfte Plattform und unveränderte Akzeptanz.** Für NEXUS wurde eine isolierte Windows-Kopie ohne macOS-Abhängigkeiten und ohne defekte Git-Metadaten erstellt. Anwendung und Assertions bleiben bytegleich. Nur der kopierte Teststarter ruft npm plattformgerecht über Node auf.

## NEXUS: Ergebnis und Ursache der früheren Blockade

Der erste Aufruf der kopierten ursprünglichen Verifikation scheiterte an `spawnSync('npm')`: Auf Windows stehen npm-Shims zur Verfügung, aber dieser shellfreie Aufruf fand kein ausführbares npm. Das ist ein Infrastrukturfehler. Nach der begrenzten Anpassung des kopierten Starters bestanden Typecheck, 25 Unit-Tests, sechs Browserfälle und der Build. Das Original wurde nicht verändert.

Der gefüllte Desktop wurde zusätzlich im gemeinsamen Browser geprüft: CSS-Viewport 1440 × 900, sieben Incidents, neun Events mit Zeitstempel, Dokumenthöhe 900. Inspector und Event-Feed endeten bei 760 beziehungsweise 884 CSS-Pixeln. Der ursprüngliche Browsertest prüfte die enthaltenen Panels und erreichbaren Aktionen. Originale Browser-Proof-Dateien haben 1440 × 900 bzw. mobil 390 × 844 Pixel. Die zusätzliche Vorschauaufnahme ist skaliert und dient nicht als Pixelmaß.

Ein eigener Server nutzte einen strikt gebundenen Port. Die ausgelieferten anwendungsspezifischen Source-Responses wurden gehasht und erneut auf Stabilität geprüft. Diese lokale Identität ist keine unabhängige Deployment-Attestierung. Einzelheiten und Source-/Test-Hashes stehen in [nexus-evidence.json](nexus-evidence.json).

## Bedingungen und Grenzen der Messungen

Die aktuellen Setup-Samples verwenden den unabhängig nachgeprüften Helper aus `5a9e208`. Pro Bedingung wurden drei erfolgreiche Installationen gemessen, in der Reihenfolge kalt/warm, warm/kalt, kalt/warm. Das zweite warme Sample nutzte den gefüllten Cache des ersten kalten Samples; jedes Projekt hatte eine frische lokale Installation.

| Paar | Frischer Download-Cache | Warmer Download-Cache, offline |
| --- | ---: | ---: |
| 1 | 3,581 s | 2,601 s |
| 2 | 3,366 s | 2,823 s |
| 3 | 7,263 s | 2,854 s |
| Empirische Spanne, n = 3 | 3,366–7,263 s | 2,601–2,854 s |

Gemessen wird der gesamte Setup-Helper einschließlich npm-Versionsermittlung, Installation und Belegschreiben. Der langsamere dritte kalte Lauf bleibt im Ergebnis. Ohne isolierte Hintergrundlast oder getrennte Netzwerk-/CPU-Messung lässt sich seine zusätzliche Dauer nicht eindeutig zuordnen. Die Rohwerte, Lock-Hashes und Aufrufbindung stehen in [dependency-samples.json](dependency-samples.json).

- Download-Cache kalt: neuer isolierter Cache und frische lokale Installation. Warm: bereits durch eine dokumentierte kalte Installation gefüllter Cache, frisches Projekt und Offline-Installation. Lifecycle-Scripts und automatische Netzwerk-Retries sind ausgeschaltet.
- Modellläufe: bestehende ChatGPT-Anmeldung im Codex CLI, keine zusätzlichen kostenpflichtigen API-Aufrufe. API-Key-/Endpoint-Overrides werden aus der Kindprozessumgebung entfernt. Angefordert werden `gpt-6.1-sol`, Reasoning `medium`, Routing aus, ein Worker und dieselben unveränderten Akzeptanztests.
- Die kontrollierte Modell-Fixture ist eine Task-Queue mit zwei Stories. Daraus folgt keine allgemeine Aussage über vollständige NEXUS-Projekte. Provider-Cache, Hintergrundlast, CPU/RAM, Preise und nicht erfasste Guardian-/Approval-Wartezeiten bleiben unbekannt.
- Der Yoke-Bericht liefert bei dieser CLI-Version keine tatsächliche Modellkennung. Native, auf das jeweilige Benchmark-Arbeitsverzeichnis gebundene Session-Metadaten werden deshalb separat geprüft. Das fehlende Feld im ursprünglichen Bericht bleibt erhalten.

## Versionsvergleich: drei Paare, sechs erfolgreiche Läufe

Gemessen wurde die Task-Queue-Fixture mit zwei Stories. Die Reihenfolge war 1.23/1.24, 1.24/1.23, 1.23/1.24. Jeder Lauf startete aus einer frischen Fixture; unveränderte Originaltests wurden danach unabhängig erneut ausgeführt. Alle sechs Läufe bestanden. Die folgenden Zeiten beginnen nach dem Fixture-Setup und enden beim Loop-Prozessende; die unabhängige Akzeptanzprüfung wird separat ausgewiesen.

| Paar | Yoke 1.23 | Yoke 1.24 | Differenz 1.24 minus 1.23 |
| --- | ---: | ---: | ---: |
| 1 | 289,127 s | 355,403 s | +66,276 s |
| 2 | 319,236 s | 318,147 s | −1,089 s |
| 3 | 324,097 s | 295,487 s | −28,610 s |
| Median, n = 3 je Version | 319,236 s | 318,147 s | −1,089 s |
| Empirische Spanne | 289,127–324,097 s | 295,487–355,403 s | |

**Ein allgemeiner Geschwindigkeitsgewinn ist nicht belegt.** Die Mediane liegen praktisch gleichauf; die Richtung des Unterschieds wechselt zwischen den Paaren. Die Summe der Loop-Zeiten beträgt 1.901,497 Sekunden (31 Minuten 41,497 Sekunden). Projektvorbereitung, Pausen zwischen Samples und externe Wartezeiten außerhalb der Loops sind darin nicht enthalten; sie wurden nicht separat gemessen.

| Sample | Implementierungsaufruf Story 1 | Implementierungsaufruf Story 2 | Übrige Loop-Zeit | Unabhängige Akzeptanz danach |
| --- | ---: | ---: | ---: | ---: |
| 1 / 1.23 | 131,644 s | 154,666 s | 2,817 s | 0,190 s |
| 1 / 1.24 | 169,397 s | 183,570 s | 2,436 s | 0,120 s |
| 2 / 1.24 | 183,084 s | 132,621 s | 2,442 s | 0,124 s |
| 2 / 1.23 | 169,027 s | 147,738 s | 2,471 s | 0,120 s |
| 3 / 1.23 | 172,921 s | 148,578 s | 2,598 s | 0,114 s |
| 3 / 1.24 | 159,988 s | 132,917 s | 2,582 s | 0,118 s |

99,19 % der erfassten Loop-Zeit liegen in den Implementierungsaufrufen. Diese Prozessdauer enthält auch Provider-/Tool-Warten und ist keine reine neuronale Rechenzeit. Die übrige Zeit ist ein Restwert; einzelne Anteile von Verifikation, Git und Status wurden hier nicht separat profiliert. Daraus folgt für die weitere Untersuchung: Kontext und Fehlversuche sind der größere Ansatzpunkt als die wenigen Sekunden außerhalb der Implementierungsprozesse. Welche Provider-/Cache- oder Hintergrundlast die Unterschiede verursachte, ist nicht isoliert gemessen.

| Erfasste Tokens, Summe über je drei Läufe | 1.23 | 1.24 |
| --- | ---: | ---: |
| Input einschließlich Cache | 1.356.910 | 1.385.667 |
| Davon Cached Input | 1.166.848 | 1.176.960 |
| Input abzüglich Cached Input | 190.062 | 208.707 |
| Output | 19.337 | 19.882 |

Auch eine Token- oder Kostensenkung ist damit nicht nachgewiesen. Alle zwölf nativen Implementierungssessions melden `gpt-6.1-sol` und `medium`; ihre kumulierten Input-/Cache-/Output-/Reasoning-Tokens stimmen exakt mit Yoke überein. Kosten bleiben unbekannt. Das Originalfeld `actualModels: null` wurde nicht nachträglich umgeschrieben; die native Prüfung ist separat gebunden.

Die Baseline stammt aus `d85cd0d` und hat denselben Git-Tree wie die veröffentlichte 1.23-Version. Der erste Kandidat stammt aus `697408a`, die späteren aus `132eda0`. Dazwischen änderten sich ausschließlich ein Windows-Pfadtest und die README-Testzahl. Der tatsächliche Runtime-Digest ist in allen drei Kandidaten identisch. Alle Quellen waren vor/nach ihrem Sample sauber und stabil; Fixture-, Akzeptanz-, Anforderungs-, Workflow-Input-, Modell-, Effort-, Startup- und Umgebungsdaten stimmen überein. Provider-Systemprompts und installierte Plugins/Skills sind damit nicht vollständig attestiert.

Die vollständigen strukturierten Ergebnisse, Aufrufzeiten, nativen Session-Hashes, Modell-/Usage-Prüfungen und Grenzen stehen in [version-pairs.json](version-pairs.json). Lokale absolute Projektpfade wurden aus der öffentlichen Kopie entfernt; die Originaldateien sind über SHA-256 gebunden. Native Transkripte bleiben lokal.

Reproduktion: in beiden fixierten Checkouts `npm run build`, anschließend `node bench/compare-codex.mjs --fixture=routing-queue --repeats=1 --arms=yoke-serial --model=gpt-6.1-sol --effort=medium --root=<frisches-Sample-Verzeichnis>` je Sample in der genannten Reihenfolge. Nur mit autorisierter bestehender CLI-Anmeldung ausführen. Die Kindprozessumgebung entfernt `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_BASE`, `AZURE_OPENAI_API_KEY` und `AZURE_OPENAI_ENDPOINT`, ohne deren Werte zu protokollieren. Der Harness replayt die Originaltests nach dem Agentenende.

## Qualität und CI: wo die Prüfzeit liegt

Der unabhängig geprüfte Runtime-Stand `132eda0` bestand [alle vier CI-Jobs](https://github.com/HECer/yoke/actions/runs/37208754601). Es gibt hier je einen beobachteten Job pro Plattform/Node-Version, keine wiederholte Plattform-Benchmarkserie. Zeiten sind aus GitHub-Step-Zeitstempeln in ganzen Sekunden abgeleitet. Unterschiedliche Runner verhindern eine isolierte Aussage zur Ursache der Plattformunterschiede.

| CI-Runner | npm ci | Lint | Build | Vollständige Tests | Canon | Docs-Testzahl | Audit | Package | Gesamter Job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Linux / Node 20 | 2 s | 6 s | 7 s | 97 s | 1 s | 41 s | 1 s | 1 s | 167 s |
| Linux / Node 24 | 2 s | 5 s | 5 s | 90 s | 1 s | 38 s | 1 s | 1 s | 149 s |
| Windows / Node 20 | 4 s | 8 s | 8 s | 296 s | 2 s | 67 s | 2 s | 2 s | 412 s |
| Windows / Node 24 | 6 s | 6 s | 7 s | 251 s | 2 s | 53 s | 1 s | 3 s | 348 s |

Die Jobs laufen parallel; ihre Summe ist keine Workflow-Wallzeit. Die Gesamtzeit enthält auch Checkout, Node-Setup und weitere Job-Schritte. Diese Yoke-Repo-Installationen sind ein anderer Workload als die NEXUS-Cache-Samples und dürfen nicht damit zusammengelegt werden. Die Daten stehen in [ci-runtime-snapshot.json](ci-runtime-snapshot.json).

Die Dokumentationsprüfung startet `vitest list --json` erneut, obwohl zuvor die vollständige Suite lief. Der gemessene Schritt dauert 38–67 Sekunden. Eine folgende Optimierung soll vorhandene vollständige Testevidenz nutzen, wenn Test-/Konfigurations-/Umgebungsidentität nachweislich übereinstimmen. Bei fehlender oder abweichender Bindung muss die vollständige Ermittlung erhalten bleiben. Prüfungen lediglich zu verkürzen oder Testzahlen zu raten würde die Sicherheit verschlechtern.

Bei der Entwicklung wurde ein Legacy-Recovery-Testfehler behoben: neue optionale Beobachtungsdaten müssen auch im weiterhin streng validierten V1-Record erlaubt sein. Die erste Windows-CI scheiterte anschließend ausschließlich an einer Testannahme zu `RUNNER~1` gegenüber dem korrekt aufgelösten vollständigen Temp-Pfad. Die Korrektur erhält den exakten Argumentvergleich und ergänzt einen unübersprungenen Verzeichnis-Alias-Test. Beide Befunde bleiben im Validierungsnachweis sichtbar.

## Was noch verbessert werden sollte

- Native tatsächlich gemeldete Modellkennungen dauerhaft im Yoke-Eventpfad erhalten, mit Thread-/Call-Bindung; angeforderte Kennungen allein reichen nicht.
- Die doppelte Testzahlermittlung mit identitätsgebundener vollständiger Testevidenz vermeiden. Kein Wiederverwenden bei geändertem Code, Tests, Konfiguration oder relevanter Umgebung.
- Mehrere vollständige Produktläufe mit gleicher unveränderter Akzeptanz sammeln, um Kontext-, Retry- und Modellentscheidungen beurteilen zu können. Die kleine Fixture ersetzt diese Untersuchung nicht.
- Nicht erfasste Legacy-/Guardian-/Approval-Ursachen und Wartezeiten gezielt instrumentieren, sobald eine bekannte Grenze Evidenz liefert. Bis dahin unbekannt lassen.

1.24 ist mit lokaler Installation, strukturierter Fehlerdiagnose und tatsächlichen Messungen als Release-Entwurf vorbereitet. Der [Validierungsnachweis](../../RELEASE-VALIDATION-1.24.0.md) und PR #17 enthalten den abschließenden Gate-Stand. 1.24 wurde nicht veröffentlicht.
