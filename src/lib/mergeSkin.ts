import { SKIN_SIZE } from '../constants'
import { measureSkin } from './exportSkin'
import type { SkinStats } from './exportSkin'
import { FACE_IDS, LAYER_IDS, getFaceRect } from './skinFaces'
import type { FaceRect, SkinLayer } from './skinFaces'
import { MODEL_LABELS } from './skinModel'
import type { ModelKind } from './skinModel'
import { ALL_BODY_KEYS } from './skinParts'
import type { BodyKey } from './skinParts'

/**
 * 合成皮肤：把两张皮肤按「部件 × 层」拼成一张。
 *
 * 这是工具的另一半。绘制解决"从零画一张"，合成解决"给已有角色更衣" ——
 * 而它能成立，靠的是 `getFaceRect(部件, 面, 层)` 已经把一张皮肤精确切成了
 * 6 部件 × 6 面 × 2 层 = 72 个互不重叠的块（见 skinFaces.ts）。
 * 合成本质上就是给这些块各指定一个来源：A 还是 B。
 *
 * 三条设计约束，都来自踩过的坑：
 *
 * 1. **第二层必须整块覆盖。** 第二层（帽子 / 外套 / 袖子）默认是透明的。
 *    如果只覆盖"非透明像素"，A 的帽子会残留在 B 的衣服上叠成两层。
 *    所以按"区域"取，而不是按"有没有像素"取。
 * 2. **跨体型要重排手臂。** 宽型手臂 4 像素、纤细 3 像素，前 / 后 / 顶 / 底 / 左五个面的
 *    UV 矩形位置都不一样，直接按坐标照搬会整体错位。见 `remapArms`。
 * 3. **输出只由选择表决定。** 不属于任何部件的未使用区留透明，不"顺手用 A 的补上" ——
 *    否则选「全用 B」也会把 A 的像素带进输出。见 `composeMerge`。
 */

export type SourceId = 'a' | 'b'

export const SOURCE_IDS: readonly SourceId[] = ['a', 'b']

export const SOURCE_LABELS: Record<SourceId, string> = {
  a: '皮肤 A',
  b: '皮肤 B',
}

export interface MergeSource {
  name: string
  /** 64×64 像素快照。**保持它自己的体型布局**，到合成那一步才按输出体型重排 */
  image: ImageData
  /** 这张图自身的体型（导入时按像素推断，用户可改） */
  model: ModelKind
  width: number
  height: number
  legacy: boolean
  standard: boolean
}

/** 每个部件、每一层的来源选择 */
export interface PartChoice {
  base: SourceId
  overlay: SourceId
}

export type MergeChoice = Record<BodyKey, PartChoice>

export function defaultChoice(id: SourceId = 'a'): MergeChoice {
  const entry = (): PartChoice => ({ base: id, overlay: id })
  return Object.fromEntries(ALL_BODY_KEYS.map((key) => [key, entry()])) as MergeChoice
}

// ------------------------------------------------------------------ 区域归属

export interface RegionOwner {
  key: BodyKey
  layer: SkinLayer
}

const regionCache = new Map<ModelKind, (RegionOwner | null)[]>()

/**
 * 「这个像素属于哪个部件哪一层」的查找表，64×64 = 4096 项，按体型缓存。
 *
 * 为什么要显式枚举 6 面：盒子的 UV 展开是个**十字形**，它的包围盒四角是空的
 * （比如身体第一层的包围盒是 24×16，而顶面只占中间 8×4，两侧各空 4×4）。
 * 按包围盒整块搬会把那些空位也算成"这个部件的内容"，把别的部件或空白一起搬过来。
 *
 * 不属于任何面的像素（贴图里的未使用区）保持 null，合成时留透明 ——
 * 见 `composeMerge` 里为什么**不能**退回"原样用 A 的"。
 */
export function buildRegionMap(model: ModelKind): (RegionOwner | null)[] {
  const cached = regionCache.get(model)
  if (cached) return cached

  const slim = model === 'slim'
  const map: (RegionOwner | null)[] = new Array(SKIN_SIZE * SKIN_SIZE).fill(null)

  for (const layer of LAYER_IDS) {
    for (const key of ALL_BODY_KEYS) {
      for (const face of FACE_IDS) {
        const r = getFaceRect(key, face, layer, slim)
        for (let y = r.y; y < r.y + r.h; y += 1) {
          for (let x = r.x; x < r.x + r.w; x += 1) {
            map[y * SKIN_SIZE + x] = { key, layer }
          }
        }
      }
    }
  }

  regionCache.set(model, map)
  return map
}

/**
 * 自检：面矩形两两不重叠、不越界。
 *
 * 这套 UV 三角关系（部件 × 面 × 层，再乘两种体型）人眼是核不出来的，
 * 一旦有重叠，合成时"后写的赢"，表现是某个部件莫名被另一个部件的像素污染。
 * 所以做成可调用的检查，验证脚本直接在页面里跑它。
 */
export function assertRegionMap(model: ModelKind): string[] {
  const problems: string[] = []
  const seen = new Map<number, RegionOwner>()
  const slim = model === 'slim'

  for (const layer of LAYER_IDS) {
    for (const key of ALL_BODY_KEYS) {
      for (const face of FACE_IDS) {
        const r = getFaceRect(key, face, layer, slim)
        if (r.x < 0 || r.y < 0 || r.x + r.w > SKIN_SIZE || r.y + r.h > SKIN_SIZE) {
          problems.push(`${layer}/${key}/${face} 越界: (${r.x},${r.y}) ${r.w}×${r.h}`)
          continue
        }
        for (let y = r.y; y < r.y + r.h; y += 1) {
          for (let x = r.x; x < r.x + r.w; x += 1) {
            const index = y * SKIN_SIZE + x
            const prev = seen.get(index)
            if (prev) {
              problems.push(
                `像素 (${x},${y}) 同时属于 ${prev.layer}/${prev.key} 与 ${layer}/${key}/${face}`,
              )
              continue
            }
            seen.set(index, { key, layer })
          }
        }
      }
    }
  }

  return problems
}

/**
 * 某部件某一层在贴图上的包围盒，只用来做**缩略图取景**。
 * 不能拿它当合成依据 —— 包围盒含空角，见 `buildRegionMap` 的说明。
 */
export function partBounds(key: BodyKey, layer: SkinLayer, slim: boolean): FaceRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const face of FACE_IDS) {
    const r = getFaceRect(key, face, layer, slim)
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ------------------------------------------------------------------ 体型重排

/** 只有手臂随体型变宽变窄；头、身体、腿在两种体型下布局完全相同 */
const ARM_KEYS: readonly BodyKey[] = ['rightArm', 'leftArm']

/** 最近邻重采样：把一个面矩形的内容搬到另一个（尺寸可能不同的）面矩形 */
function blitFace(
  src: Uint8ClampedArray,
  rs: FaceRect,
  dst: Uint8ClampedArray,
  rd: FaceRect,
): void {
  for (let j = 0; j < rd.h; j += 1) {
    const sy = rs.y + Math.min(rs.h - 1, Math.floor((j * rs.h) / rd.h))
    for (let i = 0; i < rd.w; i += 1) {
      const sx = rs.x + Math.min(rs.w - 1, Math.floor((i * rs.w) / rd.w))
      const so = (sy * SKIN_SIZE + sx) * 4
      const dofs = ((rd.y + j) * SKIN_SIZE + rd.x + i) * 4
      dst[dofs] = src[so]
      dst[dofs + 1] = src[so + 1]
      dst[dofs + 2] = src[so + 2]
      dst[dofs + 3] = src[so + 3]
    }
  }
}

/**
 * 把手臂贴图从一种体型布局重排到另一种。
 *
 * 为什么要做：一张皮肤的像素是**按某一种体型布局**排的。宽型手臂前 / 后 / 顶 / 底 / 左侧
 * 五个面的 UV 矩形位置都比纤细往右偏（最多偏 1~2 列），所以两张不同体型的皮肤直接按坐标
 * 拼起来，手臂会整体错位 —— 表现是袖子花纹被切掉一条、边界处露出隔壁面的像素。
 *
 * 做法：按**面**做矩形到矩形的最近邻重采样（而不是按坐标 1:1 拷贝），
 * 位置偏移和宽度差（4↔3）就一起被处理掉了。只有手臂需要，其他部件布局完全一致。
 *
 * 另外要把两种布局的包围盒都清一遍：宽型的区域比纤细宽，不清会在输出里留下
 * 旧布局的残像素。在"合成"这条链路上这一步其实是多余的（那些格子不属于任何面，
 * `composeMerge` 本来就不会取值），但 `remapArms` 是个可独立使用的转换函数，
 * 它自己就该保证输出里没有目标布局用不到的东西。
 */
export function remapArms(image: ImageData, from: ModelKind, to: ModelKind): ImageData {
  if (from === to) return image

  const src = image.data
  const out = new ImageData(new Uint8ClampedArray(src), SKIN_SIZE, SKIN_SIZE)
  const dst = out.data
  const slimFrom = from === 'slim'
  const slimTo = to === 'slim'

  for (const key of ARM_KEYS) {
    for (const layer of LAYER_IDS) {
      for (const slim of [slimFrom, slimTo]) {
        const box = partBounds(key, layer, slim)
        for (let y = box.y; y < box.y + box.h; y += 1) {
          for (let x = box.x; x < box.x + box.w; x += 1) {
            const o = (y * SKIN_SIZE + x) * 4
            dst[o] = 0
            dst[o + 1] = 0
            dst[o + 2] = 0
            dst[o + 3] = 0
          }
        }
      }
      for (const face of FACE_IDS) {
        blitFace(
          src,
          getFaceRect(key, face, layer, slimFrom),
          dst,
          getFaceRect(key, face, layer, slimTo),
        )
      }
    }
  }

  return out
}

// -------------------------------------------------------------------- 合成

export interface MergeResult {
  image: ImageData
  stats: SkinStats
  layers: 'single' | 'double'
  /** 体型不一致导致手臂被重排的源，供界面提示 */
  remapped: SourceId[]
  /** 拼给用户看的一句话说明 */
  notes: string[]
}

export type SourceSlots = { a: MergeSource | null; b: MergeSource | null }

/**
 * 按选择把两张源图拼成一张 64×64。
 *
 * **输出只由选择表决定**：属于某部件某层的像素取那一层的来源，
 * 其余（贴图里不属于任何面的未使用区）一律留透明。
 *
 * 未使用区为什么不"原样用 A 的"：那样选「全用 B」也会把 A 的像素带进结果。
 * 实测就是这么发现的 —— 输出里混着另一张皮肤的残色，界面上完全看不出来
 * （那些格子 MC 不渲染），但文件拿去逐像素比就会露馅，而且"这个文件到底是 A 的还是 B 的"
 * 变得说不清。留透明是有语义的："这里没有东西"，和 Mojang 官方素材的做法一致。
 */
export function composeMerge(
  sources: SourceSlots,
  choice: MergeChoice,
  outputModel: ModelKind,
): MergeResult | null {
  const { a, b } = sources
  if (!a && !b) return null

  /** 某个来源没载入时的兜底（界面已经把没载入那侧的按钮禁掉了，这里只是防呆） */
  const defaultId: SourceId = a ? 'a' : 'b'
  const pick = (id: SourceId) => (id === 'a' ? a : b)

  // 先各自重排到输出体型，之后所有拷贝都是同构的 1:1
  const prepared: Partial<Record<SourceId, Uint8ClampedArray>> = {}
  const remapped: SourceId[] = []
  for (const id of SOURCE_IDS) {
    const source = pick(id)
    if (!source) continue
    if (source.model === outputModel) {
      prepared[id] = source.image.data
    } else {
      prepared[id] = remapArms(source.image, source.model, outputModel).data
      remapped.push(id)
    }
  }

  const fallbackBytes = prepared[defaultId]
  if (!fallbackBytes) return null

  const map = buildRegionMap(outputModel)
  // ImageData 初值就是全 (0,0,0,0)，未使用区不用再管
  const out = new ImageData(SKIN_SIZE, SKIN_SIZE)
  const dst = out.data
  const total = SKIN_SIZE * SKIN_SIZE

  for (let i = 0; i < total; i += 1) {
    const owner = map[i]
    if (!owner) continue
    const c = choice[owner.key]
    const bytes = prepared[owner.layer === 'base' ? c.base : c.overlay] ?? fallbackBytes
    const o = i * 4
    dst[o] = bytes[o]
    dst[o + 1] = bytes[o + 1]
    dst[o + 2] = bytes[o + 2]
    dst[o + 3] = bytes[o + 3]
  }

  const stats = measureSkin(dst, outputModel === 'slim')

  const notes: string[] = []
  for (const id of remapped) {
    const source = pick(id)
    if (!source) continue
    notes.push(
      `${SOURCE_LABELS[id]}是${MODEL_LABELS[source.model]}，手臂贴图已重排为${MODEL_LABELS[outputModel]}`,
    )
  }

  return {
    image: out,
    stats,
    layers: stats.overlay > 0 ? 'double' : 'single',
    remapped,
    notes,
  }
}

/** 合成结果的文件名基名：两张源图的名字拼起来（导出时会再追加体型后缀） */
export function mergeBaseName(sources: SourceSlots): string {
  const names = SOURCE_IDS.map((id) => sources[id]?.name).filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  )
  if (names.length === 0) return '合成皮肤'
  if (names.length === 1) return `${names[0]}-合成`
  return `${names[0]}+${names[1]}`
}
