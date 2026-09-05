# Yoke: Produktstand und Gesprächsgedächtnis

Stand: 2026-09-05. Grundlage: Repository-Analyse und anschließende Produktdiskussion mit dem Nutzer.

Dieses Dokument sichert die wesentlichen Befunde, Vorschläge und Nutzerpräferenzen der Sitzung. Die automatische claude-mem-Erinnerung meldete einen Ausfall; ihre Speicherung wurde nicht vorausgesetzt. Es ist kein Implementierungsnachweis und kein Auftrag, sämtliche Vorschläge ungefragt umzusetzen. Vor Implementierung den aktuellen Code und die Prioritäten prüfen.

## Nutzerabsicht und akzeptierte Richtung

- Yoke soll gegenüber der Konkurrenz interessanter und ein regelmäßig genutztes Entwicklerwerkzeug werden.
- Codex, Claude und Gemini sollen funktional gleichwertig integriert sein. Gleiche Modellintelligenz ist damit weder zugesagt noch messbar belegt.
- Der Nutzer begrüßte die Richtung: überprüfbare Abnahme, Ziele, Wiederaufnahme und Anbieterwechsel.
- Tokenverbrauch und Entwicklungszeit sollen sinken: deterministische Werkzeuge, kleine/schnelle Modelle, gezielte Eskalation und sinnvolle Parallelität.
- Neue Nutzeridee: bessere Zeitschätzungen für alle Tasks; bestehende ETA verbessern.
- Neue Nutzeridee: ein Dashboard für Yoke mit Übersicht und Detailansichten für jedes Projekt. Interesse ist festgehalten; Umfang und Gestaltung sind noch nicht beschlossen.
- Der Nutzer bat ausdrücklich darum, die gesamte bisherige Diskussion dauerhaft zu sichern.

## Ausgangsbefund der Prüfung

Geprüft: Yoke 1.6.2, Commit d066058. Keine Produktcodeänderungen oder neuen authentifizierten Modellbenchmarks während der Analyse.

- Gesamtsuite: 1018 bestanden, 2 übersprungen, 1 Test-Timeout von insgesamt 1021 Tests.
- Betroffen: tests/loop/parallel-cli.integration.test.ts, Test "does not integrate when the target rewinds during integrated gates". Gesamtlauf überschritt das 5-Sekunden-Limit; separater Lauf mit 20-Sekunden-Limit bestand in etwa 1,42 Sekunden Testzeit. Kein damit nachgewiesener Integrationsfehler; Testinstabilität untersuchen.
- TypeScript-Prüfung und docs:check bestanden.
- Vorhandene Nutzeränderungen wurden nicht angefasst: .gitignore, .omo/, .playwright-mcp/, docs/community-outreach-2026-08-20.md, docs/launch-copy-2026-08-21.md.

### Stärken

- Mechanische Prüfkommandos und strukturierte Akzeptanzkriterien; neue Standardkonfigurationen verlangen Kriteriennachweise.
- Gemeinsamer Canon mit nativen Skill-Paketen und Werkzeugkonfiguration für drei Anbieter.
- Abhängigkeiten, parallele Worker, Arbeitsbäume, Locks, Prozessüberwachung und Integrationswarteschlange.
- Schema-validierte Reviews und optionaler Qualitätsvergleich mit vertauschter Kandidatenreihenfolge und Konsistenzprüfung.
- Expliziter, versionierbarer Projektkontext und lokale Belege; kompakte Ausgabe mit Artefaktverweisen.
- Benchmarkdokumentation benennt fehlende Telemetrie und fehlgeschlagene Läufe.

### Konkrete Lücken und Grenzen

1. Serielles --isolate entfernt den Arbeitsbaum im finally auch bei Fehlern; GitOps verwendet worktree remove --force. Unfertige Änderungen können verloren gehen. Siehe src/loop/loop.ts und src/loop/git.ts.
2. Ausgeführte Tests sind nicht automatisch unabhängige Abnahmetests: Implementierer kann im untersuchten Pfad Testdateien und Testskripte ändern. Geschützte Abnahmen bzw. Kontrolle von Testabschwächungen fehlen.
3. Reviews, Audit, integrierte Abschlussprüfung und Browserbelege sind teils optional. README-Garantien müssen zwischen unterstützt, aktiviert und nachgewiesen unterscheiden.
4. flow-smoke prüft Seitenaufruf, Fehler und optionale Selektoren; kein genereller Nachweis mehrstufiger Benutzerabläufe.
5. repositoryFingerprint erfasst Inhalte bestehender unversionierter Dateien nicht; bei Git-Fehlern liefert es einen leeren String. Zusätzliche Reviewer-Schreibkontrolle ist damit unvollständig.
6. Routing nutzt grobe Kostentiers und Erfolgsquoten. Fehlende Telemetrie wird teilweise als 0 aggregiert. Vollständige Kosten für Controller, Worker, Reviews, Reparaturen und Kandidaten fehlen als verlässlicher Gesamtvertrag.
7. Design-Scan prüft Stilmerkmale wie Lila/Verläufe; kein allgemeiner UX-, Accessibility- oder KI-Autorschaftsnachweis.
8. Bisherige Benchmarks belegen keine allgemeine Überlegenheit gegenüber nativen Agenten oder Konkurrenz.

### Anbieterparität

- Codex: Skills, Aufrufrichtlinie, Rollen, JSON-Ausgabe, Modell/Reasoning, RTK-Hook. Direkte Verbindung zum nativen Goal-Zustand fehlt im untersuchten Code. Adaptives Routing deaktiviert native Multi-Agent-Funktionalität bewusst.
- Claude: Skills, manuelle Aufrufsteuerung, Streaming-JSON, Modell/Effort, RTK-Hook mit Plattformbedingungen. Native strukturierte Ausgabe und Teamfunktionen sind nicht durchgängig ausgenutzt.
- Gemini: native Skills plus Slash-Commands vorhanden. Adapter fordert kein stream-json an, obwohl Auswertung JSON-Ereignisse erwartet und Reviews berichtete Modellidentität verlangen. Gemeinsame Reasoning-/Bare-Optionen werden nicht entsprechend umgesetzt. Installer-Annahme fehlender Rewrite-Hooks ist veraltet; BeforeTool unterstützt Argumentänderungen.
- Native Provider-Funktionen einzeln nutzen und auf ein gemeinsames Ergebnisformat abbilden; nicht auf identische APIs aller Anbieter warten.
- Reale Vertragsfälle je CLI/Version/Plattform: Implementierung, Review, Ausgabe, Modellidentität, Telemetrie, Rechte, Abbruch, Wiederaufnahme und Skill-Aufruf.
- Lokal geprüft: codex-cli 0.153.4, Claude Code 2.1.200, Gemini CLI 0.33.1. Verfügbare CLI bedeutet keine nachgewiesene Authentifizierung oder erfolgreiche Modellaufgabe.

### Benchmarkgrenzen

bench/RESULTS.md dokumentiert eine Codex-Routingstudie mit drei Vergleichspaaren. Alle versteckten Abnahmen bestanden; Median ungefähr 33,8 % weniger Laufzeit und 11 % weniger frische Eingabetokens. Vergleich: Routing an/aus innerhalb Yokes, nicht Yoke gegen natives Codex. Andere Architekturaufgaben blieben SELF und bezahlten Controller-Overhead. Keine allgemeinen Sparprozente versprechen.

## Produktwette: täglicher Nutzen

Yoke beantwortet: "Kann ich diese Änderung übernehmen, und wie bekommen wir sie bei offenen Befunden fertig?"

Vorgeschlagene Positionierung: gemeinsame Abnahme- und Fortsetzungsschicht für Coding-Agenten. Native Agenten verfolgen Ziele; Yoke hält überprüfbaren Projektzustand, Kriterien und Abnahme stabil. Kein unnötiger zweiter Orchestrator über nativen Goals.

### Einstieg: yoke check (Vorschlag, noch kein implementierter Befehl)

- Bestehendes Repository, vorhandener Diff und konkrete Anforderung reichen für den Einstieg; vollständiger Retrofit soll nicht Voraussetzung sein.
- Ausgabe unterscheidet bestanden, fehlgeschlagen und nicht überprüft.
- Bevorzugt ausführbare Befunde: Testreproduktion, Browserablauf, Vertragsverletzung statt spekulativer Review-Kommentare.
- Beispielvorführung: bestehende Tests grün, Yoke reproduziert eine doppelte Bestellung bei Doppelklick, Reparatur und erneute Abnahme belegen die Behebung.
- Belege sind an den tatsächlich geprüften Codezustand gebunden.
- Kritische Abnahmetests gegebenenfalls durch gezielte Mutation prüfen: erkennt der Test den passenden absichtlich eingebauten Fehler?

### Wiederaufnahme und Anbieterwechsel

Übergabepaket enthält Ziel, Kriterien, Patch/Arbeitsstand, Umgebung, bestandene Prüfungen, offene Fehler, verworfene Ansätze, Berechtigungen und verbleibendes Budget. Änderungen und Belege bleiben bei Fehlern erhalten. Anbieterwechsel erhält überprüften Zustand und verlangt keine erneute Erklärung durch den Nutzer.

Blocker unterscheiden: Implementierungsfehler, Infrastruktur/Rate-Limit, fehlende Zugangsdaten, echte Produktentscheidung. Ein Anbieterwechsel löst nicht jede Blockade.

### Zielmodell

Gemeinsamer Zielzustand verbindet PRD, Kriteriennachweise, Änderungs-Inbox, Budget, Blocker, Wiederaufnahme und integrierte Abschlussprüfung. Native Codex Goals integrieren, keine Abschlussgarantie allein aus Modelltext ableiten. Modell darf Lösungsweg wählen; verbindliche Abnahmebedingungen bleiben nachvollziehbar.

### Zielgruppe und Differenzierung

Vorgeschlagener erster Fokus: Entwickler und kleine Teams mit bestehenden TypeScript-Webprojekten und bereits genutzten Coding-Agenten. Erst dort Einrichtung und Abnahme zuverlässig machen.

Skills, Autonomie, frischer Kontext und Zweitmeinungen sind kein exklusiver Vorsprung. Aktuelle Konkurrenz: native Codex Goals/Subagenten, Superpowers auch mit Codex/Gemini, gstack mit Codex/QA/Reviews, GSD Core mit mehreren Hosts und Phasenworkflow.

Aufbauender Vorteil: robuste Projektintegration, wiederverwendbare Abnahmefälle, zuverlässige Wiederaufnahme, echte Erfolgsdaten nach Aufgabentyp und nützliche PR-Berichte. Team-Zahlungsbereitschaft ist eine unbestätigte Hypothese.

Validierung: zehn passende Entwickler mit echten Änderungen; Zeit bis zum nützlichen Befund, Reproduzierbarkeit, Fehlalarme, eingesparte Nachprüfung und freiwillige Wiederverwendung messen.

## Token-, Kosten- und Geschwindigkeitsstrategie

Optimierungsziel: Kosten und Zeit pro unabhängig abgenommener Änderung, einschließlich Fehlversuchen und menschlicher Nacharbeit. Tokenzahl, Geldkosten und Wartezeit getrennt betrachten.

1. Deterministische Aktionen ohne Modell: Formatter/Linter, AST-/LSP-Renames, Schema-Generatoren, Logparser, Versionssynchronisierung, geprüfte Codemods und Symbolsuche. Voraussetzungen/Nachbedingungen prüfen.
2. Regeln vor Routing-Modell: eindeutige Aufgaben ohne Controller-Aufruf zuordnen; unklare Fälle durch Modell entscheiden lassen.
3. Ausführungsstufen Werkzeug / Schnell / Standard / Stark. Risiko, Testbarkeit, Umfang und beobachtete Ergebnisse bestimmen die Auswahl; Dateianzahl oder Modell-Selbstvertrauen reichen nicht.
4. Günstiger Erstversuch nur bei geeigneten Aufgaben; Abnahme, begrenzte Reparatur, dann Eskalation mit Patch und Fehlerbelegen. Wiederholte Fehler erkennen. Erwartete Gesamtkosten inklusive Eskalation optimieren.
5. Aufgabenbezogene Kontextpakete: Ziel, Kriterien, Symbole, Verträge, Tests und relevante Entscheidungen. Weitere Informationen bei Bedarf abrufen; Parent-Historie nicht standardmäßig kopieren.
6. Gemeinsame Exploration/Indexierung wiederverwenden und per Codezustand/Dateihash invalidieren. Keine vier identischen Repository-Erkundungen durch vier Worker.
7. Stabile Prompt-Präfixe, passende Modellkontinuität, gemessene Cache-Treffer. Caching reduziert nicht automatisch logischen Kontext; keine Cache-Übernahme zwischen Anbietern annehmen. CLI- und API-Fähigkeiten unterscheiden.
8. Parallelität nach Abhängigkeiten, Schreibbereichen, kritischem Pfad und Ressourcen. Schnittstellen zuerst; danach unabhängige Implementierung. Ein gemeinsames Limit für Yoke-Worker und native Subagenten.
9. Prüfungen stufenweise: schnelle deterministische Prüfungen, betroffene Tests, Integration, semantisches Review, erforderliche Gesamtprüfung. Ergebnisse nur bei passenden Code-/Umgebungs-/Konfigurationsständen wiederverwenden.
10. Kleine verwandte Aufgaben bündeln; sichere Build-/Paket-Caches und vorbereitete Umgebungen nutzen. Veränderliche Worker-Arbeitsstände getrennt halten.
11. Später direkte Modellaufrufe für eng begrenzte Klassifikation/Umformung erwägen, wenn CLI-Start unverhältnismäßig ist. Separate API-Abrechnung berücksichtigen.
12. Vollständige Telemetrie für alle Rollen; unbekannte Nutzung niemals als gemessene Null darstellen.

Reihenfolge vorgeschlagen: Messung, deterministische Aktionen/Router, Kontextpakete, Eskalation, besserer Scheduler, inkrementelle Prüfungen und Cache-Optimierung.

## Zeitschätzungen: neuer Schwerpunkt

### Heutiger Codebefund

src/loop/reporter.ts speichert bis zu 50 Story-Laufzeiten in .yoke/story-durations.json. Die ETA ist der arithmetische Durchschnitt abgeschlossener Stories multipliziert mit der Anzahl verbleibender Stories. Aktuelle Run-Dauern ersetzen die ältere Historie bereits nach dem ersten Abschluss. Gespeicherte StoryDuration enthält nur storyId und ms. Diese Formel berücksichtigt weder individuelle Aufgabengröße noch Modell, Ressourcen oder parallelen kritischen Pfad. Die Aussage bezieht sich auf diese ETA-Implementierung; nicht jede Parallelansicht wurde gesondert vermessen.

### Vorgeschlagene Verbesserung

- Exakte vergangene Dauer messen; zukünftige Dauer als Schätzung mit Unsicherheit anzeigen. Keine sekundengenaue Vorhersage versprechen.
- Phasen getrennt erfassen: Warteschlange, Kontext/Setup, Implementierung, Tests, Review, Reparatur, Integration. Aktive Ausführungszeit, Wartezeit und menschliche Blockade auseinanderhalten.
- Alle Versuche inklusive Fehlern und Abbrüchen erfassen; nur erfolgreiche Story-Dauern würden Wiederholungsaufwand unterschätzen.
- Vergleichbare Aufgaben nach Typ, Scope, Testumfang, Provider, tatsächlichem Modell, Effort, Umgebung und Parallelitätsgrad gruppieren. Mit wenigen Daten robuste gemeinsame Basis verwenden statt überfeine Gruppen.
- Historie und neue Beobachtungen gewichten; ein einzelner schneller Abschluss darf nicht die ganze Prognose dominieren.
- Zunächst Median und empirische Zeitspannen mit Stichprobenzahl; später kalibrierte Quantile, etwa P50/P80, wenn genug Daten vorliegen. Zielabdeckung und Prognosefehler messen.
- Projekt-ETA aus verbleibenden Aufgaben, Abhängigkeiten, freien Slots, Integrationsengpass und Ressourcen berechnen; weder einfach aufsummieren noch blind durch Workeranzahl teilen.
- Laufende Aufgaben anhand ihrer aktuellen Phase und verstrichenen Zeit aktualisieren. Wiederholungs-/Reparaturwahrscheinlichkeit und Modellwechsel berücksichtigen.
- Bei unbekannter Dauer einer Nutzerentscheidung: "wartet auf Entscheidung" und bedingte Restlaufzeit ab Wiederaufnahme; keine erfundene Fertigstellungsuhrzeit.
- Bei neuer Aufgabe/Modell unbekannte oder schwach gestützte Schätzung sichtbar kennzeichnen; Prognose selbst benötigt nicht zwingend einen LLM-Aufruf.
- Szenarien anbieten: Zeit/Kosten bei anderer Parallelität oder anderem Modell. Als Prognose ausweisen, nicht als zugesagte Einsparung.

## Dashboard pro Projekt und projektübergreifend

Status: Nutzerinteresse; folgende Ausgestaltung ist ein Vorschlag, noch keine freigegebene Implementierung.

- Lokaler Einstieg, gleiche Datenbasis wie CLI. Zunächst registrierte Projektpfade und lesende Übersicht; kein Cloudkonto als Voraussetzung.
- Projektübersicht: aktives Ziel, Zustand, abgenommene/offene Kriterien, laufende Worker, Blocker, Zeitspanne bis Abschluss, gemessener Verbrauch und Telemetrielücken.
- Projektdetail: Task-Liste und Abhängigkeitsansicht, Phasen/Zeitleiste, kritischer Pfad, aktuelle Modelle, Reviews, Fehlerreproduktionen, Artefakte und Integrationsstand.
- Aufmerksamkeit zuerst: Was braucht eine Entscheidung? Welcher Test blockiert? Welches Projekt ist seit wann still? Warum änderte sich die ETA?
- Taskdetail: ursprüngliche/aktuelle Schätzung, tatsächliche Phasendauern, Versuchshistorie, Patch, Abnahmen, Kosten und Übergaben.
- Spätere Steuerung: Pause/Wiederaufnahme, kritische Entscheidung beantworten, Anbieterwechsel am sicheren Übergang, Budget/Parallelität ändern. Existierende Locks und Sicherheitsgrenzen wiederverwenden; UI darf keine zweite Ausführungslogik besitzen.
- Metriken: Zeit/Kosten pro abgenommener Änderung, Erstversuchserfolg, Eskalationsrate, Nacharbeit, Cache-Anteil, menschliche Eingriffe, Prognosefehler und Zeitspannen-Abdeckung.
- Zuerst versionierte Ereignisse und vollständige Messung schaffen, dann Dashboard. Vorhandene loop-status.json, loop.log, Story-Dauern und Routing-Ereignisse sind Bausteine, aber noch keine vollständige projektübergreifende Ereignishistorie.
- Telemetrie standardmäßig lokal; externe Team-/Cloudfunktion und Datenumfang später ausdrücklich entwerfen.

## Empfohlene Produktabfolge

1. Fehlerbehandlung und Provider-Parität stabilisieren; vollständige Ereignisse/Verbrauch/Dauern.
2. Nützlichen yoke-check-Einstieg aus Review, Verify und Smoke entwickeln.
3. Geschützte Abnahmen, kontrollierte Reparatur, Wiederaufnahme und Anbieterwechsel.
4. Zeitprognosen und lesendes Projektdashboard auf derselben Ereignisbasis; anschließend gezielte Steuerung.
5. Gemeinsames Zielmodell und Team-/CI-Berichte ausbauen; Optimierungen durch Vergleichsläufe validieren.

Nicht bereits beschlossen: UI-Technologie, Cloudhosting, API-Providerpreise, konkrete Modellrangliste, genauer Releaseumfang, verbindlicher Zeitplan, bezahltes Produkt oder vollständige Umsetzung aller Vorschläge.

## Quellen und Wiederaufnahme

### Umsetzungsstand nach Freigabe

Der Nutzer hat anschließend ausdrücklich „ok setze alles akribisch und sicher um“ beauftragt. Die lokale Umsetzung umfasst jetzt unabhängige Checks, geschützte ausführbare Abnahmen, dauerhafte Ziele mit Anbieterwechsel und Verbrauchsgrenzen, sichere serielle Worktree-Wiederaufnahme, Gemini-Adapterkorrekturen, Ereignisse und empirische Zeitspannen, feste Routingregeln mit Eskalation, modellfreie Werkzeugaufgaben, begrenzte kontextbezogene Prompts, deklarierte Schreibbereiche und ein lokales Projektdashboard. Bedienung und Grenzen: [VERIFIED-PROJECTS.md](VERIFIED-PROJECTS.md).

Weiterhin offen sind externe Nutzer-/Wettbewerbsversuche, authentifizierte Modellvergleiche, belastbare Kalibrierung der Zeitprognosen und kommerzielle/Cloud-Entscheidungen. Selektive Testwiederverwendung und webbasierter Start/Resume sind bewusst keine behaupteten Fähigkeiten dieses lokalen Ausbaus. Qualitätskontrollen werden vollständig ausgeführt. Die ursprünglichen Produktthesen bleiben als solche dokumentiert.

Lokale Anker: src/agents/providers.ts, src/agents/telemetry.ts, src/retrofit/planners/, src/loop/loop.ts, src/loop/git.ts, src/loop/runner.ts, src/loop/reporter.ts, src/loop/scheduler.ts, src/routing/router.ts, src/routing/registry.ts, src/context/context.ts, src/smoke/command.ts, src/scan/design.ts, bench/RESULTS.md.

Am 2026-09-05 gelesene Primärquellen; vor konkreten Versions-/Preisentscheidungen erneut prüfen:

- https://learn.chatgpt.com/use-cases/follow-goals
- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://developers.openai.com/api/docs/guides/latency-optimization
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/agent-teams
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://geminicli.com/docs/cli/headless/
- https://geminicli.com/docs/hooks/reference/
- https://ai.google.dev/gemini-api/docs/caching
- https://github.com/obra/superpowers
- https://github.com/garrytan/gstack
- https://github.com/open-gsd/gsd-core

Provenienz der ursprünglichen README-Prüfung: kein C2PA gefunden, unterstützter Scan vollständig, Verifikation/Vertrauen/Metadatenprivatsphäre unbekannt. Unicode-Befund: Emoji-Variationszeichen, kein Nachweis eines KI-Wasserzeichens. Proprietäre Wasserzeichen nicht überprüfbar. Dieses Gesprächsdokument wurde vom KI-Assistenten aus der Sitzung zusammengefasst; es enthält keine unabhängige Bestätigung der Produktthesen.
