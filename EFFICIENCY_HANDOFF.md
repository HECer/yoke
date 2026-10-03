# Yoke v1.21.0 Efficiency & Fleet Handoff

> Dies ist eine gespiegelte Handoff-Datei des Effizienz-Agents. Die Hauptversion liegt unter `Q:\NN-Developed\EfficiencyAgent\AGENT_HANDOFF.md`.

## Wichtigste Fakten für nachfolgende Agents:
1. **Yoke Version**: `v1.21.0` ist auf `main` gemerged, getaggt (`v1.21.0`) und zu GitHub gepusht.
2. **Worktrees**: Flottenweit bereinigt via `yoke worktrees prune --all` (~40 GB auf `G:` freigegeben).
3. **Modell- & Reasoning-Auswahl**: Weder bei `yoke retrofit` noch bei `yoke setup` wird automatisch Reasoning forciert. Die Steuerung erfolgt selektiv via `--runner-model`, `--runner-reasoning`, `--model=<agent>:<model>`, `--reasoning=<agent>:<effort>` oder `--configure-models`.
4. **Builds / Tests**: Vor `npm test` oder Builds immer `$env:TEMP="Q:\tmp"; $env:TMP="Q:\tmp"` setzen, da Laufwerk `C:` fast voll ist.
5. **Detaillierte Dokumentation**: Siehe [`Q:/NN-Developed/EfficiencyAgent/AGENT_HANDOFF.md`](file:///Q:/NN-Developed/EfficiencyAgent/AGENT_HANDOFF.md).
