import { SKIN_SIZE } from '../constants'
import type { SkinDocument } from './SkinDocument'
import { FACE_IDS, getFaceRect } from './skinFaces'
import type { SkinLayer } from './skinFaces'
import { MODEL_LABELS, modelFileSuffix } from './skinModel'
import type { ModelKind } from './skinModel'
import { ALL_BODY_KEYS } from './skinParts'

/**
 * 导出为「可直接导入 Minecraft 的 64×64 PNG」。
 *
 * 合规性相关的事实（都写在这里，因为这是唯一产出文件的地方）：
 *
 * 1. **尺寸 64×64**。Minecraft 1.8 之后的标准皮肤尺寸。旧版 64×32 一律在导入时
 *    就补全成 64×64（见 skinFormat.ts），所以导出永远是 64×64，不必分叉。
 * 2. **必须带 alpha 通道**。第二层（帽子 / 外套 / 袖子 / 裤腿覆盖层）就是靠全透明
 *    表示"这格没东西"，丢掉 alpha 会把整张皮肤变成不透明的方块。
 * 3. **非交错（interlace = 0）、8bit RGBA**。canvas.toBlob('image/png') 天然如此，
 *    这里不做手工编码，正是为了不引入这个风险。
 * 4. **alpha = 0 的像素，RGB 归零**。这一条是主动规范化，理由见
 *    `normalizeTransparentPixels` 的注释。
 * 5. **第一层不该有透明像素**（`countBaseHoles` 专门数它）。Minecraft Wiki「Skin」原文：
 *    "If a skin with transparent pixels on the first layer is uploaded, the transparent pixels
 *    render as black pixels in-game." —— 文件传得上去，但在游戏里是**黑洞**。
 *    同一段还写着第一层的半透明像素会被上传服务按 alpha 重新量化 RGB（等于改色）。
 *    Bedrock 版更严：两层都不接受半透明（只能 0% 或 100%）。
 *    所以编辑器在**落笔那一刻**就把第一层的橡皮改成填黑（见 SkinCanvas2D），
 *    这里只做兜底检测 —— 导入的旧皮肤可能本来就带空洞，导出前必须让用户看见。
 * 6. **体型（宽型 / 纤细）不在这个文件里**，见 skinModel.ts 的说明。它只写进文件名。
 */

/**
 * 把「完全透明但 RGB 非零」的像素洗成 (0,0,0,0)。
 *
 * 为什么必须做：PNG 规范里 alpha=0 时 RGB 无意义，Minecraft 自己渲染时也会
 * 乘上 alpha 让它消失，所以画面上看不出区别。但**读取这张图的不止 Minecraft** ——
 * 皮肤查看器、服务器插件、截图工具、缩略图生成器里，很大一部分只读 RGB 不看 alpha，
 * 于是"擦掉过的像素"会以残色显示（典型症状是皮肤边缘一圈脏色）。
 * Mojang 官方皮肤的透明区清一色是 (0,0,0,0)，导出对齐它没有任何副作用。
 *
 * 注意：半透明（0 < alpha < 255）的像素**不动**，那是用户有意做的效果。
 *
 * @returns 被修正的像素个数
 */
export function normalizeTransparentPixels(data: Uint8ClampedArray | Uint8Array): number {
  let fixed = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 && (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0)) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      fixed += 1
    }
  }
  return fixed
}

/**
 * 某一层实际被使用的像素掩码。
 *
 * 为什么要枚举「6 部件 × 6 面」而不是简单地取"下半张图"：64×64 布局里有相当一部分
 * 是**未使用区域**（如 x∈[56,64) y∈[16,32)），把它算进来会误判成"第二层有内容"。
 * 又因为 slim 模型手臂只有 3 像素宽、各面 UV 矩形比经典窄，所以经典与 slim 两套矩形
 * 取并集，避免 slim 皮肤漏判。
 */
function buildLayerMask(layer: SkinLayer): Uint8Array {
  const mask = new Uint8Array(SKIN_SIZE * SKIN_SIZE)
  for (const key of ALL_BODY_KEYS) {
    for (const face of FACE_IDS) {
      for (const slim of [false, true]) {
        const r = getFaceRect(key, face, layer, slim)
        for (let y = r.y; y < r.y + r.h; y += 1) {
          if (y < 0 || y >= SKIN_SIZE) continue
          for (let x = r.x; x < r.x + r.w; x += 1) {
            if (x < 0 || x >= SKIN_SIZE) continue
            mask[y * SKIN_SIZE + x] = 1
          }
        }
      }
    }
  }
  return mask
}

// 掩码与贴图内容无关，算一次即可
let baseMaskCache: Uint8Array | null = null
let overlayMaskCache: Uint8Array | null = null

function layerMask(layer: SkinLayer): Uint8Array {
  if (layer === 'base') {
    baseMaskCache ??= buildLayerMask('base')
    return baseMaskCache
  }
  overlayMaskCache ??= buildLayerMask('overlay')
  return overlayMaskCache
}

export interface SkinStats {
  /** 第一层里有内容的像素数 */
  base: number
  /** 第二层里有内容的像素数（> 0 即双层皮肤） */
  overlay: number
  /** 全图 alpha = 255 的像素数 */
  opaque: number
  /** 全图 0 < alpha < 255 的像素数（半透明，部分查看器支持） */
  semiTransparent: number
  /**
   * **第一层实际会被渲染的面**里 alpha = 0 的像素数。
   * Java 版会把它渲染成黑色，Bedrock 版要求每个身体部位至少留一个可见像素。
   * 正常编辑（橡皮在第一层填黑）下恒为 0，只有导入的旧皮肤自带空洞时才会 > 0。
   */
  baseHoles: number
}

/**
 * 数第一层的空洞。
 *
 * 只枚举**当前体型下**的面矩形，而不是经典 ∪ slim 的并集（`buildLayerMask` 那种）：
 * 并集会把手臂区域里属于另一种体型的、本来就不渲染的格子算进来，凭空报出空洞。
 * 各面的 UV 矩形互不重叠，所以直接累加不需要去重。
 */
export function countBaseHoles(data: Uint8ClampedArray | Uint8Array, slim: boolean): number {
  let holes = 0
  for (const key of ALL_BODY_KEYS) {
    for (const face of FACE_IDS) {
      const r = getFaceRect(key, face, 'base', slim)
      for (let y = r.y; y < r.y + r.h; y += 1) {
        if (y < 0 || y >= SKIN_SIZE) continue
        for (let x = r.x; x < r.x + r.w; x += 1) {
          if (x < 0 || x >= SKIN_SIZE) continue
          if (data[(y * SKIN_SIZE + x) * 4 + 3] === 0) holes += 1
        }
      }
    }
  }
  return holes
}

export function measureSkin(
  data: Uint8ClampedArray | Uint8Array,
  slim = false,
): SkinStats {
  const base = layerMask('base')
  const overlay = layerMask('overlay')
  let baseCount = 0
  let overlayCount = 0
  let opaque = 0
  let semi = 0

  const total = SKIN_SIZE * SKIN_SIZE
  for (let i = 0; i < total; i += 1) {
    const a = data[i * 4 + 3]
    if (a === 0) continue
    if (a === 255) opaque += 1
    else semi += 1
    if (base[i]) baseCount += 1
    if (overlay[i]) overlayCount += 1
  }

  return {
    base: baseCount,
    overlay: overlayCount,
    opaque,
    semiTransparent: semi,
    baseHoles: countBaseHoles(data, slim),
  }
}

/**
 * 作品的来源。
 *
 * 浏览器下载**只能给一个文件名，指定不了目录**，所以用前缀代替"分文件夹"：
 * 下载目录按名字排序时，「绘制-」和「合成-」自然聚成两组，一眼分得开。
 * （要真写进两个真文件夹，得走 File System Access API 让用户先授权一个作品目录。）
 */
export type WorkKind = 'draw' | 'merge'

export const WORK_KIND_PREFIX: Record<WorkKind, string> = {
  draw: '绘制-',
  merge: '合成-',
}

/** 去掉文件名里所有对文件系统有歧义的字符 */
export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'my-skin'
}

export interface SkinExport {
  blob: Blob
  filename: string
  /** 被规范化掉的透明像素数（只是为了报出来，不影响正确性） */
  normalized: number
  stats: SkinStats
  /** 第二层有没有内容 */
  layers: 'single' | 'double'
  size: number
  dataUrl: string
  /** 导出时用的体型。文件名里有它，这里也留着供调用方拼提示语 */
  model: ModelKind
}

/**
 * 从一张 64×64 皮肤画布生成待导出的 PNG。
 *
 * 刻意**不修改输入画布**：规范化只作用在导出副本上。
 * 若就地改，用户会平白多出一步"看不见的"改动（在编辑器里还没法撤销）。
 *
 * `model` 只影响**文件名**（体型不在 PNG 里，见 skinModel.ts）。同时决定用哪套
 * 手臂 UV 去数第一层空洞 —— 两种体型的手臂矩形宽度不同，数错了数就不对。
 */
export async function buildSkinPngFromCanvas(
  source: HTMLCanvasElement,
  baseName: string,
  model: ModelKind = 'wide',
  kind: WorkKind = 'draw',
): Promise<SkinExport> {
  const slim = model === 'slim'
  const scratch = document.createElement('canvas')
  scratch.width = SKIN_SIZE
  scratch.height = SKIN_SIZE
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建导出用画布')

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE)
  ctx.drawImage(source, 0, 0)

  const image = ctx.getImageData(0, 0, SKIN_SIZE, SKIN_SIZE)
  const normalized = normalizeTransparentPixels(image.data)
  if (normalized > 0) ctx.putImageData(image, 0, 0)

  const stats = measureSkin(image.data, slim)

  const blob = await new Promise<Blob>((resolve, reject) => {
    scratch.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('PNG 编码失败'))),
      'image/png',
    )
  })

  return {
    blob,
    filename: `${WORK_KIND_PREFIX[kind]}${sanitizeFileName(baseName)}${modelFileSuffix(model)}.png`,
    normalized,
    stats,
    layers: stats.overlay > 0 ? 'double' : 'single',
    size: SKIN_SIZE,
    dataUrl: scratch.toDataURL('image/png'),
    model,
  }
}

/** 从编辑文档导出。`doc.canvas` 的 getter 会先 flush 内存镜像，拿到的必定是最新像素 */
export async function buildSkinPng(
  doc: SkinDocument,
  baseName: string,
  model: ModelKind = 'wide',
  kind: WorkKind = 'draw',
): Promise<SkinExport> {
  return buildSkinPngFromCanvas(doc.canvas, baseName, model, kind)
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  // Firefox 要求锚点真的在文档里才会响应 click()
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * 导出后在状态栏显示的一句话摘要。
 *
 * 只留两条真正会被用到的信息：层数、上传时该选哪个体型。
 * 第一层空洞要**顶掉**其他信息来说 —— 它是最容易被忽略、后果又最明显的一条
 * （文件能传上去，进游戏才发现身上有黑斑）。其他信息丢了都能再查，这条不能。
 */
export function describeExport(result: SkinExport): string {
  const layerText = result.layers === 'double' ? '双层' : '单层'
  if (result.stats.baseHoles > 0) {
    return `已导出 ${result.filename}；⚠ 第一层有 ${result.stats.baseHoles} 个透明像素，游戏里会显示成黑色`
  }
  return `已导出 ${result.filename}（${layerText} · 上传时选「${MODEL_LABELS[result.model]}」）`
}
