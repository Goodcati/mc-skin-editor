import { CircleCheck, House, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { SkinExport } from '../lib/exportSkin'
import { MODEL_LABELS } from '../lib/skinModel'

/**
 * 合成完成后弹出的对话框。
 *
 * 存在的理由：合成是**一次性**的动作 —— 一件事做完就没有下一步了。
 * 以前这里放了个「继续绘制」按钮，等于替用户决定了后续路径（还顺手把他从合成页拽走），
 * 而他的下一件事多半是"再合一套衣服"。所以改成做完再问一次，答案只有两个：
 * 留在这里重来，或者出去。
 *
 * 三个出口的分工：
 * - 「继续合成新的」：清空两张源图，原地重开一轮
 * - 「回到大厅」：离开这个板块
 * - 右上角 ✕ / Esc / 点遮罩：什么都不做，当前结果原样留着（可能还想再导出一次）
 */
export default function MergeDoneDialog({
  info,
  onStartNew,
  onLobby,
  onClose,
}: {
  info: SkinExport
  onStartNew: () => void
  onLobby: () => void
  onClose: () => void
}) {
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const holes = info.stats.baseHoles

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
      /* 用 mousedown 且要求落点就是遮罩本身：不然在卡片里按下滑到外面也会被当成"点了遮罩" */
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="合成完成"
        className="w-[392px] max-w-full rounded-xl border border-white/10 bg-[#151a24] p-4 shadow-2xl"
      >
        <header className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
            <CircleCheck size={16} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-slate-100">合成完成</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              文件已交给浏览器下载，名字带「合成-」前缀，和绘制作品分得开。
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭合成完成提示"
            title="关掉（合成结果保留）"
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
            <dt className="w-12 shrink-0 text-slate-600">层数</dt>
            <dd className="flex-1 text-slate-400">
              {info.layers === 'double' ? '双层（含帽子 / 外套等第二层）' : '单层'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-slate-600">体型</dt>
            <dd className="flex-1 text-slate-400">
              {MODEL_LABELS[info.model]}
              <span className="ml-1 text-slate-600">
                · 在 Minecraft 官网 / 启动器上传时请选这一项
              </span>
            </dd>
          </div>
        </dl>

        {/*
          第一层空洞要在这里再说一遍：这是用户唯一会"文件在手、问题在游戏里"的坑。
          对话框是他刚导出、注意力还在这件事上的最后一个时机。
        */}
        {holes > 0 && (
          <p className="mt-2 flex items-start gap-1.5 rounded border border-rose-400/25 bg-rose-400/[0.07] px-2 py-1.5 text-[10px] leading-relaxed text-rose-300">
            <TriangleAlert size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
            第一层有 {holes} 个透明像素，进游戏会显示成黑色。建议换一张源图再合一次
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            ref={primaryRef}
            type="button"
            aria-label="继续合成新的皮肤"
            onClick={onStartNew}
            title="清空当前两张源图，留在合成页重新开始"
            className="flex items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1.5 text-[11px] text-emerald-300 transition-colors hover:border-emerald-400/55"
          >
            <RotateCcw size={12} strokeWidth={2} />
            继续合成新的
          </button>
          <button
            type="button"
            aria-label="回到大厅"
            onClick={onLobby}
            title="离开合成页，回到大厅"
            className="flex items-center justify-center gap-1.5 rounded-md border border-white/[0.09] bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-white/20"
          >
            <House size={12} strokeWidth={2} />
            回到大厅
          </button>
        </div>
      </div>
    </div>
  )
}
