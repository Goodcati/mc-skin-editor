import { useEditor } from '../state/EditorContext'
import { BODY_KEY_LABELS } from '../lib/skinParts'

const TOOL_LABEL: Record<string, string> = {
  pencil: '铅笔',
  eraser: '橡皮',
  pipette: '吸管',
}

/**
 * 底部状态栏：只放**正在发生的编辑状态**（工具、颜色、光标、历史、选中）。
 *
 * 皮肤的「身份」（文件名、尺寸、模型）归顶栏，这里不再重复一遍。
 */
export default function StatusBar() {
  const { tool, color, cursor, status, doc, selectedPart, setSelectedPart, flash } = useEditor()

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-white/10 bg-[#141821] px-4 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
        {TOOL_LABEL[tool] ?? tool}
      </span>

      <span className="flex items-center gap-1.5">
        颜色
        <span
          className="inline-block h-3 w-3 rounded-sm ring-1 ring-white/20"
          style={{ backgroundColor: color }}
        />
        <span className="font-mono text-slate-400">{color}</span>
      </span>

      {/* 坐标是「面内局部坐标」，和画布上看到的方块一一对应 */}
      <span className="font-mono">{cursor ? `面内 ${cursor.x}, ${cursor.y}` : '面内 —'}</span>

      <span>历史 {doc.historyDepth} 步</span>

      {selectedPart ? (
        <button
          type="button"
          onClick={() => {
            setSelectedPart(null)
            flash('已取消选择')
          }}
          title="取消选中（Esc）"
          className="flex items-center gap-1.5 rounded bg-sky-400/12 px-2 py-0.5 text-sky-300 transition-colors hover:bg-sky-400/20"
        >
          选中：{BODY_KEY_LABELS[selectedPart]}
          <span className="text-sky-400/70">✕</span>
        </button>
      ) : (
        <span>选中：—</span>
      )}

      {status && (
        <span className="ml-auto shrink-0 rounded bg-emerald-400/10 px-2 py-0.5 text-emerald-300">
          {status}
        </span>
      )}
    </footer>
  )
}
