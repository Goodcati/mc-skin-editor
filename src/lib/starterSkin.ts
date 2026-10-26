/**
 * 「新皮肤起点」偏好：示例 / 纯白 / 空画布。
 *
 * 只影响两处：
 *   1. 首次打开（本地没有草稿时展示什么）
 *   2. 大厅「绘制 = 新建」
 * 不改变当前正在编辑的那一张。
 *
 * 读写都做防御：坏值 / 存储被禁一律退回示例，绝不因为偏好损坏把用户卡在空白画布上。
 */

export type StarterBase = 'sample' | 'white' | 'empty'

const STARTER_KEY = 'mc-skin-editor/starter/v1'

export const STARTER_OPTIONS: ReadonlyArray<{ base: StarterBase; label: string; title: string }> = [
  { base: 'sample', label: '示例', title: '打开就是内置示例皮肤（经典布局，适合改造）' },
  { base: 'white', label: '纯白', title: '打开就是全白皮肤，从零画最清楚' },
  { base: 'empty', label: '未填充', title: '打开就是未填充画布，3D 里和游戏一致（看得穿）' },
]

export function readStarter(): StarterBase {
  try {
    const raw = window.localStorage.getItem(STARTER_KEY)
    if (raw === 'sample' || raw === 'white' || raw === 'empty') return raw
  } catch {
    // 隐私模式 / 存储被禁：按默认处理
  }
  return 'empty'
}

export function writeStarter(base: StarterBase): void {
  try {
    window.localStorage.setItem(STARTER_KEY, base)
  } catch {
    // 写不进去就算：本次会话仍按 React state 生效
  }
}

/**
 * 纯白皮肤的 PNG dataURL（64×64，全不透明白）。
 *
 * 走 dataURL 而不是给 SkinDocument 新增「填充」方法，是为了复用导入那条
 * 已被 verify:export / verify:works 覆盖的解码路径 —— 少一套像素写入逻辑，少一处坑。
 */
export function createWhiteSkinDataUrl(size = 64): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('createWhiteSkinDataUrl: 无法创建 2D 上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  return canvas.toDataURL('image/png')
}
