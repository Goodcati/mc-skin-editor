import { useEffect, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'

/**
 * 导出前的命名确认框（绘制 / 合成共用）。
 *
 * 为什么要在「下载之前」问一次：文件名是唯一能跟着 PNG 走到 Minecraft 上传页的载体，
 * 默认名（"未命名皮肤" / "A+B"）是兜底，不该成为最终名。给用户一个改名的机会，
 * 又不用强制（留空 = 用默认名），避免把导出变成一个必须填表的动作。
 *
 * 交互约定：
 * - 打开即聚焦、全选，直接敲字就覆盖默认名；
 * - 回车 = 确认；Esc / 点遮罩 / 点 ✕ = 取消（不导出）；
 * - 输入留空 = 用默认名（等于不改名）。
 */
export default function ExportNameDialog({
  defaultName,
  onConfirm,
  onCancel,
}: {
  /** 预填的默认名。留空提交时也回落到它 */
  defaultName: string
  /** 用户确认后回调，参数是最终基名（已 trim，空则回落到 defaultName） */
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // 聚焦 + 全选：默认名只是起点，用户想改就能直接覆盖
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Esc 取消（照 ExportDoneDialog 的写法）：window 上的监听不依赖冒泡，
  // 所以根节点的 stopPropagation（见下）不会把它挡掉
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = () => {
    const trimmed = value.trim()
    onConfirm(trimmed.length > 0 ? trimmed : defaultName)
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      /*
        弹框是模态的，不该把键盘事件漏到底下的画布。绘制页的 Ctrl+Z/Ctrl+S 监听
        挂在 window 上，事件从这里冒泡上去就会被它拦掉。所以对「非 Escape」的键
        stopPropagation，把 Ctrl+Z/S、字母键都挡在弹框内；Escape 放行，交给上面的
        window 监听去 onCancel（见 useEffect）。
      */
      onKeyDown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="给皮肤命名"
        className="w-[360px] max-w-full rounded-xl border border-white/10 bg-[#151a24] p-4 shadow-2xl"
      >
        <header className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-400/15 text-sky-300">
            <Tag size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-slate-100">给皮肤命名</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              文件名会带上「绘制- / 合成-」前缀和体型后缀，这里只填名字本身
            </p>
          </div>
          <button
            type="button"
            aria-label="取消命名"
            title="取消导出"
            onClick={onCancel}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </header>

        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={defaultName}
            spellCheck={false}
            autoComplete="off"
            aria-label="皮肤名称"
            className="w-full rounded-md border border-white/[0.09] bg-[#0d1119] px-2.5 py-2 text-[13px] text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-400/50"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="submit"
              className="flex items-center justify-center rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1.5 text-[11px] text-emerald-300 transition-colors hover:border-emerald-400/55"
            >
              确认导出
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center justify-center rounded-md border border-white/[0.09] bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-white/20"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
