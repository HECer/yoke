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

Die abschließenden Messwerte und der Release-Gate-Stand werden nach den eingefrorenen Vergleichsläufen ergänzt.
