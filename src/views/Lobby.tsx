import type { LucideIcon } from 'lucide-react'
import { Box, Brush, Combine, Download, MoveRight, Paintbrush, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { APP_VERSION } from '../constants'
import { describeAgo, readSnapshot } from '../lib/autosave'
import { downloadBlob } from '../lib/exportSkin'
import { requestHeadThumb } from '../lib/headPreview'
import {
  buildWorksBackup,
  mergeWorks,
  parseWorksFile,
  readWorks,
  removeWork,
  worksBackupFileName,
} from '../lib/works'
import type { WorkItem } from '../lib/works'
import { useEditor } from '../state/EditorContext'
import { useMerge } from '../state/MergeContext'

/**
 * 大厅：工具的入口页。
 *
 * 「大厅 = 新建」：点「绘制 / 合成」进入的是空作业。绘制侧有持久化草稿（本地快照），
 * 存在草稿时先弹一次二选一（继续上次 / 新建并清空），之后不再问；
 * 合成侧没有持久化草稿，直接新建。
 *
 * 「我的皮肤」= 继续入口：列出导出过的作品，点一件回到它最后的进度。
 */
export default function Lobby() {
  const { startNewSkin, loadWork, flash } = useEditor()
  const { startNewMerge, loadMergeWork } = useMerge()

  // 点卡片时的「二选一」状态：null = 没在问；否则存「要进哪个板块」
  const [pendingNew, setPendingNew] = useState<'draw' | 'merge' | null>(null)

  // 待删除的作品（二次确认）。null = 没在确认删除
  const [pendingDelete, setPendingDelete] = useState<WorkItem | null>(null)

  // 作品列表用 state 持有：删除后要立刻刷新，不能每次渲染都同步读 localStorage
  const [works, setWorks] = useState<WorkItem[]>(() => readWorks().works)

  // 导入备份用的隐藏文件选择器
  const backupInputRef = useRef<HTMLInputElement>(null)

  // 导出备份：作品库 → JSON 文件（走 exportSkin 现成的 downloadBlob）
  const exportBackup = () => {
    if (works.length === 0) {
      flash('作品库是空的，没有可导出的内容')
      return
    }
    const backup = buildWorksBackup(works)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    downloadBlob(blob, worksBackupFileName())
    flash(`已导出 ${works.length} 件作品备份`)
  }

  // 导入备份：解析 → 按 id 去重合并（只新增，不覆盖/删除）→ 刷新列表
  const importBackup = async (file: File) => {
    let text: string
    try {
      text = await file.text()
    } catch {
      flash('读取文件失败，请重试')
      return
    }
    const parsed = parseWorksFile(text)
    if (!parsed.ok) {
      flash(`导入失败：${parsed.error ?? '文件格式不对'}`)
      return
    }
    const result = mergeWorks(parsed.works)
    if (!result.ok) {
      flash(`导入失败：${result.error ?? '浏览器拒绝写入本地存储'}`)
      return
    }
    setWorks(readWorks().works)
    const detail = [`新增 ${result.added} 件`]
    if (result.skipped > 0) detail.push(`跳过 ${result.skipped} 件重复`)
    if (parsed.skipped > 0) detail.push(`忽略 ${parsed.skipped} 条损坏条目`)
    flash(`导入完成：${detail.join('，')}`)
  }

  const enterDraw = (fresh: boolean) => {
    if (fresh) startNewSkin()
    window.location.hash = '#/draw'
  }

  const enterMerge = () => {
    startNewMerge()
    window.location.hash = '#/merge'
  }

  // 点「绘制」卡：有草稿就问一次，没有直接新建
  const handleDrawCard = () => {
    if (readSnapshot() !== null) {
      setPendingNew('draw')
    } else {
      enterDraw(true)
    }
  }

  // 点「合成」卡：没有持久化草稿，直接新建
  const handleMergeCard = () => {
    enterMerge()
  }

  const openDrawWork = (work: WorkItem) => {
    // 恢复完成后跳转；loadWork 是异步的，跳早了画布还没回来
    void loadWork(work).then(() => {
      window.location.hash = '#/draw'
    })
  }

  const openMergeWork = (work: WorkItem) => {
    // 与 openDrawWork 同款：异步恢复完再跳，不在 async 函数里直接赋值 location.hash
    void loadMergeWork(work).then(() => {
      window.location.hash = '#/merge'
    })
  }

  const deleteWork = (work: WorkItem) => {
    const result = removeWork(work.id)
    if (!result.ok) {
      flash(`删除失败：${result.error ?? '浏览器拒绝写入本地存储'}`)
      return
    }
    setWorks((prev) => prev.filter((w) => w.id !== work.id))
    flash(`已删除「${work.name}」`)
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app text-fg-2">
      {/* 顶栏：左品牌。品牌块与绘制页顶栏保持一致，切页时不会跳位 */}
      <header className="flex h-11 shrink-0 items-center border-b border-wash-10 bg-surface-chrome px-4">
        <div className="flex items-center gap-2">
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
      </header>

      {/* 主体：两块等宽大卡片。点击 = 新建 */}
      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <LobbyCard
          icon={Combine}
          title="合成"
          desc="上传两张皮肤，按部件拼成一张"
          onClick={handleMergeCard}
          extra={<MergeSketch />}
        />
        <LobbyCard
          icon={Brush}
          title="绘制"
          desc="逐像素画一张 64×64 皮肤"
          onClick={handleDrawCard}
          extra={<CurrentSkin />}
        />
      </main>

      {/* 底部通栏：作品库（「我的皮肤」）。空态 + 真实列表 */}
      <footer className="flex h-[104px] shrink-0 flex-col border-t border-wash-10 bg-surface-chrome px-4 py-2">
        <div className="flex shrink-0 items-center justify-between">
          <span className="text-11 font-medium tracking-wide text-fg-4">我的皮肤</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={exportBackup}
              title="把作品库导出成 JSON 文件，可备份、可换机器恢复"
              className="flex items-center gap-1 rounded border border-wash-7 bg-wash-3 px-1.5 py-0.5 text-10 text-fg-4 transition-colors hover:border-accent-400/40 hover:text-accent-300"
            >
              <Download size={11} strokeWidth={2} />
              导出备份
            </button>
            <button
              type="button"
              onClick={() => backupInputRef.current?.click()}
              title="从 JSON 备份文件恢复作品（只新增，不覆盖现有作品）"
              className="flex items-center gap-1 rounded border border-wash-7 bg-wash-3 px-1.5 py-0.5 text-10 text-fg-4 transition-colors hover:border-accent-400/40 hover:text-accent-300"
            >
              <Upload size={11} strokeWidth={2} />
              导入备份
            </button>
            {/*
              离线版下载：静态文件，直接指 public/download/ 下的 zip。
              路径必须走 BASE_URL —— Vite 的 base 不重写运行时字符串，
              写死 /download/... 在子路径部署下会 404。
            */}
            <a
              href={`${import.meta.env.BASE_URL}download/mse-offline.zip`}
              download
              title="下载离线版：解压后双击 index.html，不联网也能用"
              className="flex items-center gap-1 rounded border border-wash-7 bg-wash-3 px-1.5 py-0.5 text-10 text-fg-4 transition-colors hover:border-accent-400/40 hover:text-accent-300"
            >
              <Download size={11} strokeWidth={2} />
              下载离线版
            </a>
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // 清空 value，允许连续选同一个文件（否则第二次选它不触发 change）
                event.target.value = ''
                if (file) void importBackup(file)
              }}
            />
          </div>
        </div>
        {works.length === 0 ? (
          <span className="mt-1.5 truncate text-11 text-fg-6">
            还没有作品 · 导出一张就会出现在这里
          </span>
        ) : (
          <div className="thin-scroll mt-1.5 flex min-h-0 flex-1 gap-2 overflow-x-auto">
            {works.map((work) => (
              <button
                key={work.id}
                type="button"
                onClick={() => {
                  if (work.kind === 'draw') openDrawWork(work)
                  else openMergeWork(work)
                }}
                title={
                  work.kind === 'draw'
                    ? `打开「${work.name}」继续绘制`
                    : `打开「${work.name}」恢复合成`
                }
                className="group flex w-[120px] shrink-0 flex-col items-center gap-1 rounded-lg border border-wash-7 bg-wash-2 p-1.5 text-left transition-colors hover:border-accent-400/40"
              >
                <span className="relative">
                  <WorkHeadThumb work={work} />
                  {/* 删除入口：悬浮时出现，点它删这件作品（带二次确认） */}
                  <span
                    role="button"
                    aria-label={`删除「${work.name}」`}
                    title="删除这件作品"
                    onClick={(event) => {
                      event.stopPropagation()
                      setPendingDelete(work)
                    }}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-wash-9 bg-surface-chip text-fg-4 opacity-0 transition-opacity hover:text-danger-300 group-hover:opacity-100"
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </span>
                </span>
                <span className="w-full truncate text-center text-11 text-fg-3">
                  {work.name}
                </span>
                <span className="text-9 text-fg-6">
                  {work.kind === 'draw' ? '绘制' : '合成'} · {describeAgo(work.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </footer>

      {/* 二选一：有草稿时，进绘制前问一次 */}
      {pendingNew === 'draw' && (
        <ConfirmNewDialog
          onContinue={() => {
            setPendingNew(null)
            enterDraw(false)
          }}
          onNew={() => {
            setPendingNew(null)
            enterDraw(true)
          }}
          onCancel={() => setPendingNew(null)}
        />
      )}

      {/* 删除作品：二次确认 */}
      {pendingDelete && (
        <ConfirmDeleteDialog
          name={pendingDelete.name}
          onConfirm={() => {
            deleteWork(pendingDelete)
            setPendingDelete(null)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

/**
 * 单件作品的 3D 头部预览缩略图。
 *
 * - 先用作品自带的 PNG 平面图占位（避免列表空白跳动）；
 * - 进入视口后才请求 3D 头部渲染（懒渲染，列表长时不一次性全渲染）；
 * - 渲染成功替换成头部 dataURL，失败 / 超时则保持 PNG 占位（降级）。
 *
 * 3D 渲染由一个共享的离屏渲染器（headPreview.ts）顺序完成，本组件只负责
 * 「进入视口时发请求 → 收到结果更新 src」，不自己持有任何 WebGL 上下文。
 */
function WorkHeadThumb({ work }: { work: WorkItem }) {
  const [src, setSrc] = useState<string>(work.dataUrl)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return

    let done = false

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !done) {
            done = true
            observer.disconnect()
            const hit = requestHeadThumb(work, (dataUrl) => {
              if (dataUrl) setSrc(dataUrl)
              // dataUrl 为 null（降级）时保持 PNG 占位
            })
            if (hit) setSrc(hit)
          }
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [work])

  return (
    <span ref={rootRef} className="block">
      <img
        src={src}
        alt={work.name}
        className="h-12 w-12 rounded border border-wash-10 bg-surface-inset"
        style={{ imageRendering: src === work.dataUrl ? 'pixelated' : 'auto' }}
      />
    </span>
  )
}

/** 有草稿时点「绘制」弹的二选一：继续上次 / 新建并清空。只问一次 */
function ConfirmNewDialog({
  onContinue,
  onNew,
  onCancel,
}: {
  onContinue: () => void
  onNew: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="继续还是新建"
        className="w-[360px] max-w-full rounded-xl border border-wash-10 bg-surface-dialog p-4 shadow-2xl"
      >
        <header className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-warn-400/15 text-warn-300">
            <Paintbrush size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-13 font-semibold text-fg-1">有未完成的绘制</h2>
            <p className="mt-0.5 text-11 leading-relaxed text-fg-5">
              上次的皮肤还没导出。可以接着画，也可以另起一张新的。
            </p>
          </div>
        </header>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="flex items-center justify-center rounded-md border border-accent-400/30 bg-accent-400/10 px-2 py-1.5 text-11 text-accent-300 transition-colors hover:border-accent-400/55"
          >
            继续上次
          </button>
          <button
            type="button"
            onClick={onNew}
            title="清空当前画布，另起一张新的"
            className="flex items-center justify-center rounded-md border border-wash-9 bg-wash-4 px-2 py-1.5 text-11 text-fg-3 transition-colors hover:border-wash-20"
          >
            新建并清空
          </button>
        </div>
      </div>
    </div>
  )
}

/** 删除作品的二次确认：删了就没了，必须明确点一下 */
function ConfirmDeleteDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="删除作品确认"
        className="w-[340px] max-w-full rounded-xl border border-wash-10 bg-surface-dialog p-4 shadow-2xl"
      >
        <header className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-danger-400/15 text-danger-300">
            <Trash2 size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-13 font-semibold text-fg-1">删除「{name}」？</h2>
            <p className="mt-0.5 text-11 leading-relaxed text-fg-5">
              删除后不可恢复，会从作品库里彻底移除。
            </p>
          </div>
        </header>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center justify-center rounded-md border border-danger-400/30 bg-danger-400/10 px-2 py-1.5 text-11 text-danger-300 transition-colors hover:border-danger-400/55"
          >
            删除
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center justify-center rounded-md border border-wash-9 bg-wash-4 px-2 py-1.5 text-11 text-fg-3 transition-colors hover:border-wash-20"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/** 绘制卡里那块"我现在在编什么"的实证：直接画文档画布，不重新算一遍贴图 */
function CurrentSkin() {
  const { doc, skin, historyVersion } = useEditor()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(doc.canvas, 0, 0)
    // historyVersion：落笔结束 / 撤销 / 重做 / 导入时自增，等于"文档变了"的信号
  }, [doc, historyVersion])

  return (
    <span className="flex flex-col items-center gap-2">
      <canvas
        ref={ref}
        width={64}
        height={64}
        aria-label="当前皮肤缩略图"
        className="h-32 w-32 rounded-lg border border-wash-10 bg-surface-inset"
        style={{ imageRendering: 'pixelated' }}
      />
      <span className="text-11 text-fg-5">
        {skin ? `继续编辑 · ${skin.name}` : '未加载皮肤'}
      </span>
    </span>
  )
}

/** 合成卡里的示意图：两张皮肤各出一部分，拼成一张 */
function MergeSketch() {
  const patch = 'h-12 w-7 rounded-sm border border-wash-9'
  return (
    <span className="flex items-center gap-2.5">
      <span className={`${patch} bg-alt-500/20`} />
      <span className={`${patch} bg-accent-500/20`} />
      <MoveRight size={14} strokeWidth={2} className="text-fg-7" />
      <span className="flex h-12 w-7 flex-col overflow-hidden rounded-sm border border-wash-14">
        <span className="flex-1 bg-alt-500/25" />
        <span className="flex-1 bg-accent-500/25" />
      </span>
    </span>
  )
}

interface LobbyCardProps {
  icon: LucideIcon
  title: string
  desc: string
  onClick: () => void
  /** 卡片里那块内容（缩略图 / 示意图），用来撑起版面 */
  extra?: ReactNode
}

function LobbyCard({ icon: Icon, title, desc, onClick, extra }: LobbyCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`新建${title}`}
      className="group flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-wash-8 bg-surface-panel transition-colors hover:border-accent-400/40 hover:bg-accent-400/[0.04]"
    >
      <span className="grid h-14 w-14 place-items-center rounded-xl border border-accent-400/25 bg-accent-400/10 text-accent-300 transition-colors group-hover:border-accent-400/50">
        <Icon size={26} strokeWidth={1.6} />
      </span>
      <span className="mt-1 text-18 font-medium tracking-wide text-fg-1">{title}</span>
      <span className="text-12 text-fg-5">{desc}</span>
      {extra}
    </button>
  )
}
