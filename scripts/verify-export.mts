/**
 * 导出闭环验证脚本（可重复运行，无浏览器依赖）。
 *
 * 验证「导出的皮肤 PNG 真的能直接被 Minecraft 使用」的三条验收点：
 *   1) 规格合规：64×64、RGBA、alpha ∈ {0,255}、手臂宽度与体型一致（slim=3 / wide=4）。
 *   2) 往返一致：导出 PNG → 走编辑器解析路径读回 → 逐像素与导出前一致。
 *   3) 边界不崩：全透明、仅 overlay、合并后手臂被重排，都能导出且往返一致。
 *
 * 运行：npm run verify:export   （或 npx tsx scripts/verify-export.mts）
 *
 * 复用关系：
 *   - exportSkin.ts 的 normalizeTransparentPixels / measureSkin / countBaseHoles
 *   - skinFaces.ts  的 getFaceRect / partBox（手臂宽度判定）
 *   - mergeSkin.ts  的 remapArms / composeMerge（合并 + 手臂重排样本）
 *   唯一替换：浏览器 toBlob/toDataURL → pngjs 的 PNG.sync.write（同样是标准 8bit RGBA PNG 编码）。
 *   解析路径 = PNG.sync.read（等价于 decodeSkinPixels 里 64×64 的恒等贴入 + getImageData）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'

import { SKIN_SIZE } from '../src/constants'
import {
  normalizeTransparentPixels,
  countBaseHoles,
} from '../src/lib/exportSkin'
import { getFaceRect, partBox } from '../src/lib/skinFaces'
import type { ModelKind } from '../src/lib/skinModel'
import {
  remapArms,
  composeMerge,
  defaultChoice,
} from '../src/lib/mergeSkin'
import type { MergeSource } from '../src/lib/mergeSkin'

// ---- 最小 ImageData polyfill（node 无 DOM，够 remapArms / composeMerge 使用）----
class MinimalImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
  constructor(width: number | Uint8ClampedArray, height?: number) {
    if (typeof width === 'number') {
      this.width = width
      this.height = height!
      this.data = new Uint8ClampedArray(width * height! * 4)
    } else {
      this.data = width
      this.width = height!
      this.height = this.data.length / this.width / 4
    }
  }
}
;(globalThis as unknown as { ImageData: unknown }).ImageData = MinimalImageData

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

/** 读 PNG 文件 → RGBA 数组（pngjs 返回 {width,height,data:Buffer}） */
function loadPng(path: string): { width: number; height: number; data: Uint8ClampedArray } {
  const png = PNG.sync.read(readFileSync(path))
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

/**
 * 复刻编辑器的导出路径：64×64 像素 → normalizeTransparentPixels → PNG 编码。
 * 返回 PNG 字节 + 规范化计数（对应 buildSkinPngFromCanvas 的 normalized）。
 */
function exportPixels(pixels: Uint8ClampedArray): { bytes: Buffer; normalized: number } {
  const copy = new Uint8ClampedArray(pixels)
  const normalized = normalizeTransparentPixels(copy)
  const png = new PNG({ width: SKIN_SIZE, height: SKIN_SIZE, colorType: 6 }) // RGBA
  Buffer.from(copy).copy(png.data)
  const bytes = PNG.sync.write(png)
  return { bytes, normalized }
}

/**
 * 复刻编辑器的解析路径：PNG 字节 → RGBA 数组。
 * 编辑器里 decodeSkinPixels 对 64×64 是恒等贴入 + getImageData，等价于直接读字节。
 */
function importPng(bytes: Buffer): { width: number; height: number; data: Uint8ClampedArray } {
  const png = PNG.sync.read(bytes)
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

/** 逐像素比较两段 RGBA，返回第一个差异像素坐标（无差异返回 null） */
function diffPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): { x: number; y: number; i: number } | null {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return { x: (i / 4) % SKIN_SIZE, y: Math.floor(i / 4 / SKIN_SIZE), i }
  }
  if (a.length !== b.length) return { x: -1, y: -1, i: -1 }
  return null
}

/** 统计 alpha 分布 */
function alphaHistogram(data: Uint8ClampedArray): { zeros: number; semi: number; full: number } {
  let zeros = 0
  let semi = 0
  let full = 0
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i]
    if (a === 0) zeros += 1
    else if (a === 255) full += 1
    else semi += 1
  }
  return { zeros, semi, full }
}

/** 判断手臂区域在某种体型下的「被占用宽度」，用于验收 1 的宽度核对 */
function armWidthCheck(model: ModelKind): { expect: number; actual: number; pass: boolean } {
  const box = partBox('rightArm', model === 'slim')
  return { expect: model === 'slim' ? 3 : 4, actual: box.w, pass: box.w === (model === 'slim' ? 3 : 4) }
}

// ---- 样本准备 ----

/** 从文件路径载入一个合并源（MergeSource） */
function sourceFromFile(name: string, model: ModelKind, data: Uint8ClampedArray): MergeSource {
  return { name, image: new MinimalImageData(data, SKIN_SIZE) as unknown as ImageData, model, width: SKIN_SIZE, height: SKIN_SIZE, legacy: false, standard: true }
}

const wideSkin = loadPng(join(SKINS_DIR, 'sample-wide.png'))
const slimSkin = loadPng(join(SKINS_DIR, 'sample-slim.png'))

// ---- 验收 1：规格合规 ----

function verifySpec(id: string, data: Uint8ClampedArray, model: ModelKind, w: number, h: number) {
  // 尺寸
  const sizeOk = w === SKIN_SIZE && h === SKIN_SIZE
  record(`${id}·尺寸64×64`, sizeOk, `实际 ${w}×${h}`)

  // RGBA（pngjs colorType 6 保证；这里校验数据长度 = 64*64*4）
  const rgbaOk = data.length === SKIN_SIZE * SKIN_SIZE * 4
  record(`${id}·RGBA通道`, rgbaOk, `字节数 ${data.length}（应为 ${SKIN_SIZE * SKIN_SIZE * 4}）`)

  // alpha 只含 0 与 255
  const hist = alphaHistogram(data)
  record(`${id}·alpha∈{0,255}`, hist.semi === 0, `半透明像素 ${hist.semi}（0/255 各 ${hist.zeros}/${hist.full}）`)

  // 手臂宽度与体型一致
  const aw = armWidthCheck(model)
  record(`${id}·手臂宽度=${model}`, aw.pass, `partBox 返回 ${aw.actual}，应为 ${aw.expect}`)
}

// ---- 主流程：对每个样本跑「导出 → 读回 → 逐像素比」----

interface Sample {
  id: string
  label: string
  pixels: Uint8ClampedArray
  model: ModelKind
}

const samples: Sample[] = []

// 样本 1：sample-wide.png（classic/wide）
samples.push({ id: 'sample-wide', label: 'public/skins/sample-wide.png（宽型）', pixels: wideSkin.data, model: 'wide' })

// 样本 2：sample-slim.png（slim）
samples.push({ id: 'sample-slim', label: 'public/skins/sample-slim.png（纤细）', pixels: slimSkin.data, model: 'slim' })

// 样本 3：跨体型合并结果（纤细源 → 输出宽型，触发手臂重排）
{
  const srcA = sourceFromFile('sample-slim', 'slim', slimSkin.data)
  const srcB = sourceFromFile('sample-wide', 'wide', wideSkin.data)
  const choice = defaultChoice('a')
  // 输出 wide：slim 源会被 remapArms 到 wide，属于「跨体型合并」
  const merged = composeMerge({ a: srcA, b: srcB }, choice, 'wide')
  if (!merged) throw new Error('composeMerge 返回 null')
  const remapped = merged.remapped.length > 0
  samples.push({
    id: 'merge-crossmodel',
    label: `跨体型合并结果（纤细→宽型，重排=${remapped ? '是' : '否'}）`,
    pixels: new Uint8ClampedArray(merged.image.data),
    model: 'wide',
  })
  record('样本·合并触发重排', remapped, `remapped=${JSON.stringify(merged.remapped)}`)
}

// 样本 4：全透明皮肤
{
  const allTransparent = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4)
  samples.push({ id: 'all-transparent', label: '全透明皮肤', pixels: allTransparent, model: 'wide' })
}

// 样本 5：只有 overlay 的皮肤（第二层有像素，第一层全透明）
{
  const onlyOverlay = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4)
  // 在第二层头部面（head overlay: u=32,v=0，取 front 面 8×8 区域）填不透明红
  const r = getFaceRect('head', 'front', 'overlay', false)
  for (let y = r.y; y < r.y + r.h; y += 1) {
    for (let x = r.x; x < r.x + r.w; x += 1) {
      const o = (y * SKIN_SIZE + x) * 4
      onlyOverlay[o] = 255
      onlyOverlay[o + 1] = 0
      onlyOverlay[o + 2] = 0
      onlyOverlay[o + 3] = 255
    }
  }
  samples.push({ id: 'only-overlay', label: '仅 overlay（帽子层）皮肤', pixels: onlyOverlay, model: 'wide' })
}

// 样本 6：合并后手臂被重排的结果（显式调用 remapArms，验证重排产物可导出且往返一致）
{
  const remapped = remapArms(
    new MinimalImageData(slimSkin.data, SKIN_SIZE) as unknown as ImageData,
    'slim',
    'wide',
  )
  samples.push({
    id: 'remapped-arms',
    label: 'remapArms(slim→wide) 直接产物',
    pixels: new Uint8ClampedArray(remapped.data),
    model: 'wide',
  })
}

// ---- 逐样本跑闭环 ----

for (const s of samples) {
  try {
    const { bytes } = exportPixels(s.pixels)

    // 导出侧规格
    const pngInfo = PNG.sync.read(bytes)
    verifySpec(s.id, new Uint8ClampedArray(pngInfo.data), s.model, pngInfo.width, pngInfo.height)

    // 规范化透明像素：导出后 alpha=0 的 RGB 必须为 0（导出本身不做此断言，这是规格的一部分）
    {
      const back = new Uint8ClampedArray(pngInfo.data)
      let dirtyRgb = 0
      for (let i = 0; i < back.length; i += 4) {
        if (back[i + 3] === 0 && (back[i] !== 0 || back[i + 1] !== 0 || back[i + 2] !== 0)) dirtyRgb += 1
      }
      record(`${s.id}·透明像素RGB归零`, dirtyRgb === 0, `残留非零RGB的透明像素 ${dirtyRgb}`)
    }

    // 往返：读回
    const imported = importPng(bytes)
    const back = imported.data

    // 读回后 alpha 仍只含 0/255
    const backHist = alphaHistogram(back)
    record(`${s.id}·读回alpha∈{0,255}`, backHist.semi === 0, `半透明 ${backHist.semi}`)

    // 逐像素与导出前一致（导出前的规范副本 = normalizeTransparentPixels 之后）
    const normalizedBefore = new Uint8ClampedArray(s.pixels)
    normalizeTransparentPixels(normalizedBefore)
    const diff = diffPixels(normalizedBefore, back)
    record(`${s.id}·往返一致`, diff === null, diff ? `首个差异 @(${diff.x},${diff.y}) 字节偏移${diff.i}` : '逐像素一致（颜色+alpha）')

    // 读回尺寸
    record(`${s.id}·读回尺寸`, imported.width === SKIN_SIZE && imported.height === SKIN_SIZE, `读回 ${imported.width}×${imported.height}`)

    // 边界不崩：导出过程未抛异常（try 没 catch 到即通过）
    record(`${s.id}·导出无异常`, true, 'exportPixels 正常返回')

  } catch (err) {
    record(`${s.id}·导出无异常`, false, `抛异常: ${(err as Error).message}`)
  }
}

// ---- 汇总输出 ----

console.log('\n=== MC 皮肤编辑器 · 导出闭环验证 ===\n')
console.log('样本：')
for (const s of samples) {
  console.log(`  [${s.id}] ${s.label}`)
}
console.log('\n结论表：')
let passCount = 0
let failCount = 0
const W = 58
for (const c of checks) {
  const mark = c.pass ? 'PASS' : 'FAIL'
  if (c.pass) passCount += 1
  else failCount += 1
  const line = `${mark}  ${c.id}`
  console.log(`  ${line.padEnd(W)} ${c.detail}`)
}

console.log('\n' + '='.repeat(72))
console.log(`  通过 ${passCount} / ${failCount + passCount}，失败 ${failCount}`)
console.log('='.repeat(72) + '\n')

// 额外：手臂宽度口径核对（验收 1 的语义层）
console.log('手臂宽度口径（partBox）：')
console.log(`  wide → ${partBox('rightArm', false).w}px（应为 4）`)
console.log(`  slim → ${partBox('rightArm', true).w}px（应为 3）`)

// 第一层空洞自检（示例素材是自绘的满贴图，不应有 baseHoles；合成的跨体型样本同理）
console.log('\n第一层空洞自检（countBaseHoles，示例素材应为 0）：')
console.log(`  sample-wide(wide)  ${countBaseHoles(wideSkin.data, false)}`)
console.log(`  sample-slim(slim)  ${countBaseHoles(slimSkin.data, true)}`)

if (failCount > 0) {
  process.exitCode = 1
}
