import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { hexToRgb, rgbToHex } from '../lib/pixel'

/**
 * PS 右上角那种取色器：色域方块（饱和度 x 明度）+ 色相条 + 十六进制输入。
 *
 * 内部用 HSV 做真身、对外只吐 HEX。
 * 只吐 HEX 是有意的：如果反过来（HEX 为真身、HSV 是派生），
 * 每次拖动都会 HEX→HSV→HEX 来回取整，明度或饱和度为 0 时色相会丢失，
 * 表现为"拖到纯黑之后再拖回彩色，色相突然跳到红色"。
 */

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hp = (h % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

/** 把 hex 归一化成 `#RRGGBB`；不合法返回 null */
function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$/.test(raw) && !/^[0-9a-fA-F]{6}$/.test(raw)) return null
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  return `#${full.toUpperCase()}`
}

interface DragState {
  mode: 'sv' | 'hue'
}

export default function ColorPicker({
  color,
  onChange,
}: {
  color: string
  onChange: (hex: string) => void
}) {
  // HSV 是这里的真身，只在外部颜色真的变了（吸管、最近色板）时才反向同步
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const rgb = hexToRgb(normalizeHex(color) ?? '#000000')
    return rgbToHsv(rgb[0], rgb[1], rgb[2])
  })
  const [hexDraft, setHexDraft] = useState(color)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const lastEmittedRef = useRef(color)

  const [h, s, v] = hsv
  const [r, g, b] = hsvToRgb(h, s, v)
  const hex = rgbToHex(r, g, b)

  // 外部改了颜色（吸管取色、点最近色板）→ 同步 HSV 和输入框
  useEffect(() => {
    if (color.toUpperCase() === lastEmittedRef.current.toUpperCase()) return
    const normalized = normalizeHex(color)
    if (!normalized) return
    const rgb = hexToRgb(normalized)
    setHsv(rgbToHsv(rgb[0], rgb[1], rgb[2]))
    setHexDraft(normalized)
    lastEmittedRef.current = normalized
  }, [color])

  useEffect(() => {
    setHexDraft(hex)
  }, [hex])

  const emit = useCallback(
    (next: [number, number, number]) => {
      setHsv(next)
      const [rr, gg, bb] = hsvToRgb(next[0], next[1], next[2])
      const nextHex = rgbToHex(rr, gg, bb)
      lastEmittedRef.current = nextHex
      onChange(nextHex)
    },
    [onChange],
  )

  const applyFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: DragState['mode']) => {
      const el = mode === 'sv' ? svRef.current : hueRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      const py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
      if (mode === 'sv') {
        emit([hsv[0], px, 1 - py])
      } else {
        emit([px * 360, hsv[1], hsv[2]])
      }
    },
    [emit, hsv],
  )

  const startDrag = (event: ReactPointerEvent<HTMLElement>, mode: DragState['mode']) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { mode }
    applyFromEvent(event, mode)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    applyFromEvent(event, drag.mode)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const hueHex = rgbToHex(...hsvToRgb(h, 1, 1))

  return (
    <div className="flex flex-col gap-2">
      {/* 色域方块：水平 = 饱和度，垂直 = 明度。底色是纯色相，上面叠白→透明、透明→黑两层渐变 */}
      <div
        ref={svRef}
        onPointerDown={(e) => startDrag(e, 'sv')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-28 w-full cursor-crosshair touch-none select-none rounded-md ring-1 ring-white/15"
        style={{ backgroundColor: hueHex }}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{ background: 'linear-gradient(to right, #fff, rgba(255,255,255,0))' }}
        />
        <div
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{ background: 'linear-gradient(to top, #000, rgba(0,0,0,0))' }}
        />
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
        />
      </div>

      {/* 色相条 */}
      <div
        ref={hueRef}
        onPointerDown={(e) => startDrag(e, 'hue')}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-3.5 w-full cursor-pointer touch-none select-none rounded-full ring-1 ring-white/15"
        style={{
          background:
            'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${(h / 360) * 100}%`, backgroundColor: hueHex }}
        />
      </div>

      {/* 当前色 + HEX 输入 */}
      <div className="flex items-center gap-2">
        <span
          className="h-7 w-9 shrink-0 rounded ring-1 ring-white/20"
          style={{ backgroundColor: hex }}
          title={hex}
        />
        <input
          type="text"
          value={hexDraft}
          spellCheck={false}
          aria-label="十六进制颜色"
          onChange={(e) => {
            const next = e.target.value
            setHexDraft(next)
            const normalized = normalizeHex(next)
            if (!normalized) return
            const rgb = hexToRgb(normalized)
            setHsv(rgbToHsv(rgb[0], rgb[1], rgb[2]))
            lastEmittedRef.current = normalized
            onChange(normalized)
          }}
          onBlur={() => {
            const normalized = normalizeHex(hexDraft)
            setHexDraft(normalized ?? hex)
          }}
          className="w-full min-w-0 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 font-mono text-[11px] text-slate-300 outline-none focus:border-emerald-400/40"
        />
      </div>

      <p className="font-mono text-[10px] text-slate-600">
        RGB {r}, {g}, {b}
      </p>
    </div>
  )
}
