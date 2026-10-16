import { Box } from 'lucide-react'
import PanelShell from './PanelShell'
import SkinPreview3D from './SkinPreview3D'
import { useEditor } from '../state/EditorContext'

/** 左侧：整体 3D 预览区 */
export default function OverallPreview() {
  const { skinLoading } = useEditor()

  // 标题栏右侧只在真的有事发生时报一句（正在载入），不再重复顶栏已经给的皮肤名
  return (
    <PanelShell title="整体预览" icon={Box} hint={skinLoading ? '载入中…' : undefined}>
      <SkinPreview3D />
    </PanelShell>
  )
}
