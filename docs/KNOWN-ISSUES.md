# 已知问题清单

本文件是**工作清单**，不是给使用者看的说明书。每条修完就把对应行划掉，
并在「证据」列留下可复算的判据（命令 + 期望输出），不写「已修复」这种无信息量的字。

判定口径沿用仓库纪律：

| 标记 | 含义 |
| --- | --- |
| **BUGFIX** | 已经复现出来的错误行为，改完在同一条件下复验。 |
| **HARDENING** | 没复现出错误行为，改了零风险；**不得**宣称修好了什么现象。 |
| **lint 假阳性** | 规则与代码意图不符。要么改成规则能接受的等价写法，要么带原因豁免。 |
| **N/R** | 改不动或代价过高，先留着并写清需要什么条件才能处理。 |

## 一、静态检查：oxlint 23 条（2026-10-26，`202a8cd` 起点）

分布：`react(refs)` 13 · `react(set-state-in-effect)` 4 · `react-hooks(exhaustive-deps)` 3 ·
`react(only-export-components)` 2 · `eslint(no-control-regex)` 1。

按**成因**分组，不按规则名分组 —— 同一条规则下混着两种完全不同的修法。

> 当前进度：**23 → 16**（K1 已修）。16 的构成：refs 5 · set-state-in-effect 5 ·
> exhaustive-deps 3 · only-export-components 2 · no-control-regex 1。
> 比 K1 的 7 条多出的那一处见 K3 的备注 —— 是我的改动让它从「没被判定」变成「被判定」，
> 不是新引入的代码问题，但也不能当作没发生。

| 组 | 条数 | 位置 | 成因 | 判定 | 状态 |
| --- | --- | --- | --- | --- | --- |
| K1 | 7 | `EditorContext.tsx:183,593,595,596,665`<br>`MergeContext.tsx:237×2,437` | 「渲染期惰性初始化 ref」：`if (!ref.current) ref.current = new X()`。对象身份靠 ref 保住，但 React 编译器不允许渲染期读写 ref。改成 `useState(() => new X())` 语义完全等价：初始化函数只在挂载时跑一次，身份同样稳定。 | HARDENING | ✅ 已修 |
| K2 | 5 | `MergeContext.tsx:129`<br>`SkinViewport.tsx:123`<br>`PartPreview.tsx:164,167`<br>`SkinCanvas2D.tsx:132` | 「最新值镜像」：`xRef.current = x` 直接写在渲染体里，供事件处理器/异步回调读到最新值。改成 `useEffect(() => { xRef.current = x })` 会在「渲染完成到副作用执行」之间留一个窗口，此时触发的事件会读到旧值。**这是真实风险，不是纯 lint。** | 待定 | ⏳ 未动 |
| K3 | 5 | `ColorPicker.tsx:101,107`<br>`MergeContext.tsx:118,260`<br>`EditorContext.tsx:561` | effect 内同步 setState。性质各不相同：`ColorPicker::107` 的 `setHexDraft(hex)` 可以并入已有的 emit 路径；`MergeContext::118` 的输出体型可以改成渲染期派生；`ColorPicker::101`、`EditorContext::561` 是「外部来源变了就同步本地状态」，属 React 官方承认的合法用法；`MergeContext::260` 是「画布这个外部可变对象被写了，bump 一个版本号通知 React」，同属官方说的「effect 用来同步外部系统」。 | 待定 | ⏳ 未动 |
| K4 | 3 | `SkinCanvas2D.tsx:96,234`（`view` 每次渲染都是新对象）<br>`PartPreview.tsx:161`（`historyVersion` 被判定为多余依赖） | 前两条是同一个根因：`view` 是字面量对象，导致 `draw` 每次渲染都换身份，于是 `useEffect([draw, …])` **每次渲染都重绘一遍**，memo 完全失效。第三条相反：`doc` 是可变对象、身份不变，`historyVersion` 是唯一能表达「内容变了」的信号，删掉它会真的出错。 | 假阳性 / 可优化 | ⏳ 未动 |
| K5 | 2 | `MergeContext.tsx:483`<br>`EditorContext.tsx:676` | 同一个文件里既导出组件又导出 hook，Fast Refresh 失效（改一行就整页刷新）。彻底修要把 hook 拆到独立文件，会牵动十几处 import。 | 待定 | ⏳ 未动 |
| K6 | 1 | `exportSkin.ts:186` | `sanitizeFileName` 用字符区间剔控制字符；oxlint 连 `\u0000-\u001f` 这种转义写法也判为「正则里有控制字符」。改成按码位过滤，行为逐字符等价。 | lint 假阳性 | ⏳ 未动 |

### K1 的证据（2026-10-26）

K1 改的是**对象实例的创建方式**，不是逻辑。这种改动的危险之处在于：写错了不报错，
症状是「切个工具，画的东西没了、撤销栈清空」。所以判据必须是行为指纹，不能是 build 通过。

| 检查 | 改前（`202a8cd`） | 改后 | 结论 |
| --- | --- | --- | --- |
| oxlint | 23 warnings | 16 warnings | −7（另有 1 条从隐性变显性，见上） |
| 画三笔后指纹 | `f355b9e563ef` | `f355b9e563ef` | 一致 |
| 触发 6 次重渲染后 | `f355b9e563ef` | `f355b9e563ef` | 文档没被重建 |
| Ctrl+Z 三次后 | `721ada7bb29f` | `721ada7bb29f` | 撤销栈存活，且回到画之前 |
| 合成导出（64×64 PNG） | 不透明像素 1712 | 不透明像素 1712 | 逐像素同数 |
| `npm run verify` | 55/25/19 + style 0 + contrast 11/11 | 同左 | 全绿 |

复算方式：本地脚本 `node_modules/.tmp/behavior-probe.mts`（画布指纹）与
`node_modules/.tmp/merge-probe.mts`（导出闭环）。**这两个不入库** —— 它们依赖本机安装的
`playwright-core` 和系统 Edge，而 `playwright-core` 并没有作为项目依赖声明，提交进去会让
`npm ci` 之后跑不起来。要重写就照上表两列的做法：`canvas.toDataURL()` 取 MD5 当指纹；
拦住导出的下载，用 `pngjs` 数 alpha > 0 的像素。
两个干扰项记在这里，免得下次再踩：快照**前必须把鼠标移出画布**（会画白色 hover 框），
以及**不要拿缩放当重渲染触发器**（会改变 canvas 的 backing 尺寸）。

## 二、可选：无障碍（尚未测量，不是结论）

以下三条**目前没有任何测量数据**，先不列入待修项。等真要做时，第一步是先量（键盘 Tab 走一遍全站、抓焦点顺序、核对每个可交互元素的可访问名），再决定修哪些。

- 键盘可达：`div` 上挂 `onClick` 的地方是否有 `role` / `tabIndex` / 键盘响应。
- 焦点顺序：Tab 序列是否跟着视觉顺序走；弹框打开后焦点是否被困在框内、关闭后是否归位。
- 状态可达：`aria-pressed` / `aria-disabled` 是否与视觉态一致（四态在 M2b 只用 CSS 表达，屏幕阅读器读不到「禁用」）。

## 三、修的顺序（建议，一次一条）

1. ~~K1~~ —— 已完成，见上表与证据段。
2. **K6** —— 单点、可逐字符验证，第二条用来确认「证据格式」稳定。
3. **K4 前两条** —— 纯性能，用同屏像素对比证明「重绘次数下降但画面不变」。
4. **K5** —— 纯搬迁，用 `npm run build` + 手测两个视图证明没断。
5. **K2 / K3** —— 需要真实风险判断，可能最终是「带原因豁免」而不是改。

## 四、豁免的写法

`scripts/scan-style.mts` 的白名单已清空。以后要加豁免，必须同时写清**原因**和
**到期条件**（什么情况下这条豁免该删掉），不接受只写「暂时跳过」。
