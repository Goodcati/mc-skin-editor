import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Combine,
  Download,
  ImagePlus,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import MergeDoneDialog from '../components/MergeDoneDialog'
import ExportNameDialog from '../components/ExportNameDialog'
import SkinViewport from '../components/SkinViewport'
import { APP_VERSION } from '../constants'
import { SOURCE_IDS, SOURCE_LABELS, partBounds } from '../lib/mergeSkin'
import type { MergeSource, SourceId } from '../lib/mergeSkin'
import { MODEL_HINTS, MODEL_KINDS, MODEL_LABELS } from '../lib/skinModel'
import type { ModelKind } from '../lib/skinModel'
import { imageDataToCanvas } from '../lib/skinImage'
import { LAYER_IDS, LAYER_LABELS } from '../lib/skinFaces'
import type { SkinLayer } from '../lib/skinFaces'
import { ALL_BODY_KEYS, BODY_KEY_LABELS } from '../lib/skinParts'
import type { BodyKey } from '../lib/skinParts'
import { useEditor } from '../state/EditorContext'
import { useMerge } from '../state/MergeContext'

/**
 * 合成工作区：把两张皮肤按「部件 × 层」拼成一张。
 *
 * 版面沿用绘制页的三栏语义 —— 左进、中操作、右出：
 *   左   两张源图（上传 / 用当前皮肤）
 *   中   合成表：6 个部件一行，需要细调再展开到第一层 / 第二层
 *   右   结果 3D 预览 + 唯一的出口（导出 PNG）
 *
 * **体型只出现两次，而且只有一处能改**（本次返工的主因）：
 *   源图卡上的是「识别结果」—— 从贴图像素认出来的，样式上是标签不是开关；
 *   右上角的是「输出体型」—— 决定结果图按哪套 UV 排、导出文件名带什么后缀。
 *   以前源图卡上也是二选一开关，加上右上角一共三个，用户得先弄清谁管谁；
 *   两张源图不一致时现在由警告条直接说明，而不是丢给他一个自己推。
 *
 * 粒度为什么停在「层」而不到「面」：换装真正要区分的是"整块换"（换头、换身体）和
 * "只换外套那一层"。再细到面（比如只换头部的正面）在换装里没有对应需求，
 * 却会把交互从 6 行变成 72 格。底层数据是按面切的，要放出来不难。
 */

/** 整张皮肤缩略图的显示边长（CSS 像素）。64 的整数倍放大才不会糊 */
const SKIN_THUMB = 128
const PART_THUMB_W = 104
const PART_THUMB_H = 52

const SHORT: Record<SourceId, string> = { a: 'A', b: 'B' }

/** 合成表的列宽：部件名 / A 缩略图 / 取用 / B 缩略图 / 展开 */
const ROW_GRID = 'grid grid-cols-[74px_104px_84px_104px_24px] items-center gap-2'

export default function MergeView() {
  const {
    sources,
    applyAll,
    outputModel,
    setOutputModel,
    exported,
    dismissExport,
    resetMerge,
    exportMerged,
    mergedName,
    result,
  } = useMerge()
  const { status } = useEditor()

  const loaded = SOURCE_IDS.filter((id) => sources[id] !== null)

  const [naming, setNaming] = useState(false)
  const ready = result !== null

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app text-fg-2">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-wash-10 bg-surface-chrome px-4">
        <div className="flex items-center gap-2">
          <a
            href="#/"
            aria-label="返回大厅"
            title="返回大厅"
            className="grid h-6 w-6 place-items-center rounded text-fg-5 transition-colors hover:bg-wash-6 hover:text-fg-2"
          >
            <ArrowLeft size={14} strokeWidth={2} />
          </a>
          <span className="grid h-6 w-6 place-items-center rounded bg-accent-400/15 text-accent-300">
            <Box size={15} strokeWidth={2} />
          </span>
          <h1 className="text-13 font-semibold tracking-wide">合成皮肤</h1>
          <span
            className="rounded bg-wash-6 px-1.5 py-0.5 font-mono text-10 text-fg-4"
            title="版本号：主版本.迭代.补丁"
          >
            {APP_VERSION}
          </span>
        </div>

        {/*
          输出体型。和绘制页那个是同一件事：PNG 里没有体型，官网上传时要手选。
          合成结果按这个体型排手臂贴图，所以它既是导出文件名的后缀，也是输出布局。
        */}
        <div className="flex items-center gap-3 text-11 text-fg-5">
          <span>输出体型</span>
          <ModelToggle
            value={outputModel}
            onChange={setOutputModel}
            ariaLabel="合成结果体型"
          />
          <button
            type="button"
            disabled={!ready}
            onClick={() => setNaming(true)}
            title="导出 64×64 PNG，可直接导入 Minecraft"
            className="flex items-center gap-1.5 rounded-md border border-accent-400/30 bg-accent-400/10 px-2 py-1 text-11 text-accent-300 transition-colors hover:border-accent-400/55 disabled:cursor-not-allowed disabled:border-wash-5 disabled:bg-transparent disabled:text-fg-7"
          >
            <Download size={12} strokeWidth={2} />
            导出
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <div className="flex w-[300px] min-w-[292px] flex-col gap-2 border-r border-wash-10 p-2">
          <p className="shrink-0 px-1 text-11 font-medium tracking-wide text-fg-4">
            源皮肤
            <span className="ml-2 font-normal text-fg-6">拖入 PNG，或取当前绘制</span>
          </p>
          <SourceCard id="a" />
          <SourceCard id="b" />
          <div className="min-h-0 flex-1" />
          {loaded.length < 2 && (
            <p className="shrink-0 rounded-md border border-wash-6 bg-wash-2 px-2 py-1.5 text-10 leading-relaxed text-fg-6">
              只载入一张也能用：整张都是它，改完输出体型直接导出，就等于「转一次体型」。
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-8 shrink-0 items-center justify-between border-b border-wash-7 px-3">
            <div className="flex items-center gap-1.5 text-fg-4">
              <Combine size={13} strokeWidth={2} />
              <span className="text-11 font-medium tracking-wide">按部件合成</span>
            </div>
            <div className="flex items-center gap-1.5">
              {SOURCE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={!sources[id]}
                  aria-label={`全部部件都用${SOURCE_LABELS[id]}`}
                  onClick={() => applyAll(id)}
                  title={`把 6 个部件、两层全部设为${SOURCE_LABELS[id]}`}
                  className="rounded border border-wash-7 bg-wash-3 px-2 py-0.5 text-10 text-fg-4 transition-colors hover:border-accent-400/40 hover:text-accent-300 disabled:cursor-not-allowed disabled:border-wash-5 disabled:bg-transparent disabled:text-fg-7"
                >
                  全用 {SHORT[id]}
                </button>
              ))}
            </div>
          </header>
          <div className="thin-scroll min-h-0 flex-1 overflow-auto p-3">
            <ModelMismatchNote />
            {loaded.length === 0 ? <EmptyGuide /> : <MergeTable />}
          </div>
        </div>

        <div className="w-[32%] min-w-[300px] border-l border-wash-10">
          <ResultPanel />
        </div>
      </main>

      {/*
        提示只落在这一个位置（合成页没有绘制页那套光标 / 工具状态，
        就不再单独造一个状态栏组件了）
      */}
      <footer className="flex h-6 shrink-0 items-center border-t border-wash-10 bg-surface-chrome px-3 text-10 text-fg-5">
        {status || '合成都是一次性的像素运算，不动编辑器的撤销记录'}
      </footer>

      {/*
        导出成功后才问"接下来去哪"。放在这里而不是按钮的 onClick 里：
        exported 是状态，对话框关掉就消失，不会因为重渲染又弹一次。
      */}
      {exported && (
        <MergeDoneDialog
          info={exported}
          onStartNew={resetMerge}
          onLobby={() => {
            // 先收掉对话框再跳：MergeProvider 挂在视图之上，留着它会在大厅回来时又弹一次
            dismissExport()
            window.location.hash = '#/'
          }}
          onClose={dismissExport}
        />
      )}

      {/* 导出前的命名确认：确认后才会真正生成并下载（导出按钮已上移顶栏） */}
      {naming && (
        <ExportNameDialog
          defaultName={mergedName}
          onConfirm={(name) => {
            setNaming(false)
            void exportMerged(name)
          }}
          onCancel={() => setNaming(false)}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ 源皮肤卡片

function SourceCard({ id }: { id: SourceId }) {
  const { sources, loadSourceFile, copyCurrentSkin, clearSource, setSourceModel } = useMerge()
  const source = sources[id]
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 先取出文件再清空 value：清空在前的话 files 已经空了（连续选同一个文件也不会触发 change）
    event.target.value = ''
    if (file) void loadSourceFile(id, file)
  }

  return (
    <section
      aria-label={`${SOURCE_LABELS[id]}卡片`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file) void loadSourceFile(id, file)
      }}
      className={
        'shrink-0 rounded-lg border p-2 transition-colors ' +
        (dragging
          ? 'border-accent-400/50 bg-accent-400/[0.05]'
          : 'border-wash-8 bg-surface-panel')
      }
    >
      <header className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-11 font-medium text-fg-3">
          <span className="grid h-4 w-4 place-items-center rounded bg-wash-7 font-mono text-10 text-fg-4">
            {SHORT[id]}
          </span>
          {SOURCE_LABELS[id]}
        </span>
        {source && (
          <button
            type="button"
            aria-label={`清除${SOURCE_LABELS[id]}`}
            title="清除这张源图"
            onClick={() => clearSource(id)}
            className="grid h-5 w-5 place-items-center rounded text-fg-6 transition-colors hover:bg-wash-6 hover:text-fg-3"
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </header>

      {source ? (
        <div className="flex items-start gap-2">
          <SkinThumb image={source.image} label={`${SOURCE_LABELS[id]}缩略图`} />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <span className="w-full truncate text-11 text-fg-3" title={source.name}>
              {source.name}
            </span>
            <span className="font-mono text-10 text-fg-6">
              {source.width}×{source.height}
              {source.legacy && ' · 旧版已补全'}
              {!source.standard && ' · 非标准尺寸'}
            </span>
            <SkinModelSelect
              id={id}
              value={source.model}
              onChange={(model) => setSourceModel(id, model)}
            />
            <button
              type="button"
              aria-label={`更换${SOURCE_LABELS[id]}`}
              onClick={() => inputRef.current?.click()}
              className="rounded border border-wash-7 bg-wash-3 px-1.5 py-0.5 text-10 text-fg-4 transition-colors hover:border-accent-400/40 hover:text-accent-300"
            >
              换一张
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-wash-12 px-2 py-4">
          <ImagePlus size={18} strokeWidth={1.6} className="text-fg-7" />
          <span className="text-center text-10 text-fg-6">
            拖入 PNG 到这里，或者
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              aria-label={`选择${SOURCE_LABELS[id]}的 PNG`}
              onClick={() => inputRef.current?.click()}
              className="rounded border border-wash-9 bg-wash-4 px-2 py-0.5 text-10 text-fg-3 transition-colors hover:border-accent-400/40 hover:text-accent-300"
            >
              选择 PNG
            </button>
            <button
              type="button"
              aria-label={`把当前绘制的皮肤作为${SOURCE_LABELS[id]}`}
              onClick={() => copyCurrentSkin(id)}
              title="把绘制页正在编辑的那张皮肤复制过来"
              className="rounded border border-wash-7 bg-wash-2 px-2 py-0.5 text-10 text-fg-5 transition-colors hover:border-accent-400/40 hover:text-accent-300"
            >
              用当前皮肤
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/*"
        className="hidden"
        aria-label={`${SOURCE_LABELS[id]}文件选择`}
        onChange={handleChange}
      />
    </section>
  )
}

/**
 * 源图体型的展示。
 *
 * **做成「识别结果」而不是开关，是这一版最关键的改动。**
 * 源图的体型是数据属性（决定去这张图的哪个矩形里取手臂贴图），不是用户的选择。
 * 以前这里也是个二选一按钮，于是界面上同时有三个体型开关（A / B / 输出），
 * 每个都"看起来需要自己决定"，谁也不说清自己管什么 —— 用户得先试一遍才能明白。
 *
 * 仍然可改：inferModelKind 是像素启发式，作者把手臂区域填满时会认错。
 * 但入口是下拉框（"这是个值"的语义）而不是按钮（"这是个动作"的语义），
 * 一眼能看出"这是读出来的、读错了可以纠"，而不是"这里有个我该做的选择"。
 */
function SkinModelSelect({
  id,
  value,
  onChange,
}: {
  id: SourceId
  value: ModelKind
  onChange: (model: ModelKind) => void
}) {
  return (
    <label className="flex items-center gap-1 text-10 text-fg-6">
      <span>识别为</span>
      <div
        role="group"
        aria-label={`${SOURCE_LABELS[id]}体型识别结果`}
        className="flex overflow-hidden rounded border border-wash-9"
      >
        {MODEL_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={value === kind}
            aria-label={`${SOURCE_LABELS[id]}体型识别结果 ${MODEL_LABELS[kind]}`}
            onClick={() => onChange(kind)}
            title={`${MODEL_HINTS[kind]}。这是从贴图自动识别的，认错了可以直接改`}
            className={
              'px-1.5 py-0.5 text-10 transition-colors ' +
              (value === kind
                ? 'bg-accent-400/15 text-accent-300'
                : 'bg-wash-3 text-fg-3 hover:text-fg-2')
            }
          >
            {MODEL_LABELS[kind]}
          </button>
        ))}
      </div>
    </label>
  )
}

/** 输出体型的二选一。全页**唯一**一个体型开关，右上角专用 */
function ModelToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: ModelKind
  onChange: (model: ModelKind) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex overflow-hidden rounded border border-wash-7"
    >
      {MODEL_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          aria-label={`${ariaLabel} ${MODEL_LABELS[kind]}`}
          onClick={() => onChange(kind)}
          title={`${MODEL_HINTS[kind]}。导出文件名会带这个后缀，上传时请选同一项`}
          className={
            'px-2 py-0.5 text-11 transition-colors ' +
            (value === kind
              ? 'bg-accent-400/15 text-accent-300'
              : 'bg-wash-3 text-fg-3 hover:text-fg-2')
          }
        >
          {MODEL_LABELS[kind]}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------- 缩略图

/**
 * canvas 缩略图的公共部分：按设备像素比放大画布，再把坐标缩回 CSS 像素。
 *
 * 每次渲染都重画一遍（缩略图很小，代价可忽略），但**只在尺寸真的变化时才写
 * canvas.width/height** —— 赋值会清空画布并让浏览器重新分配纹理，
 * 每帧都赋一次等于白白抖一遍。
 */
function useThumbCanvas(
  draw: (ctx: CanvasRenderingContext2D) => void,
  width: number,
  height: number,
) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const backingW = Math.round(width * dpr)
    const backingH = Math.round(height * dpr)
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW
      canvas.height = backingH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, width, height)
    draw(ctx)
  })
  return ref
}

function SkinThumb({
  image,
  label,
  size = SKIN_THUMB,
}: {
  image: ImageData
  label: string
  size?: number
}) {
  const source = useMemo(() => imageDataToCanvas(image), [image])
  const ref = useThumbCanvas(
    (ctx) => {
      ctx.drawImage(source, 0, 0, 64, 64, 0, 0, size, size)
    },
    size,
    size,
  )

  return (
    <span
      className="shrink-0 rounded border border-wash-10"
      style={{
        backgroundImage:
          'repeating-conic-gradient(#2f3542 0% 25%, #272c37 0% 50%)',
        backgroundSize: '8px 8px',
      }}
    >
      <canvas
        ref={ref}
        aria-label={label}
        className="block rounded"
        style={{ width: size, height: size }}
      />
    </span>
  )
}

/**
 * 一个部件在某张源图上的样子。
 *
 * 取的是**包围盒**而不是合成用的面矩形集合 —— 缩略图是给人看的，
 * 十字形展开图（含四角的空位）反而更容易认出"这是头 / 这是腿"。
 * 合成本身绝不能按包围盒取，见 buildRegionMap 的说明。
 */
function PartThumb({
  source,
  part,
  layer,
  ariaHidden = true,
}: {
  source: MergeSource | null
  part: BodyKey
  layer: SkinLayer
  ariaHidden?: boolean
}) {
  const image = source?.image
  const slim = source?.model === 'slim'
  const bounds = useMemo(() => partBounds(part, layer, slim), [part, layer, slim])
  const sourceCanvas = useMemo(() => (image ? imageDataToCanvas(image) : null), [image])

  const scale = Math.max(
    1,
    Math.min(
      Math.floor(PART_THUMB_W / bounds.w),
      Math.floor(PART_THUMB_H / bounds.h),
    ),
  )

  const ref = useThumbCanvas(
    (ctx) => {
      if (!sourceCanvas) return
      const w = bounds.w * scale
      const h = bounds.h * scale
      ctx.drawImage(
        sourceCanvas,
        bounds.x,
        bounds.y,
        bounds.w,
        bounds.h,
        Math.round((PART_THUMB_W - w) / 2),
        Math.round((PART_THUMB_H - h) / 2),
        w,
        h,
      )
    },
    PART_THUMB_W,
    PART_THUMB_H,
  )

  return (
    <span
      className="rounded border border-wash-8"
      style={{
        backgroundImage: 'repeating-conic-gradient(#2f3542 0% 25%, #272c37 0% 50%)',
        backgroundSize: '8px 8px',
      }}
    >
      <canvas
        ref={ref}
        aria-hidden={ariaHidden}
        className="block rounded"
        style={{ width: PART_THUMB_W, height: PART_THUMB_H }}
      />
    </span>
  )
}

// --------------------------------------------------------------- 体型一致性提示

/**
 * 两张源图体型不一致时的警告条。
 *
 * 为什么必须显式说出来：体型决定手臂贴图在 64×64 里占多宽（宽型 4 像素、纤细 3 像素）。
 * 从宽型图里取手臂、按纤细布局输出，`remapArms` 会做最近邻重排 ——
 * 结果能用，但手臂上的图案会横向压掉一列，用户看到的是"莫名其妙糊了一格"。
 * 与其让他自己反推，不如把话放在他正看着的地方，并给出可执行的动作。
 *
 * 不阻断导出：跨体型本身是合法需求（纤细的头配宽型的身体），只是不常见、得先知情。
 */
function ModelMismatchNote() {
  const { sources, sourceModelMismatch } = useMerge()
  if (!sourceModelMismatch || !sources.a || !sources.b) return null

  return (
    <p className="mb-2 flex items-start gap-2 rounded-md border border-warn-400/25 bg-warn-400/[0.06] px-2.5 py-2 text-11 leading-relaxed text-warn-300/90">
      <CircleAlert size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>
        两张源图的体型不一样：A 是
        <b className="font-medium">{MODEL_LABELS[sources.a.model]}</b>、B 是
        <b className="font-medium">{MODEL_LABELS[sources.b.model]}</b>。
        体型决定手臂贴图有多宽（宽型 4 像素 / 纤细 3 像素），合成时手臂会被自动重排，
        图案可能被压掉一列。建议用左侧的「换一张」重传一张体型一致的图。
      </span>
    </p>
  )
}

// ------------------------------------------------------------------- 合成表

function MergeTable() {
  const { sources, choice, setPartChoice, setPartBothLayers } = useMerge()
  const [expanded, setExpanded] = useState<BodyKey | null>(null)

  const hasA = sources.a !== null
  const hasB = sources.b !== null

  return (
    <div className="flex flex-col gap-1">
      {/* 列头：把两张源图的名字放在各自的缩略图列上方 */}
      <div className={ROW_GRID + ' px-1 pb-1'}>
        <span className="text-10 text-fg-6">部件</span>
        <span className="truncate text-center text-10 text-fg-5" title={sources.a?.name}>
          {sources.a ? sources.a.name : '皮肤 A 未载入'}
        </span>
        <span className="text-center text-10 text-fg-6">取用</span>
        <span className="truncate text-center text-10 text-fg-5" title={sources.b?.name}>
          {sources.b ? sources.b.name : '皮肤 B 未载入'}
        </span>
        <span />
      </div>

      {ALL_BODY_KEYS.map((key) => {
        const label = BODY_KEY_LABELS[key]
        const isOpen = expanded === key
        const pick = choice[key]
        const mixed = pick.base !== pick.overlay

        return (
          <div key={key} className="rounded-md border border-wash-6 bg-surface-panel/60">
            <div className={ROW_GRID + ' p-1.5'}>
              <span className="text-11 text-fg-3">{label}</span>

              <span className="flex justify-center">
                <PartThumb source={sources.a} part={key} layer="base" />
              </span>

              <span className="flex flex-col items-center gap-0.5">
                {isOpen ? (
                  <span className="text-10 text-fg-6">按层分开</span>
                ) : (
                  <SourcePicker
                    value={mixed ? null : pick.base}
                    onChange={(id) => setPartBothLayers(key, id)}
                    hasA={hasA}
                    hasB={hasB}
                    ariaLabel={`${label}整块`}
                  />
                )}
                {mixed && !isOpen && <span className="text-9 text-warn-400/80">两层不同</span>}
              </span>

              <span className="flex justify-center">
                <PartThumb source={sources.b} part={key} layer="base" />
              </span>

              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${label}：分层选择`}
                title={isOpen ? '收起，改回整块选' : '展开到第一层 / 第二层'}
                onClick={() => setExpanded(isOpen ? null : key)}
                className="grid h-5 w-5 place-items-center rounded text-fg-6 transition-colors hover:bg-wash-6 hover:text-fg-3"
              >
                {isOpen ? (
                  <ChevronDown size={13} strokeWidth={2} />
                ) : (
                  <ChevronRight size={13} strokeWidth={2} />
                )}
              </button>
            </div>

            {isOpen && (
              <div className="flex flex-col gap-1 border-t border-wash-5 px-1.5 py-1.5">
                {LAYER_IDS.map((layer) => (
                  <div key={layer} className={ROW_GRID}>
                    <span className="pl-2 text-10 text-fg-5">
                      {LAYER_LABELS[layer]}
                    </span>
                    <span className="flex justify-center">
                      <PartThumb source={sources.a} part={key} layer={layer} />
                    </span>
                    <span className="flex justify-center">
                      <SourcePicker
                        value={choice[key][layer]}
                        onChange={(id) => setPartChoice(key, { [layer]: id })}
                        hasA={hasA}
                        hasB={hasB}
                        ariaLabel={`${label}${LAYER_LABELS[layer]}`}
                        compact
                      />
                    </span>
                    <span className="flex justify-center">
                      <PartThumb source={sources.b} part={key} layer={layer} />
                    </span>
                    <span />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A / B 二选一。`value` 为 null 表示两层不一致（整块控件上的"混合"态） */
function SourcePicker({
  value,
  onChange,
  hasA,
  hasB,
  ariaLabel,
  compact = false,
}: {
  value: SourceId | null
  onChange: (id: SourceId) => void
  hasA: boolean
  hasB: boolean
  ariaLabel: string
  compact?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex overflow-hidden rounded border border-wash-7"
    >
      {SOURCE_IDS.map((id) => {
        const available = id === 'a' ? hasA : hasB
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            disabled={!available}
            aria-pressed={active}
            aria-label={`${ariaLabel} 用 ${SHORT[id]}`}
            onClick={() => onChange(id)}
            className={
              (compact ? 'px-2 py-0.5 text-10 ' : 'px-2.5 py-0.5 text-11 ') +
              'transition-colors ' +
              (!available
                ? 'cursor-not-allowed bg-transparent text-fg-7'
                : active
                  ? 'bg-accent-400/15 text-accent-300'
                  : 'bg-wash-3 text-fg-5 hover:text-fg-3')
            }
          >
            {SHORT[id]}
          </button>
        )
      })}
    </div>
  )
}

function EmptyGuide() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <Combine size={26} strokeWidth={1.4} className="text-fg-7" />
      <p className="text-12 text-fg-5">先载入皮肤 A / B</p>
      <p className="max-w-[320px] text-11 leading-relaxed text-fg-6">
        常见的用法是「A 的头 + B 的身体」：载入两张图后，这里会列出 6 个部件，
        每一行都能指定用哪一张。
      </p>
    </div>
  )
}

// ------------------------------------------------------------------- 结果面板

function ResultPanel() {
  const { result, resultCanvas, resultVersion, outputModel, mergedName } = useMerge()

  const ready = result !== null
  const holes = result?.stats.baseHoles ?? 0

  return (
    <div className="flex h-full flex-col bg-surface-panel">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-wash-7 px-3">
        <div className="flex items-center gap-1.5 text-fg-4">
          <Sparkles size={13} strokeWidth={2} />
          <span className="text-11 font-medium tracking-wide">合成结果</span>
        </div>
        <span className="font-mono text-10 text-fg-6">
          {result
            ? `${result.layers === 'double' ? '双层' : '单层'} · ${MODEL_LABELS[outputModel]}`
            : '等待源图'}
        </span>
      </header>

      <div className="relative min-h-0 flex-1">
        {ready ? (
          <SkinViewport
            skinSource={resultCanvas}
            sourceVersion={resultVersion}
            modelKind={outputModel}
            animated
            ariaLabel="合成结果 3D 画布"
            bottomHint="拖拽旋转 · 滚轮缩放"
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-11 text-fg-6">
            载入源图后这里会出现合成结果的 3D 预览
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-wash-7 p-2">
        {result?.notes.map((note, i) => (
          <p
            key={`note-${i}`}
            className="flex items-start gap-1.5 rounded border border-warn-400/20 bg-warn-400/[0.06] px-2 py-1 text-10 leading-relaxed text-warn-300/90"
          >
            <TriangleAlert size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
            {note}
          </p>
        ))}

        {/*
          第一层空洞要顶到最显眼的位置说：它是最容易被忽略、后果又最明显的一条
          （文件传得上去，进游戏才发现身上有黑斑）。合成比绘制更容易撞上它 ——
          从 B 拿过来的那一层，在 B 里可能本来就是空的。
        */}
        {holes > 0 && (
          <p className="flex items-start gap-1.5 rounded border border-danger-400/25 bg-danger-400/[0.07] px-2 py-1 text-10 leading-relaxed text-danger-300">
            <TriangleAlert size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
            第一层有 {holes} 个透明像素，游戏里会显示成黑色。换一张源图，或到绘制页用橡皮擦成黑色
          </p>
        )}

        {/*
          导出已上移顶栏（与绘制页同位置）。这里只保留文件名预览，
          让用户在点导出前先看到最终落盘名（含体型后缀）。
        */}
        <p className="truncate font-mono text-10 text-fg-6" title={`${mergedName}-${MODEL_LABELS[outputModel]}.png`}>
          {ready ? `${mergedName}-${MODEL_LABELS[outputModel]}.png` : '—'}
        </p>
      </div>
    </div>
  )
}
