import { SKIN_SIZE } from '../constants'
import type { SkinDocument } from './SkinDocument'
import { MODEL_KINDS } from './skinModel'
import type { ModelKind } from './skinModel'

/**
 * 浏览器本地暂存（防崩溃）。
 *
 * 为什么存 localStorage 而不是 IndexedDB：载荷就是一张 64×64 PNG 的 dataURL，
 * 实测 2~8 KB，远低于 localStorage 的常见 5 MB 配额，不值得为它引入异步数据库。
 *
 * 为什么存 PNG dataURL 而不是 ImageData 字节：ImageData 是 64*64*4 = 16 KB 原始字节，
 * 转成 base64 要 22 KB，且必须自己记尺寸；PNG 编码顺带做了压缩，还原时又能直接当
 * URL 喂给 <img>，与「导入皮肤」走完全同一条解码路径。
 */

const SNAPSHOT_KEY = 'mc-skin-editor/snapshot/v1'
const ENABLED_KEY = 'mc-skin-editor/autosave-enabled/v1'

export interface SkinSnapshot {
  dataUrl: string
  savedAt: number
  name: string
  /** 存下来时的尺寸，用于丢弃不兼容的旧快照 */
  size: number
  /**
   * 存下来时的体型。
   *
   * 可选：旧版本的快照没有这个字段。读不到就返回 undefined，由调用方用
   * 「从像素推断」兜底 —— 不能因此丢掉整份快照，那等于把用户画的东西一起扔了。
   */
  model?: ModelKind
}

/**
 * 自动保存是否开启。
 *
 * 读不到（首次运行 / 隐私模式禁用 storage）时返回 **true** ——
 * 这个开关的语义是"保护用户数据"，拿不准的时候倾向保护。
 */
export function isAutosaveEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

export function persistAutosaveEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off')
  } catch {
    // 存不下开关状态不影响本次会话内的行为
  }
}

export function readSnapshot(): SkinSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SkinSnapshot>
    if (typeof parsed.dataUrl !== 'string' || !parsed.dataUrl.startsWith('data:image/png')) {
      return null
    }
    if (typeof parsed.savedAt !== 'number' || parsed.size !== SKIN_SIZE) return null
    const model = MODEL_KINDS.includes(parsed.model as ModelKind)
      ? (parsed.model as ModelKind)
      : undefined
    return {
      dataUrl: parsed.dataUrl,
      savedAt: parsed.savedAt,
      name: typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : '未命名皮肤',
      size: parsed.size,
      model,
    }
  } catch {
    return null
  }
}

export interface SnapshotWriteResult {
  ok: boolean
  savedAt: number
  error?: string
}

/**
 * 把当前画布写进本地暂存。
 *
 * 每次都真写，不做"内容没变就跳过"的短路：自动保存是防抖触发的（落笔结束 1.2 秒后），
 * 频率本来就很低，而短路会引入一个"缓存与 storage 不同步"的隐患
 * （外部清过 localStorage、而我们手里还留着旧 dataUrl，就会永远跳过写入）。
 */
export function writeSnapshot(
  doc: SkinDocument,
  name: string,
  model: ModelKind = 'wide',
): SnapshotWriteResult {
  const savedAt = Date.now()
  try {
    const payload: SkinSnapshot = {
      dataUrl: doc.canvas.toDataURL('image/png'),
      savedAt,
      name,
      size: doc.size,
      model,
    }
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload))
    return { ok: true, savedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, savedAt, error: message }
  }
}

export function clearSnapshot(): void {
  try {
    window.localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    /* 忽略 */
  }
}

/** `HH:MM:SS`，用于「上次保存」显示 */
export function formatSavedAt(savedAt: number): string {
  const d = new Date(savedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 人类可读的"多久以前"，用于恢复时的提示 */
export function describeAgo(savedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}
