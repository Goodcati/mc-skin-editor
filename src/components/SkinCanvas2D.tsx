import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Grid3x3 } from 'lucide-react'
import { CHECKER_DARK, CHECKER_LIGHT, SKIN_SIZE } from '../constants'
import { FACE_LABELS, LAYER_IDS, LAYER_LABELS, getFaceRect } from '../lib/skinFaces'
import { TRANSPARENT, hexToRgb, rgbToHex, walkLine } from '../lib/pixel'
import type { RGBA } from '../lib/pixel'
import { BODY_KEY_LABELS } from '../lib/skinParts'
import { useEditor } from '../state/EditorContext'

/** 画布四周留白（屏幕像素） */
const PADDING = 28

/**
 * 橡皮在第一层写入的像素值：不透明黑。
 *
 * **这是对齐官方行为，不是自作主张。** Minecraft Wiki「Skin」条目原文：
 * "If a skin with transparent pixels on the first layer is uploaded, the transparent pixels
 * render as black pixels in-game." —— 第一层没有"透明"这种状态，游戏会把它渲染成黑色。
 * 而 Bedrock 版更严：每个身体部位至少要留一个可见像素。
 *
 * 所以如果让橡皮在第一层擦成透明，用户看到的是"画布上干净了"，进游戏却是一身黑斑，
 * 而且导出的文件在部分皮肤查看器里还会显示成残色。直接在画布上就写出那个黑，
 * 才是所见即所得 —— 想画黑用铅笔选黑色也是同样的结果，语义不冲突。
 *
 * 第二层（帽子 / 外套 / 袖子 / 裤腿覆盖层）擦成透明才是正确语义：那一层默认就是透明的。
 */
const BASE_ERASER_FILL: RGBA = [0, 0, 0, 255]

/**
 * 跟随系统缩放比（Windows 上常见 125% / 150%）。
 * 只有把 1 个皮肤像素对齐到整数个设备像素，放大后的方块边缘才是干净的。
 */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  )

  useEffect(() => {
    let mq: MediaQueryList | null = null

    // dpr 变化后匹配式本身也失效了，需要重新监听
    const listen = () => {
      mq?.removeEventListener('change', onChange)
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      mq.addEventListener('change', onChange)
    }
    function onChange() {
      const next = window.devicePixelRatio || 1
      setDpr((prev) => (prev === next ? prev : next))
      listen()
    }

    listen()
    return () => mq?.removeEventListener('change', onChange)
  }, [])

  return dpr
}

/**
 * 中间下方：2D 像素编辑画布。
 *
 * 只画「当前部件 × 当前面」在贴图上的那一块（未选中部件时退回整张皮肤）。
 * 这样画的就是一个**精确的面**，不用在 64x64 那张连成一片的贴图里找位置。
 *
 * 数据源依旧是 `SkinDocument` 那张唯一的 64x64 离屏画布 ——
 * 这里只是换了一个「取景框」和一套 local→global 的坐标换算，
 * 所以撤销 / 重做 / 3D 实时联动的逻辑一行都不用改。
 */
export default function SkinCanvas2D() {
  const {
    doc,
    tool,
    color,
    setColor,
    rememberColor,
    zoom,
    setZoom,
    showGrid,
    toggleGrid,
    historyVersion,
    commitStroke,
    flash,
    setCursor,
    selectedPart,
    face,
    layer,
    setLayer,
    modelType,
  } = useEditor()

  const slim = modelType === 'slim'

  // 取景框：选中部件时是「该部件该面」的 UV 矩形，否则是整张贴图
  const view = selectedPart
    ? getFaceRect(selectedPart, face, layer, slim)
    : { x: 0, y: 0, w: SKIN_SIZE, h: SKIN_SIZE }
  const { w: viewW, h: viewH } = view
  // 编第二层时把第一层垫在下面做参考，才知道自己画到哪儿了
  const refRect = selectedPart && layer === 'overlay' ? getFaceRect(selectedPart, face, 'base', slim) : null

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const paintingRef = useRef(false)
  /**
   * 本次拖拽里有没有真的落笔（铅笔）。
   *
   * 「最近使用」只收真正在画布上用过的颜色 —— 在调色盘上挑到一个色、
   * 或者用吸管取了一个色，都还没"用过"，不该进最近使用。
   * 所以不走 commitStroke 的返回值：涂在本来就同色的像素上时净变化为零，
   * 但颜色确实已经被用了，也算一次使用。
   */
  const paintedRef = useRef(false)
  /** 「第一层擦除会填黑」这句解释只提示一次，之后不再反复打扰 */
  const baseEraserHintedRef = useRef(false)
  const checkerRef = useRef<CanvasPattern | null>(null)
  const checkerCellRef = useRef(0)

  const dpr = useDevicePixelRatio()

  // 每个皮肤像素占多少设备像素，取整后才能保证硬边
  const cell = Math.max(1, Math.round(zoom * dpr))
  const backingW = viewW * cell
  const backingH = viewH * cell
  const displayW = backingW / dpr
  const displayH = backingH / dpr

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // ---------------------------------------------------- 自动适配缩放

  const [avail, setAvail] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const apply = () => setAvail({ w: host.clientWidth, h: host.clientHeight })
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // 只要换了部件 / 面 / 图层，或者面板尺寸变了，就重新自动适配一次；
  // 用户自己滚轮调过的倍数在同一个目标下不会被覆盖
  const fitKey = `${selectedPart ?? 'all'}|${face}|${layer}|${slim}|${avail.w}x${avail.h}`
  const lastFitRef = useRef('')
  useEffect(() => {
    if (avail.w <= 0 || avail.h <= 0) return
    if (lastFitRef.current === fitKey) return
    lastFitRef.current = fitKey
    const fit = Math.floor(Math.min((avail.w - PADDING * 2) / viewW, (avail.h - PADDING * 2) / viewH))
    setZoom(fit)
  }, [fitKey, avail, viewW, viewH, setZoom])

  // ------------------------------------------------------------ 渲染

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, backingW, backingH)

    // 透明像素铺棋盘格，否则"擦成透明"这件事在界面上看不出来
    if (!checkerRef.current || checkerCellRef.current !== cell) {
      const tile = document.createElement('canvas')
      tile.width = cell * 2
      tile.height = cell * 2
      const tctx = tile.getContext('2d')
      if (tctx) {
        tctx.fillStyle = CHECKER_LIGHT
        tctx.fillRect(0, 0, cell * 2, cell * 2)
        tctx.fillStyle = CHECKER_DARK
        tctx.fillRect(0, 0, cell, cell)
        tctx.fillRect(cell, cell, cell, cell)
      }
      checkerRef.current = ctx.createPattern(tile, 'repeat')
      checkerCellRef.current = cell
    }
    if (checkerRef.current) {
      ctx.fillStyle = checkerRef.current
      ctx.fillRect(0, 0, backingW, backingH)
    }

    // 第二层之下垫一层淡淡的第一层，方便对照着画
    if (refRect) {
      ctx.globalAlpha = 0.3
      ctx.drawImage(
        doc.canvas,
        refRect.x, refRect.y, refRect.w, refRect.h,
        0, 0, backingW, backingH,
      )
      ctx.globalAlpha = 1
    }

    // 一次 drawImage 完成整体放大；插值已关闭，每个皮肤像素就是干净的 cell x cell 方块
    ctx.drawImage(
      doc.canvas,
      view.x, view.y, view.w, view.h,
      0, 0, backingW, backingH,
    )

    if (showGrid && cell >= 4) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 1; i < viewW; i += 1) {
        const p = i * cell + 0.5
        ctx.moveTo(p, 0)
        ctx.lineTo(p, backingH)
      }
      for (let i = 1; i < viewH; i += 1) {
        const p = i * cell + 0.5
        ctx.moveTo(0, p)
        ctx.lineTo(backingW, p)
      }
      ctx.stroke()
    }

    const hover = hoverRef.current
    if (hover) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(hover.x * cell + 1, hover.y * cell + 1, cell - 2, cell - 2)
    }
  }, [doc, cell, backingW, backingH, viewW, viewH, view, refRect, showGrid])

  // 历史变化 / 缩放 / 网格开关后重绘
  useEffect(() => {
    draw()
  }, [draw, historyVersion, dpr])

  // 滚轮缩放：必须用非 passive 监听才能 preventDefault，阻止面板跟着滚
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const step = Math.max(1, Math.round(zoomRef.current * 0.18))
      const next = zoomRef.current + (event.deltaY > 0 ? -step : step)
      if (next !== zoomRef.current) setZoom(next)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [setZoom])

  // ------------------------------------------------------------ 交互

  /** 屏幕坐标 -> 面内局部像素坐标（0..viewW-1, 0..viewH-1） */
  const toLocal = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * viewW)
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * viewH)
    if (x < 0 || y < 0 || x >= viewW || y >= viewH) return null
    return { x, y }
  }

  /** 局部坐标 -> 贴图上的全局坐标，这是与 3D 对齐的关键一步 */
  const toGlobal = (x: number, y: number) => ({ x: view.x + x, y: view.y + y })

  const paintPixel = (x: number, y: number): boolean => {
    const rgba: RGBA =
      tool === 'eraser'
        ? layer === 'base'
          ? BASE_ERASER_FILL
          : TRANSPARENT
        : [...hexToRgb(color), 255]
    if (tool === 'pencil') paintedRef.current = true
    const global = toGlobal(x, y)
    return doc.setPixel(global.x, global.y, rgba)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const point = toLocal(event)
    if (!point) return
    hoverRef.current = point
    setCursor(point)
    draw()

    if (tool === 'pipette') {
      const global = toGlobal(point.x, point.y)
      const [r, g, b, a] = doc.getPixel(global.x, global.y)
      if (a === 0) {
        flash('该像素是透明的，没有颜色可取')
        return
      }
      // 吸管只是"取到"一个颜色，还没在画布上用过，不进最近使用
      const hex = rgbToHex(r, g, b)
      setColor(hex)
      flash(`已吸取颜色 ${hex}`)
      return
    }

    // 「擦除却变成黑色」是本工具里最反直觉的一处，第一次遇到必须解释清楚，
    // 否则用户会以为橡皮坏了。只提示一次，之后不再打扰（改由按钮 title 长期说明）
    if (tool === 'eraser' && layer === 'base' && !baseEraserHintedRef.current) {
      baseEraserHintedRef.current = true
      flash('第一层没有透明：游戏里透明像素就是黑的，所以这里擦成黑色')
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    paintingRef.current = true
    paintedRef.current = false
    lastRef.current = point
    doc.beginStroke()
    paintPixel(point.x, point.y)
    draw()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toLocal(event)

    // 坐标变化才更新状态栏，避免每次 mousemove 都触发 React 渲染
    const prev = hoverRef.current
    if (point?.x !== prev?.x || point?.y !== prev?.y) {
      hoverRef.current = point
      setCursor(point)
      if (!paintingRef.current) draw()
    }

    if (!paintingRef.current || !point) return

    const last = lastRef.current
    if (last) {
      // 拖太快时事件之间会跳像素，用直线补上
      walkLine(last.x, last.y, point.x, point.y, paintPixel)
    } else {
      paintPixel(point.x, point.y)
    }
    lastRef.current = point
    draw()
  }

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current) return
    paintingRef.current = false
    lastRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commitStroke()
    // 真正落过笔才记入"最近使用"，与是否产生净变化无关
    if (paintedRef.current) rememberColor(color)
    paintedRef.current = false
  }

  const handlePointerLeave = () => {
    if (paintingRef.current) return
    hoverRef.current = null
    setCursor(null)
    draw()
  }

  const cursorClass =
    tool === 'pipette' ? 'cursor-cell' : tool === 'eraser' ? 'cursor-crosshair' : 'cursor-crosshair'

  const targetLabel = selectedPart
    ? `${BODY_KEY_LABELS[selectedPart]} · ${FACE_LABELS[face]} · ${LAYER_LABELS[layer]}`
    : '整张皮肤（未选中部位）'

  return (
    <div className="flex h-full w-full flex-col bg-surface-panel">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-wash-7 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-11 font-medium tracking-wide text-fg-3">
            {targetLabel}
          </span>
          {/*
            取景框尺寸只在选中部位时报：那时它是「这个面多大」，顶栏那句整图尺寸给不了。
            未选中时取景框就是整张贴图，再报一次 64×64 只是把顶栏的话说第二遍。
          */}
          {selectedPart && (
            <span className="shrink-0 font-mono text-10 text-fg-6">
              {viewW}×{viewH} px
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {selectedPart && (
            <div className="flex overflow-hidden rounded border border-wash-7">
              {LAYER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLayer(id)}
                  title={`编辑${LAYER_LABELS[id]}`}
                  className={
                    'px-2 py-0.5 text-10 transition-colors ' +
                    (id === layer
                      ? 'bg-accent-400/15 text-accent-300'
                      : 'bg-wash-3 text-fg-5 hover:text-fg-3')
                  }
                >
                  {LAYER_LABELS[id]}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={toggleGrid}
            title={showGrid ? '隐藏像素网格' : '显示像素网格'}
            className={
              'rounded border p-1 transition-colors ' +
              (showGrid
                ? 'border-accent-400/40 bg-accent-400/12 text-accent-300'
                : 'border-wash-7 bg-wash-3 text-fg-5 hover:text-fg-3')
            }
          >
            <Grid3x3 size={13} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div ref={hostRef} className="thin-scroll min-h-0 flex-1 overflow-auto bg-surface-canvas">
        {/* grid + place-items-center：内容比容器小时居中，比容器大时正常出滚动条 */}
        <div className="grid h-max min-h-full w-max min-w-full box-border place-items-center">
          <canvas
            ref={canvasRef}
            width={backingW}
            height={backingH}
            aria-label="皮肤像素编辑画布"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={handlePointerLeave}
            onContextMenu={(e) => e.preventDefault()}
            className={`block rounded-sm ring-1 ring-wash-15 touch-none select-none ${cursorClass}`}
            style={{ width: `${displayW}px`, height: `${displayH}px` }}
          />
        </div>
      </div>
    </div>
  )
}
