import { SKIN_SIZE } from '../constants'
import { convertSkinTo1x8, isLegacySkinSize } from './skinFormat'

/**
 * 皮肤图片的解码与落格 —— 把任意一张 PNG 变成「64×64 的皮肤像素」。
 *
 * 三条规则（与 `SkinDocument.loadSkinImage` 完全一致，那边也是调这里的 `drawSkinInto`）：
 *  - 标准 64×64：原样贴入；
 *  - 旧版 64×32：内容贴进上半部分后镜像补出左腿 / 左臂（见 skinFormat.ts）；
 *  - 其他尺寸：等比拉伸填满，避免出现半截图。
 *
 * 单独成一个模块是因为它有两个调用方：编辑器的像素文档，和合成页的两张源图。
 * 合成页只需要一张只读的 64×64 像素快照，不应该为此背上撤销栈和订阅机制。
 */

/** 能当皮肤源来画的东西。canvas 也算 —— 合成结果是先画进一张画布的。 */
export type DrawableSkin = HTMLImageElement | ImageBitmap | HTMLCanvasElement

export interface SkinSourceInfo {
  width: number
  height: number
  /** 是否为 Minecraft 标准皮肤尺寸（64x64 或旧版 64x32） */
  standard: boolean
  /** 是否为旧版 64x32（导入时已自动补全左腿 / 左臂） */
  legacy: boolean
}

/**
 * 取源图的原始像素尺寸。
 *
 * `<img>` 的显示尺寸可能被 CSS 改过，只有 `naturalWidth/naturalHeight` 才是文件真实尺寸；
 * ImageBitmap / canvas 没有这一组属性，`width/height` 就是真实尺寸。
 */
function sourceSize(source: DrawableSkin): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

/**
 * 把一张皮肤图画进目标上下文的左上角，格宽 = `size`。
 *
 * 只负责「画」，不读回像素 —— 让调用方决定是留在自己的 canvas 里（SkinDocument）
 * 还是马上 getImageData 取走（decodeSkinPixels）。
 */
export function drawSkinInto(
  ctx: CanvasRenderingContext2D,
  source: DrawableSkin,
  size: number = SKIN_SIZE,
): SkinSourceInfo {
  const { width, height } = sourceSize(source)

  const exact = width === size && height === size
  const legacy = isLegacySkinSize(width, height)

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, size, size)

  if (exact) {
    ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height)
  } else if (legacy) {
    // 旧版内容占据上半部分，转换函数只写下半部分的左腿 / 左臂区域
    ctx.drawImage(source, 0, 0, width, height, 0, 0, width, height)
    convertSkinTo1x8(ctx, size)
  } else {
    ctx.drawImage(source, 0, 0, width, height, 0, 0, size, size)
  }

  return { width, height, standard: exact || legacy, legacy }
}

export interface DecodedSkin extends SkinSourceInfo {
  /** 64×64 的像素快照，与源图不再有任何引用关系 */
  image: ImageData
}

/** 把一张图解码成 64×64 的独立像素快照（合成页的源图用它） */
export function decodeSkinPixels(source: DrawableSkin): DecodedSkin {
  const canvas = document.createElement('canvas')
  canvas.width = SKIN_SIZE
  canvas.height = SKIN_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建皮肤解码画布')

  const info = drawSkinInto(ctx, source, SKIN_SIZE)
  return { ...info, image: ctx.getImageData(0, 0, SKIN_SIZE, SKIN_SIZE) }
}

/** 64×64 像素快照 -> 一张可 drawImage / 可喂给 skinview3d 的画布 */
export function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建像素画布')
  ctx.putImageData(image, 0, 0)
  return canvas
}
