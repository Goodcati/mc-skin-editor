import { useRef } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { useEditor } from '../state/EditorContext'

interface SkinImportButtonProps {
  className?: string
  children: ReactNode
  title?: string
}

/** 导入皮肤文件选择器。自身带一个隐藏 input，可多处复用。 */
export default function SkinImportButton({
  className,
  children,
  title = '导入皮肤 PNG（64×64 或旧版 64×32）',
}: SkinImportButtonProps) {
  const { importSkinFile, skinLoading } = useEditor()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 清空 value，保证连续选同一个文件也能触发 change
    event.target.value = ''
    if (file) await importSkinFile(file)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/*"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        title={title}
        disabled={skinLoading}
        onClick={() => inputRef.current?.click()}
        className={className}
      >
        {children}
      </button>
    </>
  )
}
