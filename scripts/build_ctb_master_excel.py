#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import zlib
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = ROOT / "scripts/ctb_master_bootstrap.b64"
OUTPUT = ROOT / "docs/data/chimera_battle_ctb_redesign_v02_clean.xlsx"


def load_payload() -> dict:
    encoded = PAYLOAD.read_text(encoding="utf-8").strip()
    raw = zlib.decompress(base64.b64decode(encoded))
    return json.loads(raw.decode("utf-8"))


def build_workbook(payload: dict) -> None:
    wb = Workbook()
    wb.remove(wb.active)

    for sheet_name, rows in payload["sheets"].items():
        ws = wb.create_sheet(sheet_name)
        for row in rows:
            ws.append(row)

        ws.freeze_panes = "A2" if len(rows) > 1 else None
        ws.auto_filter.ref = ws.dimensions if len(rows) > 1 else None

        if ws.max_row >= 1:
            for cell in ws[1]:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="404040")
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        for row in ws.iter_rows():
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=True)

        for col_idx in range(1, ws.max_column + 1):
            values = [str(ws.cell(r, col_idx).value or "") for r in range(1, min(ws.max_row, 80) + 1)]
            width = min(max(10, max((len(v) for v in values), default=10) + 2), 34)
            ws.column_dimensions[get_column_letter(col_idx)].width = width

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUTPUT)
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build_workbook(load_payload())
