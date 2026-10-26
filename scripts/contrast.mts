/**
 * WCAG 对比度核对（改前 / 改后两列）
 *
 * 用法：tsx scripts/contrast.mts [改前的 git 版本，默认 HEAD]
 *
 * 干的事：
 *   1. 从 `git show <rev>:src/theme.css` 读出**改前**的 token 值
 *   2. 从工作区的 src/theme.css 读出**改后**的 token 值
 *   3. 把 oklch() / #hex 都换算成 sRGB → 按 WCAG 2.1 算相对亮度 → 算对比度
 *   4. 逐行打印：用途 / 前景 / 背景 / 改前比值 / 改后比值 / 判定
 *
 * 为什么不用浏览器取色：Chrome 的 getComputedStyle 对 oklch 原样返回，
 * 不做 sRGB 换算，拿不到可直接算对比度的数值。所以这里自己实现 oklch→sRGB。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------- 颜色解析 ----------

type RGB = { r: number; g: number; b: number } // 0..1，sRGB（已做 gamma 编码）

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return {
    r: parseInt(n.slice(0, 2), 16) / 255,
    g: parseInt(n.slice(2, 4), 16) / 255,
    b: parseInt(n.slice(4, 6), 16) / 255,
  }
}

const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/** oklch(L C H) → sRGB。L/C 可带 %，H 为角度 */
function oklchToRgb(l: number, c: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ * l_ * l_
  const M = m_ * m_ * m_
  const S = s_ * s_ * s_

  const rl = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S
  const gl = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
  return { r: gamma(clamp01(rl)), g: gamma(clamp01(gl)), b: gamma(clamp01(bl)) }
}

type RGBA = RGB & { alpha?: number }

function parseColor(raw: string): RGBA | null {
  const v = raw.trim()
  if (v.startsWith('#')) return hexToRgb(v)

  const m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/)
  if (m) {
    // L 在 oklch() 里可能写 0~1，也可能写 0~100%
    const L = m[2] === '%' ? parseFloat(m[1]) / 100 : parseFloat(m[1])
    return oklchToRgb(L, parseFloat(m[3]), parseFloat(m[4]))
  }

  // 白色按百分比叠加：color-mix(in oklab, #fff 7%, transparent)
  const mm = v.match(/color-mix\([^)]*?([\d.]+)%,\s*transparent\)/)
  if (mm) return { r: 1, g: 1, b: 1, alpha: parseFloat(mm[1]) / 100 }

  return null
}

/** 半透明白（或指定透明度）按 alpha 叠加到不透明底色上 */
function over(fg: RGBA, bg: RGB, alphaOverride?: number): RGB {
  const a = alphaOverride ?? fg.alpha ?? 1
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }
}

function luminance({ r, g, b }: RGB): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------- 读 token ----------

const ROOT = process.cwd()
const cssPath = join(ROOT, 'src', 'theme.css')
const rev = process.argv[2] ?? 'HEAD'

function parseTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) out[m[1]] = m[2].trim()
  return out
}

const afterTokens = parseTokens(readFileSync(cssPath, 'utf8'))

/**
 * 「改前」列的来源是 git。CI 里常是浅克隆、或者这个文件本来就没改过，
 * 取不到时**不当作失败**，降级成「只校验改后」—— 门禁的职责是拦住坏配色，
 * 不是拦住「没有历史」。降级时会打印一行醒目的说明，避免有人以为是全绿。
 */
let beforeCss: string | null = null
try {
  beforeCss = execFileSync('git', ['show', `${rev}:src/theme.css`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
} catch {
  beforeCss = null
}
const degraded = beforeCss === null
const beforeTokens = beforeCss ? parseTokens(beforeCss) : afterTokens

const color = (tokens: Record<string, string>, name: string): RGBA => {
  const raw = tokens[name]
  if (!raw) throw new Error(`token 不存在: ${name}`)
  const c = parseColor(raw)
  if (!c) throw new Error(`无法解析 ${name} = ${raw}`)
  return c
}

// ---------- 核对表 ----------
// 每一行：用途 / 前景 token / 背景 token / 阈值（正文 4.5，次要 3，禁用 2.5）
// opacity：可选。禁用态在 index.css 里是 `opacity: 0.55`，
// 真实观感 = 文字色按 55% 合成到底色上，所以这一行必须按合成后算，
// 否则表上是 14.74、屏幕上是 5.19，等于自欺。
type Row = { use: string; fg: string; fgBefore: string; bg: string; min: number; opacity?: number }

const ROWS: Row[] = [
  { use: '正文 · 面板上', fg: 'fg-2', fgBefore: 'fg-2', bg: 'surface-panel', min: 4.5 },
  { use: '正文 · 页面底', fg: 'fg-2', fgBefore: 'fg-2', bg: 'surface-app', min: 4.5 },
  { use: '次要 · 面板上', fg: 'fg-4', fgBefore: 'fg-4', bg: 'surface-panel', min: 3 },
  { use: '三级 · 面板上', fg: 'fg-6', fgBefore: 'fg-6', bg: 'surface-panel', min: 3 },
  { use: '三级 · 弹框上', fg: 'fg-6', fgBefore: 'fg-6', bg: 'surface-dialog', min: 3 },
  { use: '最暗提示 · 面板上', fg: 'fg-7', fgBefore: 'fg-7', bg: 'surface-panel', min: 2.5 },
  // 禁用按钮：WCAG 1.4.3 对「不可用控件」是豁免的，所以这条不求 4.5，
  // 只求「还看得清是什么字」，阈值取 2.5（与最暗提示同一档）。
  { use: '禁用按钮 · 面板上', fg: 'fg-2', fgBefore: 'fg-2', bg: 'surface-panel', min: 2.5, opacity: 0.55 },
  { use: '强调字 · 面板上', fg: 'accent-300', fgBefore: 'accent-300', bg: 'surface-panel', min: 4.5 },
  { use: '危险字 · 面板上', fg: 'danger-300', fgBefore: 'danger-300', bg: 'surface-panel', min: 4.5 },
  { use: '提醒字 · 面板上', fg: 'warn-300', fgBefore: 'warn-300', bg: 'surface-panel', min: 4.5 },
  { use: '信息字 · 面板上', fg: 'info-300', fgBefore: 'info-300', bg: 'surface-panel', min: 4.5 },
]

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)))
const fmt = (x: number) => x.toFixed(2)

console.log(`\n改前 = ${rev} 的 src/theme.css   ·   改后 = 工作区 src/theme.css\n`)
if (degraded) {
  console.log(`⚠️  读不到 ${rev}:src/theme.css（浅克隆 / 无 git / 文件新增），已降级为「只校验改后」。\n`)
}
console.log(`${pad('用途', 20)}${pad('前景', 12)}${pad('背景', 16)}${pad('改前', 8)}${pad('改后', 8)}${pad('阈值', 6)}判定`)
console.log('-'.repeat(86))

let passBefore = 0
let passAfter = 0
for (const row of ROWS) {
  const fgA0 = color(afterTokens, row.fg)
  const fgB0 = color(beforeTokens, row.fgBefore)
  const bgA = color(afterTokens, row.bg)
  const bgB = color(beforeTokens, row.bg)
  // 改后若要叠透明度（禁用态），先合成到底色再算；改前不叠 —— 那时候禁用态根本
  // 没有样式，看起来和可点的一模一样，这正是本批要修的东西。
  const fgA = row.opacity === undefined ? fgA0 : over(fgA0, bgA, row.opacity)
  const rB = contrast(fgB0, bgB)
  const rA = contrast(fgA, bgA)
  const okB = rB >= row.min
  const okA = rA >= row.min
  if (okB) passBefore++
  if (okA) passAfter++
  const verdict = !okA
    ? '**未达标**'
    : row.opacity === undefined
      ? okB
        ? '达标（原已达）'
        : `达标 ↑ 从 ${fmt(rB)} 提到 ${fmt(rA)}`
      : `达标（含 ${Math.round(row.opacity * 100)}% 透明度合成）`
  console.log(
    `${pad(row.use, 20)}${pad(row.fg, 12)}${pad(row.bg.replace('surface-', ''), 16)}${pad(fmt(rB), 8)}${pad(fmt(rA), 8)}${pad(String(row.min), 6)}${verdict}`,
  )
}
console.log('-'.repeat(86))
console.log(`合计达标：改前 ${passBefore}/${ROWS.length}  ·  改后 ${passAfter}/${ROWS.length}\n`)

// 有未达标项就以非 0 退出，方便当门禁挂进 CI
if (passAfter < ROWS.length) {
  console.error(`✗ 有 ${ROWS.length - passAfter} 项未达标`)
  process.exitCode = 1
}

// 边框可见度（非文字，不做 WCAG 判定，只报合成后的实际颜色与对底色的比值）
console.log('边框 / 分隔线可见度（合成到面板底色后与底色的比值，供参考）')
const panel = color(afterTokens, 'surface-panel')
const panelBefore = color(beforeTokens, 'surface-panel')
for (const name of ['wash-2', 'wash-6', 'wash-7', 'wash-10', 'wash-15', 'wash-20']) {
  const a = afterTokens[name]
  const b = beforeTokens[name]
  if (!a || !b) continue
  const ca = parseColor(a) as RGBA
  const cb = parseColor(b) as RGBA
  console.log(
    `${pad(name, 12)}改前 alpha ${pad(formatPct(cb.alpha), 6)} 比值 ${pad(fmt(contrast(over(cb, panelBefore), panelBefore)), 6)}   改后 alpha ${pad(formatPct(ca.alpha), 6)} 比值 ${fmt(contrast(over(ca, panel), panel))}`,
  )
}

function formatPct(alpha: number | undefined): string {
  return `${Math.round((alpha ?? 1) * 100)}%`
}
