import { getFaceRect } from './skinFaces'
import type { FaceId } from './skinFaces'

/**
 * 纯 2D 等距头部渲染 —— 无 DOM、无 WebGL、无 canvas，只吃一个 64×64×4 的 RGBA 数组，
 * 吐出一个 size×size×4 的 RGBA 数组。因为是完全确定的纯函数，可以写无头测试逐像素断言。
 *
 * 为什么放弃 WebGL（skinview3d）路线：相机 / OrbitControls / 渲染上下文的组合在无头环境
 * 无法静态定位，只能靠眼睛验收。改成等距投影后，几何是线性可解的逆映射，正确性可被证明。
 *
 * 取景：等距 2:1 投影（轴斜率 0.5，即约 26.57°），三面 = 正面（front）+ 左侧面（left）+
 * 顶面（top），拼成一个完整的等距立方体头部。三面各自有独立明暗系数，营造立体感。
 */

/** 输出逻辑图的边长（头部等距图 16×16，四周各留 1 像素 margin 容纳帽层外扩） */
const LOGIC_SIZE = 18

/** 逻辑坐标原点在逻辑图里的偏移（头部屏幕坐标 ∈ [-8,8]，平移到 [1,17]，居中） */
const LOGIC_OFFSET = 9

/** 三个面的明暗系数（顶最亮、正面次之、右面最暗）；要调明暗就改这三个数 */
const SHADE_TOP = 1.0
const SHADE_FRONT = 0.85
const SHADE_RIGHT = 0.7

/** 帽层（overlay）相对 base 的放大倍数：帽层盒子 9×9×9、base 8×8×8 → 9/8 */
const OVERLAY_SCALE = 9 / 8

/**
 * 三个面的屏幕四边形（等距 2:1 投影）。
 *
 * 几何约定（世界轴 → 屏幕，2:1 等距）：
 *   世界 +X → 屏幕 (1, 0.5)（右下）；世界 +Z → 屏幕 (-1, 0.5)（左下）；世界 +Y → 屏幕 (0,-1)（上）。
 * 头部 8×8×8、中心在原点。能看到的面：+Z 前面、+Y 顶面、+X 左侧面。
 *
 * 侧面朝向（已用 scripts/verify-head.mts 的「镜像」断言钉死）：
 *   按上面声明的轴（+X→右下），屏幕右半（x∈[0,8]）的几何位置就是 **+X 面（角色左侧）**，
 *   所以右侧那个 quad 取 `face:'left'`（角色左侧面，贴图 x=16 块），贴图方向与几何自洽、不镜像。
 *   左面贴图 u=0 边 = 前-左竖直棱，对应该 quad 的 u=0 边（A(0,0)→D(0,8)）。
 *   注：若日后要改看「角色右侧面」，需整个投影沿 X/Z 轴镜像重做，不是改这一个 face 字段。
 *
 * 每个面存 4 个顶点（按 [左上, 右上, 右下, 左下] 顺序），纹理 u 沿「左上→右上」、
 * v 沿「左上→左下」。三面在中心 (0,0) 汇聚、无缝拼成完整立方体，无重叠无空洞。
 *
 * 顶面（菱形，中心在 (0,-4)）：
 *   上(0,-8) 右(8,-4) 下(0,0) 左(-8,-4)
 * 前面（右下平行四边形）：
 *   左上(-8,-4) 右上(0,0) 右下(0,8) 左下(-8,4)
 * 侧面（左下平行四边形，显示角色左侧面 +X）：
 *   左上(0,0) 右上(8,-4) 右下(8,4) 左下(0,8)
 */
type Vec2 = { x: number; y: number }

interface FaceQuad {
  face: FaceId
  /** 四个顶点：[左上, 右上, 右下, 左下] */
  quad: [Vec2, Vec2, Vec2, Vec2]
  shade: number
}

/** 三个面的屏幕四边形（导出供无头测试断言面积相等 / 轮廓无缺口，避免测试二次手写几何） */
export const HEAD_QUADS: FaceQuad[] = [
  {
    face: 'top',
    quad: [
      { x: 0, y: -8 },
      { x: 8, y: -4 },
      { x: 0, y: 0 },
      { x: -8, y: -4 },
    ],
    shade: SHADE_TOP,
  },
  {
    face: 'front',
    quad: [
      { x: -8, y: -4 },
      { x: 0, y: 0 },
      { x: 0, y: 8 },
      { x: -8, y: 4 },
    ],
    shade: SHADE_FRONT,
  },
  {
    face: 'left',
    quad: [
      { x: 0, y: 0 },
      { x: 8, y: -4 },
      { x: 8, y: 4 },
      { x: 0, y: 8 },
    ],
    shade: SHADE_RIGHT,
  },
]

/**
 * 平行四边形逆映射：给定点 P 和四个顶点 [A,B,C,D]（A=左上，B=右上，D=左下），
 * 求 P = A + u·(B-A) + v·(D-A) 的 (u,v)。若 P 不在平行四边形内返回 null。
 *
 * B-A 与 D-A 是两条边向量（不要求正交），用克拉默法则解 2×2 线性方程组。
 */
function inverseMap(p: Vec2, quad: [Vec2, Vec2, Vec2, Vec2]): { u: number; v: number } | null {
  const [a, b, , d] = quad
  const e1x = b.x - a.x
  const e1y = b.y - a.y
  const e2x = d.x - a.x
  const e2y = d.y - a.y
  const px = p.x - a.x
  const py = p.y - a.y

  // det = e1x*e2y - e1y*e2x（平行四边形有向面积）
  const det = e1x * e2y - e1y * e2x
  if (det === 0) return null
  const u = (px * e2y - py * e2x) / det
  const v = (e1x * py - e1y * px) / det
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  return { u, v }
}

/** 把四边形相对其中心放大 scale 倍，返回新四边形（帽层外扩用） */
function scaleQuad(quad: [Vec2, Vec2, Vec2, Vec2], scale: number): [Vec2, Vec2, Vec2, Vec2] {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4
  return quad.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale })) as [
    Vec2,
    Vec2,
    Vec2,
    Vec2,
  ]
}

/** 从皮肤贴图取某个面某个层的矩形，采样 (u,v)∈[0,1] 处的 RGBA */
function sampleFace(
  skin: Uint8ClampedArray,
  face: FaceId,
  layer: 'base' | 'overlay',
  u: number,
  v: number,
): { r: number; g: number; b: number; a: number } {
  const rect = getFaceRect('head', face, layer, false)
  // 最近邻采样：u/v ∈ [0,1] → 纹理像素 [0, 8)
  let tx = Math.floor(u * rect.w)
  let ty = Math.floor(v * rect.h)
  // 帽层外扩后 u/v 可能略越界（外扩到 -0.0625~1.0625），clamp 到边缘
  tx = tx < 0 ? 0 : tx >= rect.w ? rect.w - 1 : tx
  ty = ty < 0 ? 0 : ty >= rect.h ? rect.h - 1 : ty
  const sx = rect.x + tx
  const sy = rect.y + ty
  const o = (sy * 64 + sx) * 4
  return { r: skin[o], g: skin[o + 1], b: skin[o + 2], a: skin[o + 3] }
}

/**
 * 渲染 64×64 皮肤为一个等距头部的 size×size×4 RGBA 输出。
 *
 * @param skin 64×64×4 的 RGBA 像素（长度 16384）
 * @param size 输出边长（像素）
 * @returns size×size×4 的 RGBA，背景透明（alpha 0）
 */
export function renderHeadIsometric(
  skin: Uint8ClampedArray,
  size: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4)
  const scale = size / LOGIC_SIZE

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // 输出像素 → 逻辑坐标 → 头部屏幕坐标
      const lx = px / scale
      const ly = py / scale
      const sx = lx - LOGIC_OFFSET
      const sy = ly - LOGIC_OFFSET

      // 先画 base：按 顶 → 前 → 右 顺序找所属面
      let drew = false
      for (const fq of HEAD_QUADS) {
        const uv = inverseMap({ x: sx, y: sy }, fq.quad)
        if (!uv) continue
        const c = sampleFace(skin, fq.face, 'base', uv.u, uv.v)
        if (c.a > 0) {
          const o = (py * size + px) * 4
          out[o] = Math.round(c.r * fq.shade)
          out[o + 1] = Math.round(c.g * fq.shade)
          out[o + 2] = Math.round(c.b * fq.shade)
          out[o + 3] = c.a
          drew = true
        }
        break
      }

      // 帽层：外扩后的四边形再逆映射采样，alpha>0 才覆盖 base
      for (const fq of HEAD_QUADS) {
        const big = scaleQuad(fq.quad, OVERLAY_SCALE)
        const uv = inverseMap({ x: sx, y: sy }, big)
        if (!uv) continue
        const c = sampleFace(skin, fq.face, 'overlay', uv.u, uv.v)
        if (c.a > 0) {
          const o = (py * size + px) * 4
          out[o] = Math.round(c.r * fq.shade)
          out[o + 1] = Math.round(c.g * fq.shade)
          out[o + 2] = Math.round(c.b * fq.shade)
          out[o + 3] = c.a
          drew = true
        }
        break
      }

      // 未命中任何面 → 保持透明（drew 未用，保留语义清晰）
      void drew
    }
  }

  return out
}
