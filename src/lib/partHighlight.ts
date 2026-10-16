import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import type { Object3D } from 'three'
import type { SkinObject } from 'skinview3d'
import { ALL_BODY_KEYS } from './skinParts'
import type { BodyKey } from './skinParts'

/**
 * 高亮外壳比内层网格每轴多出的尺寸（单位 = 皮肤像素 = 模型世界 1 单位）。
 *
 * 参考值：外层（帽子 / 外套那层）比内层每轴各多 0.5，头部是 1。
 * 取 1.6 是为了让外壳稳定浮在两层之外，不至于和外套产生 z-fighting。
 */
const HULL_PADDING = 1.6

const SELECTED_COLOR = '#38bdf8'
const SELECTED_OPACITY = 0.32
const HOVER_COLOR = '#7dd3fc'
const HOVER_OPACITY = 0.14

type Hull = Mesh<BoxGeometry, MeshBasicMaterial>

/**
 * 给部件套一层半透明发光外壳。
 *
 * 为什么不直接改材质颜色：skinview3d 的 6 个部件**共用同一个材质实例**
 * （head / body 用 layer1Material，四肢用 layer1MaterialBiased），
 * 改任何一个都会把全身染色。所以统一用「额外外壳」方案，零侵入。
 *
 * 外壳挂在「内层网格的父级」而不是部件组上 —— 因为手臂和腿的内层网格被
 * pivot Group 包了一层（还带偏移动画），跟着内层网格走才能对得上。
 */
export class PartHighlighter {
  private readonly hulls: Hull[] = []
  private readonly byPart = new Map<BodyKey, Hull>()
  private selected: BodyKey | null = null
  private hovered: BodyKey | null = null

  constructor(skin: SkinObject) {
    for (const key of ALL_BODY_KEYS) {
      const hull = buildHull(skin[key].innerLayer)
      if (!hull) continue
      this.byPart.set(key, hull)
      this.hulls.push(hull)
    }
    this.apply()
  }

  setSelected(part: BodyKey | null): void {
    if (this.selected === part) return
    this.selected = part
    this.apply()
  }

  setHover(part: BodyKey | null): void {
    if (this.hovered === part) return
    this.hovered = part
    this.apply()
  }

  dispose(): void {
    for (const hull of this.hulls) {
      hull.removeFromParent()
      hull.geometry.dispose()
      hull.material.dispose()
    }
    this.hulls.length = 0
    this.byPart.clear()
    this.selected = null
    this.hovered = null
  }

  private apply(): void {
    for (const [part, hull] of this.byPart) {
      const isSelected = part === this.selected
      const isHovered = part === this.hovered
      hull.visible = isSelected || isHovered
      if (isSelected) {
        hull.material.color.set(SELECTED_COLOR)
        hull.material.opacity = SELECTED_OPACITY
      } else if (isHovered) {
        hull.material.color.set(HOVER_COLOR)
        hull.material.opacity = HOVER_OPACITY
      }
    }
  }
}

/** 用内层网格的几何尺寸造一个正好包住它的外壳 */
function buildHull(innerLayer: Object3D): Hull | null {
  if (!(innerLayer instanceof Mesh)) return null

  const geometry = innerLayer.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box) return null

  // 手臂的内层网格是「1x1x1 的方块 + scale」缩出来的，头部和腿用的是实尺寸几何体，
  // 必须把 scale 乘进尺寸里，两种做法才能共用同一套计算
  const size = box.getSize(new Vector3()).multiply(innerLayer.scale)
  const center = box.getCenter(new Vector3()).multiply(innerLayer.scale)

  const hullGeometry = new BoxGeometry(
    size.x + HULL_PADDING,
    size.y + HULL_PADDING,
    size.z + HULL_PADDING,
  )
  // 几何体包围盒中心若不落在原点上，外壳要跟着平移，否则会偏心
  hullGeometry.translate(center.x, center.y, center.z)

  const material = new MeshBasicMaterial({
    color: new Color(HOVER_COLOR),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })

  const hull = new Mesh(hullGeometry, material)
  hull.name = 'part-highlight-hull'
  // 第二道防线：pickPart 已经用白名单把外壳排除在外，这里再把 raycast 置空，
  // 万一以后有人改成递归整棵子树做检测，外壳也不会挡住自己包裹的部件
  hull.raycast = () => {}
  hull.visible = false
  hull.position.copy(innerLayer.position)
  hull.quaternion.copy(innerLayer.quaternion)

  innerLayer.parent?.add(hull)
  return hull
}
