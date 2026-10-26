# 开发者笔记

给接手的人（包括未来的自己）看：这个工程的架构约定、几个容易踩反的地方，以及已知的扩展方向。

技术栈：React 19 + TypeScript + Vite + Tailwind CSS 4，2D 画布用原生 `Canvas`，3D 预览用 `skinview3d`（three.js）。纯前端，没有后端。

## 关键约定

### 路由

不引路由库，用 URL hash：`#/` 大厅、`#/draw` 绘制、`#/merge` 合成。皮肤自动保存，刷新落在原视图。

### Provider 层级

`EditorProvider`（外）→ `MergeProvider`（内）。合成侧借用编辑器的 flash 提示条，所以提示条全局只该有一个。

### 状态

皮肤文档、撤销栈、自动保存、两张合成源图**全在内存**，往返大厅不丢半成品。落盘只走 `localStorage`：

| key | 内容 |
| --- | --- |
| `mc-skin-editor/snapshot/v1` | 绘制页草稿快照 |
| `mc-skin-editor/autosave-enabled/v1` | 自动保存开关 |
| `mc-skin-editor/recent-colors/v1` | 最近使用颜色 |
| `mc-skin-editor/works/v1` | 作品库 |

读取一律**防御式解析**：解析失败就丢掉该条 / 整表回退默认，绝不把用户卡在坏数据上。

### 住在 Provider 里的临时 UI 状态，进入视图时要清一遍

导出完成对话框、提示这类状态挂在 Provider 上，而 **Provider 的寿命比视图长**——「离开视图」不等于「状态归零」。所以 `loadMergeWork` / `loadWork` 开头都显式清一次。

### 贴图布局的单一事实来源

`src/lib/skinFaces.ts` 里的 `PART_UV` / `partBox` **必须和 `skinview3d/libs/model.js` 的 `setSkinUVs(...)` 一致**，那份数据就是从那里抄的。升级 `skinview3d` 后如果 2D 面视图和 3D 显示错位，先回去核对那一份。

两个具体结论（都踩反过）：

- **只有手臂随体型变宽**（纤细 3 / 宽型 4），腿在两种体型下都是 4 像素宽。
- 侧面的左右对应关系：角色**左侧面**（+X）取 `u+w+d` 那块，角色**右侧面**（−X）取 `u` 那块。

### 视觉值的单一事实来源

颜色、字号、圆角、间距全部在 `src/theme.css` 的 `@theme` 里。**组件里不许写死这些值**，`npm run verify:style` 会拦（硬编码颜色 / `text-[13px]` / 越界圆角 / 越界间距步长）。

两处容易踩的地方：

- **圆角能靠覆盖 token 收敛，间距不能**。`--radius-md` 这类变量被 `.rounded-md { border-radius: var(--radius-md) }` 引用，所以改值不改类名就生效（这也是为什么 `src/views/Lobby.tsx` 不动也能跟着变）。但间距是 `calc(var(--spacing) * N)`，没有逐档覆盖的入口，只能改类名。
- `.rounded`（不带后缀）在 v4 产物里是硬编码 `.25rem`，**不吃 token**。它正好是 4px，归在「控件」档。改圆角档位时别忘了它不会跟着动。

### 交互四态统一收口在 `src/index.css` 的 `@layer base`

hover / active / focus-visible / disabled **全部由元素选择器接管**，组件里不要再写 `hover:` / `disabled:` 变体（早期残留的 `disabled:cursor-not-allowed` 之类已清掉——工具类优先级高于 base 层，留着会跟基线打架）。

三条约束，改之前先读：

1. **focus-visible 只用 `outline` + `outline-offset`**，不加 border 宽度、不加尺寸 —— 否则键盘 Tab 过控件时页面会抖。
2. **disabled 不能只靠变淡**。主操作按钮是绿底，淡一点仍然像能点，所以额外 `saturate(0.1)` 把绿抽成灰，一眼就知道点不了。透明度取 0.55 是有据的：正文色文字对比度 14.74 → 5.19，仍远高于 4.5；再低（0.45）掉到 3.89 就属于看不清而不是点不了。
3. hover / active 用 `filter` 而不是改背景色。按钮底色来自各处的 wash/bg 类，逐个改等于把 UI 改回散装状态。

锚点（`<a href>`）没有 `:disabled` 语义，测四态时会被跳过 —— 给 `el.disabled` 赋值只是挂了个无意义的 expando，量出来必然 0 变化，那不是缺陷。

### 构建即回归判据

`npm run build`（`tsc -b && vite build`）通过 = 没改坏。不要靠截图自查布局。

### 示例素材是自绘的

`public/skins/sample-wide.png` / `sample-slim.png` 由 `scripts/make-sample-skins.mts` 生成（`npm run gen:samples`），**不含任何官方素材**。生成脚本复用 `getFaceRect`，所以它和渲染器用的是同一份面定义——改布局不会两边对不上。验证脚本会直接读这两张图，**不要改名或替换**（换了会验证失败，不是静默跳过）。

## 验证

见 [TESTING.md](TESTING.md)。命令层五条，浏览器手测清单一份。

## 未来可能的扩展（未做）

**合成支持 3+ 个源。** 现在每部件的选择表语义写死为「取 a 源还是 b 源」，扩展要同时动三处：

1. 数据模型（源集合，而不是 `{ a, b }`）；
2. 每部件选择表的语义（`a | b` → 源索引数组）；
3. 三处 UI（两个源卡、选择表、输出体型旁的源图例）。

属**中等重构**，不是加个按钮的事。触发条件：社区在 Issues 里真的提出这个需求——**没呼声就不做**。

界面文案里刻意不提这件事，避免给自己挖坑。
