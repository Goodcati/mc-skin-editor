import type { ModelKind } from './skinModel'
import type { MergeChoice } from './mergeSkin'

/**
 * 作品库（「我的皮肤」列表的持久层）。
 *
 * 与 autosave.ts 的分工：
 * - autosave.ts 是**防崩溃暂存**：一个单槽 snapshot，随自动保存反复覆盖，
 *   语义是「你上次没做完的那一份」，丢了只是丢一次进度。
 * - 本文件是**作品存档**：append-only 列表，每件作品独立一份，导出成功才写入，
 *   语义是「你导出过的成品」，是用户真正会回来找的东西。
 *
 * 两者分开，而不是塞进 autosave：生命周期完全不同（一个覆盖、一个累积），
 * 混在一起会让「读快照」和「读作品列表」的防御式解析互相纠缠。
 *
 * 存储沿用 autosave 的约定：版本化键名、PNG dataURL（不是 ImageData 字节）、
 * 防御式解析（坏数据丢弃）、写入返回 { ok, error }。
 */

const WORKS_KEY = 'mc-skin-editor/works/v1'

export type WorkKind = 'draw' | 'merge'

export interface WorkSource {
  name: string
  model: ModelKind
  dataUrl: string
}

export interface WorkItem {
  id: string
  kind: WorkKind
  name: string
  model: ModelKind
  /** 最后修改时间戳，用于列表排序和「多久以前」 */
  updatedAt: number
  /** 成品 PNG 的 dataURL，直接喂 <img> 当缩略图、也能喂导入路径恢复画布 */
  dataUrl: string
  /** 合成作品才有的：两张源图 + 每部件选择表 + 输出体型（恢复合成页用） */
  merge?: {
    sources: [WorkSource | null, WorkSource | null]
    choice: MergeChoice
    outputModel: ModelKind
  }
}

export interface WorksReadResult {
  ok: boolean
  works: WorkItem[]
  error?: string
}

export interface WorksWriteResult {
  ok: boolean
  error?: string
}

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/png')
}

function isModelKind(value: unknown): value is ModelKind {
  return value === 'wide' || value === 'slim'
}

/**
 * 防御式解析：一条坏数据只丢它自己，不影响整份列表。
 * 字段不齐、类型不对的条目一律跳过，绝不让一条坏记录把整个作品库搞崩。
 */
function parseWorkItem(raw: unknown): WorkItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>

  if (typeof item.id !== 'string' || item.id.length === 0) return null
  if (item.kind !== 'draw' && item.kind !== 'merge') return null
  if (typeof item.name !== 'string' || item.name.length === 0) return null
  if (!isModelKind(item.model)) return null
  if (typeof item.updatedAt !== 'number') return null
  if (!isDataUrl(item.dataUrl)) return null

  const work: WorkItem = {
    id: item.id,
    kind: item.kind,
    name: item.name,
    model: item.model,
    updatedAt: item.updatedAt,
    dataUrl: item.dataUrl,
  }

  // 合成作品：merge 结构是可选的（老数据 / 手动删过），读不到就只恢复不了合成页，
  // 但缩略图、名称、类型照常显示 —— 不能因为缺 merge 就丢掉整件作品。
  if (item.kind === 'merge' && typeof item.merge === 'object' && item.merge !== null) {
    const merge = item.merge as Record<string, unknown>
    if (
      Array.isArray(merge.sources) &&
      merge.sources.length === 2 &&
      typeof merge.choice === 'object' &&
      merge.choice !== null &&
      isModelKind(merge.outputModel)
    ) {
      const sources = merge.sources.map((s): WorkSource | null => {
        if (typeof s !== 'object' || s === null) return null
        const src = s as Record<string, unknown>
        if (typeof src.name !== 'string' || !isModelKind(src.model) || !isDataUrl(src.dataUrl)) {
          return null
        }
        return { name: src.name, model: src.model, dataUrl: src.dataUrl }
      }) as [WorkSource | null, WorkSource | null]
      work.merge = {
        sources,
        choice: merge.choice as MergeChoice,
        outputModel: merge.outputModel,
      }
    }
  }

  return work
}

/** 读整份作品列表。坏 JSON / 坏条目都兜底成空列表，绝不抛异常 */
export function readWorks(): WorksReadResult {
  try {
    const raw = window.localStorage.getItem(WORKS_KEY)
    if (!raw) return { ok: true, works: [] }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: true, works: [] }
    const works = parsed
      .map(parseWorkItem)
      .filter((w): w is WorkItem => w !== null)
      // 按更新时间倒序：最新导出的排最前
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { ok: true, works }
  } catch {
    return { ok: true, works: [] }
  }
}

/**
 * 追加一件作品。写失败（最常见是配额满）返回 { ok:false, error }。
 *
 * 不去重是有意的：同一张皮肤导出两次就是两件独立作品（时间戳不同），
 * 用户可能就是想留两个版本。去重反而会在「改了名重新导出」时误伤。
 */
export function addWork(item: WorkItem): WorksWriteResult {
  const { works } = readWorks()
  const next = [item, ...works]
  try {
    window.localStorage.setItem(WORKS_KEY, JSON.stringify(next))
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/** 按 id 删除一件作品 */
export function removeWork(id: string): WorksWriteResult {
  const { works } = readWorks()
  const next = works.filter((w) => w.id !== id)
  try {
    window.localStorage.setItem(WORKS_KEY, JSON.stringify(next))
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

// ---- 备份导出 / 导入 ----
//
// 作品只活在浏览器 localStorage，用户清一次浏览器数据就全没。这一组函数提供
// 「导出成 JSON / 从 JSON 恢复」，是纯数据搬运，不碰任何 UI。
// 导入的防御式解析**复用上面同一个 parseWorkItem**，不另写一份校验 —— 两份迟早不一致。

/** 备份文件格式的版本号。将来结构变了就 +1，旧版本会被明确拒绝而不是静默出错 */
export const WORKS_BACKUP_VERSION = 1

export interface WorksBackup {
  version: number
  /** 导出时间戳（毫秒） */
  exportedAt: number
  works: WorkItem[]
}

export interface WorksImportResult {
  ok: boolean
  /** 通过防御式校验、可用于合并的作品 */
  works: WorkItem[]
  /** 被丢弃的坏条目数（整体仍算成功，只是少几件） */
  skipped: number
  error?: string
}

export interface WorksMergeResult {
  ok: boolean
  /** 实际新增的件数 */
  added: number
  /** 因 id 已存在（或导入文件内自身重复）而跳过的件数 */
  skipped: number
  error?: string
}

/** 构造导出内容：版本号 + 导出时间 + 作品列表 */
export function buildWorksBackup(works: WorkItem[]): WorksBackup {
  return { version: WORKS_BACKUP_VERSION, exportedAt: Date.now(), works }
}

/** 按本地日期生成备份文件名，如 mc-skin-editor-works-20261016.json */
export function worksBackupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  return `mc-skin-editor-works-${stamp}.json`
}

/**
 * 解析备份 JSON 文本。
 *
 * 分两层兜底：
 * - **文件级**问题（不是 JSON / 顶层不是对象 / version 不对 / 缺 works 数组）→ ok:false + 明确 error，拒绝导入；
 * - **条目级**问题（某条记录字段不齐）→ 走 parseWorkItem 丢弃该条，整体仍 ok，skipped 记数。
 */
export function parseWorksFile(text: string): WorksImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, works: [], skipped: 0, error: '文件不是合法的 JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, works: [], skipped: 0, error: '备份文件格式不对（顶层应是对象）' }
  }
  const root = parsed as Record<string, unknown>
  if (root.version !== WORKS_BACKUP_VERSION) {
    return {
      ok: false,
      works: [],
      skipped: 0,
      error: `不支持的备份版本「${String(root.version)}」（本程序只认 version ${WORKS_BACKUP_VERSION}）`,
    }
  }
  if (!Array.isArray(root.works)) {
    return { ok: false, works: [], skipped: 0, error: '备份文件缺少 works 数组' }
  }

  const works: WorkItem[] = []
  let skipped = 0
  for (const raw of root.works) {
    const item = parseWorkItem(raw)
    if (item) works.push(item)
    else skipped += 1
  }
  return { ok: true, works, skipped }
}

/**
 * 把导入的作品并进现有作品库：**按 id 去重、只新增，绝不覆盖或删除现有作品**。
 * 导入文件内部若有重复 id 也只保留第一条。
 */
export function mergeWorks(imported: WorkItem[]): WorksMergeResult {
  const { works } = readWorks()
  const existing = new Set(works.map((w) => w.id))

  const seen = new Set<string>()
  const fresh: WorkItem[] = []
  for (const item of imported) {
    if (existing.has(item.id) || seen.has(item.id)) continue
    seen.add(item.id)
    fresh.push(item)
  }
  const skipped = imported.length - fresh.length
  if (fresh.length === 0) return { ok: true, added: 0, skipped }

  const next = [...fresh, ...works].sort((a, b) => b.updatedAt - a.updatedAt)
  try {
    window.localStorage.setItem(WORKS_KEY, JSON.stringify(next))
    return { ok: true, added: fresh.length, skipped }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, added: 0, skipped, error: message }
  }
}
