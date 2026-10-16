import { Brush, Eraser, Pipette, Redo2, Save, ShieldCheck, Undo2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import ColorPicker from './ColorPicker'
import SkinImportButton from './SkinImportButton'
import { MAX_RECENT_COLORS } from '../constants'
import { formatSavedAt } from '../lib/autosave'
import { useEditor } from '../state/EditorContext'
import type { ToolId } from '../state/EditorContext'

const TOOLS: { id: ToolId; label: string; shortcut: string; icon: LucideIcon; hint: string }[] = [
  { id: 'pencil', label: '铅笔', shortcut: 'P', icon: Brush, hint: '用当前颜色作画' },
  {
    id: 'eraser',
    label: '橡皮',
    shortcut: 'E',
    icon: Eraser,
    // 两个图层的行为不同，必须在按钮上就说清楚 —— 用户看不见"擦成透明"和"擦成黑色"的区别，
    // 只有到游戏里才会发现
    hint: '第二层擦成透明；第一层擦成黑色（游戏里透明像素就是黑的）',
  },
  { id: 'pipette', label: '吸管', shortcut: 'I', icon: Pipette, hint: '吸取画布上的颜色' },
]

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-white/[0.06] px-3 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium tracking-[0.12em] text-slate-600">{title}</p>
        {aside}
      </div>
      {children}
    </div>
  )
}

function Chip({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={
        'flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-[11px] transition-colors ' +
        (active
          ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-300'
          : 'border-white/[0.07] bg-white/[0.03] text-slate-400 enabled:hover:border-white/15 enabled:hover:bg-white/[0.07] enabled:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40')
      }
    >
      <Icon size={13} strokeWidth={2} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * 左起的全高色柱：最近使用过的颜色。
 *
 * 为什么是一条贴着面板左边、贯通整高的竖列，而不是塞在某个分区里：
 * 一是"自上而下"才符合取色的直觉（新→旧一眼扫下来），二是竖列能常驻几十个色块，
 * 横向格子放七八个就到头了；三是它不参与右侧分区滚动，翻到「文件」那里也照样能取色。
 * 颜色编号不在常态里占位，挂在 title 上。
 */
function RecentRail({
  colors,
  active,
  onPick,
}: {
  colors: string[]
  active: string
  onPick: (hex: string) => void
}) {
  const count = colors.length
  return (
    <aside className="flex min-h-0 w-9 shrink-0 flex-col items-center border-r border-white/[0.07]">
      <div
        className="flex h-8 w-full shrink-0 items-center justify-center border-b border-white/[0.06]"
        title={
          count === 0
            ? '最近使用：画布上真正涂过的颜色会自上而下出现在这里'
            : `最近使用 ${count}/${MAX_RECENT_COLORS}：自上而下由新到旧，点一下即切换为这支颜色`
        }
      >
        <span className="text-[9px] font-medium tracking-wide text-slate-600">最近</span>
      </div>

      <div className="thin-scroll flex min-h-0 flex-1 flex-col items-center gap-[3px] overflow-y-auto py-2">
        {count === 0
          ? Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="h-[26px] w-[26px] shrink-0 rounded-[4px] border border-dashed border-white/[0.09]"
              />
            ))
          : colors.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={`最近使用的颜色 ${hex}`}
                onClick={() => onPick(hex)}
                className={
                  'h-[26px] w-[26px] shrink-0 rounded-[4px] transition-shadow ' +
                  (hex === active
                    ? 'ring-2 ring-inset ring-emerald-300'
                    : 'ring-1 ring-inset ring-white/[0.14] hover:ring-white/45')
                }
                style={{ backgroundColor: hex }}
              />
            ))}
      </div>
    </aside>
  )
}

/** 右侧：一条全高的「最近使用」色柱 + 调色盘 / 工具 / 文件 */
export default function Toolbar() {
  const {
    tool,
    setTool,
    color,
    setColor,
    recentColors,
    canUndo,
    canRedo,
    undo,
    redo,
    saveNow,
    lastSavedAt,
    autosaveEnabled,
    setAutosaveEnabled,
    flash,
  } = useEditor()

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#12161f]">
      <header className="flex h-8 shrink-0 items-center border-b border-white/[0.07] px-3">
        <span className="text-[11px] font-medium tracking-wide text-slate-400">工具栏</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <RecentRail
          colors={recentColors}
          active={color}
          onPick={(hex) => {
            setColor(hex)
            flash(`已切换为 ${hex}`)
          }}
        />

        <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* 调色盘放最上面：手搓皮肤时这是最常摸的一块 */}
          <Section title="调色盘">
            <ColorPicker color={color} onChange={setColor} />
          </Section>

          {/* 撤销 / 重做并入工具栏，不再单开「历史」一节 */}
          <Section title="工具">
            <div className="grid grid-cols-3 gap-1.5">
              {TOOLS.map(({ id, label, shortcut, icon, hint }) => (
                <Chip
                  key={id}
                  icon={icon}
                  label={label}
                  active={id === tool}
                  onClick={() => setTool(id)}
                  title={`${label} (${shortcut})：${hint}`}
                />
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <Chip icon={Undo2} label="撤销" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" />
              <Chip icon={Redo2} label="重做" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Y)" />
            </div>
          </Section>

          {/* 导入入口移到文件区（与保存同区），导出已上移顶栏 */}
          <Section
            title="文件"
            aside={
              lastSavedAt !== null ? (
                <span className="font-mono text-[10px] text-slate-600">
                  上次保存 {formatSavedAt(lastSavedAt)}
                </span>
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-1.5">
              <SkinImportButton
                title="导入皮肤 PNG（64×64 或旧版 64×32）"
                className="flex items-center justify-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-1.5 text-[11px] text-slate-400 transition-colors enabled:hover:border-white/15 enabled:hover:bg-white/[0.07] enabled:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Upload size={13} strokeWidth={2} />
                <span className="truncate">导入</span>
              </SkinImportButton>

              <button
                type="button"
                role="switch"
                aria-checked={autosaveEnabled}
                onClick={() => setAutosaveEnabled(!autosaveEnabled)}
                title="开启后每次落笔结束都会把皮肤暂存到浏览器本地，意外关闭页面后可以恢复"
                className="flex items-center justify-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-white/15"
              >
                <ShieldCheck
                  size={13}
                  strokeWidth={2}
                  className={autosaveEnabled ? 'text-emerald-300' : 'text-slate-500'}
                />
                自动保存
                <span
                  className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${
                    autosaveEnabled ? 'bg-emerald-400/80' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-[left] ${
                      autosaveEnabled ? 'left-3' : 'left-0.5'
                    }`}
                  />
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => saveNow('manual')}
              title="立即保存到浏览器本地 (Ctrl+S)"
              className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-2 text-[11px] text-slate-400 transition-colors enabled:hover:border-white/15 enabled:hover:bg-white/[0.07] enabled:hover:text-slate-200"
            >
              <Save size={13} strokeWidth={2} />
              <span className="truncate">保存</span>
            </button>
          </Section>
        </div>
      </div>
    </div>
  )
}
