import { MAX_HISTORY, SKIN_SIZE } from '../constants'
import type { RGBA } from './pixel'
import { drawSkinInto } from './skinImage'
import type { DrawableSkin, SkinSourceInfo } from './skinImage'

export type { SkinSourceInfo }

/**
 * 一次编辑产生的最小像素变化集合。
 * 只记录真正被改动的像素下标，以及它们改动前/后的 RGBA。
 * 一次拖拽 = 一条 patch，而不是"一整张 64x64 快照"，所以历史栈很轻。
 */
export interface PixelPatch {
  /** 被改动的像素下标（0 .. size*size-1），不会重复 */
  indices: Uint16Array
  /** 与 indices 一一对应的改动前 RGBA，长度 = indices.length * 4 */
  before: Uint8ClampedArray
  /** 改动后的 RGBA，长度同上 */
  after: Uint8ClampedArray
}

/**
 * 皮肤像素文档 —— 全应用唯一的像素数据源。
 *
 * 内部结构：
 *   - `canvasEl`（64x64 离屏 canvas）是持久载体，导入皮肤 / 导出 PNG / 喂给 skinview3d 都读它；
 *   - `imageData` 是它的内存镜像，所有逐像素读写都在镜像上完成，避免每画一个点就 getImageData（那是 4096 像素的拷贝）；
 *   - 任何外部要拿 `canvas` 时，getter 会先 flush() 把镜像写回，保证两者永不脱节。
 */
export class SkinDocument {
  readonly size: number

  private readonly canvasEl: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private imageData: ImageData
  private dirty = false

  private readonly undoStack: PixelPatch[] = []
  private readonly redoStack: PixelPatch[] = []

  /** 笔画进行中时不为 null：收集本次拖拽的净变化 */
  private strokeChanges: Map<number, Uint8ClampedArray> | null = null

  /** 像素变更订阅者（3D 预览用它做实时联动，绕开 React 渲染） */
  private readonly listeners = new Set<() => void>()

  constructor(size: number = SKIN_SIZE) {
    this.size = size
    this.canvasEl = document.createElement('canvas')
    this.canvasEl.width = size
    this.canvasEl.height = size

    const ctx = this.canvasEl.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('SkinDocument: 无法创建 2D 上下文')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = false

    this.imageData = this.ctx.getImageData(0, 0, size, size)
  }

  // ---------------------------------------------------------------- 读写

  /** 把内存镜像刷回离屏 canvas。凡是要读取 canvas 像素的地方都会先走这里。 */
  private flush(): void {
    if (!this.dirty) return
    this.ctx.putImageData(this.imageData, 0, 0)
    this.dirty = false
  }

  /** 离屏 canvas 本体，对外只读使用 */
  get canvas(): HTMLCanvasElement {
    this.flush()
    return this.canvasEl
  }

  getImageData(): ImageData {
    return new ImageData(
      new Uint8ClampedArray(this.imageData.data),
      this.size,
      this.size,
    )
  }

  getPixel(x: number, y: number): RGBA {
    if (!this.inBounds(x, y)) return [0, 0, 0, 0]
    const o = (y * this.size + x) * 4
    const d = this.imageData.data
    return [d[o], d[o + 1], d[o + 2], d[o + 3]]
  }

  /**
   * 写入单个像素。
   * 若正处于 beginStroke() / commitStroke() 之间，会自动把"改动前"的值记进本次变化集合。
   * @returns 是否真的产生了变化（值相同返回 false，不会污染历史栈）
   */
  setPixel(x: number, y: number, rgba: RGBA): boolean {
    if (!this.inBounds(x, y)) return false

    // alpha = 0 时 RGB 没有意义，统一归零。
    // 与导出时的规范化是同一条规则，保证「画布上的像素」和「导出的像素」永远一致，
    // 不会出现"画布上擦干净了、导出的文件里却留着残色"。
    const a = rgba[3]
    const r = a === 0 ? 0 : rgba[0]
    const g = a === 0 ? 0 : rgba[1]
    const b = a === 0 ? 0 : rgba[2]

    const index = y * this.size + x
    const o = index * 4
    const d = this.imageData.data

    if (d[o] === r && d[o + 1] === g && d[o + 2] === b && d[o + 3] === a) {
      return false
    }

    const stroke = this.strokeChanges
    if (stroke) {
      const prev = stroke.get(index)
      if (!prev) {
        stroke.set(index, new Uint8ClampedArray([d[o], d[o + 1], d[o + 2], d[o + 3]]))
      } else if (prev[0] === r && prev[1] === g && prev[2] === b && prev[3] === a) {
        // 涂回了原本的颜色 —— 净变化为零，从集合里剔除，patch 保持最小
        stroke.delete(index)
      }
    }

    d[o] = r
    d[o + 1] = g
    d[o + 2] = b
    d[o + 3] = a
    this.dirty = true
    this.emit()
    return true
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size
  }

  // ------------------------------------------------------------ 笔画收集

  beginStroke(): void {
    this.strokeChanges = new Map()
  }

  /** 结束一次拖拽并把净变化压入撤销栈。@returns 是否真的压入了历史 */
  commitStroke(): boolean {
    const changes = this.strokeChanges
    this.strokeChanges = null
    if (!changes || changes.size === 0) return false

    const count = changes.size
    const indices = new Uint16Array(count)
    const before = new Uint8ClampedArray(count * 4)
    const after = new Uint8ClampedArray(count * 4)
    const d = this.imageData.data

    let i = 0
    for (const [index, prev] of changes) {
      indices[i] = index
      before.set(prev, i * 4)
      const o = index * 4
      after[i * 4] = d[o]
      after[i * 4 + 1] = d[o + 1]
      after[i * 4 + 2] = d[o + 2]
      after[i * 4 + 3] = d[o + 3]
      i += 1
    }

    this.pushPatch({ indices, before, after })
    return true
  }

  /** 中断当前笔画且不记录历史（例如指针移出窗口） */
  abortStroke(): void {
    this.strokeChanges = null
  }

  private pushPatch(patch: PixelPatch): void {
    this.undoStack.push(patch)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack.length = 0
  }

  private applyBytes(indices: Uint16Array, bytes: Uint8ClampedArray): void {
    const d = this.imageData.data
    for (let i = 0; i < indices.length; i += 1) {
      const o = indices[i] * 4
      d[o] = bytes[i * 4]
      d[o + 1] = bytes[i * 4 + 1]
      d[o + 2] = bytes[i * 4 + 2]
      d[o + 3] = bytes[i * 4 + 3]
    }
    this.dirty = true
    this.emit()
  }

  // -------------------------------------------------------------- 变更订阅

  /** 订阅像素变更。返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  // ---------------------------------------------------------------- 历史

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 已记录的历史步数，用于状态栏显示 */
  get historyDepth(): number {
    return this.undoStack.length
  }

  /**
   * 画布是否全空（所有像素 alpha = 0）。
   *
   * 用于「空画布不算草稿」这一条不变式：新建/清空之后不该再把空白板写进
   * 本地快照，否则刷新时会把用户卡在一张空皮肤上，还谎称「已恢复上次编辑」。
   */
  isEmpty(): boolean {
    const d = this.imageData.data
    const total = this.size * this.size
    for (let i = 0; i < total; i += 1) {
      if (d[i * 4 + 3] !== 0) return false
    }
    return true
  }

  undo(): boolean {
    const patch = this.undoStack.pop()
    if (!patch) return false
    this.applyBytes(patch.indices, patch.before)
    this.redoStack.push(patch)
    return true
  }

  redo(): boolean {
    const patch = this.redoStack.pop()
    if (!patch) return false
    this.applyBytes(patch.indices, patch.after)
    this.undoStack.push(patch)
    return true
  }

  // ---------------------------------------------------------------- 整体

  /** 清空画布，本身也可撤销（只记录非透明像素，仍是差集） */
  clear(): boolean {
    const d = this.imageData.data
    const hits: number[] = []
    const total = this.size * this.size
    for (let i = 0; i < total; i += 1) {
      if (d[i * 4 + 3] !== 0) hits.push(i)
    }
    if (hits.length === 0) return false

    const indices = new Uint16Array(hits)
    const before = new Uint8ClampedArray(hits.length * 4)
    hits.forEach((index, i) => {
      before.set(d.subarray(index * 4, index * 4 + 4), i * 4)
    })
    const after = new Uint8ClampedArray(hits.length * 4) // 全透明

    this.applyBytes(indices, after)
    this.pushPatch({ indices, before, after })
    return true
  }

  /**
   * 用一张图片替换整张皮肤（导入语义，会清空历史）。
   *
   * 落格规则（64×64 原样 / 旧版 64×32 补全 / 其他尺寸拉伸）在 `drawSkinInto` 里，
   * 与合成页解码源图走的是同一份实现 —— 两边各写一遍必然会分叉。
   */
  loadSkinImage(source: DrawableSkin): SkinSourceInfo {
    this.flush()
    const info = drawSkinInto(this.ctx, source, this.size)

    this.imageData = this.ctx.getImageData(0, 0, this.size, this.size)
    this.dirty = false
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.emit()

    return info
  }
}
