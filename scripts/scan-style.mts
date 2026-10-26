/**
 * 裸值扫描（样式纪律门禁）
 *
 * 用法：tsx scripts/scan-style.mts [--all]
 *   --all  连白名单文件一起检查（默认跳过 Lobby.tsx）
 *
 * 拦的东西：组件里绕过 src/theme.css、自己写死视觉值的情况。
 *   1. 硬编码颜色       bg-[#123456] / text-[#abc]
 *   2. 任意像素字号     text-[13px]
 *   3. 越界圆角         rounded-2xl / rounded-[10px]（只允许 3 档 + full）
 *   4. 越界间距步长     gap-0.5 / px-2.5 / p-4（只允许 1 / 1.5 / 2 / 3）
 *
 * 为什么第 4 条要单独扫：圆角能靠覆盖 Tailwind 的数值 token 收敛（见 theme.css），
 * 间距不行 —— v4 的间距是 calc(var(--spacing) * N)，没有逐档覆盖的入口，
 * 只能靠类名约定 + 这个脚本兜着。
 *
 * 白名单只有 Lobby.tsx：那个文件归机主（离线下载那条链在他手上），
 * 里面有 17 处旧步长和 1 个 text-9 还没迁。迁完把 ALLOW 清空即可。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** 已知未迁、且本轮不归我改的文件 */
const ALLOW: Record<string, string> = {
  // （已清空）Lobby.tsx 已于 2026-10-26 并入统一间距与字号，不再豁免
}

const SPACING_PREFIX = [
  'space-x',
  'space-y',
  'px',
  'py',
  'pt',
  'pb',
  'pl',
  'pr',
  'mx',
  'my',
  'mt',
  'mb',
  'ml',
  'mr',
  'gap',
  'p',
  'm',
]
const BAD_STEPS = ['0.5', '2.5', '4']

type Rule = { name: string; re: RegExp; hint: string; drop?: (m: string) => boolean }

/** 允许的字号档位，顺序即命名档的顺序 */
const FONT_STEPS = ['10', '11', '12', '13', '15', '18']

const RULES: Rule[] = [
  {
    name: '硬编码颜色',
    re: /(?:bg|text|border|ring|fill|stroke|shadow|from|to|via|outline)-\[#[0-9a-fA-F]{3,8}\]/g,
    hint: '改用 theme.css 的 token（surface-* / fg-* / wash-* / accent-* …）',
  },
  {
    name: '越界字号',
    // 数字档（text-9 / text-14 …）与命名档（text-sm / text-2xl …）都抓
    re: /\btext-(?:\d+(?:\.\d+)?|xs|sm|base|lg|xl|[2-9]xl)\b/g,
    hint: `只允许 text-${FONT_STEPS.join(' / text-')}`,
    drop: (m) => FONT_STEPS.includes(m.slice('text-'.length)),
  },
  {
    name: '任意像素字号',
    re: /\btext-\[\d+(?:\.\d+)?px\]/g,
    hint: '只允许 text-10 / 11 / 12 / 13 / 15 / 18',
  },
  {
    name: '越界圆角',
    re: /\brounded-(?:xs|2xl|3xl|4xl|\[[^\]]*\])/g,
    hint: '只允许 rounded / rounded-sm（4px）· rounded-md / rounded-lg（8px）· rounded-xl（12px）· rounded-full',
  },
  {
    name: '越界间距步长',
    // 前面的字符不能是字母数字或 -，否则 gap-4 里的 p-4、-mt-2 里的 mt-2 会被误抓
    re: new RegExp(`(?:^|[^\\w-])(?:${SPACING_PREFIX.join('|').replace(/-/g, '\\-')})-(?:${BAD_STEPS.join('|').replace(/\./g, '\\.')})(?![\\d.])`, 'g'),
    hint: '只允许 *-1（4px）/ *-1.5（6px）/ *-2（8px）/ *-3（12px）',
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const includeAllowed = process.argv.includes('--all')

type Hit = { file: string; line: number; rule: string; snippet: string }

const files = walk(SRC)
const hits: Hit[] = []
const skipped: string[] = []

for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join('/')
  // theme.css / index.css 是 token 源与四态层，本来就该写字面值
  if (rel === 'src/theme.css' || rel === 'src/index.css') continue
  const allowed = rel in ALLOW
  if (allowed && !includeAllowed) {
    skipped.push(rel)
    continue
  }

  const lines = readFileSync(abs, 'utf8').split('\n')
  for (const rule of RULES) {
    lines.forEach((text, i) => {
      rule.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rule.re.exec(text))) {
        if (!rule.drop?.(m[0])) {
          hits.push({ file: rel, line: i + 1, rule: rule.name, snippet: m[0].trim() })
        }
        if (m[0].length === 0) rule.re.lastIndex++
      }
    })
  }
}

console.log(`\n裸值扫描：${files.length} 个文件（src/theme.css、src/index.css 豁免）\n`)

if (hits.length === 0) {
  console.log('✓ 没有发现裸值。')
} else {
  const byRule = new Map<string, Hit[]>()
  for (const h of hits) {
    const list = byRule.get(h.rule) ?? []
    list.push(h)
    byRule.set(h.rule, list)
  }
  for (const rule of RULES) {
    const list = byRule.get(rule.name)
    if (!list) continue
    console.log(`✗ ${rule.name} —— ${list.length} 处`)
    console.log(`  改法：${rule.hint}`)
    for (const h of list) console.log(`    ${h.file}:${h.line}  ${h.snippet}`)
    console.log('')
  }
}

for (const s of skipped) console.log(`· 已跳过白名单：${s}（${ALLOW[s]}）`)
console.log('')

if (hits.length > 0) {
  console.error(`✗ ${hits.length} 处裸值不符合样式纪律`)
  process.exitCode = 1
}
