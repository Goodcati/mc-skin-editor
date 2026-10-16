import { useEffect, useState } from 'react'
import { EditorProvider } from './state/EditorContext'
import { MergeProvider } from './state/MergeContext'
import DrawView from './views/DrawView'
import Lobby from './views/Lobby'
import MergeView from './views/MergeView'

export type ViewId = 'lobby' | 'draw' | 'merge'

/**
 * 用 URL hash 当路由。
 *
 * 不引路由库（约定是只用 useState/useContext）：三个视图而已，
 * hash 换来的是刷新/前进后退都能回到原处 —— 尤其重要，因为皮肤是自动保存的，
 * 刷新后落在大厅还是绘制页，用户是能感觉到的。
 */
function readView(): ViewId {
  const segment = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  if (segment === 'draw') return 'draw'
  if (segment === 'merge') return 'merge'
  return 'lobby'
}

export default function App() {
  const [view, setView] = useState<ViewId>(readView)

  useEffect(() => {
    const onHashChange = () => setView(readView())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    /*
      两个 Provider 都挂在视图之上，皮肤文档、撤销栈、自动保存、两张合成源图
      全部活在内存里，往返大厅不会把做到一半的东西丢掉。
      MergeProvider 在内层是因为它要用编辑器的 flash 报消息 —— 提示条只该有一个。
    */
    <EditorProvider>
      <MergeProvider>
        {view === 'draw' ? <DrawView /> : view === 'merge' ? <MergeView /> : <Lobby />}
      </MergeProvider>
    </EditorProvider>
  )
}
