import Sidebar from './components/Sidebar'
import Layout from './components/Layout'
import SettingsModal from './components/SettingsModal'
import DragDivider from './components/DragDivider'
import useStore from './store/useStore'

export default function App() {
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)

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
