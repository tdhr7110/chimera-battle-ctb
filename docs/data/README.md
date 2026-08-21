# CTB Master Data

`chimera_battle_ctb_redesign_v02_clean.xlsx` is the human-editable source of truth for CHIMERA BATTLE CTB content data.

## Normal edit workflow

1. Edit `docs/data/chimera_battle_ctb_redesign_v02_clean.xlsx` in Excel or another compatible spreadsheet editor.
2. Save the workbook without renaming the existing sheets/required headers unless the importer is updated at the same time.
3. Run:

```bash
npm run data:import
```

4. Generated runtime data is written to `src/data/generated/`.
5. Verify that generated files match the workbook:

```bash
npm run data:check
```

6. Commit the Excel workbook and generated JSON together.

## Source of truth

- Edit the Excel workbook.
- Do **not** hand-edit files in `src/data/generated/`; they are derived files and may be overwritten.
- `src/data/generated/manifest.json` records the source workbook SHA-256 and row counts.

## Generated files

- `ctb-settings.json`
- `commands.json`
- `parts.json`
- `enemies.json`
- `synergies.json`
- `status-effects.json`
- `representative-builds.json`
- `manifest.json`

The importer validates that the workbook is a valid XLSX/ZIP container and rejects blank or duplicate IDs in command, part, enemy, synergy, and status-effect master sheets.

Current intended master counts are 60 commands, 80 parts, 45 enemies, 36 synergy rows, 24 status effects, and 20 representative build test cases. These counts may intentionally change later as the game expands; the manifest reports the actual workbook counts each time.
