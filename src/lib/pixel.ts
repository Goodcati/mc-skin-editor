/** 一个像素的 RGBA 四元组，0-255 */
export type RGBA = readonly [number, number, number, number]

/** 十六进制颜色 -> RGB */
export function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim()
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.padEnd(6, '0').slice(0, 6)
  const n = Number.parseInt(full, 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** RGB -> 大写十六进制颜色，供 <input type="color"> 与色板复用 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export const TRANSPARENT: RGBA = [0, 0, 0, 0]

/**
 * Bresenham 直线插值。
 * 鼠标拖快时 pointermove 事件之间会隔着好几个像素，不插值就会画出断点。
 */
export function walkLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy

  for (;;) {
    visit(x, y)
    if (x === x1 && y === y1) return
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}
