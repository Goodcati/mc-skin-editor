import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box3,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three'
import type { Object3D } from 'three'
import type { SkinObject, SkinViewer } from 'skinview3d'
import { Layers } from 'lucide-react'
import PanelShell from './PanelShell'
import SkinViewport from './SkinViewport'
import { createPickTargets, pickPartFace } from '../lib/pickPart'
import type { SkinDocument } from '../lib/SkinDocument'
import { FACE_IDS, FACE_LABELS, FACE_NORMALS, getFaceRect } from '../lib/skinFaces'
import type { FaceId } from '../lib/skinFaces'
import { ALL_BODY_KEYS } from '../lib/skinParts'
import type { BodyKey } from '../lib/skinParts'
import { useEditor } from '../state/EditorContext'

/** 必须与 SkinViewport 建 viewer 时传的 fov 一致，取景算距离要用它 */
const FOV = 50
/**
 * 部件在画面里占的比例。
 *
 * 比"正好框住"留得松：现在可以自由旋转，转起来后投影尺寸会超过正对时的尺寸
 * （正方体沿体对角线看会胀到 √2 倍），按正对尺寸取景会一转就出画。
 */
const FILL = 0.64
const HALF_FOV_TAN = Math.tan(((FOV / 2) * Math.PI) / 180)

/** 按下到抬起的位移超过这个屏幕像素数就算「拖拽旋转」，不当作「选面」 */
const CLICK_SLOP = 5

/** 高亮面板离盒面的间隙，避免与盒面共面闪烁 */
const PLATE_GAP = 0.06

/**
 * 面 -> 高亮平面的旋转（PlaneGeometry 默认朝 +Z）。
 * 与 `FACE_NORMALS` 一一对应：转到该面朝外。
 */
const PLATE_ROTATION: Record<FaceId, readonly [number, number]> = {
  front: [0, 0],
  back: [0, Math.PI],
  left: [0, Math.PI / 2],
  right: [0, -Math.PI / 2],
  top: [-Math.PI / 2, 0],
  bottom: [Math.PI / 2, 0],
}

/** BodyPart 上取内层网格（类型声明是 Object3D，运行期是 Mesh） */
function innerOf(skin: SkinObject, key: BodyKey): Object3D | null {
  const part = skin[key] as unknown as { innerLayer?: Object3D | null } | undefined
  return part?.innerLayer ?? null
}

/** BodyPart 上取外层（第二层）网格 */
function outerOf(skin: SkinObject, key: BodyKey): Object3D | null {
  const part = skin[key] as unknown as { outerLayer?: Object3D | null } | undefined
  return part?.outerLayer ?? null
}

/**
 * 该部位的第二层里有没有实心像素。
 *
 * 用来决定高亮面板贴在哪个盒面上：第二层是放大一圈的覆盖层，如果它有实心像素，
 * 而高亮面板贴在**第一层**表面上，编第一层时面板就会被帽子 / 外套挡在里面看不见。
 * 有实心像素就整块贴到外表面，两层都看得见。
 */
function overlayHasPixels(doc: SkinDocument, key: BodyKey, slim: boolean): boolean {
  for (const face of FACE_IDS) {
    const r = getFaceRect(key, face, 'overlay', slim)
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        if (doc.getPixel(x, y)[3] !== 0) return true
      }
    }
  }
  return false
}

/** 当前编辑面的高亮：一块半透明面板 + 一圈亮边 */
interface FaceRig {
  group: Group
  dispose: () => void
}

function createFaceRig(): FaceRig {
  // 用 1x1 的平面 + group.scale 适配任意尺寸的面，省得每次换面重建几何
  const geometry = new PlaneGeometry(1, 1)
  const fillMaterial = new MeshBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0.16,
    side: DoubleSide,
    depthWrite: false,
  })
  const lineMaterial = new LineBasicMaterial({
    color: 0x6ee7b7,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  const outlineGeometry = new EdgesGeometry(geometry)

  const fill = new Mesh(geometry, fillMaterial)
  const outline = new LineSegments(outlineGeometry, lineMaterial)
  const group = new Group()
  group.visible = false
  group.add(fill, outline)

  return {
    group,
    dispose: () => {
      geometry.dispose()
      outlineGeometry.dispose()
      fillMaterial.dispose()
      lineMaterial.dispose()
    },
  }
}

/**
 * 中上：选中部件的**局部 3D 视图**。
 *
 * 与「面视图」的区别：这里不锁朝向，拖拽可以绕着部件转，能看清它的立体形状 ——
 * 下面 2D 画布只能画一个平面，光看平面是判断不出自己在部件上的什么位置的。
 * 「正在编辑哪个面」由贴在部件表面上的高亮面板标出，面板同时在 2D 画布上被编辑。
 *
 * 显示哪个部件由**左侧整体预览里点选的部件**决定；
 * 换面有两条路：点这里的六个面按钮（相机会转过去正对该面），
 * 或直接**点局部 3D 上的某个面**（不转相机，你看的已经是那一面）。
 *
 * 取景做法：只保留当前部件 → 把它内层的包围盒心搬到世界原点 → 量取景盒 →
 * 按需要的画面占比反推相机距离。盒心落在原点是关键：`controls.target` 就是原点，
 * 相机天然对准部件，旋转时也绕部件中心转。
 */
export default function PartPreview() {
  const { selectedPart, face, setFace, modelType, doc, historyVersion, flash } = useEditor()

  const viewerRef = useRef<SkinViewer | null>(null)
  const rigRef = useRef<FaceRig | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const basePositionRef = useRef<Vector3 | null>(null)
  const prevPartRef = useRef<BodyKey | null | undefined>(undefined)
  const prevViewerVersionRef = useRef(-1)
  const [viewerVersion, setViewerVersion] = useState(0)

  const slim = modelType === 'slim'

  // 第二层有没有实心像素会改变取景盒 / 高亮面板的位置，
  // historyVersion 变化代表画布内容真的变了（画上第一笔帽子层时就要重算）
  const hasOverlayPixels = useMemo(
    () => (selectedPart ? overlayHasPixels(doc, selectedPart, slim) : false),
    [doc, selectedPart, slim, historyVersion],
  )
  const hasOverlayRef = useRef(hasOverlayPixels)
  hasOverlayRef.current = hasOverlayPixels

  const partRef = useRef(selectedPart)
  partRef.current = selectedPart

  /** 把高亮面板摆到「取景盒的某个面」外侧 */
  const placeRig = useCallback((box: Box3, nextFace: FaceId | null) => {
    const rig = rigRef.current
    if (!rig) return
    if (!nextFace || box.isEmpty()) {
      rig.group.visible = false
      return
    }

    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const n = FACE_NORMALS[nextFace]
    const halfAlongNormal =
      (n[0] !== 0 ? size.x : n[1] !== 0 ? size.y : size.z) / 2

    // 平面沿两个非法向轴展开
    let width: number
    let height: number
    if (nextFace === 'front' || nextFace === 'back') {
      width = size.x
      height = size.y
    } else if (nextFace === 'left' || nextFace === 'right') {
      width = size.z
      height = size.y
    } else {
      width = size.x
      height = size.z
    }

    const [rx, ry] = PLATE_ROTATION[nextFace]
    rig.group.visible = true
    rig.group.scale.set(width, height, 1)
    rig.group.rotation.set(rx, ry, 0)
    rig.group.position.set(
      center.x + n[0] * (halfAlongNormal + PLATE_GAP),
      center.y + n[1] * (halfAlongNormal + PLATE_GAP),
      center.z + n[2] * (halfAlongNormal + PLATE_GAP),
    )
  }, [])

  /**
   * 布局：可见部件 + 居中 + 相机 + 高亮。
   *
   * `mode`：
   *   - `orient`：相机摆到正对该面的位置（初次进入 / 换部件 / 点面按钮）
   *   - `keep`  ：只更新距离和高亮，保留用户当前的旋转角度（面板尺寸变化 / 点 3D 面）
   */
  const layout = useCallback(
    (
      viewer: SkinViewer,
      part: BodyKey | null,
      nextFace: FaceId,
      mode: 'orient' | 'keep',
    ) => {
      const player = viewer.playerObject
      const skinObject = player.skin

      if (!basePositionRef.current) basePositionRef.current = player.position.clone()
      const base = basePositionRef.current

      // 1) 先复位，再只留下要看的部件
      player.position.copy(base)
      player.rotation.set(0, 0, 0)
      player.updateMatrixWorld(true)

      const visibleKeys: readonly BodyKey[] = part ? [part] : ALL_BODY_KEYS
      for (const key of ALL_BODY_KEYS) {
        skinObject[key].visible = visibleKeys.includes(key)
      }

      // 2) 量内层包围盒：外层是放大一圈的覆盖层且可能整块透明，
      //    更要紧的是别把默认隐藏的耳朵网格算进来（它在头顶上方十几像素）
      const centerBox = new Box3()
      for (const key of visibleKeys) {
        const inner = innerOf(skinObject, key)
        if (inner) centerBox.expandByObject(inner)
      }
      if (centerBox.isEmpty()) {
        placeRig(centerBox, null)
        return
      }

      // 3) 盒心搬到世界原点 —— 之后所有东西都相对原点算，旋转中心也就落在部件中心
      player.position.sub(centerBox.getCenter(new Vector3()))
      player.updateMatrixWorld(true)

      // 4) 取景盒：第二层有实心像素时用它（那才是实际看得见的轮廓），否则用内层
      const useOuter = part !== null && hasOverlayRef.current
      const frameBox = new Box3()
      for (const key of visibleKeys) {
        const mesh = useOuter ? outerOf(skinObject, key) : innerOf(skinObject, key)
        if (mesh) frameBox.expandByObject(mesh)
      }
      if (frameBox.isEmpty()) {
        placeRig(centerBox, null)
        return
      }

      const size = frameBox.getSize(new Vector3())
      const center = frameBox.getCenter(new Vector3())

      // 5) 反推相机距离：可见高度 = 2 * d * tan(fov/2)，高宽都要装得下
      const canvasWidth = Math.max(1, viewer.canvas.clientWidth)
      const canvasHeight = Math.max(1, viewer.canvas.clientHeight)
      const aspect = Math.max(0.1, canvasWidth / canvasHeight)
      const needHeight = Math.max(size.y / FILL, size.x / FILL / aspect)
      const distance = needHeight / (2 * HALF_FOV_TAN)

      const controls = viewer.controls
      controls.target.copy(center)
      controls.minDistance = 0.5
      controls.maxDistance = Math.max(1, distance * 10)

      if (mode === 'orient') {
        const n = FACE_NORMALS[nextFace]
        viewer.camera.up.set(0, 1, 0)
        viewer.camera.position.set(
          center.x + n[0] * distance,
          center.y + n[1] * distance,
          center.z + n[2] * distance,
        )
      } else {
        const dir = viewer.camera.position.clone().sub(controls.target)
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
        dir.normalize()
        viewer.camera.position.copy(center).addScaledVector(dir, distance)
      }
      controls.update()

      // 6) 高亮当前编辑面；未选中部件时不标（没有"当前面"可言）
      placeRig(frameBox, part ? nextFace : null)
    },
    [placeRig],
  )

  const handleViewerChange = useCallback(
    (viewer: SkinViewer | null) => {
      // 换 viewer（StrictMode 二次挂载 / HMR）时，先把上一轮的高亮和监听拆干净
      detachRef.current?.()
      detachRef.current = null
      rigRef.current?.dispose()
      rigRef.current = null

      viewerRef.current = viewer
      if (!viewer) {
        basePositionRef.current = null
        return
      }

      const rig = createFaceRig()
      rigRef.current = rig
      viewer.scene.add(rig.group)

      // 这一块是**立体预览**，旋转要打开：拖拽绕着部件转，看它长什么样
      const controls = viewer.controls
      controls.enableRotate = true
      controls.enablePan = false
      controls.enableZoom = true
      controls.enableDamping = false
      // 正对顶面 / 底面时相机落在极点上，球坐标会退化（万向锁、拖拽乱跳）。
      // 留一点点余量绕开极点，代价只是顶/底视角略微带一点俯仰，反而更有立体感
      controls.minPolarAngle = 0.08
      controls.maxPolarAngle = Math.PI - 0.08

      const canvas = viewer.canvas
      const skinObject = viewer.playerObject.skin
      let downX = 0
      let downY = 0
      let pressed = false

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        pressed = true
        downX = event.clientX
        downY = event.clientY
      }

      const onPointerUp = (event: PointerEvent) => {
        if (!pressed) return
        pressed = false
        // 拖拽过 = 在旋转视角，不当作选面
        if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_SLOP) return

        const part = partRef.current
        if (!part) return

        const meshes = createPickTargets(skinObject)
          .filter((target) => target.key === part)
          .map((target) => target.mesh)
        const nextFace = pickPartFace(viewer, event.clientX, event.clientY, meshes)
        if (!nextFace) return

        // 这里不置 orientRequest：用户点的就是眼前这一面，相机再转反而突兀
        setFace(nextFace)
        flash(`已切到${FACE_LABELS[nextFace]}，下方画布同步`)
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointerup', onPointerUp)
      detachRef.current = () => {
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointerup', onPointerUp)
      }

      setViewerVersion((v) => v + 1)
    },
    [flash, setFace],
  )

  // 换部件 / 换面 / 内容变化后重新布局。
  // 这里一律用 `keep`（保留用户当前的旋转角度）—— 需要"转正"的场景
  // （初次进入、换部件、点面按钮）都已经在上游显式做过一次 orient 了。
  // 例外是 viewer 被重建（换体型 / StrictMode 二次挂载）：那台相机是全新的，
  // 停在默认位置，"keep" 会保持一个跟当前编辑面无关的朝向，必须重新 orient。
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.disposed) return
    const viewerChanged = prevViewerVersionRef.current !== viewerVersion
    const partChanged = prevPartRef.current !== selectedPart
    prevViewerVersionRef.current = viewerVersion
    prevPartRef.current = selectedPart
    layout(viewer, selectedPart, face, viewerChanged || partChanged ? 'orient' : 'keep')
  }, [selectedPart, face, viewerVersion, hasOverlayPixels, layout])

  // 面板尺寸变化后重新取景（保留用户当前的旋转角度）
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.disposed) return
    const canvas = viewer.canvas
    const observer = new ResizeObserver(() => {
      if (viewer.disposed) return
      layout(viewer, partRef.current, face, 'keep')
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [face, viewerVersion, layout])

  /**
   * 点面按钮：切面 + 把相机转过去正对该面。
   *
   * 定向必须在这里**直接做**，不能靠"给下面那个 effect 留个标记"：
   * 如果用户旋转完视角后又点了**当前已经选中**的那个面，`setFace` 是同值，
   * 不会触发重渲染、effect 也就不会跑，标记就永远留在那儿了 ——
   * 表现是"点了面按钮，相机纹丝不动"。
   */
  const selectFace = useCallback(
    (id: FaceId) => {
      setFace(id)
      const viewer = viewerRef.current
      if (viewer && !viewer.disposed) {
        layout(viewer, partRef.current, id, 'orient')
      }
    },
    [setFace, layout],
  )

  return (
    <PanelShell
      title="部位预览"
      icon={Layers}
      // 选中哪一面已经在 3D 上由高亮面板标出、下方画布标题也写着，这里不再重复；
      // 只在「还没选部件」这个真正需要引导的时刻报一句
      hint={selectedPart ? undefined : '未选中部件'}
    >
      <div className="flex h-full w-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-wash-7 px-2 py-1.5">
          {FACE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              disabled={!selectedPart}
              onClick={() => selectFace(id)}
              title={
                selectedPart
                  ? `切到${FACE_LABELS[id]}，下方画布同步`
                  : '先点左侧模型选一个部位'
              }
              className={
                'rounded border px-2 py-0.5 text-11 transition-colors ' +
                (!selectedPart
                  ? 'cursor-not-allowed border-wash-5 bg-wash-2 text-fg-7'
                  : id === face
                    ? 'border-accent-400/40 bg-accent-400/12 text-accent-300'
                    : 'border-wash-7 bg-wash-3 text-fg-4 hover:border-wash-15 hover:text-fg-2')
              }
            >
              {FACE_LABELS[id]}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">
          <SkinViewport
            onViewerChange={handleViewerChange}
            animated={false}
            ariaLabel="部位预览 3D 画布"
            // 「拖拽旋转 · 滚轮缩放」左侧整体预览已经说过一遍，这里只留这条独有的
            bottomHint={selectedPart ? '单击模型上的面即切换编辑面' : undefined}
          />
        </div>
      </div>
    </PanelShell>
  )
}
