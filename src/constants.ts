/** Minecraft 皮肤贴图标准尺寸（64x64，含 1.8 版本的双层布局） */
export const SKIN_SIZE = 64

/**
 * 界面显示的版本号（主版本.迭代.补丁）。
 * 大厅和绘制页顶栏都读这一处，免得两边各写一份、改一处漏一处。
 */
export const APP_VERSION = 'V0.9.0'

/** 铅笔初始颜色 */
export const DEFAULT_COLOR = '#3B82F6'

/**
 * 画布放大倍数的上下限：1 个皮肤像素占几个屏幕像素。
 *
 * 上限给到 96 是因为面视图里最小的一块只有 4x4（手臂顶面），
 * 要把它填满面板就需要很高的倍率。实际进入某个面时会自动适配，这个范围只是滚轮的手动边界。
 */
export const DEFAULT_ZOOM = 16
export const MIN_ZOOM = 2
export const MAX_ZOOM = 96

/** 最近使用颜色最多保留数量（右侧是一列纵向列表，可滚动） */
export const MAX_RECENT_COLORS = 32

/** 撤销栈上限，按patch 条数计（单条 patch 最多 4096 像素，约 32KB） */
export const MAX_HISTORY = 200

/** 透明像素的棋盘格配色 */
export const CHECKER_LIGHT = '#2f3542'
export const CHECKER_DARK = '#272c37'

/**
 * 打赏链接（爱发电主页）。README 与界面上的「支持」入口都读这一处。
 *
 * **留空字符串 = 不显示任何打赏入口**。要开打赏，只改这一个地方，
 * 不要在组件里另写一份 URL。
 */
export const SUPPORT_URL = ''
