import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkinViewer } from 'skinview3d'
import { PartHighlighter } from '../lib/partHighlight'
import { createPickTargets, pickBodyPart } from '../lib/pickPart'
import type { PickTarget } from '../lib/pickPart'
import { BODY_KEY_LABELS } from '../lib/skinParts'
import type { BodyKey } from '../lib/skinParts'
import { useEditor } from '../state/EditorContext'
import SkinViewport from './SkinViewport'

/** 比 skinview3d 默认的 0.9 稍远一点，给头顶和脚下留出余量，避免顶到面板边缘 */
const DEFAULT_ZOOM = 0.78

/** 按下到抬起的位移超过这个屏幕像素数，就当成「拖拽旋转」，不判定为单击选中 */
const CLICK_SLOP = 5

/** 每个 viewer 对应一套高亮外壳 + 拾取白名单，生命周期与 viewer 相同 */
interface PickRig {
  highlighter: PartHighlighter
  targets: PickTarget[]
}

/**
 * 左侧：整体 3D 预览。
 * 默认取景、与 2D 画布实时联动，并支持点击模型选中单个部件。
 */
export default function SkinPreview3D() {
  const { selectedPart, setSelectedPart, flash } = useEditor()
  const zoomRef = useRef(DEFAULT_ZOOM)
  const rigRef = useRef<PickRig | null>(null)
  const detachRef = useRef<(() => void) | null>(null)
  const selectedRef = useRef<BodyKey | null>(selectedPart)
  const hoveredRef = useRef<BodyKey | null>(null)
  const [hovered, setHovered] = useState<BodyKey | null>(null)

  const handleViewerChange = useCallback(
    (viewer: SkinViewer | null) => {
      // 换 viewer（StrictMode 二次挂载 / HMR）时，先把上一轮的监听和高亮外壳拆干净
      detachRef.current?.()
      detachRef.current = null
      rigRef.current?.highlighter.dispose()
      rigRef.current = null

      if (!viewer) return

      viewer.zoom = zoomRef.current
      viewer.adjustCameraDistance()
      viewer.controls.target.set(0, 0, 0)
      viewer.controls.update()

      const skin = viewer.playerObject.skin
      const highlighter = new PartHighlighter(skin)
      highlighter.setSelected(selectedRef.current)
      const rig: PickRig = { highlighter, targets: createPickTargets(skin) }
      rigRef.current = rig

      const canvas = viewer.canvas
      let downX = 0
      let downY = 0
      let pressed = false
      let rotated = false

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        pressed = true
        rotated = false
        downX = event.clientX
        downY = event.clientY
      }

      const onPointerMove = (event: PointerEvent) => {
        if (pressed) {
          if (
            Math.abs(event.clientX - downX) > CLICK_SLOP ||
            Math.abs(event.clientY - downY) > CLICK_SLOP
          ) {
            rotated = true
          }
          // 正在旋转视角时不做悬停判定，否则高亮会跟着拖拽乱跳
          if (rotated) return
        }

        const part = pickBodyPart(viewer, event.clientX, event.clientY, rig.targets)
        if (part === hoveredRef.current) return
        hoveredRef.current = part
        setHovered(part)
        highlighter.setHover(part)
        canvas.style.cursor = part ? 'pointer' : ''
      }

      const onPointerUp = (event: PointerEvent) => {
        if (!pressed) return
        pressed = false
        // 拖拽过就当成旋转视角，不选中任何部件
        if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_SLOP) return

        const part = pickBodyPart(viewer, event.clientX, event.clientY, rig.targets)
        // 按需求把命中结果打出来，方便直接在控制台确认射线逻辑。
        // 同时给中文名和内部 key：中文名给人看，key 方便和 createPickTargets 的白名单对齐
        if (import.meta.env.DEV) {
          console.log(
            '[pick] 命中部位：',
            part ? `${BODY_KEY_LABELS[part]}（${part}）` : '（空白处，取消选择）',
          )
        }

        selectedRef.current = part
        highlighter.setSelected(part)
        setSelectedPart(part)
        flash(part ? `已选中${BODY_KEY_LABELS[part]}` : '已取消选择')
      }

      const onPointerLeave = () => {
        if (hoveredRef.current === null) return
        hoveredRef.current = null
        setHovered(null)
        highlighter.setHover(null)
        canvas.style.cursor = ''
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointerleave', onPointerLeave)

      detachRef.current = () => {
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointerleave', onPointerLeave)
        canvas.style.cursor = ''
      }
    },
    [flash, setSelectedPart],
  )

  // 选中状态可能来自组件外部（Esc 取消、状态栏清除），统一在这里同步高亮
  useEffect(() => {
    selectedRef.current = selectedPart
    rigRef.current?.highlighter.setSelected(selectedPart)
  }, [selectedPart])

  // Esc 取消选择
  useEffect(() => {
    if (!selectedPart) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelectedPart(null)
      flash('已取消选择')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPart, setSelectedPart, flash])

  // 鼠标停在已选中的部位上时，不要退回显示"悬停"——那会让用户以为刚才的单击没生效
  const title =
    hovered && hovered !== selectedPart
      ? `悬停：${BODY_KEY_LABELS[hovered]}`
      : selectedPart
        ? `已选中：${BODY_KEY_LABELS[selectedPart]} · Esc 取消`
        : hovered
          ? `悬停：${BODY_KEY_LABELS[hovered]}`
          : '单击模型可选中部位'

  return (
    <SkinViewport
      onViewerChange={handleViewerChange}
      animated
      ariaLabel="整体预览 3D 画布"
      overlay={
        <span
          className={
            'pointer-events-none absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] transition-colors ' +
            (hovered || selectedPart ? 'bg-sky-400/15 text-sky-200' : 'bg-black/40 text-slate-400')
          }
        >
          {title}
        </span>
      }
      // 尺寸已在顶栏报过；「点模型选部位」由左上角那条状态文字承担，这里只留操作手势
      bottomHint="拖拽旋转 · 滚轮缩放"
    />
  )
}
