// ============================================================
// プロトタイプ専用: Excel「部位」シートの12カテゴリ(頭/目/口/腕/脚/心臓/胴/尻尾/翼/角/器官/コア)
// → 今回検証する7スロット(head/body/front/leg/wing/tail/core)への割り当て表。
//
// 仕様書19章: 「ゲームデータそのものは変更せず、このプロトタイプ用のvisual slot mappingで
// 7カテゴリへ割り当ててください」「判断が曖昧なものについては、コード内にmapping tableを
// 作ってください」への対応。src/data/types.ts の PartType は一切変更していない。
//
// 判断が曖昧だったもの:
//   - 目・口・角 → head へ寄せた(顔まわりのパーツとして頭部に統合)。
//   - 心臓・器官・コア → すべて core へ寄せた(いずれも「内部器官/核」系のため)。
// このスクリプト(build_prototype_assets.py)が画像割り当て時に実際に使っているテーブルと
// 同じ内容を、UI表示・ドキュメント目的でTS側にも複製している。
// ============================================================
import type { ChimeraSlotCategory } from './types';

export const EXCEL_CATEGORY_TO_SLOT: Record<string, ChimeraSlotCategory> = {
  頭: 'head',
  目: 'head',
  口: 'head',
  角: 'head',
  腕: 'front',
  脚: 'leg',
  翼: 'wing',
  尻尾: 'tail',
  胴: 'body',
  心臓: 'core',
  器官: 'core',
  コア: 'core',
};

export const SLOT_TO_EXCEL_CATEGORIES: Record<ChimeraSlotCategory, string[]> = {
  head: ['頭', '目', '口', '角'],
  body: ['胴'],
  front: ['腕'],
  leg: ['脚'],
  wing: ['翼'],
  tail: ['尻尾'],
  core: ['心臓', '器官', 'コア'],
};
