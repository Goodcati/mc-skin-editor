import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_COLOR, DEFAULT_ZOOM, MAX_RECENT_COLORS, MAX_ZOOM, MIN_ZOOM } from '../constants'
import { SkinDocument } from '../lib/SkinDocument'
import {
  clearSnapshot,
  describeAgo,
  isAutosaveEnabled,
  persistAutosaveEnabled,
  readSnapshot,
  writeSnapshot,
} from '../lib/autosave'
import { buildSkinPng, describeExport, downloadBlob } from '../lib/exportSkin'
import type { SkinExport } from '../lib/exportSkin'
import { addWork } from '../lib/works'
import type { WorkItem } from '../lib/works'
import { MODEL_LABELS, inferModelKind } from '../lib/skinModel'
import type { ModelKind } from '../lib/skinModel'
import type { FaceId, SkinLayer } from '../lib/skinFaces'
import type { BodyKey } from '../lib/skinParts'

export type ToolId = 'pencil' | 'eraser' | 'pipette'

/**
 * 自动保存的防抖时长。
 * 存在的理由不是"性能"，而是"粒度"：一次拖拽中间会改几十上百个像素，
 * 但只有拖拽结束才是一个可保存的稳态。1.2 秒足够让连续描线合并成一次写入，
 * 又不至于让"画完立刻崩溃"丢掉内容。
 */
const AUTOSAVE_DELAY = 1200

const RECENT_COLORS_KEY = 'mc-skin-editor/recent-colors/v1'

/**
 * 内置示例皮肤的 URL。
 *
 * **必须走 `import.meta.env.BASE_URL`**：GitHub Pages 的「项目型」站点把应用挂在
 * `/mc-skin-editor/` 子路径下，而 Vite 的 `base` **不会**重写运行时拼出的字符串
 * （只重写 index.html / CSS 里的引用）——写死 `/skins/sample-wide.png` 在线上会 404。
 * 实测：子路径下 `/skins/...` → 404，`/mc-skin-editor/skins/...` → 200。
 */
import { createWhiteSkinDataUrl, readStarter, type StarterBase } from '../lib/starterSkin'

const BUILTIN_SKIN_URL = `${import.meta.env.BASE_URL}skins/sample-wide.png`

/**
 * 从本地存储读「最近使用颜色」。
 *
 * 沿用 autosave/works 的约定：版本化键名 + 防御式解析。坏数据（不是数组 /
 * 元素不是合法 hex / JSON 解析失败）一律返回空数组，绝不抛异常——这一列
 * 只是便利功能，不值得为它冒「编辑器整个起不来」的险。
 */
function readRecentColors(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COLORS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((c): c is string => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c))
      .slice(0, MAX_RECENT_COLORS)
  } catch {
    return []
  }
}

/** 把最近色写回本地存储。写失败（配额满/隐私模式）静默忽略，不影响取色。 */
function persistRecentColors(colors: string[]): void {
  try {
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors))
  } catch {
    /* 存不下只是下次刷新丢了最近色，不阻断使用 */
  }
}

export interface LoadedSkin {
  name: string
  width: number
  height: number
  standard: boolean
  /** 旧版 64x32：导入时已自动补全左腿 / 左臂 */
  legacy: boolean
}

export interface EditorContextValue {
  // 工具与颜色
  tool: ToolId
  setTool: (tool: ToolId) => void
  color: string
  setColor: (hex: string) => void
  recentColors: string[]
  rememberColor: (hex: string) => void

  // 2D 画布视图（放大倍数 = 1 个皮肤像素占几个屏幕像素）
  zoom: number
  setZoom: (zoom: number) => void
  showGrid: boolean
  toggleGrid: () => void

  /**
   * 当前编辑目标。
   * - `selectedPart`：在左侧整体 3D 预览里点选出来的部件；null = 未选中（回退到整体 / 整张皮肤）
   * - `face` / `layer`：中上的面选择器与第一层/第二层切换
   *
   * 中上「部位预览」和中间下方「2D 编辑画布」都从这两个状态派生，
   * 二者永远显示同一个「部件 × 面」，不会各说各话。
   */
  selectedPart: BodyKey | null
  setSelectedPart: (part: BodyKey | null) => void
  face: FaceId
  setFace: (face: FaceId) => void
  layer: SkinLayer
  setLayer: (layer: SkinLayer) => void

  // 像素文档与历史
  doc: SkinDocument
  historyVersion: number
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /** 结束一次拖拽并入库历史；返回是否真的产生了变化 */
  commitStroke: () => boolean

  // 皮肤加载
  skin: LoadedSkin | null
  skinLoading: boolean
  loadSkinFromUrl: (
    url: string,
    name: string,
    persist?: boolean,
    modelOverride?: ModelKind,
  ) => Promise<void>
  importSkinFile: (file: File) => Promise<void>
  /**
   * 把一张外部画布直接当作当前皮肤（合成结果的落点）。
   * 与导入 PNG 同语义：清空历史、立即落盘，并把体型一并定下来。
   */
  adoptSkin: (source: HTMLCanvasElement, name: string, model: ModelKind) => void
  resetSkin: () => void
  /** 大厅「绘制=新建」：清空画布并清掉草稿，进入一张全新空画布 */
  startNewSkin: (base?: StarterBase) => void
  /** 从作品库恢复一件绘制作品（画布 + 名称 + 体型） */
  loadWork: (work: WorkItem) => Promise<void>

  /**
   * 体型（宽型 / 纤细）。
   *
   * 它不是从 `skin` 派生的：导入时按像素推断一次作为初值，之后**由用户的选择说了算**。
   * 推断会出错（作者把手臂填满到边界时无从分辨），而选错体型的后果是手臂贴图错位，
   * 所以最终决定权必须在人手上。改它会重建 3D 和 2D 取景 —— 手臂宽度变了。
   */
  modelType: ModelKind
  setModelType: (kind: ModelKind) => void

  /** 导出 64×64 PNG（可直接导入 Minecraft）；返回是否成功。`baseName` 缺省用当前皮肤名 */
  exportSkin: (baseName?: string) => Promise<boolean>
  /** 当前皮肤名（导出的默认基名，也是命名框的预填值） */
  skinName: string
  /** 导出成功的成品信息。非 null 就意味着该弹「导出完成」反馈（与合成侧一致） */
  exported: SkinExport | null
  /** 关掉导出完成反馈 */
  dismissExport: () => void
  /** 把当前画布写入浏览器本地暂存。`manual` 会给出成功提示，`auto` 静默 */
  saveNow: (reason?: 'manual' | 'auto') => boolean
  /** 上次成功保存的时间戳（含页面加载时从旧快照读到的值） */
  lastSavedAt: number | null
  autosaveEnabled: boolean
  setAutosaveEnabled: (enabled: boolean) => void

  // 状态栏
  status: string
  flash: (message: string) => void
  cursor: { x: number; y: number } | null
  setCursor: (pos: { x: number; y: number } | null) => void
}

const EditorContext = createContext<EditorContextValue | null>(null)

export function EditorProvider({ children }: { children: ReactNode }) {
  // 文档实例必须跨渲染保持同一个对象，用 ref 保证身份稳定
  const docRef = useRef<SkinDocument | null>(null)
  if (!docRef.current) docRef.current = new SkinDocument()
  const doc = docRef.current

  const [tool, setTool] = useState<ToolId>('pencil')
  const [color, setColorState] = useState(DEFAULT_COLOR)
  const [recentColors, setRecentColors] = useState<string[]>(readRecentColors)
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM)
  const [showGrid, setShowGrid] = useState(true)
  const [selectedPart, setSelectedPart] = useState<BodyKey | null>(null)
  const [face, setFace] = useState<FaceId>('front')
  const [layer, setLayer] = useState<SkinLayer>('base')
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [status, setStatus] = useState('')

  // 历史栈是可变对象，用版本号驱动 React 重新渲染按钮的可用态
  const [historyVersion, setHistoryVersion] = useState(0)
  const bump = useCallback(() => setHistoryVersion((v) => v + 1), [])

  const statusTimer = useRef<number | null>(null)
  const flash = useCallback((message: string) => {
    setStatus(message)
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(''), 2200)
  }, [])
  useEffect(
    () => () => {
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current)
    },
    [],
  )

  const rememberColor = useCallback((hex: string) => {
    const normalized = hex.toUpperCase()
    setRecentColors((prev) =>
      [normalized, ...prev.filter((c) => c !== normalized)].slice(0, MAX_RECENT_COLORS),
    )
  }, [])

  // 最近色变更后写回本地存储，刷新页面不丢。写失败静默，不影响取色。
  // 单独放一个 effect 而不是塞进 rememberColor：副作用不进 setState 的 updater，
  // 严格模式重复调用也只会重复写同一份值，幂等无害。
  useEffect(() => {
    persistRecentColors(recentColors)
  }, [recentColors])

  const setColor = useCallback((hex: string) => setColorState(hex.toUpperCase()), [])

  const setZoom = useCallback((next: number) => {
    setZoomState(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next))))
  }, [])
  const toggleGrid = useCallback(() => setShowGrid((g) => !g), [])

  const undo = useCallback(() => {
    if (doc.undo()) {
      bump()
      flash('已撤销')
    } else {
      flash('没有可撤销的操作')
    }
  }, [doc, bump, flash])

  const redo = useCallback(() => {
    if (doc.redo()) {
      bump()
      flash('已重做')
    } else {
      flash('没有可重做的操作')
    }
  }, [doc, bump, flash])

  const commitStroke = useCallback(() => {
    const changed = doc.commitStroke()
    if (changed) bump()
    return changed
  }, [doc, bump])

  // ------------------------------------------------------------ 皮肤加载

  const [skin, setSkin] = useState<LoadedSkin | null>(null)
  const [skinLoading, setSkinLoading] = useState(false)

  /**
   * 体型。默认宽型 —— 与内置示例皮肤一致（`/skins/sample-wide.png` 是经典布局），
   * 导入时会被推断值或快照里的值覆盖。
   */
  const [modelType, setModelTypeState] = useState<ModelKind>('wide')

  /**
   * 体型的 ref 镜像。
   *
   * `saveNow` / `exportSkin` 都要读它，而这两个函数必须是**身份稳定**的：
   * `saveNow` 一旦重建就会把自动保存的防抖定时器一起重置（见 skinNameRef 的说明），
   * `exportSkin` 重建会让 Toolbar 跟着重渲染。所以走 ref 读，不把 state 放进依赖。
   */
  const modelKindRef = useRef<ModelKind>('wide')

  const commitModel = useCallback((kind: ModelKind) => {
    modelKindRef.current = kind
    setModelTypeState(kind)
  }, [])

  /**
   * 用户手动切体型。
   *
   * 这里要提醒一句"上传时选哪个"：切到纤细之后，用户很可能忘了官网那个下拉框还在宽型上，
   * 结果皮肤传上去手臂错位、还以为是我们导出的文件有问题。
   */
  const setModelType = useCallback(
    (kind: ModelKind) => {
      if (modelKindRef.current === kind) return
      commitModel(kind)
      flash(`体型已切换为${MODEL_LABELS[kind]}（${kind === 'slim' ? '手臂 3 像素' : '手臂 4 像素'}）`)
    },
    [commitModel, flash],
  )

  // ------------------------------------------------------ 本地暂存（防崩溃）

  /**
   * 当前皮肤名，供「导出文件名」和「快照里的名字」使用。
   *
   * 用 ref 而不是 state：saveNow 会被按钮、快捷键、导入流程多处调用，
   * 一旦它的依赖里带上 skin，每次换皮肤都会重建它，顺带把自动保存的
   * 防抖定时器也重置掉 —— 表现就是"刚导入完皮肤，自动保存迟迟不写"。
   */
  const skinNameRef = useRef('未命名皮肤')

  const [autosaveEnabled, setAutosaveEnabledState] = useState(() => isAutosaveEnabled())
  // 初值直接取旧快照的时间：刷新后还没保存任何东西时，也能显示"上次保存"是什么时候
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(
    () => readSnapshot()?.savedAt ?? null,
  )

  const setAutosaveEnabled = useCallback(
    (enabled: boolean) => {
      setAutosaveEnabledState(enabled)
      persistAutosaveEnabled(enabled)
      flash(enabled ? '自动保存已开启' : '自动保存已关闭')
    },
    [flash],
  )

  const saveNow = useCallback(
    (reason: 'manual' | 'auto' = 'manual') => {
      // 空画布不算草稿：清空/新建后画布是全透明的，写进去只会让下次打开
      // 「恢复」出一张白板。这里直接清掉快照槽，让草稿判断回到「无」。
      // 这条守卫同时覆盖了 resetSkin 之后 1.2 秒那个被 bump() 触发的防抖
      // 自动保存 —— 它再跑 saveNow('auto') 时画布仍空，同样落到 clearSnapshot，
      // 不会再复活一个空草稿。
      if (doc.isEmpty()) {
        clearSnapshot()
        setLastSavedAt(null)
        // 手动保存（Ctrl+S）时给一句反馈，别让用户按了键毫无反应；
        // 自动保存则保持安静，空画布本来就没东西可存。
        if (reason === 'manual') flash('空画布无需保存')
        return true
      }
      const result = writeSnapshot(doc, skinNameRef.current, modelKindRef.current)
      if (!result.ok) {
        flash(`保存失败：${result.error ?? '浏览器拒绝写入本地存储'}`)
        return false
      }
      setLastSavedAt(result.savedAt)
      if (reason === 'manual') flash('已保存到浏览器本地')
      return true
    },
    [doc, flash],
  )

  /**
   * 导出成功后留下的成品信息，界面靠它弹「导出完成」反馈。
   * 与合成侧的 `exported` 对称：两侧导出后给同一种反馈，至少都显示文件名。
   */
  const [exported, setExported] = useState<SkinExport | null>(null)
  const dismissExport = useCallback(() => setExported(null), [])

  const exportSkin = useCallback(
    async (baseName?: string) => {
      try {
        const result = await buildSkinPng(
          doc,
          baseName ?? skinNameRef.current,
          modelKindRef.current,
          'draw',
        )
        downloadBlob(result.blob, result.filename)
        flash(describeExport(result))
        setExported(result)
        // 导出成功即入库一件作品（大厅「我的皮肤」列的就是"保存/导出过的皮肤"）。
        // 入库失败（配额满 / 隐私模式禁写）不能吞掉：文件已经下来了，但列表里会
        // 凭空少一件，必须明确告诉用户。
        const saved = addWork({
          id: crypto.randomUUID(),
          kind: 'draw',
          name: baseName ?? skinNameRef.current,
          model: result.model,
          updatedAt: Date.now(),
          dataUrl: result.dataUrl,
        })
        if (!saved.ok) {
          flash(`已下载，但未能存入作品库：${saved.error ?? '浏览器拒绝写入本地存储'}`)
        }
        return true
      } catch (error) {
        flash(`导出失败：${error instanceof Error ? error.message : '未知错误'}`)
        return false
      }
    },
    [doc, flash],
  )

  const loadSkinFromUrl = useCallback(
    async (url: string, name: string, persist = false, modelOverride?: ModelKind) => {
      setSkinLoading(true)
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('图片解码失败'))
          img.src = url
        })
        const info = doc.loadSkinImage(image)
        // 体型优先用调用方给的（从快照恢复时存着用户的选择），否则按像素推断一次。
        // 推断只是初值：skinview-utils 的算法靠手臂区域里那几小块空白判断，作者把手臂
        // 画满到边界时就无从分辨 —— 所以用户随时能改，导出的文件名以用户的选择为准。
        const model = modelOverride ?? inferModelKind(doc.canvas)
        commitModel(model)
        skinNameRef.current = name
        setSkin({ name, ...info })
        bump()
        // 导入是**一次明确的状态切换**，不是连续落笔的一部分，所以立刻落盘、
        // 不走自动保存的防抖。否则"导入完 1.2 秒内崩溃"会恢复到上一张皮肤 ——
        // 这正是本功能要防的那种情况。
        if (persist) saveNow('auto')
        const style = MODEL_LABELS[model]
        if (info.legacy) {
          flash(
            `已载入 ${name}（旧版 ${info.width}×${info.height}）· ${style}；左腿 / 左臂已自动补全`,
          )
        } else if (info.standard) {
          flash(`已载入 ${name}（${info.width}×${info.height} · ${style}）`)
        } else {
          flash(`${name} 不是标准皮肤尺寸（${info.width}×${info.height}），已拉伸填充`)
        }
      } catch (error) {
        flash(`载入失败：${error instanceof Error ? error.message : '未知错误'}`)
        throw error
      } finally {
        setSkinLoading(false)
      }
    },
    [doc, bump, flash, saveNow, commitModel],
  )

  const importSkinFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        flash('请选择 PNG 图片文件')
        return
      }
      const objectUrl = URL.createObjectURL(file)
      try {
        await loadSkinFromUrl(objectUrl, file.name.replace(/\.png$/i, ''), true)
      } catch {
        // loadSkinFromUrl 内部已经提示过了
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    },
    [loadSkinFromUrl, flash],
  )

  /**
   * 把合成结果落到编辑器里。
   *
   * 走 `loadSkinImage` 而不是逐像素 setPixel：语义就是「换一张皮肤」（清空撤销栈、
   * 重新推断尺寸信息），而且用户在合成页看到的和落到绘制页的必须是同一份像素。
   */
  const adoptSkin = useCallback(
    (source: HTMLCanvasElement, name: string, model: ModelKind) => {
      const info = doc.loadSkinImage(source)
      commitModel(model)
      skinNameRef.current = name
      setSkin({ name, ...info })
      bump()
      saveNow('auto')
      flash(`已载入「${name}」· ${MODEL_LABELS[model]}`)
    },
    [doc, bump, flash, saveNow, commitModel],
  )

  const resetSkin = useCallback(() => {
    // 清掉残留的导出完成对话框：resetSkin 走「新建皮肤」路径（导出后浏览器后退回大厅再点新建），
    // 与 MergeContext.resetMerge 里清 exported 对称，否则旧的导出反馈会跟着进新画布。
    setExported(null)
    doc.clear()
    skinNameRef.current = '未命名皮肤'
    commitModel('wide')
    setSkin(null)
    bump()
    saveNow('auto')
    flash('已清空皮肤')
  }, [doc, bump, flash, saveNow, commitModel, setExported])

  /**
   * 大厅「绘制 = 新建」的落地动作。
   *
   * 清空画布后清掉草稿槽，让「有没有未完成作业」的判断回到「无」。
   * 这里的 clearSnapshot 与 saveNow 里的空画布守卫（doc.isEmpty() → clearSnapshot）
   * 是双保险：即便 resetSkin 内部的 saveNow('auto') 或随后防抖重排的自动保存
   * 再触发一次，也会因为画布仍空而落到 clearSnapshot，不会复活空草稿。
   */
  /** 按偏好载入「首次打开 / 新建」的起点皮肤；空画布返回已完成。 */
  const loadStarterSkin = useCallback(() => {
    const base = readStarter()
    if (base === 'white') return loadSkinFromUrl(createWhiteSkinDataUrl(), '纯白皮肤', false, 'wide')
    if (base === 'sample') return loadSkinFromUrl(BUILTIN_SKIN_URL, '示例·宽型')
    return Promise.resolve()
  }, [loadSkinFromUrl])

  const startNewSkin = useCallback(
    (base: StarterBase = readStarter()) => {
      resetSkin()
      clearSnapshot()
      // 纯白 / 示例都走 loadSkinFromUrl（与导入同一条解码路径），空画布则什么都不做
      if (base === 'white') {
        void loadSkinFromUrl(createWhiteSkinDataUrl(), '纯白皮肤', false, 'wide').catch(() => flash('纯白皮肤生成失败'))
      } else if (base === 'sample') {
        void loadStarterSkin().catch(() => flash('内置示例皮肤加载失败，可手动导入'))
      }
    },
    [resetSkin, loadStarterSkin, loadSkinFromUrl, flash],
  )

  /** 从作品库恢复一件绘制作品：dataUrl 走与导入完全相同的解码路径 */
  const loadWork = useCallback(
    async (work: WorkItem) => {
      // 进入绘制视图时清掉残留的导出完成对话框（与合成侧 loadMergeWork 对称）。
      // 加在 loadWork 而不是 loadSkinFromUrl：后者还被导入 / 快照恢复复用，
      // 那些路径不该背这个「切换作品」的副作用。
      setExported(null)
      await loadSkinFromUrl(work.dataUrl, work.name, true, work.model)
    },
    [loadSkinFromUrl, setExported],
  )

  // ------------------------------------------------------------ 自动保存

  /**
   * 自动保存的触发点。
   *
   * 用 `historyVersion`（落笔结束 / 撤销 / 重做 / 导入时自增）而不是订阅像素流：
   * 一次拖拽会产生几十上百次像素变更，但只有拖拽结束才是可保存的稳态。
   */
  useEffect(() => {
    if (!autosaveEnabled) return
    const timer = window.setTimeout(() => saveNow('auto'), AUTOSAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [autosaveEnabled, historyVersion, saveNow])

  // 首次进入：优先恢复本地暂存，没有才载入内置示例皮肤
  const defaultLoaded = useRef(false)
  useEffect(() => {
    if (defaultLoaded.current) return
    defaultLoaded.current = true

    const snapshot = readSnapshot()
    if (snapshot) {
      // 体型用快照里存的：用户当时手选的纤细，不该被重新推断出来的宽型覆盖掉
      loadSkinFromUrl(snapshot.dataUrl, snapshot.name, false, snapshot.model)
        .then(() => flash(`已恢复上次编辑的内容（${describeAgo(snapshot.savedAt)}）`))
        .catch(() => {
          // 快照坏了（被手工改过 / 解码失败）就丢掉，否则每次打开都会再失败一次；
          // 同时退回内置示例皮肤，绝不把用户卡在空白画布上
          clearSnapshot()
          setLastSavedAt(null)
          loadStarterSkin().catch(() => {
            flash('内置示例皮肤加载失败，可手动导入')
          })
        })
      return
    }

    loadStarterSkin().catch(() => {
      flash('内置示例皮肤加载失败，可手动导入')
    })
  }, [loadSkinFromUrl, flash])

  // 快捷键（B/E/I 切工具、Ctrl+Z/Y 撤销重做、Ctrl+S 保存）搬去了 DrawView：
  // 那是「绘制工作区」的行为，挂在这里等于全应用生效，在大厅上按也是白按。

  const value = useMemo<EditorContextValue>(
    () => ({
      tool,
      setTool,
      color,
      setColor,
      recentColors,
      rememberColor,
      zoom,
      setZoom,
      showGrid,
      toggleGrid,
      selectedPart,
      setSelectedPart,
      face,
      setFace,
      layer,
      setLayer,
      doc,
      historyVersion,
      canUndo: doc.canUndo,
      canRedo: doc.canRedo,
      undo,
      redo,
      commitStroke,
      skin,
      skinLoading,
      loadSkinFromUrl,
      importSkinFile,
      adoptSkin,
      resetSkin,
      startNewSkin,
      loadWork,
      modelType,
      setModelType,
      exportSkin,
      skinName: skin?.name ?? '未命名皮肤',
      exported,
      dismissExport,
      saveNow,
      lastSavedAt,
      autosaveEnabled,
      setAutosaveEnabled,
      status,
      flash,
      cursor,
      setCursor,
    }),
    [
      tool,
      color,
      setColor,
      recentColors,
      rememberColor,
      zoom,
      setZoom,
      showGrid,
      toggleGrid,
      selectedPart,
      face,
      layer,
      doc,
      historyVersion,
      undo,
      redo,
      commitStroke,
      skin,
      skinLoading,
      loadSkinFromUrl,
      importSkinFile,
      adoptSkin,
      resetSkin,
      startNewSkin,
      loadWork,
      modelType,
      setModelType,
      exportSkin,
      exported,
      dismissExport,
      saveNow,
      lastSavedAt,
      autosaveEnabled,
      setAutosaveEnabled,
      status,
      flash,
      cursor,
      setCursor,
    ],
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor 必须在 EditorProvider 内部使用')
  return ctx
}
