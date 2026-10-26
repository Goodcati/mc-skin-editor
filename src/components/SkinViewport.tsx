import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { IdleAnimation, SkinViewer } from 'skinview3d'
import { toViewerModel } from '../lib/skinModel'
import type { ModelKind } from '../lib/skinModel'
import { useEditor } from '../state/EditorContext'

/**
 * 测量容器的实际尺寸。
 *
 * 为什么要逐帧重试：冷启动（首次加载、样式尚未落盘）时 useEffect 里读到的
 * clientWidth 会是 0。而 skinview3d 的 setSize 会写内联 style.width/height，
 * 一旦用 0/1 去初始化，画布就被永久锁在 1px，后面 ResizeObserver 也救不回来
 * —— 这是踩过的真实坑，所以这里必须量到非零尺寸才允许创建 viewer。
 */
function useMeasuredSize<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    let frame = 0
    let attempts = 0
    let stopped = false

    const apply = (width: number, height: number) => {
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      )
    }

    const measure = () => {
      if (stopped) return
      const width = element.clientWidth
      const height = element.clientHeight
      if (width > 0 && height > 0) {
        apply(width, height)
        return
      }
      // 最多重试 120 帧，避免元素永久隐藏时空转
      if (attempts < 120) {
        attempts += 1
        frame = requestAnimationFrame(measure)
      }
    }
    measure()

    const observer = new ResizeObserver(() => {
      const width = element.clientWidth
      const height = element.clientHeight
      if (width > 0 && height > 0) apply(width, height)
    })
    observer.observe(element)

    return () => {
      stopped = true
      if (frame !== 0) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ref])

  return size
}

interface SkinViewportProps {
  /** viewer 创建/销毁时回调，供外部做取景配置 */
  onViewerChange?: (viewer: SkinViewer | null) => void
  /** 是否播放待机动画 */
  animated?: boolean
  /** 覆盖在画布上的内容 */
  overlay?: ReactNode
  bottomHint?: ReactNode
  /** 画布的无障碍名。页面里有三块 canvas，它是区分彼此的唯一稳定标识 */
  ariaLabel?: string
  className?: string
  /**
   * 外部皮肤源（合成页把它当作结果预览用）。
   *
   * 给了它就不再订阅文档 —— 合成结果是一张独立画布，不属于编辑器文档。
   * 外部画布**必须由调用方保持同一个对象身份**（用 ref 持住），
   * 内容更新时把 `sourceVersion` 加一即可，不要重建画布元素（那会连带重建 viewer）。
   */
  skinSource?: HTMLCanvasElement | null
  /** 外部皮肤源的版本号；变化时只重新上传纹理，不重建 viewer */
  sourceVersion?: number
  /** 覆盖 context 里的体型（外部源有自己的体型） */
  modelKind?: ModelKind
  /** 是否允许拖拽旋转 / 滚轮缩放 */
  interactive?: boolean
}

/**
 * 3D 预览视口。
 *
 * 数据流：2D 文档画布（唯一数据源）-> skinview3d 内部 skinCanvas -> CanvasTexture。
 * skinview3d 不从外部纹理源直接出图，而是先把源画进自己的 skinCanvas，
 * 因此订阅文档变更后把像素同步过去、把纹理标脏即可，
 * 既不重建 viewer，也不触发任何 React 重渲染。
 */
export default function SkinViewport({
  onViewerChange,
  animated = true,
  overlay,
  bottomHint,
  ariaLabel,
  className,
  skinSource,
  sourceVersion = 0,
  modelKind,
  interactive = true,
}: SkinViewportProps) {
  const { doc, modelType } = useEditor()
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<SkinViewer | null>(null)

  const { width, height } = useMeasuredSize(hostRef)
  const ready = width > 0 && height > 0

  // 用 ref 持有回调，避免因回调身份变化而重建 viewer
  const callbackRef = useRef(onViewerChange)
  callbackRef.current = onViewerChange

  const effectiveModel = modelKind ?? modelType
  // 外部源是稳定身份的画布；没有外部源时读文档画布（getter 会先 flush 内存镜像）
  const external = skinSource ?? null
  const sourceCanvas = external ?? doc.canvas

  /** 把源像素同步进 viewer 自己的 skinCanvas 并标脏纹理。重建与增量更新都用它 */
  const syncRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!ready) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    const viewer = new SkinViewer({
      canvas,
      width: host.clientWidth,
      height: host.clientHeight,
      skin: sourceCanvas,
      // 体型来自用户的选择，不用 'auto-detect'：我们已经在导入时推断过一次，
      // 之后由用户拍板，让 skinview3d 再猜一次只会跟用户的选择打架
      model: toViewerModel(effectiveModel),
      animation: animated ? new IdleAnimation() : undefined,
      fov: 50,
      zoom: 0.9,
      enableControls: interactive,
      background: '#171a21',
    })
    viewer.controls.enablePan = false
    viewerRef.current = viewer

    const skinCanvas = viewer.skinCanvas
    let frame = 0

    const syncNow = () => {
      frame = 0
      if (viewer.disposed) return
      const ctx = skinCanvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, skinCanvas.width, skinCanvas.height)
      ctx.drawImage(sourceCanvas, 0, 0)
      const texture = viewer.playerObject.skin.map
      if (texture) texture.needsUpdate = true
    }
    syncRef.current = syncNow

    // 一次拖拽会触发上千次像素变更，用 rAF 合并成一帧一次纹理上传
    const scheduleSync = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(syncNow)
    }

    const unsubscribe = external ? () => {} : doc.subscribe(scheduleSync)
    syncNow()
    callbackRef.current?.(viewer)

    return () => {
      callbackRef.current?.(null)
      viewerRef.current = null
      syncRef.current = () => {}
      unsubscribe()
      if (frame !== 0) cancelAnimationFrame(frame)
      viewer.dispose()
    }
    // 换体型必须**重建** viewer，不能只改一下 playerObject.skin.modelType：
    // 手臂宽度变了（4 -> 3），各面的 UV 矩形跟着变，而外面挂着的高亮外壳、
    // 拾取白名单都是按旧几何体装配的。重建会让 onViewerChange 再走一遍，
    // 全部重新装配，不会漏。代价是视角复位 —— 换体型本来就是个"重新认识这张皮"的动作。
  }, [doc, ready, animated, effectiveModel, external, sourceCanvas, interactive])

  // 外部源内容变了：只重新同步一次纹理，不重建 viewer（重建会丢掉用户的旋转角度）
  useEffect(() => {
    if (!external) return
    syncRef.current()
  }, [external, sourceVersion])

  // 尺寸变化只调整，不重建（重建会丢失用户的旋转角度）
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || viewer.disposed || !ready) return
    viewer.setSize(width, height)
  }, [width, height, ready])

  return (
    <div ref={hostRef} className={`relative h-full w-full ${className ?? ''}`}>
      <canvas ref={canvasRef} aria-label={ariaLabel} className="block" />
      {overlay}
      {bottomHint && (
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-10 text-fg-5">
          {bottomHint}
        </p>
      )}
    </div>
  )
}
