import Sidebar from './components/Sidebar'
import Layout from './components/Layout'
import SettingsModal from './components/SettingsModal'

export default function App() {
  return (
    <div className="h-screen flex animated-gradient">
      <Sidebar />
      <Layout />
      <SettingsModal />
    </div>
  )
}
