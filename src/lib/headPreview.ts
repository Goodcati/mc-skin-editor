import { renderHeadIsometric } from './headIso'
import { drawSkinInto } from './skinImage'
import type { WorkItem } from './works'

/**
 * 大厅作品列表的「3D 头部预览」渲染器（纯 2D 等距，无 WebGL）。
 *
 * 流程：作品 dataUrl → 解码成 64×64 皮肤画布 → renderHeadIsometric（纯函数等距投影）
 * → putImageData 到 128×128 canvas → toDataURL → 内存缓存。列表显示 <img>。
 *
 * 不再依赖 WebGL：等距渲染是确定性的纯函数（见 headIso.ts），无上下文上限问题、
 * 无需「WebGL 失败降级」。唯一仍要降级的是**解码失败**（dataUrl 坏了 / 图片加载失败），
 * 此时返回 null，调用方退回作品自带的 PNG 缩略图。
 */

/** 输出缩略图边长（CSS 像素） */
const THUMB = 128

/** 内存缓存：key = `id:updatedAt`（作品时间戳一变，缓存自动失效） */
const cache = new Map<string, string>()

/** 正在解码 / 渲染中的 key，避免同一件重复入队 */
const inFlight = new Set<string>()

/** 等结果的回调：key -> 回调列表 */
const pending = new Map<string, ((dataUrl: string | null) => void)[]>()

function cacheKey(work: WorkItem): string {
  return `${work.id}:${work.updatedAt}`
}

/** 把作品 dataUrl 解码成 64×64 皮肤画布（处理旧版 / 非标尺寸） */
async function loadSkinCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('图片解码失败'))
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建皮肤解码画布')
  drawSkinInto(ctx, image, 64)
  return canvas
}

/** 渲染一件作品成等距头部 dataURL；解码失败返回 null（降级） */
async function renderOne(work: WorkItem): Promise<string | null> {
  try {
    const skinCanvas = await loadSkinCanvas(work.dataUrl)
    const ctx = skinCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const imageData = ctx.getImageData(0, 0, 64, 64)
    // 显式拷贝成 ArrayBuffer-backed 数组：getImageData 返回的 data 可能是 SharedArrayBuffer，
    // 而 renderHeadIsometric / new ImageData 需要普通 ArrayBuffer 类型
    const pixels = new Uint8ClampedArray(imageData.data)

    const out = renderHeadIsometric(pixels, THUMB)

    const result = document.createElement('canvas')
    result.width = THUMB
    result.height = THUMB
    const rctx = result.getContext('2d')
    if (!rctx) return null
    rctx.putImageData(new ImageData(out, THUMB, THUMB), 0, 0)
    return result.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * 请求一件作品的头部预览 dataURL。
 *
 * - 命中缓存：立即返回该 dataURL。
 * - 未命中：入队并注册回调，返回 null（调用方先用 PNG 占位），
 *   渲染完成（或失败）后通过 `onDone` 回调通知。
 */
export function requestHeadThumb(
  work: WorkItem,
  onDone: (dataUrl: string | null) => void,
): string | null {
  const key = cacheKey(work)

  const hit = cache.get(key)
  if (hit) return hit

  const list = pending.get(key) ?? []
  list.push(onDone)
  pending.set(key, list)

  if (!inFlight.has(key)) {
    inFlight.add(key)
    void (async () => {
      let url: string | null = null
      try {
        url = await renderOne(work)
        if (url) cache.set(key, url)
      } catch {
        url = null
      } finally {
        inFlight.delete(key)
      }
      const callbacks = pending.get(key)
      if (callbacks) {
        pending.delete(key)
        for (const cb of callbacks) cb(url)
      }
    })()
  }

  return null
}
