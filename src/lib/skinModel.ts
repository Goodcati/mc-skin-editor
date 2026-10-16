import { inferModelType } from 'skinview-utils'

/**
 * 玩家模型体型 —— 全应用对外只说这两个值。
 *
 * **官方口径**（Minecraft Wiki「Skin」条目）：
 * - 手臂 4 像素宽的那个叫 **Wide**（宽型），社区也叫 Classic / 经典 / Steve 型；
 * - 手臂 3 像素宽的那个叫 **Slim**（纤细），社区也叫 Alex 型。
 * - "纤细 = 女角色"是刻板印象：官方 9 个默认皮肤里，Alex / Efe / Makena / Noor 是纤细，
 *   Steve / Ari / Zuri / Sunny / Kai 是宽型，两种体型都各有男女角色。
 *
 * **关键事实：体型不在 PNG 文件里。** Java 版是在 minecraft.net 个人资料页或启动器上传时
 * 让用户手选，然后把它作为**账号档案属性**下发（`textures` 属性里的 `model: "slim"`）。
 * 文件本身只含像素，不含任何体型标记。所以「选错体型」不会让皮肤传不上去，
 * 只会让手臂贴图整体错位一格、袖子露缝 —— 但这也正是必须由工具提醒用户的原因：
 * 我们把 PNG 给他，他上传时还得自己选对。
 *
 * 内部值用 `wide` / `slim`，与 skinview3d 的 `default` / `slim` 在边界处转换
 * （见 `toViewerModel`）—— skinview3d 把宽型叫 `default`，那个词在 UI 里没法用。
 */
export type ModelKind = 'wide' | 'slim'

export const MODEL_KINDS: readonly ModelKind[] = ['wide', 'slim']

/** 界面上的正式叫法，与官网个人资料页的用词一致 */
export const MODEL_LABELS: Record<ModelKind, string> = {
  wide: '宽型',
  slim: '纤细',
}

/** 括号里的补充说明，用于 title，避免用户看不懂官方术语 */
export const MODEL_HINTS: Record<ModelKind, string> = {
  wide: '宽型（经典 / Steve 型）：手臂 4 像素宽',
  slim: '纤细（Alex 型）：手臂 3 像素宽',
}

/** 皮肤像素层面的差异，写在一眼能看懂的地方 */
export const MODEL_NOTE = '手臂宽度不同，会改变手臂各面的贴图位置'

/** 内部值 -> skinview3d 的模型参数 */
export function toViewerModel(kind: ModelKind): 'default' | 'slim' {
  return kind === 'slim' ? 'slim' : 'default'
}

/** skinview3d 的模型参数 -> 内部值 */
export function fromViewerModel(model: string): ModelKind {
  return model === 'slim' ? 'slim' : 'wide'
}

/**
 * 从贴图像素推断体型（skinview-utils 的官方算法：看手臂区域里四小块是否留有空白）。
 *
 * 用途仅限**导入时给个默认值**。推断会出错（皮肤作者把手臂填满到边界时无法区分），
 * 所以它是初值而不是真相 —— 用户随时可以手动改，导出文件名以用户的选择为准。
 */
export function inferModelKind(canvas: HTMLCanvasElement): ModelKind {
  return fromViewerModel(inferModelType(canvas))
}

/**
 * 导出文件名里的体型后缀。
 *
 * 为什么要写进文件名：体型不在 PNG 里，用户上传时必须在官网手选。
 * 文件名是**唯一能跟着文件走到上传页面**的载体 —— 八个月后他从下载目录里挑出这张图，
 * 文件名会告诉他该选哪个。
 */
export function modelFileSuffix(kind: ModelKind): string {
  return `-${MODEL_LABELS[kind]}`
}
