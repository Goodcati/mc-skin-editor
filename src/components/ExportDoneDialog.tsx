import { CircleCheck, X } from 'lucide-react'
import { useEffect } from 'react'
import type { SkinExport } from '../lib/exportSkin'
import { MODEL_LABELS } from '../lib/skinModel'

/**
 * 绘制侧导出完成后的轻量反馈。
 *
 * 与合成侧的 MergeDoneDialog 对齐的是「导出后都告诉用户文件名」这一点 ——
 * 文件名带体型后缀，用户去官网上传时要照它选体型，不显示出来他没法照做。
 * 绘制没有"继续合成新的"这种下一步，所以这里只留一个关闭出口，
 * 不替用户决定之后去哪（回画布接着画是他的常态）。
 */
export default function ExportDoneDialog({
  info,
  onClose,
}: {
  info: SkinExport
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="导出完成"
        className="w-[360px] max-w-full rounded-xl border border-white/10 bg-[#151a24] p-4 shadow-2xl"
      >
        <header className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
            <CircleCheck size={16} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-slate-100">导出完成</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              文件已交给浏览器下载，上传时照文件名选体型
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭导出完成提示"
            title="关闭"
            onClick={onClose}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-600 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </header>

        <dl className="mt-3 space-y-1 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2 text-[11px]">
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-slate-600">文件名</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-slate-300" title={info.filename}>
              {info.filename}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-slate-600">体型</dt>
            <dd className="flex-1 text-slate-400">{MODEL_LABELS[info.model]}</dd>
          </div>
        </dl>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex items-center justify-center rounded-md border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-white/20"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
