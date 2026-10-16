/**
 * 等距头部渲染验证脚本（可重复运行，无浏览器依赖）。
 *
 * 验证 renderHeadIsometric 纯函数的验收点：
 *   a. 输出尺寸正确、无异常
 *   b. 三个面（顶 / 前 / 侧）区域都非空（各自都有不透明像素）
 *   c. 明暗关系成立：侧面平均亮度 < 前面平均亮度
 *   d. 全透明皮肤 → 输出全透明且不崩
 *   e. 帽层有内容的用例 → 帽层像素确实出现在预期区域
 *   f. 形状：三面等面积 / 轮廓无缺口 / 正面不压扁（抓几何 bug）
 *   g. 镜像：右半 quad 用角色左侧面(+X)贴图（左面黄出现、右面绿为 0）
 *
 * 运行：npm run verify:head   （或 npx tsx scripts/verify-head.mts）
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'

import { renderHeadIsometric, HEAD_QUADS } from '../src/lib/headIso'
import { getFaceRect } from '../src/lib/skinFaces'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKINS_DIR = join(__dirname, '..', 'public', 'skins')

// ---- 结果记录 ----
interface Check {
  id: string
  pass: boolean
  detail: string
}
const checks: Check[] = []
function record(id: string, pass: boolean, detail: string) {
  checks.push({ id, pass, detail })
}

// ---- 工具 ----

function loadPng(path: string): Uint8ClampedArray {
  const png = PNG.sync.read(readFileSync(path))
  if (png.width !== 64 || png.height !== 64) {
    throw new Error(`${path} 不是 64×64，而是 ${png.width}×${png.height}`)
  }
  return new Uint8ClampedArray(png.data)
}

/** 输出 buffer 里某个屏幕矩形区域的不透明像素数 */
function opaqueCount(buf: Uint8ClampedArray, size: number, box: { x: number; y: number; w: number; h: number }): number {
  let n = 0
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const o = (y * size + x) * 4
      if (buf[o + 3] > 0) n += 1
    }
  }
  return n
}

/** 输出 buffer 里某个屏幕矩形区域的平均亮度（只算 alpha>0 的像素） */
function avgBrightness(buf: Uint8ClampedArray, size: number, box: { x: number; y: number; w: number; h: number }): number {
  let sum = 0
  let n = 0
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const o = (y * size + x) * 4
      if (buf[o + 3] > 0) {
        sum += (buf[o] + buf[o + 1] + buf[o + 2]) / 3
        n += 1
      }
    }
  }
  return n === 0 ? 0 : sum / n
}

/** 输出 buffer 里完全不透明像素总数 */
function totalOpaque(buf: Uint8ClampedArray): number {
  let n = 0
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] > 0) n += 1
  }
  return n
}

/**
 * 三个面的屏幕区域（逻辑坐标，单位 = 头部屏幕坐标 ∈ [-8,8]，中心原点）。
 * 与 headIso.ts 的 HEAD_QUADS 一致，这里只用于「验证落在哪个面」的采样窗口。
 *
 * 逻辑坐标 → 输出像素：out_px = (sx + LOGIC_OFFSET) * (size/LOGIC_SIZE)。
 * 这里为测试简便，直接给「输出像素」的包围盒（size=128 时）。
 */
function faceBoxes(size: number): { top: { x: number; y: number; w: number; h: number }; front: { x: number; y: number; w: number; h: number }; right: { x: number; y: number; w: number; h: number } } {
  // LOGIC_SIZE=18, LOGIC_OFFSET=9, scale=size/18
  const scale = size / 18
  const toPx = (v: number) => Math.round((v + 9) * scale)

  // 顶面菱形 bounding：x∈[-8,8], y∈[-8,0]
  // 前面平行四边形 bounding：x∈[-8,0], y∈[-4,8]（正面高 8 格，不是半高）
  // 右面平行四边形 bounding：x∈[0,8], y∈[-4,8]
  return {
    top: { x: toPx(-8), y: toPx(-8), w: toPx(8) - toPx(-8), h: toPx(0) - toPx(-8) },
    front: { x: toPx(-8), y: toPx(-4), w: toPx(0) - toPx(-8), h: toPx(8) - toPx(-4) },
    right: { x: toPx(0), y: toPx(-4), w: toPx(8) - toPx(0), h: toPx(8) - toPx(-4) },
  }
}

// ---- 样本 ----

const wideSkin = loadPng(join(SKINS_DIR, 'sample-wide.png'))
const slimSkin = loadPng(join(SKINS_DIR, 'sample-slim.png'))

const SIZE = 128

// ---- 验收 a：尺寸 + 无异常 ----

function verifyBasic(id: string, pixels: Uint8ClampedArray) {
  let out: Uint8ClampedArray | null = null
  let threw = false
  let msg = ''
  try {
    out = renderHeadIsometric(pixels, SIZE)
  } catch (err) {
    threw = true
    msg = (err as Error).message
  }
  record(`${id}·无异常`, !threw, threw ? `抛异常 ${msg}` : '正常返回')
  record(`${id}·输出尺寸`, out !== null && out.length === SIZE * SIZE * 4, `字节数 ${out?.length}（应为 ${SIZE * SIZE * 4}）`)
  return out
}

// ---- 验收 b：三面都非空 ----

function verifyFacesNonEmpty(id: string, out: Uint8ClampedArray) {
  const boxes = faceBoxes(SIZE)
  const top = opaqueCount(out, SIZE, boxes.top)
  const front = opaqueCount(out, SIZE, boxes.front)
  const right = opaqueCount(out, SIZE, boxes.right)
  record(`${id}·顶面非空`, top > 0, `不透明像素 ${top}`)
  record(`${id}·正面非空`, front > 0, `不透明像素 ${front}`)
  record(`${id}·右面非空`, right > 0, `不透明像素 ${right}`)
}

// ---- 验收 c：明暗关系（右面 < 前面） ----

function verifyShading(id: string, out: Uint8ClampedArray) {
  const boxes = faceBoxes(SIZE)
  const front = avgBrightness(out, SIZE, boxes.front)
  const right = avgBrightness(out, SIZE, boxes.right)
  record(`${id}·右面暗于前面`, right < front, `右 ${right.toFixed(1)} < 前 ${front.toFixed(1)}`)
}

// ---- 验收 d：全透明不崩 + 全透明 ----

function verifyTransparent(id: string) {
  const empty = new Uint8ClampedArray(64 * 64 * 4)
  const out = verifyBasic(id, empty)
  if (out) {
    record(`${id}·全透明输出`, totalOpaque(out) === 0, `不透明像素 ${totalOpaque(out)}`)
  }
}

// ---- 验收 e：帽层像素出现在预期区域 ----

/**
 * 构造一个「帽层有内容、第一层也有内容」的用例：
 * base 头部前面涂绿色，overlay（帽层）头部前面涂红色。
 * 渲染后，前面区域应同时出现红色（帽层）和绿色（base，未被帽层完全覆盖的边角），
 * 且红色像素集中在帽层外扩后的边缘 / 覆盖区。
 */
function verifyOverlay() {
  const pixels = new Uint8ClampedArray(64 * 64 * 4)

  // base head front：涂绿
  const baseFront = getFaceRect('head', 'front', 'base', false)
  for (let y = baseFront.y; y < baseFront.y + baseFront.h; y += 1) {
    for (let x = baseFront.x; x < baseFront.x + baseFront.w; x += 1) {
      const o = (y * 64 + x) * 4
      pixels[o] = 0
      pixels[o + 1] = 255
      pixels[o + 2] = 0
      pixels[o + 3] = 255
    }
  }
  // overlay head front：涂红（帽层）
  const ovFront = getFaceRect('head', 'front', 'overlay', false)
  for (let y = ovFront.y; y < ovFront.y + ovFront.h; y += 1) {
    for (let x = ovFront.x; x < ovFront.x + ovFront.w; x += 1) {
      const o = (y * 64 + x) * 4
      pixels[o] = 255
      pixels[o + 1] = 0
      pixels[o + 2] = 0
      pixels[o + 3] = 255
    }
  }

  const out = verifyBasic('帽层用例', pixels)
  if (!out) return

  // 前面区域里，红色像素和绿色像素都应有
  const boxes = faceBoxes(SIZE)
  const f = boxes.front
  let red = 0
  let green = 0
  for (let y = f.y; y < f.y + f.h; y += 1) {
    for (let x = f.x; x < f.x + f.w; x += 1) {
      const o = (y * SIZE + x) * 4
      if (out[o + 3] === 0) continue
      const r = out[o]
      const g = out[o + 1]
      const b = out[o + 2]
      if (r > 200 && g < 60 && b < 60) red += 1
      else if (g > 200 && r < 60 && b < 60) green += 1
    }
  }
  // 帽层（红）应覆盖在 base（绿）之上：红色像素应占主导（帽层几乎盖满前面）
  record('帽层用例·帽层出现', red > 0, `红色（帽层）像素 ${red}`)
  record('帽层用例·覆盖关系', red >= green, `红 ${red} ≥ 绿 ${green}（帽层盖在 base 上）`)
}

// ---- 形状约束 1：三面等面积 ----

/** 平行四边形（顶点 [A,B,C,D]，A=左上 B=右上 D=左下）的有向面积 |e1 × e2| */
function quadArea(quad: [Vec2, Vec2, Vec2, Vec2]): number {
  const [a, b, , d] = quad
  const e1x = b.x - a.x
  const e1y = b.y - a.y
  const e2x = d.x - a.x
  const e2y = d.y - a.y
  return Math.abs(e1x * e2y - e1y * e2x)
}

type Vec2 = { x: number; y: number }

function verifyEqualAreas() {
  const areas = HEAD_QUADS.map((fq) => ({ face: fq.face, area: quadArea(fq.quad) }))
  const [t, f, r] = areas
  const allEqual = t.area === f.area && f.area === r.area
  record(
    '形状·三面等面积',
    allEqual,
    `顶 ${t.area} / 前 ${f.area} / 右 ${r.area}（三者应相等）`,
  )
  // 绝对值断言：三面各 8×8=64。防「三个面一起被压扁」时等面积仍通过
  const EXPECT = 64
  const absOk = t.area === EXPECT && f.area === EXPECT && r.area === EXPECT
  record(
    '形状·三面面积绝对值=64',
    absOk,
    `顶 ${t.area} / 前 ${f.area} / 右 ${r.area}（各应为 ${EXPECT}）`,
  )
}

// ---- 形状约束 2：轮廓无缺口（下半部分每个立方体内像素必须不透明） ----

/**
 * 用一张头部 base 全不透明的皮肤，断言：等距立方体轮廓内的每个逻辑像素都是不透明的。
 * 判定「是否在轮廓内」用的是 HEAD_QUADS 的逆映射（与实现同一套几何），
 * 所以如果三面有缺口（某面面积算小），必然有轮廓内像素没被覆盖 → 失败。
 */
function verifyNoGap() {
  // 造一张「头部六个面 base 全部不透明」的皮肤 —— 与「实现采样哪些面」解耦：
  // 涂满六面后，无论实现取 front/left/top 还是别的三面组合，本条都只考察「几何有没有缺口」，
  // 实现改取面时测试不必跟着改（此前涂三面就跟着实现改过一次）。
  const pixels = new Uint8ClampedArray(64 * 64 * 4)
  for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom'] as const) {
    const rect = getFaceRect('head', face, 'base', false)
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const o = (y * 64 + x) * 4
        pixels[o] = 200
        pixels[o + 1] = 200
        pixels[o + 2] = 200
        pixels[o + 3] = 255
      }
    }
  }

  const SIZE_GAP = 64
  const out = renderHeadIsometric(pixels, SIZE_GAP)
  const scale = SIZE_GAP / 18
  const offset = 9

  // 逐逻辑像素检查：中心点落在任意一个面内 → 该像素必须不透明
  let inBoxTotal = 0
  let inBoxOpaque = 0
  const gaps: string[] = []
  for (let ly = 0; ly < 18; ly += 1) {
    for (let lx = 0; lx < 18; lx += 1) {
      // 用逻辑像素的中心（+0.5）判定归属，避免把「只有一半在立方体内」的边界像素算进来
      const sx = lx + 0.5 - offset
      const sy = ly + 0.5 - offset
      // 是否落在任一面的平行四边形内（中心采样）
      const inside = HEAD_QUADS.some((fq) => {
        const [a, b, , d] = fq.quad
        const e1x = b.x - a.x
        const e1y = b.y - a.y
        const e2x = d.x - a.x
        const e2y = d.y - a.y
        const px = sx - a.x
        const py = sy - a.y
        const det = e1x * e2y - e1y * e2x
        if (det === 0) return false
        const u = (px * e2y - py * e2x) / det
        const v = (e1x * py - e1y * px) / det
        return u >= 0 && u <= 1 && v >= 0 && v <= 1
      })
      if (!inside) continue
      inBoxTotal += 1
      // 输出像素 = 逻辑像素 × scale；采样该逻辑像素对应的输出像素（中心）
      const ox = Math.min(SIZE_GAP - 1, Math.round((lx + 0.5) * scale))
      const oy = Math.min(SIZE_GAP - 1, Math.round((ly + 0.5) * scale))
      const o = (oy * SIZE_GAP + ox) * 4
      if (out[o + 3] > 0) inBoxOpaque += 1
      else if (gaps.length < 5) gaps.push(`(${sx.toFixed(1)},${sy.toFixed(1)})`)
    }
  }
  const noGap = inBoxTotal > 0 && inBoxOpaque === inBoxTotal
  record(
    '形状·轮廓无缺口',
    noGap,
    `轮廓内 ${inBoxOpaque}/${inBoxTotal} 像素不透明${gaps.length ? `，缺口示例 ${gaps.join(' ')}` : ''}`,
  )
}

// ---- 形状约束 3：正面不再压扁（8 行纹理 → 8 格屏幕高度） ----

/**
 * 沿正面中心竖线（x 固定在前面对称轴、y 从正面顶到底）数不透明像素行数，
 * 应约等于 8×scale（正面 8 格高）。若正面被压成半高，只会数到 4×scale。
 */
function verifyFrontNotSquashed() {
  const pixels = new Uint8ClampedArray(64 * 64 * 4)
  const rect = getFaceRect('head', 'front', 'base', false)
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const o = (y * 64 + x) * 4
      pixels[o] = 200
      pixels[o + 1] = 200
      pixels[o + 2] = 200
      pixels[o + 3] = 255
    }
  }

  const SIZE_F = 256
  const out = renderHeadIsometric(pixels, SIZE_F)
  const scale = SIZE_F / 18

  // 正面中心竖线：正面 quad 的 u 方向中点，x 取前面中心（u=0.5 处）
  // 前面 quad [A(-8,-4), B(0,0), C(0,8), D(-8,4)]，中心竖线沿 v 方向、u=0.5
  // u=0.5 时 x = A.x + 0.5*(B.x-A.x) = -8 + 0.5*8 = -4
  const cx = -4
  // 沿这条竖线数不透明像素行（从 y=-4 到 y=8）
  let opaqueRows = 0
  const yMin = -4
  const yMax = 8
  const steps = (yMax - yMin) * scale
  for (let i = 0; i <= steps; i += 1) {
    const sy = yMin + i / scale
    const ox = Math.round((cx + 9) * scale)
    const oy = Math.round((sy + 9) * scale)
    if (ox < 0 || ox >= SIZE_F || oy < 0 || oy >= SIZE_F) continue
    const o = (oy * SIZE_F + ox) * 4
    if (out[o + 3] > 0) opaqueRows += 1
  }
  // 期望 ≈ 8 格 × scale（12 格行程 8 格是正面高度）
  const expected = 8 * scale
  const ok = Math.abs(opaqueRows - expected) < expected * 0.25
  record(
    '形状·正面不压扁',
    ok,
    `正面中心竖线不透明 ${opaqueRows} 行 ≈ 8×scale(${expected.toFixed(0)})`,
  )
}

// ---- 侧面镜像断言（把「右半 quad 取哪张贴图」钉死） ----

/**
 * 造「角色右侧面贴图(−X, face='right', x=0 块) 涂绿、角色左侧面贴图(+X, face='left', x=16 块) 涂黄」，
 * 渲染后断言：
 *   · 输出**存在黄色** → 用了左面贴图
 *   · 输出**不存在绿色** → 没用右面贴图
 * 这钉死「右半 quad 取 left 贴图」这一事实：把 face 改回 'right' 会立刻 FAIL。
 *
 * ⚠️ 明暗系数会压暗颜色（侧面 ×0.7 → 黄 (179,179,0)、绿 (0,179,0)），
 *    判据必须用「主通道明显占优」，不能用绝对阈值。
 */
function verifySideMirror() {
  const pixels = new Uint8ClampedArray(64 * 64 * 4)
  const fill = (
    rect: { x: number; y: number; w: number; h: number },
    r: number,
    g: number,
    b: number,
  ) => {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const o = (y * 64 + x) * 4
        pixels[o] = r
        pixels[o + 1] = g
        pixels[o + 2] = b
        pixels[o + 3] = 255
      }
    }
  }
  // 角色右侧面(−X) = face 'right' = x=0 块 → 绿
  fill(getFaceRect('head', 'right', 'base', false), 0, 255, 0)
  // 角色左侧面(+X) = face 'left' = x=16 块 → 黄
  fill(getFaceRect('head', 'left', 'base', false), 255, 255, 0)

  const out = renderHeadIsometric(pixels, 128)
  // 全局统计（黄色必须出现、绿色必须为 0），用「主通道明显占优」判色
  let yellow = 0
  let green = 0
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    if (r > 100 && g > 100 && b < r * 0.6) yellow += 1
    else if (g > 100 && r < g * 0.6 && b < g * 0.6) green += 1
  }
  record('镜像·右半用左面贴图（黄出现）', yellow > 0, `黄色像素 ${yellow}`)
  record('镜像·右半不掺右面贴图（绿必须为 0）', green === 0, `绿色像素 ${green}`)
}

// ---- 主流程 ----

console.log('\n=== MC 皮肤编辑器 · 等距头部渲染验证 ===\n')

console.log('样本：')
console.log('  [sample-wide] public/skins/sample-wide.png（宽型）')
console.log('  [sample-slim] public/skins/sample-slim.png（纤细）')
console.log('  [transparent] 全透明皮肤')
console.log('  [overlay] 帽层有内容的合成用例')
console.log('')

for (const [id, pixels] of [
  ['sample-wide', wideSkin],
  ['sample-slim', slimSkin],
] as const) {
  const out = verifyBasic(id, pixels)
  if (out) {
    verifyFacesNonEmpty(id, out)
    verifyShading(id, out)
  }
}

verifyTransparent('全透明')
verifyOverlay()

// 形状约束（本次补强：抓住「正面半高」这类几何 bug）
verifyEqualAreas()
verifyNoGap()
verifyFrontNotSquashed()

// 侧面镜像（断言：右半必须用角色左侧面贴图）
verifySideMirror()

// ---- 汇总输出 ----

console.log('\n结论表：')
let passCount = 0
let failCount = 0
const W = 52
for (const c of checks) {
  const mark = c.pass ? 'PASS' : 'FAIL'
  if (c.pass) passCount += 1
  else failCount += 1
  console.log(`  ${mark}  ${c.id}`.padEnd(W) + ` ${c.detail}`)
}

console.log('\n' + '='.repeat(72))
console.log(`  通过 ${passCount} / ${passCount + failCount}，失败 ${failCount}`)
console.log('='.repeat(72) + '\n')

if (failCount > 0) {
  process.exitCode = 1
}
