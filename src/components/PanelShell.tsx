import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface PanelShellProps {
  title: string
  icon: LucideIcon
  hint?: string
  children: ReactNode
}

/** 三个工作区共用的面板外壳：一条标题栏 + 自适应剩余高度的内容区 */
export default function PanelShell({ title, icon: Icon, hint, children }: PanelShellProps) {
  return (
    <section className="flex h-full w-full flex-col bg-[#12161f]">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.07] px-3">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Icon size={13} strokeWidth={2} />
          <span className="text-[11px] font-medium tracking-wide">{title}</span>
        </div>
        {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  )
}
