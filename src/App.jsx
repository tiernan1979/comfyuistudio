import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Layout from './components/Layout'
import SettingsModal from './components/SettingsModal'
import DragDivider from './components/DragDivider'
import useStore from './store/useStore'
import { useAppConnection } from './hooks/useAppConnection'

export default function App() {
  useAppConnection()
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const setShowMusicEditor = useStore((s) => s.setShowMusicEditor)

  // ?studio=1 — the Studio opened in its own tab/window (see the
  // "Open in Studio" button). The param stays in the URL so a refresh
  // of that tab comes back with the Studio open.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('studio') === '1') {
      setShowMusicEditor(true)
    }
  }, [setShowMusicEditor])

  return (
    <div className="h-screen flex animated-gradient">
      <Sidebar />
      <DragDivider
        label="Resize sidebar"
        value={sidebarWidth}
        min={200}
        max={480}
        defaultValue={256}
        onChange={setSidebarWidth}
        direction={1}
      />
      <Layout />
      <SettingsModal />
    </div>
  )
}
