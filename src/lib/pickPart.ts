import { Matrix3, Mesh, Raycaster, Vector2 } from 'three'
import type { Object3D } from 'three'
import type { SkinObject, SkinViewer } from 'skinview3d'
import type { FaceId } from './skinFaces'
import { ALL_BODY_KEYS } from './skinParts'
import type { BodyKey } from './skinParts'

export interface PickTarget {
  key: BodyKey
  mesh: Mesh
}

/**
 * 建立「可点击网格」白名单：只收六个部位的内层 + 外层网格。
 *
 * 为什么不直接 `intersectObject(skin, true)` 递归整棵子树：
 * skinview3d 的皮肤对象里还挂着默认不加载、`visible = false` 的耳朵网格
 * （`rightEar` / `leftEar`，实测在世界坐标 y≈20，即头顶上方十几像素）。
 * 而 three 的 Raycaster **不会跳过 `visible = false` 的对象** —— 于是点头顶
 * 上方的空白会命中耳朵，再顺着父级链被算成「头部」。
 * 显式列白名单，比命中之后再过滤更不容易漏。
 */
export function createPickTargets(skin: SkinObject): PickTarget[] {
  const targets: PickTarget[] = []
  for (const key of ALL_BODY_KEYS) {
    // BodyPart.innerLayer 声明成 Object3D，实际是 Mesh；类型上收窄一下
    const part = skin[key] as unknown as
      | { innerLayer?: Object3D | null; outerLayer?: Object3D | null }
      | undefined
    for (const layer of [part?.innerLayer, part?.outerLayer]) {
      if (layer instanceof Mesh) targets.push({ key, mesh: layer })
    }
  }
  return targets
}

/** 任一祖先 `visible = false` 就不会被渲染，自然也不该被点中 */
function isRendered(object: Object3D): boolean {
  let node: Object3D | null = object
  while (node) {
    if (!node.visible) return false
    node = node.parent
  }
  return true
}

// 复用同一组临时对象，避免每次 mousemove 都分配新对象
const raycaster = new Raycaster()
const pointerNdc = new Vector2()

/** 屏幕坐标 -> 命中部位；点在空白处返回 null */
export function pickBodyPart(
  viewer: SkinViewer,
  clientX: number,
  clientY: number,
  targets: readonly PickTarget[],
): BodyKey | null {
  const rect = viewer.canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null

  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointerNdc, viewer.camera)

  const pickable: Mesh[] = []
  for (const target of targets) {
    if (isRendered(target.mesh)) pickable.push(target.mesh)
  }
  if (pickable.length === 0) return null

  // 目标已经是具体网格，不需要递归
  const hits = raycaster.intersectObjects(pickable, false)
  if (hits.length === 0) return null

  const hitMesh = hits[0].object
  return targets.find((target) => target.mesh === hitMesh)?.key ?? null
}

const normalMatrix = new Matrix3()

/**
 * 屏幕坐标 -> 命中了某个部件的哪个面（用于「点哪个面就编辑哪个面」）。
 *
 * 面的判定靠命中点的**几何法向**取主轴，而不是靠点的位置反算——
 * 盒子每个面都是平面，法向只有一个非零分量，取主轴是稳的。
 *
 * 法向要经过 `getNormalMatrix(世界矩阵)` 变换：手臂网格用的是非等比缩放
 * （`BoxGeometry(1,1,1)` + `scale(3,12,4)`），直接拿局部法向当世界法向会歪。
 * 非等比缩放只改变长度和方向比例，取主轴后仍然正确，变换完归一化即可。
 *
 * 朝向映射与 `FACE_NORMALS` 一致：+X = 角色左侧面，+Z = 正面，+Y = 顶面。
 */
export function pickPartFace(
  viewer: SkinViewer,
  clientX: number,
  clientY: number,
  meshes: readonly Mesh[],
): FaceId | null {
  const rect = viewer.canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null

  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointerNdc, viewer.camera)

  const pickable = meshes.filter(isRendered)
  if (pickable.length === 0) return null

  const hits = raycaster.intersectObjects(pickable, false)
  const hit = hits[0]
  if (!hit || !hit.face) return null

  normalMatrix.getNormalMatrix(hit.object.matrixWorld)
  const n = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()

  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ax >= ay && ax >= az) return n.x > 0 ? 'left' : 'right'
  if (ay >= az) return n.y > 0 ? 'top' : 'bottom'
  return n.z > 0 ? 'front' : 'back'
}
