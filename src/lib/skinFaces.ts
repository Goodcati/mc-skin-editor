import type { BodyKey } from './skinParts'

/**
 * 面 = 部件盒子的一个朝向。命名以**角色自身**为准：
 *
 * - `front`  正面（角色面朝的方向）
 * - `back`   背面
 * - `left`   角色**自身**的左侧面
 * - `right`  角色自身的右侧面
 * - `top`    顶面
 * - `bottom` 底面
 *
 * three.js 坐标约定（与 skinview3d 一致）：角色面向 +Z、头顶 +Y、角色左手在 +X。
 */
export type FaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'

export const FACE_IDS: readonly FaceId[] = ['front', 'back', 'left', 'right', 'top', 'bottom']

export const FACE_LABELS: Record<FaceId, string> = {
  front: '正面',
  back: '背面',
  left: '左侧面',
  right: '右侧面',
  top: '顶面',
  bottom: '底面',
}

/** 面在模型空间里朝外的法向，用于推导「要转到什么角度才能正对它」 */
export const FACE_NORMALS: Record<FaceId, readonly [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
}

/** 皮肤贴图里某个面的矩形（单位：皮肤像素，左上角为原点） */
export interface FaceRect {
  x: number
  y: number
  w: number
  h: number
}

/** 第一层（皮肤本体） / 第二层（帽子层、外套、袖子、裤腿覆盖层） */
export type SkinLayer = 'base' | 'overlay'

export const LAYER_IDS: readonly SkinLayer[] = ['base', 'overlay']

export const LAYER_LABELS: Record<SkinLayer, string> = {
  base: '第一层',
  overlay: '第二层',
}

/** 部件盒子的尺寸（宽度 / 高度 / 厚度） */
interface PartBox {
  w: number
  h: number
  d: number
}

/**
 * 每个部件盒子在第一层 / 第二层贴图上的基准点。
 *
 * **这份数据必须和 `skinview3d/libs/model.js` 里的 `setSkinUVs(...)` 调用保持一致**，
 * 它就是从那里抄下来的（第一层：head 0,0 / body 16,16 / rightArm 40,16 / leftArm 32,48 /
 * rightLeg 0,16 / leftLeg 16,48；第二层依次 32,0 / 16,32 / 40,32 / 48,48 / 0,32 / 0,48）。
 * 升级 skinview3d 后如果这里对不上，2D 面视图会和 3D 显示错位 —— 先回去核对那一份。
 */
const PART_UV: Record<SkinLayer, Record<BodyKey, { u: number; v: number }>> = {
  base: {
    head: { u: 0, v: 0 },
    body: { u: 16, v: 16 },
    rightArm: { u: 40, v: 16 },
    leftArm: { u: 32, v: 48 },
    rightLeg: { u: 0, v: 16 },
    leftLeg: { u: 16, v: 48 },
  },
  overlay: {
    head: { u: 32, v: 0 },
    body: { u: 16, v: 32 },
    rightArm: { u: 40, v: 32 },
    leftArm: { u: 48, v: 48 },
    rightLeg: { u: 0, v: 32 },
    leftLeg: { u: 0, v: 48 },
  },
}

/**
 * 部件盒子的尺寸。
 *
 * **只有手臂随体型变宽**（纤细 3 / 宽型 4）。这一点容易想当然地写成"slim 的四肢都窄"，
 * 但腿在两种体型下**都是 4 像素宽** —— 依据是 `skinview3d/libs/model.js` 里那些
 * `setSkinUVs` 调用：手臂那两处写的是 `this.slim ? 3 : 4`，而
 * `setSkinUVs(rightLegBox, 0, 16, 4, 12, 4)` / `setSkinUVs(leftLegBox, 16, 48, 4, 12, 4)`
 * 是写死的 4，没有 slim 分支。
 *
 * 写错的后果很具体：纤细体型下选中一条腿，2D 面视图会只画出 3 列，
 * 第 4 列既看不见也画不到（写进去的像素落在取景框之外）。
 */
export function partBox(key: BodyKey, slim = false): PartBox {
  if (key === 'head') return { w: 8, h: 8, d: 8 }
  if (key === 'body') return { w: 8, h: 12, d: 4 }
  if (key === 'rightArm' || key === 'leftArm') return { w: slim ? 3 : 4, h: 12, d: 4 }
  return { w: 4, h: 12, d: 4 }
}

/**
 * 取某个部件某个面在贴图上的矩形。
 *
 * 盒子展开规则与 skinview3d 的 `setUVs` 完全一致：
 * ```
 *   top        (u+d,      v)     w x d
 *   bottom     (u+w+d,    v)     w x d
 *   front      (u+d,      v+d)   w x h
 *   back       (u+w+2d,   v+d)   w x h
 *   侧面两块   (u,        v+d)   d x h
 *              (u+w+d,    v+d)   d x h
 * ```
 *
 * 侧面的对应关系最容易搞反，所以说明一下：skinview3d 内部把 `u` 那块叫 "left"、
 * `u+w+d` 那块叫 "right"，但它把 "left" 块挂到盒子的 **−X 面**、"right" 块挂到 **+X 面**。
 * 而角色左手在 +X，因此——
 *   角色**左侧面**（+X）取 `u+w+d` 那块；
 *   角色**右侧面**（−X）取 `u` 那块。
 */
export function getFaceRect(
  key: BodyKey,
  face: FaceId,
  layer: SkinLayer = 'base',
  slim = false,
): FaceRect {
  const { u, v } = PART_UV[layer][key]
  const { w, h, d } = partBox(key, slim)

  switch (face) {
    case 'top':
      return { x: u + d, y: v, w, h: d }
    case 'bottom':
      return { x: u + w + d, y: v, w, h: d }
    case 'front':
      return { x: u + d, y: v + d, w, h }
    case 'back':
      return { x: u + w + d * 2, y: v + d, w, h }
    case 'left':
      return { x: u + w + d, y: v + d, w: d, h }
    case 'right':
      return { x: u, y: v + d, w: d, h }
  }
}

/** 贴图里所有有效面加起来应当覆盖的像素数，用于自检（见 skinFaces.test 注释） */
export function assertFaceRectsInBounds(): string[] {
  const problems: string[] = []
  for (const layer of LAYER_IDS) {
    for (const key of [
      'head',
      'body',
      'rightArm',
      'leftArm',
      'rightLeg',
      'leftLeg',
    ] as BodyKey[]) {
      for (const face of FACE_IDS) {
        const r = getFaceRect(key, face, layer)
        if (r.x < 0 || r.y < 0 || r.x + r.w > 64 || r.y + r.h > 64) {
          problems.push(`${layer}/${key}/${face} 越界: ${r.x},${r.y} ${r.w}x${r.h}`)
        }
      }
    }
  }
  return problems
}
