import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SKIN_SIZE } from '../constants'
import { buildSkinPngFromCanvas, describeExport, downloadBlob } from '../lib/exportSkin'
import type { SkinExport } from '../lib/exportSkin'
import { SOURCE_IDS, SOURCE_LABELS, composeMerge, defaultChoice, mergeBaseName } from '../lib/mergeSkin'
import type { MergeChoice, MergeResult, MergeSource, SourceId } from '../lib/mergeSkin'
import { MODEL_LABELS, inferModelKind } from '../lib/skinModel'
import type { ModelKind } from '../lib/skinModel'
import { decodeSkinPixels, imageDataToCanvas as canvasOf } from '../lib/skinImage'
import { ALL_BODY_KEYS } from '../lib/skinParts'
import type { BodyKey } from '../lib/skinParts'
import { addWork } from '../lib/works'
import type { WorkItem, WorkSource } from '../lib/works'
import { useEditor } from './EditorContext'

/**
 * 合成页的状态。
 *
 * **单独一个 Provider，而不是塞进 EditorContext**：合成有自己的两张源图、一张选择表
 * 和一个输出体型，跟编辑文档没有交集；混在一起会让编辑那边每加一个东西都要求合成页重渲染。
 *
 * 挂在视图之上（见 App.tsx），所以往返大厅不会丢已经上传的两张皮肤 ——
 * 这一点必须做到：重传两张 PNG 是很烦的，而进大厅只是想切个功能。
 */
export interface MergeContextValue {
  sources: { a: MergeSource | null; b: MergeSource | null }
  loadSourceFile: (id: SourceId, file: File) => Promise<void>
  /** 把编辑里的当前皮肤复制过来当源图（先画一张再合成，是最顺的用法） */
  copyCurrentSkin: (id: SourceId) => void
  clearSource: (id: SourceId) => void
  setSourceModel: (id: SourceId, model: ModelKind) => void
  /**
   * 两张源图都载入了、但体型不一致。
   *
   * 源图的体型是**从贴图像素自动识别的**，不让用户手动切 —— 见 SkinModelSelect 的说明。
   * 但两张不一样时必须说出来：体型决定手臂贴图有多宽（4 / 3 像素），
   * 从一张取手臂贴到另一张的布局上要跨体型重排，结果虽然能出，却不是用户以为的那样。
   */
  sourceModelMismatch: boolean

  choice: MergeChoice
  setPartChoice: (key: BodyKey, patch: Partial<MergeChoice[BodyKey]>) => void
  /** 一个部件同时决定两层（界面上的「整体用 A / 用 B」） */
  setPartBothLayers: (key: BodyKey, id: SourceId) => void
  /** 全部部件、全部层都用某一张 */
  applyAll: (id: SourceId) => void

  outputModel: ModelKind
  setOutputModel: (model: ModelKind) => void

  result: MergeResult | null
  /** 合成结果的 64×64 画布，喂给 3D 预览和导出 */
  resultCanvas: HTMLCanvasElement | null
  /** 结果画布的内容版本号；3D 预览靠它知道该重新上传纹理 */
  resultVersion: number
  mergedName: string

  /** 导出成功的成品信息。非 null 就意味着该弹「合成完成」对话框了 */
  exported: SkinExport | null
  /** 只关掉对话框，当前合成结果原样留着 */
  dismissExport: () => void
  /** 清空两张源图和选择表，回到刚进页面时的样子 */
  resetMerge: () => void
  /** 大厅「合成 = 新建」：语义同 resetMerge（合成无草稿槽） */
  startNewMerge: () => void
  /** 从作品库恢复一件合成作品：两张源图 + 选择表 + 输出体型 + 名称 */
  loadMergeWork: (work: WorkItem) => Promise<void>

  exportMerged: (baseName?: string) => Promise<boolean>
}

const MergeContext = createContext<MergeContextValue | null>(null)

export function MergeProvider({ children }: { children: ReactNode }) {
  const { doc, modelType, flash } = useEditor()

  const [sources, setSources] = useState<{ a: MergeSource | null; b: MergeSource | null }>({
    a: null,
    b: null,
  })
  const [choice, setChoice] = useState<MergeChoice>(() => defaultChoice('a'))
  const [outputModel, setOutputModelState] = useState<ModelKind>('wide')
  /**
   * 从作品库恢复时记下的作品名。
   *
   * 平时合成名由两张源图的名字拼出来（`mergeBaseName`），但恢复一件作品后，
   * 名字应该是它导出时用户起的那个（可能跟「A+B」不一样）—— 导出默认名要预填它。
   * 非空时覆盖派生名；点「新建」清空，回到跟随源图。
   */
  const [nameOverride, setNameOverride] = useState<string | null>(null)

  /**
   * 用户有没有亲手动过右上角的「输出体型」。
   *
   * 没动过之前让它跟着源图跑；动过就不再插手。
   * 否则默认的 wide 撞上一张纤细源图，用户第一眼看到的是重排过的错位手臂，
   * 却不知道问题出在右上角那个开关 —— 这正是「三个体型开关」最劝退的地方。
   */
  const outputTouchedRef = useRef(false)
  const setOutputModel = useCallback((model: ModelKind) => {
    outputTouchedRef.current = true
    setOutputModelState(model)
  }, [])

  /**
   * 源图体型 -> 输出体型。
   *
   * 只在"两张都一致"时跟随：不一致说明不了该输出哪一种，
   * 这时候保持现状，由界面上的提示去让用户先把两张图统一了。
   */
  useEffect(() => {
    if (outputTouchedRef.current) return
    const kinds = SOURCE_IDS.map((id) => sources[id]?.model).filter(
      (kind): kind is ModelKind => kind !== undefined,
    )
    if (kinds.length === 0 || !kinds.every((kind) => kind === kinds[0])) return
    setOutputModelState(kinds[0])
  }, [sources])

  /**
   * 源图的 ref 镜像。
   *
   * `loadSourceFile` 要判断"另一侧是不是空的"来决定要不要把整张表默认成这一张。
   * 不能在 setSources 的更新函数里顺手调 setChoice —— 更新函数必须是纯的
   * （StrictMode 下会被调用两次），那种写法会有难以预期的重复副作用。
   */
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  // ------------------------------------------------------------ 源图

  const loadSourceFile = useCallback(
    async (id: SourceId, file: File) => {
      if (!file.type.startsWith('image/')) {
        flash('请选择 PNG 图片文件')
        return
      }
      const url = URL.createObjectURL(file)
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          el.crossOrigin = 'anonymous'
          el.onload = () => resolve(el)
          el.onerror = () => reject(new Error('图片解码失败'))
          el.src = url
        })
        const decoded = decodeSkinPixels(image)
        const name = file.name.replace(/\.png$/i, '') || SOURCE_LABELS[id]
        const source: MergeSource = {
          name,
          image: decoded.image,
          /*
            体型只推断个初值，用户可以在卡片上改。
            推断走**已解码的 64×64 像素**而不是原始文件：旧版 64×32 和尺寸异常的图
            在解码时已经被补全 / 拉伸过，推断必须看最终会参与合成的那份像素。
            （inferModelKind 收的是画布，所以这里把快照再转回一张画布。）
          */
          model: inferModelKind(canvasOf(decoded.image)),
          width: decoded.width,
          height: decoded.height,
          legacy: decoded.legacy,
          standard: decoded.standard,
        }
        const other = id === 'a' ? sourcesRef.current.b : sourcesRef.current.a
        setSources((prev) => ({ ...prev, [id]: source }))
        // 只载入了一张时默认整张都用它 —— 否则另一侧全空，用户要多点六下
        if (!other) setChoice(defaultChoice(id))
        flash(`已载入${SOURCE_LABELS[id]}「${name}」`)
      } catch (error) {
        flash(`载入失败：${error instanceof Error ? error.message : '未知错误'}`)
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    [flash],
  )

  const copyCurrentSkin = useCallback(
    (id: SourceId) => {
      // getImageData() 返回的是副本，之后在编辑器里继续画不会改到这张源图
      const image = doc.getImageData()
      const name = `当前绘制（${MODEL_LABELS[modelType]}）`
      setSources((prev) => ({
        ...prev,
        [id]: {
          name,
          image,
          model: modelType,
          width: SKIN_SIZE,
          height: SKIN_SIZE,
          legacy: false,
          standard: true,
        },
      }))
      flash(`已把当前皮肤复制为${SOURCE_LABELS[id]}`)
    },
    [doc, modelType, flash],
  )

  const clearSource = useCallback((id: SourceId) => {
    setSources((prev) => ({ ...prev, [id]: null }))
  }, [])

  const setSourceModel = useCallback((id: SourceId, model: ModelKind) => {
    setSources((prev) => {
      const source = prev[id]
      if (!source) return prev
      return { ...prev, [id]: { ...source, model } }
    })
  }, [])

  // ------------------------------------------------------------ 选择表

  const setPartChoice = useCallback(
    (key: BodyKey, patch: Partial<MergeChoice[BodyKey]>) => {
      setChoice((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    },
    [],
  )

  const setPartBothLayers = useCallback((key: BodyKey, id: SourceId) => {
    setChoice((prev) => ({ ...prev, [key]: { base: id, overlay: id } }))
  }, [])

  const applyAll = useCallback((id: SourceId) => setChoice(defaultChoice(id)), [])

  // ------------------------------------------------------------ 合成结果

  const result = useMemo(
    () => composeMerge(sources, choice, outputModel),
    [sources, choice, outputModel],
  )

  /** 结果的落点画布。用 ref 保持身份稳定 —— 3D 预览不能每次重算就重建 viewer */
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!canvasRef.current && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = SKIN_SIZE
    canvas.height = SKIN_SIZE
    canvasRef.current = canvas
  }

  const [resultVersion, setResultVersion] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE)
    if (result) ctx.putImageData(result.image, 0, 0)
    setResultVersion((v) => v + 1)
  }, [result])

  const mergedName = useMemo(
    () => nameOverride ?? mergeBaseName(sources),
    [nameOverride, sources],
  )

  /**
   * 导出成功后留下的成品信息，界面靠它弹「合成完成」。
   *
   * 对话框要显示文件名 / 层数 / 第一层空洞这些只有 SkinExport 才知道的东西，
   * 而这些在导出那一刻才存在，所以它是一个状态而不是按钮里的临时变量。
   */
  const [exported, setExported] = useState<SkinExport | null>(null)

  const exportMerged = useCallback(
    async (baseName?: string) => {
      const canvas = canvasRef.current
      if (!canvas || !result) {
        flash('先载入至少一张皮肤')
        return false
      }
      try {
        const built = await buildSkinPngFromCanvas(
          canvas,
          baseName ?? mergedName,
          outputModel,
          'merge',
        )
        downloadBlob(built.blob, built.filename)
        flash(describeExport(built))
        setExported(built)
        // 导出成功即入库一件合成作品：带上两张源图 + 选择表 + 输出体型，
        // 供「我的皮肤」点进去时恢复合成页。入库失败不能吞掉，要明确提示。
        const saved = addWork({
          id: crypto.randomUUID(),
          kind: 'merge',
          name: baseName ?? mergedName,
          model: outputModel,
          updatedAt: Date.now(),
          dataUrl: built.dataUrl,
          merge: {
            sources: SOURCE_IDS.map((id) => {
              const src = sources[id]
              if (!src) return null
              return {
                name: src.name,
                model: src.model,
                dataUrl: canvasOf(src.image).toDataURL('image/png'),
              }
            }) as [WorkSource | null, WorkSource | null],
            choice,
            outputModel,
          },
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
    [result, mergedName, outputModel, flash, sources, choice],
  )

  const dismissExport = useCallback(() => setExported(null), [])

  /**
   * 清空重来。
   *
   * 输出体型**故意不清**：给同一个角色连着合成几套衣服是常规用法，
   * 每张都回到默认值反而是多按一下。
   */
  const resetMerge = useCallback(() => {
    setSources({ a: null, b: null })
    setChoice(defaultChoice('a'))
    setExported(null)
    setNameOverride(null)
  }, [])

  /** 大厅「合成 = 新建」：与 resetMerge 相同（合成没有草稿槽，无需清快照） */
  const startNewMerge = useCallback(() => {
    resetMerge()
  }, [resetMerge])

  /**
   * 从作品库恢复一件合成作品。
   *
   * 与 EditorContext.loadWork 对称：dataUrl 走「导入皮肤」完全相同的解码路径
   * （`decodeSkinPixels`），体型用作品里存的（用户可能手动改过），不重新推断。
   * choice 里的 key 若在当前版本已不存在（重构改过部件名），整表回退默认并提示，
   * 绝不因为一件旧作品就崩掉或错配。
   */
  const loadMergeWork = useCallback(
    async (work: WorkItem) => {
      // 进入合成视图时清掉残留的导出完成对话框：exported 住在 Provider，
      // 浏览器后退回大厅时不会清，这里恢复作品会把它重新带出来。
      setExported(null)

      const merge = work.merge
      if (!merge) {
        flash('这件合成作品缺少源图数据，无法恢复')
        return
      }

      // 逐源解码成 MergeSource。dataUrl 加载走与 loadSourceFile 相同的 new Image 路径。
      const restored: { a: MergeSource | null; b: MergeSource | null } = { a: null, b: null }
      for (const id of SOURCE_IDS) {
        const stored = merge.sources[id === 'a' ? 0 : 1]
        if (!stored) continue
        try {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image()
            el.crossOrigin = 'anonymous'
            el.onload = () => resolve(el)
            el.onerror = () => reject(new Error('图片解码失败'))
            el.src = stored.dataUrl
          })
          const decoded = decodeSkinPixels(image)
          restored[id] = {
            name: stored.name,
            image: decoded.image,
            model: stored.model,
            width: decoded.width,
            height: decoded.height,
            legacy: decoded.legacy,
            standard: decoded.standard,
          }
        } catch (error) {
          flash(
            `${SOURCE_LABELS[id]}恢复失败：${error instanceof Error ? error.message : '未知错误'}`,
          )
        }
      }

      // 防御式恢复选择表：key 不在当前部件集合、或 base/overlay 不是合法来源，就整表回退默认。
      const validChoice = ALL_BODY_KEYS.every((key) => {
        const part = merge.choice[key]
        return (
          part !== undefined &&
          (part.base === 'a' || part.base === 'b') &&
          (part.overlay === 'a' || part.overlay === 'b')
        )
      })
      if (validChoice) {
        setChoice(merge.choice)
      } else {
        setChoice(defaultChoice('a'))
        flash('这件作品的部件选择表已过期，已重置为默认分配')
      }

      // 输出体型也要恢复，并且视为「用户已手动设定」——恢复的应该是当时选的结果，
      // 不该再被源图体型自动带偏。
      outputTouchedRef.current = true
      setOutputModelState(merge.outputModel)

      setSources(restored)
      setNameOverride(work.name)
      flash(`已恢复合成作品「${work.name}」`)
    },
    [flash],
  )

  const sourceModelMismatch =
    sources.a !== null && sources.b !== null && sources.a.model !== sources.b.model

  const value = useMemo<MergeContextValue>(
    () => ({
      sources,
      loadSourceFile,
      copyCurrentSkin,
      clearSource,
      setSourceModel,
      sourceModelMismatch,
      choice,
      setPartChoice,
      setPartBothLayers,
      applyAll,
      outputModel,
      setOutputModel,
      result,
      resultCanvas: canvasRef.current,
      resultVersion,
      mergedName,
      exported,
      dismissExport,
      resetMerge,
      startNewMerge,
      loadMergeWork,
      exportMerged,
    }),
    [
      sources,
      loadSourceFile,
      copyCurrentSkin,
      clearSource,
      setSourceModel,
      sourceModelMismatch,
      choice,
      setPartChoice,
      setPartBothLayers,
      applyAll,
      outputModel,
      setOutputModel,
      result,
      resultVersion,
      mergedName,
      exported,
      dismissExport,
      resetMerge,
      startNewMerge,
      loadMergeWork,
      exportMerged,
    ],
  )

  return <MergeContext.Provider value={value}>{children}</MergeContext.Provider>
}

export function useMerge(): MergeContextValue {
  const ctx = useContext(MergeContext)
  if (!ctx) throw new Error('useMerge 必须在 MergeProvider 内部使用')
  return ctx
}
