#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKBOOK = ROOT / "docs/data/chimera_battle_ctb_redesign_v02_clean.xlsx"
DEFAULT_OUTPUT = ROOT / "src/data/generated"

SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"x": SHEET_NS}

SPECS = {
    "CTB設定": {
        "file": "ctb-settings.json",
        "columns": {
            "項目": "key", "仮値": "value", "区分": "category", "説明": "description", "検証ポイント": "validationPoint",
        },
        "numbers": {"value"},
    },
    "コマンド": {
        "file": "commands.json",
        "columns": {
            "ID": "id", "名称": "name", "系統": "category", "レア度": "rarity", "威力": "power", "Hit": "hits", "MP": "mpCost",
            "CT区分": "ctClass", "CT倍率": "ctMultiplier", "対象": "target", "タグ": "tags", "効果": "effect",
            "状態異常": "statusEffect", "CT操作": "ctOperation", "条件/代償": "conditionOrCost", "想定ビルド": "intendedBuild",
            "AI評価": "aiEvaluation", "実装優先": "implementationPriority",
        },
        "numbers": {"power", "hits", "mpCost", "ctMultiplier"},
        "arrays": {"tags"},
    },
    "部位": {
        "file": "parts.json",
        "columns": {
            "ID": "id", "部位名": "name", "カテゴリ": "category", "レア度": "rarity", "タグ1": "tag1", "タグ2": "tag2",
            "基礎効果": "baseEffect", "CTB効果": "ctbEffect", "MP効果": "mpEffect", "コマンド連動": "commandInteraction",
            "状態異常": "statusEffect", "特殊ルール": "specialRule", "デメリット": "downside", "想定ビルド": "intendedBuild",
            "実装優先": "implementationPriority",
        },
        "tags_from": ["tag1", "tag2"],
    },
    "敵": {
        "file": "enemies.json",
        "columns": {
            "ID": "id", "敵名": "name", "階級": "tier", "アーキタイプ": "archetype", "HP": "hp", "速度": "speed", "最大MP": "maxMp",
            "行動1": "move1", "行動2": "move2", "危険行動": "dangerMove", "意図表示": "intentDisplay", "CTBギミック": "ctbGimmick",
            "フェーズ変化": "phaseChange", "弱点/攻略": "weaknessStrategy", "ドロップタグ": "dropTags", "実装優先": "implementationPriority",
        },
        "numbers": {"hp", "speed", "maxMp"},
        "arrays": {"dropTags"},
    },
    "シナジー": {
        "file": "synergies.json",
        "columns": {
            "ID": "id", "シナジー": "name", "タグ": "tag", "段階": "stage", "必要数": "requiredCount", "効果": "effect",
            "CTB効果": "ctbEffect", "MP効果": "mpEffect", "ルール変化/完成形": "ruleChange", "対応ビルド": "supportedBuild", "危険度": "risk",
        },
        "numbers": {"stage", "requiredCount"},
    },
    "状態異常": {
        "file": "status-effects.json",
        "columns": {
            "ID": "id", "名称": "name", "種別": "type", "スタック": "stacking", "基本効果": "baseEffect", "CTBへの影響": "ctbEffect",
            "解除条件": "removeCondition", "主な付与元": "mainSources", "ボス耐性方針": "bossResistancePolicy",
        },
        "arrays": {"mainSources"},
    },
    # Phase 5(任意の部位融合)で追加。素材タグA/Bが空の行はワイルドカード(既定の融合結果)。
    "融合": {
        "file": "fusions.json",
        "columns": {
            "ID": "id", "融合名": "name", "アイコン": "icon", "素材タグA": "tagA", "素材タグB": "tagB",
            "カテゴリ": "category", "継承タグ": "tags", "効果": "effect", "説明": "description",
        },
        "arrays": {"tags"},
    },
    "代表ビルド": {
        "file": "representative-builds.json",
        "columns": {
            "ビルド": "name", "核タグ": "coreTags", "主要部位": "keyParts", "主要コマンド": "keyCommands", "勝ち筋": "winCondition",
            "CTBでの遊び": "ctbPlaystyle", "弱点": "weakness", "完成時の壊れ方": "completionPayoff",
        },
        "arrays": {"coreTags", "keyParts", "keyCommands"},
    },
}


def _column_number(cell_ref: str) -> int:
    letters = re.match(r"([A-Z]+)", cell_ref)
    if not letters:
        return 0
    value = 0
    for ch in letters.group(1):
        value = value * 26 + ord(ch) - 64
    return value


def _parse_scalar(value: str):
    value = value.strip()
    if value == "":
        return ""
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?(?:\d+\.\d*|\d*\.\d+)", value):
        return float(value)
    return value


def _split_list(value):
    if value in (None, ""):
        return []
    if not isinstance(value, str):
        return [value]
    return [item.strip() for item in re.split(r"[/／,，、|｜]", value) if item.strip()]


def read_workbook(path: Path) -> dict[str, list[dict[str, object]]]:
    if not path.exists():
        raise FileNotFoundError(f"Workbook not found: {path}")
    if not zipfile.is_zipfile(path):
        raise ValueError(f"Not a valid XLSX/ZIP file: {path}")

    with zipfile.ZipFile(path) as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for item in root.findall("x:si", NS):
                shared_strings.append("".join(t.text or "" for t in item.iter(f"{{{SHEET_NS}}}t")))

        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship")}

        sheet_paths: dict[str, str] = {}
        for sheet in workbook.find("x:sheets", NS):
            rel_id = sheet.attrib[f"{{{REL_NS}}}id"]
            target = rel_targets[rel_id].lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            sheet_paths[sheet.attrib["name"]] = target

        result: dict[str, list[dict[str, object]]] = {}
        for sheet_name, spec in SPECS.items():
            if sheet_name not in sheet_paths:
                raise ValueError(f"Required sheet missing: {sheet_name}")
            root = ET.fromstring(zf.read(sheet_paths[sheet_name]))
            rows: list[list[object]] = []
            for row in root.findall(".//x:sheetData/x:row", NS):
                cells: dict[int, object] = {}
                for cell in row.findall("x:c", NS):
                    col = _column_number(cell.attrib.get("r", ""))
                    cell_type = cell.attrib.get("t")
                    value_node = cell.find("x:v", NS)
                    inline_node = cell.find("x:is", NS)
                    if cell_type == "s" and value_node is not None:
                        value = shared_strings[int(value_node.text or "0")]
                    elif cell_type == "inlineStr" and inline_node is not None:
                        value = "".join(t.text or "" for t in inline_node.iter(f"{{{SHEET_NS}}}t"))
                    elif value_node is not None:
                        value = _parse_scalar(value_node.text or "")
                    else:
                        value = ""
                    cells[col] = value
                if cells:
                    rows.append([cells.get(i, "") for i in range(1, max(cells) + 1)])

            if not rows:
                result[sheet_name] = []
                continue
            headers = [str(v).strip() for v in rows[0]]
            unknown_headers = [h for h in headers if h and h not in spec["columns"]]
            if unknown_headers:
                print(f"warning: {sheet_name}: unmapped columns preserved under _source: {unknown_headers}", file=sys.stderr)

            records: list[dict[str, object]] = []
            for row in rows[1:]:
                source = {headers[i]: row[i] if i < len(row) else "" for i in range(len(headers)) if headers[i]}
                if not any(v not in (None, "") for v in source.values()):
                    continue
                record: dict[str, object] = {}
                for jp_name, en_name in spec["columns"].items():
                    value = source.get(jp_name, "")
                    if en_name in spec.get("numbers", set()) and isinstance(value, str):
                        value = _parse_scalar(value)
                    if en_name in spec.get("arrays", set()):
                        value = _split_list(value)
                    record[en_name] = value
                if "tags_from" in spec:
                    record["tags"] = [record.get(k) for k in spec["tags_from"] if record.get(k)]
                extras = {k: v for k, v in source.items() if k not in spec["columns"] and v not in (None, "")}
                if extras:
                    record["_source"] = extras
                records.append(record)
            result[sheet_name] = records
    return result


def validate(data: dict[str, list[dict[str, object]]]) -> None:
    for sheet_name in ["コマンド", "部位", "敵", "シナジー", "状態異常", "融合"]:
        records = data[sheet_name]
        ids = [str(r.get("id", "")).strip() for r in records]
        if any(not x for x in ids):
            raise ValueError(f"{sheet_name}: blank ID found")
        duplicates = sorted({x for x in ids if ids.count(x) > 1})
        if duplicates:
            raise ValueError(f"{sheet_name}: duplicate IDs: {duplicates}")


def build_payloads(workbook: Path) -> dict[str, str]:
    data = read_workbook(workbook)
    validate(data)
    payloads: dict[str, str] = {}
    counts = {}
    for sheet_name, spec in SPECS.items():
        records = data[sheet_name]
        counts[sheet_name] = len(records)
        payloads[spec["file"]] = json.dumps(records, ensure_ascii=False, indent=2) + "\n"
    manifest = {
        "source": str(workbook.relative_to(ROOT)).replace("\\", "/") if workbook.is_relative_to(ROOT) else str(workbook),
        "sourceSha256": hashlib.sha256(workbook.read_bytes()).hexdigest(),
        "counts": counts,
        "files": {sheet: spec["file"] for sheet, spec in SPECS.items()},
    }
    payloads["manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    return payloads


def main() -> int:
    parser = argparse.ArgumentParser(description="Import CHIMERA BATTLE CTB Excel master into deterministic JSON files.")
    parser.add_argument("--workbook", type=Path, default=DEFAULT_WORKBOOK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="Fail if generated JSON is missing or stale; do not write files.")
    args = parser.parse_args()

    workbook = args.workbook if args.workbook.is_absolute() else (ROOT / args.workbook)
    output = args.output if args.output.is_absolute() else (ROOT / args.output)
    payloads = build_payloads(workbook)

    stale = []
    for filename, content in payloads.items():
        path = output / filename
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            stale.append(filename)

    if args.check:
        if stale:
            print("Generated master data is stale: " + ", ".join(stale), file=sys.stderr)
            return 1
        print("CTB master data is up to date.")
        return 0

    output.mkdir(parents=True, exist_ok=True)
    for filename, content in payloads.items():
        (output / filename).write_text(content, encoding="utf-8", newline="\n")
    print("Imported CTB master Excel:")
    for sheet_name, spec in SPECS.items():
        print(f"  {sheet_name}: {len(json.loads(payloads[spec['file']]))}")
    print(f"Output: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
