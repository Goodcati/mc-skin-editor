/**
 * 生成内置示例皮肤（**自绘**，非官方素材）。
 *
 * 为什么留这个脚本：`public/skins/` 里原本放的是 Mojang 官方贴图（steve / alex），
 * 开源发布不能带官方素材，所以换成自绘图。自绘图是二进制、肉眼没法审计，
 * 留一份生成脚本，任何人都能重跑、改配色、复现这两张图，也能证明它是自绘的。
 *
 * 运行：npx tsx scripts/make-sample-skins.mts
 * 产物：
 *   public/skins/sample-wide.png  （宽型 / 经典，手臂 4 像素宽）
 *   public/skins/sample-slim.png  （纤细，手臂 3 像素宽）
 *
 * 画法要点：
 *   - 面矩形直接复用 `src/lib/skinFaces.ts` 的 `getFaceRect` —— 生成器和渲染器
 *     共用同一份布局定义，日后改布局不会两边对不上。
 *   - 第一层（base）六个部件的**所有面都填满不透明像素**，保证「第一层无空洞」
 *     （`verify:export` 的 countBaseHoles 自检为 0）。
 *   - 第二层（overlay）只画头部刘海（前额两行 + 整个头顶），颜色比第一层头发略亮，
 *     用来演示双层结构；其余 overlay 区域保持透明。
 *   - alpha 只有 0 / 255，且 alpha=0 处 RGB 也是 0（导出规格要求）。
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'

import { SKIN_SIZE } from '../src/constants'
import { getFaceRect } from '../src/lib/skinFaces'
import type { FaceId, FaceRect } from '../src/lib/skinFaces'
import type { BodyKey } from '../src/lib/skinParts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'skins')

type RGB = readonly [number, number, number]

interface Palette {
  skin: RGB
  skinDark: RGB
  hair: RGB
  hairHi: RGB
  eyeWhite: RGB
  eyePupil: RGB
  shirt: RGB
  shirtDark: RGB
  pants: RGB
  shoe: RGB
}

// ---- 配色（自选，与官方素材无关）----

/** 示例·宽型：暖肤色 + 深棕短发 + 蓝衬衫 */
const WIDE: Palette = {
  skin: [224, 172, 105],
  skinDark: [186, 138, 80],
  hair: [74, 55, 40],
  hairHi: [104, 80, 58],
  eyeWhite: [240, 240, 240],
  eyePupil: [40, 40, 52],
  shirt: [47, 111, 191],
  shirtDark: [33, 84, 150],
  pants: [63, 71, 86],
  shoe: [40, 44, 54],
}

/** 示例·纤细：浅肤色 + 赤褐长发 + 珊瑚色上衣 */
const SLIM: Palette = {
  skin: [240, 200, 160],
  skinDark: [208, 168, 128],
  hair: [139, 74, 43],
  hairHi: [176, 101, 60],
  eyeWhite: [245, 245, 245],
  eyePupil: [56, 92, 72],
  shirt: [224, 122, 95],
  shirtDark: [176, 90, 68],
  pants: [92, 107, 138],
  shoe: [52, 54, 66],
}

// ---- 画布 ----

interface Canvas {
  px: Uint8Array
  /** 单像素写入（越界静默忽略），alpha 一律 255 */
  set(x: number, y: number, c: RGB): void
  /** 整块填充 */
  fill(r: FaceRect, c: RGB): void
  /** 从面矩形顶部起，按「占几行」依次铺色（bands 行数之和应等于 r.h） */
  bands(part: BodyKey, face: FaceId, layer: 'base' | 'overlay', slim: boolean, list: { rows: number; color: RGB }[]): void
  /** 按字模逐像素贴图（面内坐标，宽高须与 f 的面矩形一致） */
  art(part: BodyKey, face: FaceId, layer: 'base' | 'overlay', slim: boolean, f: FaceRect, rows: string[], map: Record<string, RGB>): void
}

function createCanvas(): Canvas {
  const px = new Uint8Array(SKIN_SIZE * SKIN_SIZE * 4)

  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= SKIN_SIZE || y >= SKIN_SIZE) return
    const o = (y * SKIN_SIZE + x) * 4
    px[o] = c[0]
    px[o + 1] = c[1]
    px[o + 2] = c[2]
    px[o + 3] = 255
  }

  const fill = (f: FaceRect, c: RGB) => {
    for (let y = f.y; y < f.y + f.h; y += 1) {
      for (let x = f.x; x < f.x + f.w; x += 1) set(x, y, c)
    }
  }

  const bands = (
    part: BodyKey,
    face: FaceId,
    layer: 'base' | 'overlay',
    slim: boolean,
    list: { rows: number; color: RGB }[],
  ) => {
    const f = getFaceRect(part, face, layer, slim)
    let y = f.y
    for (const b of list) {
      fill({ x: f.x, y, w: f.w, h: b.rows }, b.color)
      y += b.rows
    }
  }

  const art = (
    part: BodyKey,
    face: FaceId,
    layer: 'base' | 'overlay',
    slim: boolean,
    f: FaceRect,
    rows: string[],
    map: Record<string, RGB>,
  ) => {
    const r = getFaceRect(part, face, layer, slim)
    if (r.w !== f.w || r.h !== f.h) {
      throw new Error(`${part}/${face}/${layer} 面矩形 ${r.w}×${r.h} 与字模 ${f.w}×${f.h} 不一致`)
    }
    if (rows.length !== r.h) {
      throw new Error(`${part}/${face}/${layer} 字模 ${rows.length} 行，面矩形需要 ${r.h} 行`)
    }
    for (let row = 0; row < r.h; row += 1) {
      const line = rows[row] ?? ''
      for (let col = 0; col < r.w; col += 1) {
        const ch = line[col]
        if (!ch || ch === '.') continue // '.' = 保留底色
        const c = map[ch]
        if (!c) throw new Error(`字模出现未定义字符 "${ch}"`)
        set(r.x + col, r.y + row, c)
      }
    }
  }

  return { px, set, fill, bands, art }
}

// ---- 字模 ----

/**
 * 头部正面 8×8：两行刘海 + 双眼 + 嘴。
 * '.' 表示保留底色（肤色）。1 = 眼白，2 = 瞳孔，3 = 唇色。
 */
const HEAD_FRONT_ART = [
  'hhhhhhhh',
  'hh....hh',
  '........',
  '.12..21.',
  '........',
  '...33...',
  '........',
  '........',
]

/** 躯干正面 8×12：中间一条竖门襟，下摆两行深色当腰带 */
const BODY_FRONT_ART = [
  '........',
  '........',
  '........',
  '...dd...',
  '...dd...',
  '...dd...',
  '...dd...',
  '...dd...',
  '...dd...',
  '........',
  'bbbbbbbb',
  'bbbbbbbb',
]

// ---- 造图 ----

function buildSkin(p: Palette, slim: boolean): Uint8Array {
  const cv = createCanvas()

  // ---- 头部（base）：四面头发、正面画脸 ----
  cv.fill(getFaceRect('head', 'top', 'base', slim), p.hair)
  cv.fill(getFaceRect('head', 'bottom', 'base', slim), p.hair)
  cv.fill(getFaceRect('head', 'back', 'base', slim), p.hair)
  cv.fill(getFaceRect('head', 'left', 'base', slim), p.hair)
  cv.fill(getFaceRect('head', 'right', 'base', slim), p.hair)
  cv.fill(getFaceRect('head', 'front', 'base', slim), p.skin)
  cv.art('head', 'front', 'base', slim, getFaceRect('head', 'front', 'base', slim), HEAD_FRONT_ART, {
    h: p.hair,
    1: p.eyeWhite,
    2: p.eyePupil,
    3: p.skinDark,
  })

  // 头部（overlay）：只做一条刘海（前额两行 + 整个头顶），比 base 头发略亮
  const headOvTop = getFaceRect('head', 'top', 'overlay', slim)
  cv.fill(headOvTop, p.hairHi)
  const headOvFront = getFaceRect('head', 'front', 'overlay', slim)
  cv.fill({ x: headOvFront.x, y: headOvFront.y, w: headOvFront.w, h: 2 }, p.hairHi)

  // ---- 躯干（base）：上衣，正面加门襟与下摆腰带 ----
  cv.fill(getFaceRect('body', 'top', 'base', slim), p.shirt)
  cv.fill(getFaceRect('body', 'back', 'base', slim), p.shirt)
  cv.fill(getFaceRect('body', 'left', 'base', slim), p.shirt)
  cv.fill(getFaceRect('body', 'right', 'base', slim), p.shirt)
  cv.fill(getFaceRect('body', 'bottom', 'base', slim), p.shirtDark)
  cv.fill(getFaceRect('body', 'front', 'base', slim), p.shirt)
  cv.art('body', 'front', 'base', slim, getFaceRect('body', 'front', 'base', slim), BODY_FRONT_ART, {
    d: p.shirtDark,
    b: p.shirtDark,
  })

  // ---- 四肢（base）：上段袖子/裤子，下段露肤/鞋 ----
  const arms: BodyKey[] = ['rightArm', 'leftArm']
  for (const arm of arms) {
    for (const face of ['front', 'back', 'left', 'right'] as FaceId[]) {
      cv.bands(arm, face, 'base', slim, [
        { rows: 6, color: p.shirt },
        { rows: 6, color: p.skin },
      ])
    }
    cv.fill(getFaceRect(arm, 'top', 'base', slim), p.shirt)
    cv.fill(getFaceRect(arm, 'bottom', 'base', slim), p.skin)
  }

  const legs: BodyKey[] = ['rightLeg', 'leftLeg']
  for (const leg of legs) {
    for (const face of ['front', 'back', 'left', 'right'] as FaceId[]) {
      cv.bands(leg, face, 'base', slim, [
        { rows: 9, color: p.pants },
        { rows: 3, color: p.shoe },
      ])
    }
    cv.fill(getFaceRect(leg, 'top', 'base', slim), p.pants)
    cv.fill(getFaceRect(leg, 'bottom', 'base', slim), p.shoe)
  }

  return cv.px
}

// ---- 落盘 ----

function save(fileName: string, px: Uint8Array) {
  const png = new PNG({ width: SKIN_SIZE, height: SKIN_SIZE, colorType: 6 })
  Buffer.from(px).copy(png.data)
  const path = join(OUT_DIR, fileName)
  writeFileSync(path, PNG.sync.write(png))
  const opaque = px.filter((_, i) => i % 4 === 3 && px[i] === 255).length
  console.log(`  ${fileName}  64×64  ${png.data.length} 字节 RGBA，不透明像素 ${opaque}`)
}

console.log('\n生成自绘示例皮肤：')
save('sample-wide.png', buildSkin(WIDE, false))
save('sample-slim.png', buildSkin(SLIM, true))
console.log(`\n输出目录：${OUT_DIR}\n`)
