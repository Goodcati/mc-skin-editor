/**
 * 作品库备份「导出 / 导入」逻辑验证（无头，不依赖浏览器）。
 *
 * works.ts 是纯逻辑 + localStorage，所以在 node 里 mock 一个 localStorage 就能完整验证：
 *   a. 导出往返：buildWorksBackup → JSON → parseWorksFile，字段（含 merge 结构）一致
 *   b. 合并语义：按 id 去重、只新增、绝不覆盖或删除现有作品
 *   c. 文件级坏输入：坏 JSON / 空文件 / 顶层非对象 / version 不对 / 缺 works 数组 → 明确拒绝
 *   d. 条目级坏数据：丢弃该条但整体成功，且计数正确
 *   e. 文件名按本地日期生成
 *
 * 运行：npm run verify:works   （或 npx tsx scripts/verify-works.mts）
 */

import { buildWorksBackup, mergeWorks, parseWorksFile, readWorks, worksBackupFileName } from '../src/lib/works'
import type { WorkItem } from '../src/lib/works'
import { defaultChoice } from '../src/lib/mergeSkin'

// ---- mock localStorage（在 import 之后设置即可：works.ts 顶层不访问 window） ----
const store = new Map<string, string>()
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v))
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
  clear: () => store.clear(),
}
;(globalThis as unknown as { window: unknown }).window = { localStorage: storage }

// ---- 结果记录 ----
interface Check {
  id: string
  pass: boolean
  detail: string
}
const checks: Check[] = []
function record(id: string, pass: boolean, detail = '') {
  checks.push({ id, pass, detail })
}

// ---- 工具 ----
const PNG = 'data:image/png;base64,iVBORw0KGgo='

function mkWork(id: string, kind: 'draw' | 'merge', name: string, updatedAt: number): WorkItem {
  const base: WorkItem = {
    id,
    kind,
    name,
    model: 'wide',
    updatedAt,
    dataUrl: PNG,
  }
  if (kind === 'merge') {
    base.merge = { sources: [null, null], choice: defaultChoice('a'), outputModel: 'wide' }
  }
  return base
}

function resetStorage() {
  storage.clear()
}

// ---- 主流程 ----

console.log('\n=== MC 皮肤编辑器 · 作品库备份导出/导入 验证 ===\n')

// a. 导出往返
resetStorage()
const works = [
  mkWork('a', 'draw', '甲', 100),
  mkWork('b', 'merge', '乙', 200),
  mkWork('c', 'draw', '丙', 300),
]
const backup = buildWorksBackup(works)
const json = JSON.stringify(backup, null, 2)

record('导出·JSON 含 works 数组', json.includes('"works"') && Array.isArray(backup.works))
record('导出·version=1', backup.version === 1, `version=${backup.version}`)
record('导出·exportedAt 是数字', typeof backup.exportedAt === 'number', `exportedAt=${backup.exportedAt}`)

const rt = parseWorksFile(json)
record('往返·解析 ok 且 3 件', rt.ok && rt.works.length === 3, `解析出 ${rt.works.length} 件`)
record(
  '往返·字段一致（含 merge 结构）',
  rt.works.every(
    (w, i) => w.id === works[i].id && w.name === works[i].name && w.updatedAt === works[i].updatedAt,
  ) && rt.works[1].merge !== undefined,
)

// b. 合并语义
const m1 = mergeWorks(rt.works)
record('合并·进空库新增 3', m1.ok && m1.added === 3 && m1.skipped === 0, `added=${m1.added} skipped=${m1.skipped}`)
record('合并·readWorks 3 件', readWorks().works.length === 3)

const m2 = mergeWorks(rt.works)
record('合并·重复导入新增 0 跳过 3', m2.ok && m2.added === 0 && m2.skipped === 3, `added=${m2.added} skipped=${m2.skipped}`)
record('合并·列表仍 3 件（不产生重复）', readWorks().works.length === 3)

const m3 = mergeWorks([mkWork('a', 'draw', '甲改', 999), mkWork('d', 'draw', '丁', 400)])
record('合并·部分重叠新增 1 跳过 1', m3.ok && m3.added === 1 && m3.skipped === 1, `added=${m3.added} skipped=${m3.skipped}`)
record('合并·列表 4 件', readWorks().works.length === 4)
record('合并·绝不覆盖现有（a 仍为「甲」）', readWorks().works.find((w) => w.id === 'a')?.name === '甲')

// c. 文件级坏输入
const badInputs: [string, string][] = [
  ['坏 JSON', '{ 不是 json'],
  ['空文件', ''],
  ['顶层是数组', '[]'],
  ['version=2', JSON.stringify({ version: 2, works: [] })],
  ['缺 works 数组', JSON.stringify({ version: 1 })],
]
for (const [label, input] of badInputs) {
  const r = parseWorksFile(input)
  record(`拒绝·${label}`, !r.ok && !!r.error, `error="${r.error ?? ''}"`)
}

// d. 条目级坏数据
const mixed = JSON.stringify({
  version: 1,
  exportedAt: 1,
  works: [mkWork('x', 'draw', '好', 10), { id: 'bad' }, mkWork('y', 'draw', '好2', 20)],
})
const rm = parseWorksFile(mixed)
record(
  '条目级·坏条目丢弃但整体成功',
  rm.ok && rm.works.length === 2 && rm.skipped === 1,
  `works=${rm.works.length} skipped=${rm.skipped}`,
)

// e. 文件名
const fn = worksBackupFileName(new Date(2026, 9, 16))
record('文件名·带本地日期', fn === 'mc-skin-editor-works-20261016.json', fn)

// ---- 汇总输出 ----
console.log('结论表：')
let passCount = 0
let failCount = 0
const W = 52
for (const c of checks) {
  const mark = c.pass ? 'PASS' : 'FAIL'
  if (c.pass) passCount += 1
  else failCount += 1
  console.log(`  ${mark}  ${c.id}`.padEnd(W) + (c.detail ? ` ${c.detail}` : ''))
}
console.log('\n' + '='.repeat(72))
console.log(`  通过 ${passCount} / ${passCount + failCount}，失败 ${failCount}`)
console.log('='.repeat(72) + '\n')

if (failCount > 0) {
  process.exitCode = 1
}
