import type { LucideIcon } from 'lucide-react'
import { Box, Brush, Combine, Download, History, MoveRight, Trash2, Upload, TriangleAlert, X } from 'lucide-react'
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
import { STARTER_OPTIONS, readStarter, writeStarter, type StarterBase } from '../lib/starterSkin'

/**
 * 「作品只存在这台电脑」提示的关闭记录。
 *
 * key 里带版本号是故意的：将来要再提醒一次（比如加了云同步、或者搬家流程变了），
 * 把 v1 改成 v2，所有人都会重新看到一次，不用写迁移代码。
 */
const NOTICE_KEY = 'mc-skin-editor/notice/v1'

function readNoticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

function writeNoticeDismissed(): void {
  try {
    window.localStorage.setItem(NOTICE_KEY, '1')
  } catch {
    // 隐私模式下写不进去：那就每次进来都提醒，也不算坏
  }
}

/** 三个起点的说明。文案里有「游戏内会显示成黑色」这句，别删 —— 那是真实表现 */
const STARTER_DESC: Record<StarterBase, string> = {
  sample: '内置示例皮肤，适合改造',
  white: '全白皮肤，从零画最清楚',
  empty: '未填充画布；游戏内会显示成黑色',
}

/**
 * 路由跳转。
 *
 * 放在模块级而不是组件里，是因为 oxlint 的 React 编译器规则会把组件内的
 * `window.location.hash = ...` 判成「修改外部可变值」（react/immutability）。
 * 这里只碰 location、不碰任何组件状态，本来就不是渲染逻辑。
 */
function goTo(hash: '#/draw' | '#/merge'): void {
  window.location.hash = hash
}

/**
 * 大厅：工具的入口页。
 *
 * 「大厅 = 新建」：点「绘制」一定会弹「新建皮肤」让你选起点（有草稿时多一条
 * 「继续编辑」），选完直接进绘制页，不再二次确认。
 * 合成侧没有持久化草稿，点卡片直接新建。
 *
 * 「我的皮肤」= 继续入口：列出导出过的作品，点一件回到它最后的进度。
 */
export default function Lobby() {
  const { startNewSkin, loadWork, importSkinFile, flash } = useEditor()
  const { startNewMerge, loadMergeWork } = useMerge()

  // 「新建皮肤」弹窗。draft 在打开那一刻算一次，之后不再重复读 localStorage
  const [newSkin, setNewSkin] = useState<{ draft: boolean } | null>(null)

  // 待删除的作品（二次确认）。null = 没在确认删除
  const [pendingDelete, setPendingDelete] = useState<WorkItem | null>(null)

  // 作品列表用 state 持有：删除后要立刻刷新，不能每次渲染都同步读 localStorage
  const [works, setWorks] = useState<WorkItem[]>(() => readWorks().works)

  // 上次选的起点，用来给弹窗里的选项做默认高亮
  const [starter, setStarter] = useState<StarterBase>(() => readStarter())

  // 数据提醒条：关掉之后（同一 key 版本内）不再出现
  const [noticeOpen, setNoticeOpen] = useState(() => !readNoticeDismissed())

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
    goTo('#/draw')
  }

  const enterMerge = () => {
    startNewMerge()
    goTo('#/merge')
  }

  // 点「绘制」卡：一律弹窗。有没有草稿在打开这一刻算
  const handleDrawCard = () => {
    setNewSkin({ draft: readSnapshot() !== null })
  }

  // 选了某个起点：记住它、按它新建、直接进绘制页（不再二次确认）
  const pickStarter = (base: StarterBase) => {
    writeStarter(base)
    setStarter(base)
    setNewSkin(null)
    startNewSkin(base)
    goTo('#/draw')
  }

  // 选了「导入」：先清成未填充，再走已有导入路径（它会立刻落盘），然后进绘制页
  const pickImport = async (file: File) => {
    setNewSkin(null)
    startNewSkin('empty')
    await importSkinFile(file)
    goTo('#/draw')
  }

  // 点「合成」卡：没有持久化草稿，直接新建
  const handleMergeCard = () => {
    enterMerge()
  }

  const openDrawWork = (work: WorkItem) => {
    // 恢复完成后跳转；loadWork 是异步的，跳早了画布还没回来
    void loadWork(work).then(() => {
      goTo('#/draw')
    })
  }

  const openMergeWork = (work: WorkItem) => {
    // 与 openDrawWork 同款：异步恢复完再跳，不在 async 函数里直接赋值 location.hash
    void loadMergeWork(work).then(() => {
      goTo('#/merge')
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

  const toolBtn =
    'flex items-center gap-1 rounded border border-wash-7 bg-wash-3 px-1.5 py-1 text-10 text-fg-4 transition-colors hover:border-accent-400/40 hover:text-accent-300'

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-app text-fg-2">
      {/* 顶栏：品牌在左，三个数据工具在右。品牌块与绘制页顶栏保持一致，切页时不会跳位 */}
      <header className="flex h-11 shrink-0 items-center border-b border-wash-10 bg-surface-chrome px-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded bg-accent-400/15 text-accent-300">
            <Box size={15} strokeWidth={2} />
          </span>
          <h1 className="text-13 font-semibold tracking-wide">Minecraft 皮肤编辑器</h1>
          <span
            className="rounded bg-wash-6 px-1.5 py-1 font-mono text-10 text-fg-4"
            title="版本号：主版本.迭代.补丁"
          >
            {APP_VERSION}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={exportBackup}
            title="把作品库整体导出成一个 JSON 文件。清理浏览器数据、换电脑、或从网页版迁到离线版时，这是唯一的迁移方式。"
            className={toolBtn}
          >
            <Download size={11} strokeWidth={2} />
            导出备份
          </button>
          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            title="从 JSON 备份恢复作品，只新增不覆盖，可反复导入同一个文件。"
            className={toolBtn}
          >
            <Upload size={11} strokeWidth={2} />
            导入备份
          </button>
          {/*
            离线版下载：静态文件，直接指 public/download/ 下的 zip。
            路径必须走 BASE_URL —— Vite 的 base 不重写运行时字符串，
            写死 /download/... 在子路径部署下会 404。
            离线包本身（MODE=offline）里不能出现这个入口：包里没有这个 zip，点了就是死链。
          */}
          {import.meta.env.MODE !== 'offline' && (
            <a
              href={`${import.meta.env.BASE_URL}download/mse-offline.zip`}
              download
              title="下载可离线使用的整包（解压后双击 index.html）。离线版和网页版的作品库互不相通，用导出备份迁移。"
              className={toolBtn}
            >
              <Download size={11} strokeWidth={2} />
              下载离线版
            </a>
          )}
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
      </header>

      {/* 主体：数据提醒条 + 两块等宽大卡片。点卡片 = 新建 */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {noticeOpen && (
          <StorageNotice
            onClose={() => {
              writeNoticeDismissed()
              setNoticeOpen(false)
            }}
          />
        )}
        <div className="flex min-h-0 flex-1 gap-3">
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
        </div>
      </main>

      {/* 底部通栏：作品库（「我的皮肤」）。空态 + 真实列表 */}
      <footer className="flex h-[104px] shrink-0 flex-col border-t border-wash-10 bg-surface-chrome px-3 py-2">
        <div className="flex shrink-0 items-center">
          <span className="text-11 font-medium tracking-wide text-fg-4">我的皮肤</span>
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
                <span className="text-10 text-fg-6">
                  {work.kind === 'draw' ? '绘制' : '合成'} · {describeAgo(work.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </footer>

      {/* 新建皮肤：点「绘制」一律先过这一步 */}
      {newSkin && (
        <NewSkinDialog
          draft={newSkin.draft}
          starter={starter}
          onContinue={() => {
            setNewSkin(null)
            enterDraw(false)
          }}
          onPick={pickStarter}
          onImport={(file) => void pickImport(file)}
          onCancel={() => setNewSkin(null)}
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
 * 数据只存在本地这件事，新用户第一次进来必须看到。
 *
 * 不遮挡卡片点击区：它是 main 里的普通一行，卡片行在它下面独立撑开，
 * 没有用 fixed / absolute 去盖任何东西。
 */
function StorageNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-start gap-2 rounded-lg border border-warn-400/25 bg-warn-400/10 px-3 py-2">
      <TriangleAlert size={14} strokeWidth={2} className="mt-1 shrink-0 text-warn-300" />
      <p className="min-w-0 flex-1 text-11 leading-relaxed text-fg-3">
        作品保存在这台电脑的浏览器里（不上传、不同步）。清理浏览器数据或换设备会丢失 ——
        建议用右上角「导出备份」留一份 JSON。
      </p>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭这条提示"
        title="关掉后不再显示（同一版本内）"
        className="-mr-1 shrink-0 rounded p-1 text-fg-5 transition-colors hover:text-fg-2"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * 新建皮肤：先选起点，选完直接进绘制页。
 *
 * 有草稿时多一条「继续编辑」—— 那条不是起点，它只是回到上次那张，
 * 所以放在起点列表**上方**并单独描边，避免和「示例/纯白/未填充」混成一排选项。
 */
function NewSkinDialog({
  draft,
  starter,
  onContinue,
  onPick,
  onImport,
  onCancel,
}: {
  draft: boolean
  starter: StarterBase
  onContinue: () => void
  onPick: (base: StarterBase) => void
  onImport: (file: File) => void
  onCancel: () => void
}) {
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const rowBase = 'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors'
  const rowIdle = `${rowBase} border-wash-8 bg-wash-3 hover:border-accent-400/40`
  const rowActive = `${rowBase} border-accent-400/55 bg-accent-400/12`
  // 间距只用 1 / 1.5 / 2 / 3 四档（4/6/8/12px），见 docs/DEV-NOTES.md
  const chipBase = 'mt-1 w-14 shrink-0 rounded border px-1 py-1 text-center text-10'
  const chipIdle = `${chipBase} border-wash-9 text-fg-4`
  const chipActive = `${chipBase} border-accent-400/40 bg-accent-400/15 text-accent-300`

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建皮肤"
        className="w-[420px] max-w-full rounded-xl border border-wash-10 bg-surface-dialog p-3 shadow-2xl"
      >
        <h2 className="text-13 font-semibold text-fg-1">新建皮肤</h2>

        {draft && (
          <button
            type="button"
            onClick={onContinue}
            className="mt-2 flex w-full items-center gap-2 rounded-md border border-accent-400/30 bg-accent-400/10 px-2 py-1.5 text-left text-11 text-accent-300 transition-colors hover:border-accent-400/55"
          >
            <History size={12} strokeWidth={2} />
            继续编辑 · 当前草稿
          </button>
        )}

        <p className="mt-3 text-11 text-fg-5">从哪种起点开始？</p>

        <div className="mt-2 flex flex-col gap-1.5">
          {STARTER_OPTIONS.map((option) => {
            const active = option.base === starter
            return (
              <button
                key={option.base}
                type="button"
                onClick={() => onPick(option.base)}
                className={active ? rowActive : rowIdle}
              >
                <span className={active ? chipActive : chipIdle}>{option.label}</span>
                <span className="min-w-0 flex-1 text-11 leading-relaxed text-fg-3">
                  {STARTER_DESC[option.base]}
                </span>
              </button>
            )
          })}

          {/* 导入不是「起点偏好」，所以不参与高亮、也不写入 starter */}
          <button type="button" onClick={() => importInputRef.current?.click()} className={rowIdle}>
            <span className={chipIdle}>导入</span>
            <span className="min-w-0 flex-1 text-11 leading-relaxed text-fg-3">
              选一张本地 64×64 皮肤
            </span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-10 text-fg-6">选好直接进绘制页</span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-wash-9 bg-wash-4 px-2 py-1.5 text-11 text-fg-3 transition-colors hover:border-wash-20"
          >
            取消
          </button>
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept="image/png"
          aria-label="选择要导入的皮肤文件"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImport(file)
          }}
        />
      </div>
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="删除作品确认"
        className="w-[340px] max-w-full rounded-xl border border-wash-10 bg-surface-dialog p-3 shadow-2xl"
      >
        <header className="flex items-start gap-2">
          <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-danger-400/15 text-danger-300">
            <Trash2 size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-13 font-semibold text-fg-1">删除「{name}」？</h2>
            <p className="mt-1 text-11 leading-relaxed text-fg-5">
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
    <span className="flex items-center gap-2">
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
