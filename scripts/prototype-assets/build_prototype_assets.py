#!/usr/bin/env python3
"""
プロトタイプ専用: 7スロット・キメラ画像合成システムの検証用アセットを組み立てるワンショット
スクリプト。

これは本番の `scripts/import_ctb_master.py`(Excel → src/data/generated/*.json)とは
完全に独立している。Excel自体・generated JSON(parts.json/enemies.json)は一切書き換えず、
読み込み専用の参照元として使うだけ。

入力:
  - 今回チャットでアップロードされた3枚のリファレンス画像(部位シート/敵シート/コア・エフェクトシート)。
    これらはセッション固有の一時アップロードであり、リポジトリには含まれない。そのため
    このスクリプトはそのままでは再実行できない(SRC_* のパスがセッションローカル)。
    再実行が必要な場合はSRC_*を実ファイルパスへ書き換えること。
  - src/data/generated/parts.json, enemies.json (読み取り専用)

出力:
  - public/assets/prototype-chimera/parts/<category>/<PRTxxx>.png
  - public/assets/prototype-chimera/enemies/<ENMxxx>.png
  - src/prototype/chimera/generated-visuals.json (visual manifest: anchor/scale/zIndex等)
"""
import json
import os
import shutil
import sys
from PIL import Image
import numpy as np
from scipy import ndimage

REPO = '/home/user/chimera-battle-ctb'
SRC_PARTS_SHEET = '/root/.claude/uploads/28dd634a-b8d6-5d9a-948c-93375bd1e349/d860325c-image.png'
SRC_ENEMY_SHEET = '/root/.claude/uploads/28dd634a-b8d6-5d9a-948c-93375bd1e349/0ce51773-image.png'

SCRATCH = '/tmp/claude-0/-home-user-chimera-battle-ctb/28dd634a-b8d6-5d9a-948c-93375bd1e349/scratchpad'
CROP_PARTS_DIR = f'{SCRATCH}/extract_final'
CROP_ENEMY_DIR = f'{SCRATCH}/extract_enemies_final'

OUT_PARTS_DIR = f'{REPO}/public/assets/prototype-chimera/parts'
OUT_ENEMY_DIR = f'{REPO}/public/assets/prototype-chimera/enemies'
OUT_MANIFEST = f'{REPO}/src/prototype/chimera/generated-visuals.json'

CANVAS_SIZE = 256

# ------------------------------------------------------------------
# Excel「部位」シートの12カテゴリ → プロトタイプ7スロットの対応表(仕様書19章)。
# 頭/目/口→head、腕→front、脚→leg、翼→wing、尻尾→tail、胴→body、
# 心臓/器官/コア→core。角は頭部寄りとしてheadへ寄せる(判断が曖昧なため明記)。
# ------------------------------------------------------------------
EXCEL_CATEGORY_TO_SLOT = {
    '頭': 'head',
    '目': 'head',
    '口': 'head',
    '角': 'head',
    '腕': 'front',
    '脚': 'leg',
    '翼': 'wing',
    '尻尾': 'tail',
    '胴': 'body',
    '心臓': 'core',
    '器官': 'core',
    'コア': 'core',
}

SLOT_CATEGORIES = ['head', 'body', 'front', 'leg', 'wing', 'tail', 'core']

# カテゴリごとの接続基準点(256x256キャンバス)。
# 素材(頭・胴・前脚等)は検証の結果すべて「右向き」で描かれていることを確認できたため
# (敵シートは逆に左向きで統一されている)、プレイヤー側は反転なしでそのまま使う。
CATEGORY_ANCHORS = {
    'body': {'x': 130, 'y': 150},
    'head': {'x': 150, 'y': 95},
    'front': {'x': 158, 'y': 178},
    'leg': {'x': 104, 'y': 184},
    'tail': {'x': 78, 'y': 150},
    'wing': {'x': 108, 'y': 108},
    'core': {'x': 140, 'y': 156},
}

# 各カテゴリ画像内でのピボット位置(画像自身のbboxに対する0..1の割合)。
# 「その部位のどの点をCATEGORY_ANCHORSへ合わせるか」。前脚/後脚/羽は素材上、
# 関節(接続部)がbboxの右上寄りに描かれている(検証時に目視確認済み)。
CATEGORY_PIVOT_FRACTION = {
    'head': (0.4, 0.88),
    'body': (0.5, 0.32),
    'front': (0.75, 0.15),
    'leg': (0.75, 0.15),
    'tail': (0.55, 0.15),
    'wing': (0.75, 0.15),
    'core': (0.5, 0.5),
}

CATEGORY_TARGET_HEIGHT_PX = {
    'head': 92,
    'body': 122,
    'front': 82,
    'leg': 82,
    'tail': 88,
    'wing': 100,
    'core': 54,
}

CATEGORY_Z_INDEX = {
    'tail': 5,
    'leg': 8,
    'body': 10,
    'wing': 15,
    'front': 20,
    'core': 25,
    'head': 30,
}


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def trim_body_head_crops():
    """
    リファレンスシートの「BODY」行は、実際には頭・胴・前脚まで揃った完成済みの
    小型モンスター1体分の絵になっている(頭部だけを切り出した「head」行とは違う)。
    そのままbodyカテゴリとして使うと、別途選んだ頭部レイヤーと二重に頭が生えて見えるため、
    各画像の上部(頭が乗っている領域)をアルファ密度の局所的な谷(=首のくびれ)で検出して
    トリミングし、胴体+脚のシルエットに近づける。
    冪等ではない(既にトリミング済みの画像へ再実行するとさらに切り詰めてしまう)ため、
    抽出直後(extract_parts2.py 直後)に一度だけ呼ぶ想定。
    """
    body_dir = CROP_PARTS_DIR
    files = sorted(f for f in os.listdir(body_dir) if f.startswith('body_'))
    for fname in files:
        path = os.path.join(body_dir, fname)
        with Image.open(path).convert('RGBA') as im:
            alpha = np.array(im)[:, :, 3]
            h = alpha.shape[0]
            row_coverage = (alpha > 40).sum(axis=1)
            search_start, search_end = int(h * 0.22), int(h * 0.62)
            seg = row_coverage[search_start:search_end]
            cut = search_start + int(np.argmin(seg)) if len(seg) else int(h * 0.35)
            cropped = im.crop((0, cut, im.width, im.height))
            cropped.save(path)


def build_parts():
    parts = load_json(f'{REPO}/src/data/generated/parts.json')
    pool_manifest = load_json(f'{CROP_PARTS_DIR}/parts_manifest.json')

    # PRT id → 割り当てるスロットカテゴリ を決定し、スロットごとにID順で並べてから
    # プールの画像を周回(cyclic)で割り当てる。同じ画像が複数PRT idに再利用されうる
    # (プロトタイプ段階では1カテゴリにつき9〜12枚の実素材しか無いため)。
    by_slot = {c: [] for c in SLOT_CATEGORIES}
    for p in parts:
        slot = EXCEL_CATEGORY_TO_SLOT[p['category']]
        by_slot[slot].append(p)

    os.makedirs(OUT_PARTS_DIR, exist_ok=True)
    visuals = []
    assignment_log = []
    for slot in SLOT_CATEGORIES:
        ids_sorted = sorted(by_slot[slot], key=lambda p: p['id'])
        pool = pool_manifest[slot]
        pivot_fx, pivot_fy = CATEGORY_PIVOT_FRACTION[slot]
        target_h = CATEGORY_TARGET_HEIGHT_PX[slot]
        anchor = CATEGORY_ANCHORS[slot]
        z = CATEGORY_Z_INDEX[slot]

        out_dir = os.path.join(OUT_PARTS_DIR, slot)
        os.makedirs(out_dir, exist_ok=True)

        for i, p in enumerate(ids_sorted):
            src_entry = pool[i % len(pool)]
            src_path = os.path.join(CROP_PARTS_DIR, src_entry['file'])
            dst_name = f"{p['id']}.png"
            dst_path = os.path.join(out_dir, dst_name)
            shutil.copyfile(src_path, dst_path)

            # 保存済みマニフェストの値ではなく、実際にコピーしたファイルの現在の寸法を使う
            # (bodyカテゴリはtrim_body_head_crops()で頭部分をトリミング済みのため寸法が変わっている)。
            with Image.open(dst_path) as im:
                w, h = im.size
            scale = round(target_h / h, 4)
            visuals.append({
                'id': p['id'],
                'name': p['name'],
                'category': slot,
                'excelCategory': p['category'],
                'image': f'assets/prototype-chimera/parts/{slot}/{dst_name}',
                'anchorX': pivot_fx,
                'anchorY': pivot_fy,
                'scale': scale,
                'zIndex': z,
                'width': w,
                'height': h,
            })
            assignment_log.append({'id': p['id'], 'slot': slot, 'sourceCrop': src_entry['file']})

    return visuals, assignment_log


TIER_TO_JP = {'通常': 'normal', 'エリート': 'elite', 'ボス': 'boss'}


def build_enemies():
    enemies = load_json(f'{REPO}/src/data/generated/enemies.json')
    pool = load_json(f'{CROP_ENEMY_DIR}/enemies_manifest.json')
    # 抽出順: 1-40が[N]通常タグ, 41-47が[EL]エリートタグ, 48-51が[BOSS]タグ(シート上の見た目タグに基づく)。
    tier_pools = {
        '通常': pool[0:40],
        'エリート': pool[40:47],
        'ボス': pool[47:51],
    }

    os.makedirs(OUT_ENEMY_DIR, exist_ok=True)
    visuals = []
    counters = {'通常': 0, 'エリート': 0, 'ボス': 0}
    for e in enemies:
        tier = e['tier']
        tp = tier_pools[tier]
        src_entry = tp[counters[tier] % len(tp)]
        counters[tier] += 1
        src_path = os.path.join(CROP_ENEMY_DIR, src_entry['file'])
        dst_name = f"{e['id']}.png"
        dst_path = os.path.join(OUT_ENEMY_DIR, dst_name)
        shutil.copyfile(src_path, dst_path)
        visuals.append({
            'id': e['id'],
            'name': e['name'],
            'tier': TIER_TO_JP[tier],
            'image': f'assets/prototype-chimera/enemies/{dst_name}',
            'width': src_entry['w'],
            'height': src_entry['h'],
        })
    return visuals


def main():
    # 注: このセッションのCROP_PARTS_DIRは、extract_parts2.py実行直後にtrim_body_head_crops()を
    # 適用済みの状態(bodyの頭部分はトリミング済み)。再実行時にextract_parts2.pyから
    # やり直す場合は、build_parts()の前に trim_body_head_crops() を1回だけ呼ぶこと。
    parts_visuals, assignment_log = build_parts()
    enemy_visuals = build_enemies()

    manifest = {
        'canvasSize': CANVAS_SIZE,
        'categoryAnchors': CATEGORY_ANCHORS,
        'parts': parts_visuals,
        'enemies': enemy_visuals,
    }
    os.makedirs(os.path.dirname(OUT_MANIFEST), exist_ok=True)
    with open(OUT_MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f'parts visuals: {len(parts_visuals)}', file=sys.stderr)
    print(f'enemy visuals: {len(enemy_visuals)}', file=sys.stderr)
    print('done.', file=sys.stderr)


if __name__ == '__main__':
    main()
