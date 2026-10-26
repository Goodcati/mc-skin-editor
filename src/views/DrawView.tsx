import { ArrowLeft, Box, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import OverallPreview from '../components/OverallPreview'
import PartPreview from '../components/PartPreview'
import SkinCanvas2D from '../components/SkinCanvas2D'
import StatusBar from '../components/StatusBar'
import Toolbar from '../components/Toolbar'
import ExportDoneDialog from '../components/ExportDoneDialog'
import ExportNameDialog from '../components/ExportNameDialog'
import { APP_VERSION } from '../constants'
import { MODEL_HINTS, MODEL_KINDS, MODEL_LABELS, MODEL_NOTE } from '../lib/skinModel'
import { useEditor } from '../state/EditorContext'
import type { ToolId } from '../state/EditorContext'

/** 绘制工作区：大厅「绘制」卡片的落地页，也就是此前的编辑器主界面 */
export default function DrawView() {
  const {
    skin,
    modelType,
    setModelType,
    setTool,
    undo,
    redo,
    saveNow,
    exportSkin,
    skinName,
    exported,
    dismissExport,
  } = useEditor()

  const [naming, setNaming] = useState(false)

  /**
   * 快捷键只挂在绘制页。
   *
   * 原来这段在 EditorProvider 里，等于全应用生效 —— 大厅上按 B 会改画笔、按 Ctrl+S 会写快照，
   * 都是没有落点也没有反馈的动作。挂到这里，语义才和「绘制工作区」对齐。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable

      // Ctrl+S 必须拦掉：浏览器默认会弹"保存网页"
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveNow('manual')
        return
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
        return
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))
      ) {
        event.preventDefault()
        redo()
        return
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return

      const key = event.key.toLowerCase()
      const toolMap: Record<string, ToolId> = {
        p: 'pencil',
        b: 'pencil',
        e: 'eraser',
        i: 'pipette',
      }
      const next = toolMap[key]
      if (next) {
        event.preventDefault()
        setTool(next)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, saveNow, setTool])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app text-fg-2">
      {/* 顶栏 */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-wash-10 bg-surface-chrome px-4">
        <div className="flex items-center gap-2">
          {/* 回大厅。不做成隐藏手势：进来之后没有回头路，只能手改地址栏 */}
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
          <h1 className="text-13 font-semibold tracking-wide">Minecraft 皮肤编辑器</h1>
          <span
            className="rounded bg-wash-6 px-1.5 py-0.5 font-mono text-10 text-fg-4"
            title="版本号：主版本.迭代.补丁"
          >
            {APP_VERSION}
          </span>
        </div>

        {/*
          皮肤的「身份」只在这一处报：文件名 + 尺寸。
          尺寸原本在左边还独立写了一遍 64 × 64，状态栏和左侧面板标题也各写了一次皮肤名，
          同一个事实说四遍 —— 都是删掉的地方。

          体型没有并进这行文字，而是做成了右边的切换控件：它不是纯粹的信息，
          而是**必须由人拍板的一个选择**（PNG 里没有体型，官网上传时要手选）。
        */}
        <div className="flex items-center gap-3 text-11 text-fg-5">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${skin ? 'bg-accent-400' : 'bg-warn-400'}`}
            />
            {skin ? `${skin.name} · ${skin.width}×${skin.height}` : '未加载皮肤'}
          </span>

          <div
            role="group"
            aria-label="体型选择"
            className="flex overflow-hidden rounded border border-wash-7"
          >
            {MODEL_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={modelType === kind}
                onClick={() => setModelType(kind)}
                title={`${MODEL_HINTS[kind]}。${MODEL_NOTE}；上传时请在官网 / 启动器选同一项`}
                className={
                  'px-2 py-0.5 transition-colors ' +
                  (modelType === kind
                    ? 'bg-accent-400/15 text-accent-300'
                    : 'bg-wash-3 text-fg-5 hover:text-fg-3')
                }
              >
                {MODEL_LABELS[kind]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setNaming(true)}
            title={`导出 64×64 PNG；文件名会带上体型（${MODEL_LABELS[modelType]}），上传时照文件名选`}
            className="flex items-center gap-1.5 rounded-md border border-wash-7 bg-wash-3 px-2 py-1 text-11 text-fg-3 transition-colors hover:border-accent-400/40 hover:text-accent-300"
          >
            <Download size={12} strokeWidth={2} />
            导出
          </button>
        </div>
      </header>

      {/* 三栏主体：左 30% / 中 50% / 右 20% */}
      <main className="flex min-h-0 flex-1">
        {/* 左：整体 3D 预览 */}
        <div className="w-[30%] min-w-[260px] border-r border-wash-10">
          <OverallPreview />
        </div>

        {/* 中：上 部位预览 / 下 2D 编辑画布 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 basis-[40%] border-b border-wash-10">
            <PartPreview />
          </div>
          <div className="min-h-0 basis-[60%]">
            <SkinCanvas2D />
          </div>
        </div>

        {/* 右：工具栏 */}
        <div className="w-[20%] min-w-[190px] border-l border-wash-10">
          <Toolbar />
        </div>
      </main>

      <StatusBar />

      {/* 导出前的命名确认（绘制侧）：确认后才会真正生成并下载 */}
      {naming && (
        <ExportNameDialog
          defaultName={skinName}
          onConfirm={(name) => {
            setNaming(false)
            void exportSkin(name)
          }}
          onCancel={() => setNaming(false)}
        />
      )}

      {/* 导出完成反馈（绘制侧）：与合成侧一致，至少报文件名 */}
      {exported && <ExportDoneDialog info={exported} onClose={dismissExport} />}
    </div>
  )
}
