# Yoke 2.0: überprüfbare Agentenarbeit statt einer weiteren Agenten-IDE

**Entscheidungsstand: 16. September 2026.** Geprüfte Yoke-Basis: `1.15.1`, Commit `4c8654e1e8639ddd3c308db8aded0701d8cebcbf`. Dieses Dokument trennt bestehende Funktionen, die implementierte M0-Vorschau und zukünftige Arbeit. Es ist keine Behauptung einer fertigen oder veröffentlichten Version 2.0.

## 1. Die wichtigste Korrektur des ursprünglichen Plans

Yoke muss nicht erst durch Orca Worktrees, Worker, Scheduler, Integration oder Wiederaufnahme erhalten. Diese Bausteine existieren bereits. Ein obligatorischer Wechsel zu Orca würde funktionierende Infrastruktur ersetzen, eine zusätzliche Laufzeitabhängigkeit erzeugen und konkurrierende Verantwortlichkeiten riskieren.

Die Produktentscheidung lautet deshalb:

> Yoke hält Ziel, Budget, Berechtigungen und überprüfbare Abnahme stabil. Native Coding-Agenten und optionale Ausführungsumgebungen dürfen wechseln, ohne diese Verantwortung zu übernehmen.

Orca wird ein optionaler Adapter, keine Voraussetzung. Von BridgeMind übernehmen wir das Konzept einer langlebigen, vom konkreten Modell unabhängigen Rolle, nicht dessen Oberfläche und nicht eine unbewiesene Selbstlern-Garantie. Yokes bestehendes Dashboard bleibt die Bedienoberfläche für Zustand und Entscheidungen.

## 2. Vergleich auf der richtigen Ebene

Die drei Produkte lösen teilweise unterschiedliche Probleme. Eine pauschale Rangliste nach Anzahl gestarteter Agenten wäre irreführend.

| Dimension | BridgeMind: dokumentiert | Orca: dokumentiert | Yoke 1.15.1: Codebefund | Entscheidung für 2.0 |
| --- | --- | --- | --- | --- |
| Grundeinheit | Persistenter Teammate oder Projekt-Session | Workspace, Task, autoritativer Dispatch | Goal, Story, Worker-Kandidat, Integrationsprüfung | Identität, Arbeit, Ausführung und Abnahme getrennt modellieren |
| Agentenoberfläche | Agent/Code/Chat; Rollen, Memory, Skills | Terminals, Worktrees, Browser und Review | Native CLI-Adapter, gemeinsamer Canon, Dashboard | Keine weitere komplette IDE entwickeln |
| Anbieterintegration | Chat-Adapter für Claude/Codex; andere erkannte Engines im Terminal | Viele Engines; einzelne Startparameter haben unterschiedliche Unterstützung | Sieben Adapter mit unterschiedlichen nativen Fähigkeiten | Fähigkeiten einzeln nachweisen; Terminalstart ist keine vollständige Parität |
| Parallelität | Pair/Workbench/Swarm-Layouts | Strukturierte Orchestration und getrennte Ausführungsorte | Scheduler, Claims, Leases, Worktrees, Merge-Queue | Bestehenden Scheduler erhalten; ein gemeinsames Zulassungsbudget |
| Abschluss | Agenten- und Chat-Ergebnisse | Dispatch-Lifecycle und Settlement | Kandidat bleibt pending-integration; Gates entscheiden | Runtime-Fertigmeldung niemals automatisch als Abnahme behandeln |
| Kontinuität | Persistenter Brief, Memory und Skills | Session-/Runtime-Zustand und Dispatch-Eigentümerschaft | Goals, Handoff, Projektkontext, lokale Belege | Typisierte Übergaben und geprüfte Wissensübernahme |
| Remote | In den geprüften Seiten kein äquivalenter Runtime-Vertrag belegt | SSH, Remote Orca Server, experimentelle BYO-Cloud-Rezepte | Lokaler Kern; hier kein gleichwertiger Remote-Vertrag nachgewiesen | Orca als optionale Remote-/Workspace-Erweiterung |
| Wiederkehrende Arbeit | Routines laufen nur bei geöffneter Anwendung | Eigene Automations-Oberfläche | Bestehende Goal-/Loop-Ausführung | Später eigener begrenzter Triggerpfad; nicht zwei Scheduler koppeln |

Quellen: BridgeMind Agent Mode [B1], Code Mode [B2], Routines [B3]; Orca Orchestration [O1], Startpräferenzen [O3], Laufzeitorte [O4]; Yoke-Quellpfade in Abschnitt 3. Nicht dokumentiert bedeutet hier **nicht nachgewiesen**, nicht automatisch nicht vorhanden. Keine dieser Dokumentationsvergleiche ist ein kontrollierter Geschwindigkeits-, Qualitäts- oder Kostenbenchmark.

### Konkrete Grenzen, die eine Integration verändern

BridgeMind trennt den langlebigen Teammate von der Engine. Das ist eine nützliche Modellierungsentscheidung; es beweist weder langfristige Zuverlässigkeit des gespeicherten Wissens noch vollständige Gleichheit aller Engine-Adapter [B1, B2].

Bei Orca sind Task und Dispatch verschieden. Ein verlorener Kontakt ist nicht gleichbedeutend mit einem beendeten Agenten. Ein fehlgeschlagener Startaufruf kann Restressourcen hinterlassen und darf nicht blind wiederholt werden [O1]. Für bestimmte frische Agent-Terminals werden Modellpräferenzen unterstützt; angefordert und tatsächlich wirksam sind getrennte Felder [O3].

Die Cloud-VM-Funktion ist eine experimentelle Rezeptoberfläche mit eigener Infrastruktur und eigener Abrechnung des Nutzers, kein kostenloses verwaltetes Hosting [O4]. Das verändert Kostenmodell, Fehlerbehandlung und Freigaben.

## 3. Was erhalten bleibt

Der Ausgangspunkt ist der aktuelle Code, nicht die frühere Analyse zu 1.6.2:

| Bestehender Bereich | Geprüfte Pfade | Rolle im neuen Plan |
| --- | --- | --- |
| Ziele und Anbieterwechsel | `src/goals/command.ts` | Weiterhin Zielzustand, gemeinsame Projektsperre, Recovery und begrenzte Versuche |
| Mechanische Abnahme | `src/check/command.ts`, Aufrufpfade in Goals und Worker-Verträgen | Autoritative Prüfung; keine Modellbehauptung als Ersatz |
| Ausführung und Integration | `src/loop/worker-contracts.ts`, `dispatcher.ts`, `scheduler.ts`, `merge-queue.ts` | Bestehende Trennung Kandidat/Integration erhalten |
| Sperren und Prozessüberwachung | `src/loop/lock.ts`, `cleanup.ts`, `watchdog.ts` | Wiederverwenden statt konkurrierende Lock-Dateien einzuführen |
| Routing | `src/routing/router.ts`, vorbereitete Assessments | Erweiterung um vollständige Kosten- und Ergebnisbelege, kein unbelegter intelligenterer Router |
| Deterministische Aktionen | `src/execution/actions.ts` | Wo passend ohne LLM arbeiten; Abnahme bleibt erforderlich |
| Code Intelligence | `src/code-intelligence`, `docs/CODE-INTELLIGENCE.md`, Changelog 1.15.0 | Bestehende Graft/Graphify/Serena-Fassade erweitern, nicht erneut integrieren |
| Projektübersicht | `src/dashboard`, Changelog 1.14.0 | Entscheidungssicht auf vorhandene Ereignisse aufbauen |

Die Prüftiefe war gezielt: ausgewählte Implementierungen und Verträge, Konfiguration, Quellbaum, Release- und Produktdokumentation. Das ist kein behauptetes vollständiges Audit jeder Zeile des Repositorys. Historische Testzahlen aus dem Changelog werden nicht als Testlauf dieses Branches ausgegeben.

## 4. Zielarchitektur und Zuständigkeiten

```text
Nutzer / bestehendes Dashboard / CI / später begrenzte Routinen
                         |
                 Yoke Control Plane
       Ziele — Policy — Budget — gültige Abnahmebelege
                         |
        bestehender Planner, Router und Scheduler
            /                            \
  Native Ausführung                  optionaler Orca-Adapter
  bestehende CLI-Adapter             Workspace / Dispatch / Remote
            \                            /
          Kandidat + nachweisbarer Ausführungszustand
                         |
          bestehende unabhängige Integrationsprüfung
                         |
            akzeptiert / offen / nicht verifizierbar
```

**Nur eine Instanz besitzt die Abnahmeentscheidung für einen Job.** Orca besitzt seine Prozess- und Dispatch-Fakten, Yoke besitzt seinen Ziel- und Abnahmestatus. Diese Fakten werden abgebildet, nicht durch gegeneinander laufende Statusautomaten überschrieben.

Ein Runtime-Adapter entscheidet nicht über das richtige Modell oder das Produktziel. Ein Planner darf keine Sandbox- oder Abnahmebedingungen herabsetzen. Eine Agentenrolle darf keine neuen Berechtigungen aus ihrem Memory ableiten. Ein Dashboard zeigt Zustand und leitet typisierte Bedienaktionen weiter; es wird keine beliebige Remote-Shell.

### Identitäten sauber trennen

- **AgentProfile:** Aufgabe, Rolle, zugelassene Schreibbereiche und später freigegebene Skills/Memory. Keine Personifizierung als technische Garantie.
- **Engine:** etwa Codex CLI, Claude Code oder OpenCode; verantwortlich für native Aufrufe und Ergebnisnormalisierung.
- **ModelSelection:** angeforderter Provider, Modell und Effort. Tatsächlich gemeldete Identität wird separat gespeichert.
- **Runtime:** lokaler Yoke-Worker oder eine genau identifizierte Orca-Ausführungsinstanz.
- **Goal/Task:** gewünschtes Ergebnis und Kriterien; **Attempt/Dispatch:** ein konkreter autoritativer Versuch.
- **Evidence:** welche Kriterien auf welchem Code-, Policy- und Umgebungsstand geprüft wurden.

Ein Release-Agent kann dadurch bei gleicher Rolle eine andere Engine erhalten. Das bedeutet nicht, dass ein beliebiger bisheriger Transcript oder ein Provider-Cache unverändert übernommen werden kann.

## 5. Ausführung ist ein verteiltes Zuverlässigkeitsproblem

Die kritischen Fehler entstehen nicht beim Erstellen eines Terminals, sondern zwischen Reservierung, Start, Bestätigung, Ende, Abnahme und Aufräumen.

### Vorgeschlagener Ablauf für M1/M2

1. Ziel, Kriterien und erlaubte Änderungen als überprüfbaren Snapshot erfassen.
2. Budget und Schreibbereiche unter der bestehenden Projektsperre prüfen.
3. Persistente Startabsicht mit stabiler ID speichern, bevor ein externer Start erfolgt.
4. Runtime genau einmal beauftragen und den zurückgegebenen Handle/Dispatch zuordnen.
5. Bei Timeout zuerst den vorhandenen Versuch lokalisieren. Ein zweiter Start ist keine Wiederaufnahme.
6. Prozess-/Dispatch-Ende und tatsächlichen Verbrauch erfassen. Unbekannte Daten bleiben unbekannt.
7. Kandidaten in der vorgesehenen Zielumgebung prüfen. Erst passende Integrationsbelege erlauben Abnahme.
8. Aufräumen erst nach gesicherter Eigentümerschaft und Settlement; unfertige Arbeit erhalten.

Für Remote-Koordination braucht dies später einen langlebigen Outbox-/Intent-Vertrag, Lease-Generationen und Fencing. Ein lokaler PID-Lock ist dafür allein nicht ausreichend. Diese verteilte Ausführung ist **nicht** Teil der M0-Implementierung.

| Fehler | Falsches Verhalten | Geforderte Reaktion |
| --- | --- | --- |
| Startantwort geht verloren | Mit neuer ID erneut starten | Vorhandenen Dispatch suchen; Zustand zunächst unbekannt |
| Laptop verliert Verbindung | Budget/Schreibbereich freigeben | Remote-Prozess kann weiterleben; Reservierung halten |
| Alte Worker-Nachricht trifft ein | Aktuelle Aufgabe fertig markieren | Attempt-/Dispatch-Bindung prüfen und veraltete Nachricht ablehnen |
| Modell liefert eine schöne Zusammenfassung | Story als bestanden setzen | Nur ausführbare, aktuelle Kriterienbelege akzeptieren |
| Target-Branch oder Testumgebung ändert sich | Alten Testlauf wiederverwenden | Betroffene Belege invalidieren und integrierte Prüfung wiederholen |
| Usage-Event fehlt | Nullkosten verbuchen | Abdeckung als unbekannt zeigen; weitere budgetierte Arbeit blockieren |
| Agent ändert Akzeptanztests | Neue grüne Tests als Erfolg nehmen | Geschützte Abnahmeänderung separat genehmigen oder blockieren |

## 6. Budget: nicht nur Token zählen

Das Optimierungsziel ist der **Gesamtaufwand pro unabhängig akzeptierter Änderung**. Zu berücksichtigen sind Controller, Worker, Reviews, Reparaturen, verworfene Kandidaten, Integration und menschliche Nacharbeit. Weniger Tokens oder mehr gleichzeitig laufende Agenten sind keine ausreichenden Erfolgsmetriken.

Die neue Grundlage trennt drei additive Ressourcen: Tokens, Geld in ganzzahligen Mikro-US-Dollar und aufsummierte Rechen-/Agentenzeit. `computeMs` ist ausdrücklich nicht die verstrichene Wandzeit eines parallelen Jobs. Wandzeit, Warteschlangenzeit und menschliche Blockade benötigen eigene Messungen.

### Reservierung versus harte Kostenobergrenze

Die M0-Reservierung verhindert Überbuchung gegen den angegebenen Ledger. Sie garantiert nicht, dass ein externer Anbieter seine tatsächlichen Kosten auf die Schätzung begrenzt. Für eine harte Grenze müssen Runtime, native Unteragenten, Zeitlimits und gegebenenfalls anbieterbasierte Limits mitwirken. Ist das nicht möglich, muss die Oberfläche zwischen weichem Budget und durchsetzbarer Obergrenze unterscheiden.

Bekannter tatsächlicher Mehrverbrauch wird gespeichert und blockiert weitere Zulassung. Fehlende Kosten werden nicht zu gemessenen Nullkosten. Ein beendeter Versuch mit unbekannter Nutzung bleibt als Messlücke sichtbar; M0 hat bewusst noch keinen bequem kaschierenden Reset oder nachträglichen Null-Abgleich.

### Routing als messbare Entscheidung

Die spätere Auswahl optimiert eine explizite Zielfunktion: erwartete Kosten bis zur Abnahme plus gewichtete Wartezeit und Fehlerrisiko, unter Berechtigungs-, Qualitäts- und Budgetbedingungen. Das ist ein Designziel, kein bereits gemessener Vorteil.

Ein billiger erster Versuch kann insgesamt teurer sein, wenn er viele Reparaturen, Reviews und anschließend doch das starke Modell benötigt. Ebenso kann eine deterministische Umformung besser sein als jeder zusätzliche Planungsaufruf. Deshalb: zuerst sichere Werkzeuge und eindeutige Regeln, dann vorbereitete Assessments, danach begrenzte Modellarbeit. Eine größere Engine wird nur bei geeigneten, nachvollziehbaren Eskalationsgründen gewählt.

Erfolgsstatistiken müssen nach Aufgabentyp, Prüfstrategie, tatsächlichem Modell und Umgebung vergleichbar sein. Fehlversuche gehören in die Daten. Routing produziert Selektionsverzerrungen: wenn das starke Modell ausschließlich die schwierigen Aufgaben erhält, darf seine rohe Erfolgsrate nicht direkt gegen leichte Aufgaben des günstigen Modells gerechnet werden. Kleine Stichproben erhalten Unsicherheit statt scheinpräziser Ranglisten.

## 7. Parallelität: Rechte, Abhängigkeiten und Ressourcen gemeinsam betrachten

Eine Kante im Task-Graphen bedeutet eine echte Abhängigkeit, nicht bloß eine chronologische Wunschreihenfolge. Bereit ist eine Aufgabe erst nach akzeptierten Vorgängern. Eine gerade gestartete oder vom Worker fertig gemeldete Voraussetzung reicht nicht.

Schreibkonflikte werden auf erlaubten Bereichen, nicht nur zufällig beobachteten Diff-Dateien geprüft. Globale Problemstellen wie Lockfiles, gemeinsame Schemas, Migrationen, Ports, Datenbanken und Testkonten benötigen zusätzliche Ressourcen-Claims. Eine getrennte Git-Arbeitskopie verhindert nicht automatisch diese Konflikte.

Yoke und native Unteragenten brauchen einen gemeinsamen Ressourcenvertrag. In M0 existiert der globale Ledger für kooperierende Aufrufer. Tatsächliche native Fan-out-Durchsetzung folgt erst mit den Adaptern; sie ist nicht durch ein Feld `maxActive` allein bewiesen.

Die M0-Zulassungsfunktion ist eine reine, deterministische Entscheidung für eine Welle. Sie ersetzt ausdrücklich nicht `src/loop/scheduler.ts` und startet keine Prozesse. Die spätere Integration verwendet sie an dessen vorhandenen Grenzen.

## 8. Verifikation: Belege sind zustandsgebunden

Ein Ergebnis darf nur für den Zustand gelten, auf dem es geprüft wurde. Die M0-Belegprüfung bindet an Task, Attempt, Dispatch sowie SHA-256-Digests von Workspace-Snapshot, Acceptance, Policy und Umgebung. Kandidatenprüfung und integrierte Abnahme sind verschiedene Stufen. Fehlende oder unbestätigte Kriterien sind nicht bestanden.

Das Schema allein beweist nicht, dass ein Test wirklich ausgeführt wurde. Ein Agent könnte ein plausibles JSON-Objekt schreiben. Deshalb muss der spätere vertrauenswürdige Prüfadapter die Belege erzeugen; Modelltext ist keine solche Autorität. Bei Remote-Betrieb sind Transportauthentifizierung, Herkunft, Replay-Schutz und gegebenenfalls signierte Belege gesondert zu implementieren.

Die eigentlichen Akzeptanztests einschließlich relevanter Skripte, Hilfsdateien und Konfigurationen müssen außerhalb der Änderungsbefugnis des Implementierers bleiben oder ihre Änderung muss eine neue Freigabe verlangen. Ein geschützter Dateiname allein schützt nicht automatisch die gesamte Testinfrastruktur. Gezielte Mutationen können später prüfen, ob ein Test den relevanten Fehler überhaupt erkennt.

## 9. Langlebige Agenten und Memory ohne Selbsttäuschung

Für Yoke ist eine stabile Rolle nützlicher als eine laufende Endlossitzung. Ein Agent besitzt einen Auftrag, freigegebene Ressourcen und ein begrenztes, versioniertes Kontextpaket. Die Engine darf wechseln; Wissen wird nicht ungeprüft aus jeder Antwort übernommen.

Vorgeschlagene Wissensarten:

| Art | Beispiel | Aufnahme und Gültigkeit |
| --- | --- | --- |
| Produktentscheidung | Öffentliche API bleibt kompatibel | Menschliche Entscheidung mit Quelle; Änderung nur explizit |
| Repository-Fakt | Symbol X implementiert Vertrag Y | Code-Referenz, Snapshot und Abdeckungsgrad; bei Änderung invalidieren |
| Episode | Reparaturversuch scheiterte an Test Z | Evidenz für genau diesen Versuch, keine allgemeine Wahrheit |
| Geprüfte Prozedur | Wiederholbarer Release-Check | Vorbedingungen, Versionen, Nachbedingungen, Review und Rücknahme |
| Vermutung | Ein Test könnte instabil sein | Als Hypothese behandeln; keine verbindliche Policy daraus machen |

Der Lernpfad lautet: Kandidat → Quellenprüfung/Test → Freigabe → versionierte Prozedur → wiederholte Beobachtung. Ein besserer Prompt oder mehr gespeicherter Text ist keine nachgewiesene Lernleistung. Secrets gehören nicht in Memory. Untrusted Logs, fremde Repository-Texte und Nachrichten dürfen keine Berechtigungen oder Instruktionshierarchie überschreiben.

Dies ist M3. Die implementierte M0 hat ein **AgentProfile-Vertragsobjekt**, aber noch keinen persistenten Agenten-Manager oder Memory-Lernprozess.

## 10. Code Intelligence und Kontextökonomie

Graft, Graphify und Serena bleiben hinter der bestehenden Yoke-Fassade. Backend-Abdeckung, Sprache, Snapshot und Herkunft werden nicht in einer angeblich vollständigen Graph-Sicht versteckt. Ein ausgefallenes Backend muss als Teilabdeckung erscheinen.

Das nächste Kontextpaket soll Ziel, Kriterien, relevante Symbole, Verträge, Tests und geprüfte Entscheidungen enthalten. Nicht jeder Worker erhält die gesamte Parent-Historie und nicht jeder Worker erkundet dasselbe Repository neu. Gemeinsame, read-only Exploration darf anhand von Inhalts-/Konfigurationshashes wiederverwendet werden; veränderliche Arbeitsstände bleiben getrennt.

Zusätzliche Abrufe folgen einem Nutzenbudget: Welche offene Frage entscheidet den nächsten Schritt? Lohnt sich der nächste Abruf eher als ein weiterer Modellversuch? Zunächst reichen nachvollziehbare Regeln und Messung; ein weiteres dauerhaft aktives Controller-Modell wäre sonst selbst ein Kostentreiber.

## 11. Orca-Adapter: Fähigkeit vor Bequemlichkeit

Der Adapter muss Engine-Version, Runtime-Ort und die tatsächlich unterstützten Operationen feststellen. `unknown`, `unsupported` und `supported` sind verschieden. Ein erfolgreiches `status`-JSON beweist weder Abbruch, Modellparität noch geschützte Ausführung.

Ein konkretes Implementierungsdetail ist bereits wichtig: Unter Linux soll außerhalb verwalteter Sessions nicht blind `orca` gestartet werden, da der Name auf den GNOME-Screenreader zeigen kann. Die offizielle Discovery-Anleitung verlangt eine einmalige Programmauswahl und das Laden des zur Anwendung passenden Guides [O2]. Die M0-Vorschau folgt konservativ diesem Prinzip: explizites Override, Development-Binary oder `orca-ide`; keine automatische Ausweichinstallation und kein Start der Anwendung.

M0 kann den Guide und Status begrenzt lesen sowie einen Startaufruf als Argumentliste **vorschauen**. Sie startet keinen Worker. Selbst eine erfolgreiche Statusantwort bleibt hinsichtlich der benötigten Ausführungsfähigkeiten unbekannt. `--setup skip` in einem vorgeschlagenen Aufruf ist keine Sandbox-Garantie und kein Beleg, dass alle sonstigen Startup-Aktionen unterdrückt wären.

Ein echter Adapter benötigt anschließend aufgezeichnete Vertragsfälle: Start, teilweise fehlgeschlagener Start, Beobachtung, bestätigtes Ende, Wiederanbindung, Stop, Settlement, Cleanup, Parameterabweichung und Remote-Verlust. Keine stillschweigende lokale Ersatz-Ausführung, wenn der angeforderte Remote-Ort nicht verfügbar ist.

## 12. Sicherheit und Betriebsgrenzen

Worktree-Isolation ist keine Betriebssystem-Sandbox. Pfadbereiche in M0 sind konservative lexikalische Regeln, keine Datei-Zugriffskontrolle gegen Symlinks, Mounts oder einen böswilligen Prozess desselben Betriebssystemnutzers. `.git` und `.yoke` sind zusätzlich zu explizit geschützten Bereichen in der Zulassung gesperrt.

Der Ledger verwendet die vorhandene Projektsperre, Revisionen, begrenzte Eingaben, temporäre Dateien und atomare Ersetzung. Existierende State-Symlinks werden vor Schreiboperationen abgelehnt. Atomare Ersetzung und Dateisynchronisation sind keine plattformunabhängige Zusage gegen jeden Stromausfall; Verzeichnis- und Netzwerkdateisystem-Semantik bleiben zu prüfen.

Später werden Ausführungsrechte getrennt: Repository lesen, bestimmte Bereiche bearbeiten, Netzwerkzugriff, Secret-Referenz verwenden, Tool aufrufen und extern veröffentlichen. Ein Permission-Grant erbt nicht unbegrenzt in Unteragenten. Eine Routine ist niemals automatisch eine Freigabe für Merge, npm-Publish, Deployment, Löschung oder Cloud-Ausgaben.

## 13. Routinen und Dashboard

Zuerst verlässliche Ausführung, danach Zeitpläne. Eine spätere Routine erzeugt denselben begrenzten Job wie eine manuelle Anforderung. Sie braucht Zeitzone, DST-Regel, Misfire-Verhalten, Idempotenzschlüssel, maximale Parallelität, Budget und explizite Regeln für Nebenwirkungen. Ein geschlossener Desktop darf nicht mit einem tatsächlich laufenden Dienst verwechselt werden; BridgeMind dokumentiert diese Grenze ausdrücklich [B3].

Das Dashboard wird nicht neu gebaut. Seine nächste Aufgabe ist, Aufmerksamkeit zu lenken: welcher Goal ist blockiert, welche Entscheidung fehlt, welche Abnahme ist veraltet, wo fehlen Kostenmessungen, welcher Remote-Versuch ist noch unklar? Angefordert und tatsächlich gemeldet müssen bei Modellen getrennt sichtbar bleiben. Eine reine Wand voller animierter Agenten wäre keine Verbesserung dieser Entscheidungen.

## 14. Implementierung in überprüfbaren Etappen

| Etappe | Inhalt | Abnahmebedingung |
| --- | --- | --- |
| **M0 – dieser Branch** | Budgetvertrag und Reservierung, deterministische Zulassung, Belegbindung, lokaler Ledger, read-only Orca-Probe, Preview-CLI, Tests | Neue Verträge getestet; keine ungefragte Ausführung; bestehende Defaults unverändert |
| **M1 – native Integration** | Bestehende Goal-/Worker-Grenzen an Ledger anschließen; alle Rollen und Cancellation berücksichtigen | Echte lokale Aufgabe mit Replay, Abbruch, Wiederaufnahme, Budgetüberlauf und bestehender Abnahme erfolgreich geprüft |
| **M2 – optionales Orca-Backend** | Versionierte Runtime-Fähigkeiten, Dispatch-/Intent-Abbildung, Live-Vertragsmatrix, Remote-Recovery | Keine Doppelstarts bei verlorenem Start-Receipt; kein Ressourcenverlust; keine Akzeptanz aus Worker-Text |
| **M3 – langlebige Rollen und Kontext** | Agentenregister, typisierte Übergaben, Memory-Herkunft, freigegebene Prozeduren | Anbieterwechsel ohne Verlust gültiger Belege; veraltetes Wissen wird nicht als aktuell ausgegeben |
| **M4 – begrenzte Routinen und Dashboard** | Job-Trigger, Missed-run-Policy, Freigaben und Entscheidungssichten | Zeitzonen-/DST-/Restart-/Doppeltrigger-Fälle geprüft; keine unautorisierten Seiteneffekte |
| **M5 – Messung und 2.0-Release** | Reale Vergleichsaufgaben, Migration, Regressionen und Release-Verifikation | Akzeptanz-/Kosten-/Zeitdaten mit Messabdeckung; freigegebene Migration; grüne CI und verifizierte Veröffentlichung |

### Migration

Keine Zwangsmigration. M0 fügt einen separaten Einstieg `node dist/control-plane/cli.js` hinzu. `yoke goal`, `yoke loop`, `yoke check`, Provider-Konfiguration, Versionsnummer und Release-Manifeste bleiben unverändert. Die Budgetdatei wird nur durch explizite Initialisierung angelegt.

Für M1/M2 ist eine schrittweise Aktivierung vorgesehen: `off` → read-only/shadow → explizit aktive Ausführung. Shadow darf insbesondere keinen zweiten Worker starten und keine zweite Integration durchführen. Der genaue Konfigurationsschlüssel ist vor M1 zu beschließen, nicht schon hier als existierender CLI-Parameter auszugeben.

Vor einem 2.0-Tag gelten `AGENTS.md` und die Release-Regeln: datierter Changelog, Versionssynchronisierung, vollständige Tests, Canon-/Dokumentations-/Paketprüfung, CI- und Veröffentlichungsnachweis. Dieser Branch ist kein npm-Release.

## 15. Benchmarks und Erfolgskriterien

Kein pauschales Einsparversprechen. Vergleichsarme: native Engine mit gleicher Aufgabe, heutiges Yoke, Yoke mit M1-Regeln, später Yoke über Orca. Gleiche Anforderungen, Akzeptanztests, Budgetregeln und Startzustände; Modell-/Effort-/Cache- und Umgebungsunterschiede protokollieren.

Messen: akzeptierte Ergebnisse, Regressionen, Zeit bis zur Abnahme, gesamte Rechenzeit, bekannte Geldkosten, Tokenarten, Messabdeckung, Reparaturen, menschliche Eingriffe und erhaltene Arbeit nach Fehlern. P50/P80 nur mit genügender Stichprobe und nachvollziehbarer Abdeckung. Ein Lauf mit fehlenden Messungen darf nicht als besonders günstig gewinnen.

Fehlerinjektion gehört zum Benchmark: Prozessabbruch, verlorene Antwort, doppelte Nachricht, veränderte Akzeptanzdatei, neuer Target-Commit, fehlendes Usage-Event, nicht verfügbare Runtime, konkurrierender Schreibbereich und überschrittenes Budget. Die Mechanik muss vor einer breiten autonomen Nutzung bestehen.

## 16. Tatsächlicher M0-Lieferumfang und Grenzen

Implementiert sind die Dateien in `src/control-plane`, die gemeinsamen Vertragsfälle unter `tests/control-plane`, Beispiele und die [Bedienungsanleitung](CONTROL-PLANE-PREVIEW.md). Die Dateien werden von der vorhandenen TypeScript-Konfiguration mitgebaut. Es kommen keine Laufzeitabhängigkeiten hinzu.

Die lokalen Vertragsfälle sind mit Node 22.16.0 und TypeScript für den neuen Quellteil sowie den unverändert übernommenen State-/Lock-Helfern ausführbar geprüft worden. Das ist nicht dasselbe wie ein vollständiger lokaler Testlauf aller Yoke-Module. GitHub-CI-Resultate müssen anhand des konkreten PR-Commits zusätzlich überprüft werden.

Nicht implementiert: produktive Einbindung in Goal/Loop, verteilte Lease-/Outbox-Ausführung, gestartete Orca-Worker, Live-Abnahme mit authentifizierten Modellen, persistente Agenten-Memory-Verwaltung, Routinen-Daemon und ein fertig veröffentlichtes Yoke 2.0. Nicht behauptet: garantierte Kostensenkung, Modellparität, harte externe Kostendeckel oder OS-Sandboxing durch diese Vorschau.

## Primärquellen und Reproduzierbarkeit

Alle folgenden öffentlichen Produktquellen wurden am 16. September 2026 geprüft. Bewegliche `main`-Dokumentation ersetzt keinen installierten, versionsgebundenen Vertrag.

- [Y0: Yoke-Basiscommit](https://github.com/HECer/yoke/tree/4c8654e1e8639ddd3c308db8aded0701d8cebcbf)
- [Y1: Produktentscheidung vom 5. September](PRODUCT-DIRECTION-2026-09-05.md), als historischer Kontext und nicht pauschal aktueller Fehlerstand.
- [B1: BridgeMind Agent Mode](https://docs.bridgemind.ai/docs/agent-mode)
- [B2: BridgeMind Code Mode](https://docs.bridgemind.ai/docs/code-mode)
- [B3: BridgeMind Routines](https://docs.bridgemind.ai/docs/routines)
- [O1: Orca Orchestration](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration.md)
- [O2: Orca CLI Discovery](https://github.com/stablyai/orca/blob/main/skills/orca-cli/SKILL.md)
- [O3: Orca Coordinator/Launch-Vertrag](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration/references/coordinator-loop.md)
- [O4: Orca Ways to Run](https://www.onorca.dev/docs/ways-to-run)
