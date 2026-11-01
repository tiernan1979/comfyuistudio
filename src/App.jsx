import { lazy, Suspense, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Sidebar from './components/Sidebar'
import Layout from './components/Layout'
import DragDivider from './components/DragDivider'
import ErrorBoundary from './components/ErrorBoundary'
import PanelLoader from './components/PanelLoader'
import useStore from './store/useStore'
import { useAppConnection } from './hooks/useAppConnection'
import useKeepMounted from './hooks/useKeepMounted'
import { useFocusTrap } from './hooks/useFocusTrap'

// Settings is a large screen with five sections — keep it out of the initial
// bundle and only fetch it the first time the modal opens.
const SettingsModal = lazy(() => import('./components/SettingsModal'))

// Phone drawer: a real dialog for focus/keyboard purposes. Mounted only while
// open so the trap activates and Escape can close it.
function MobileDrawer() {
  const ref = useRef(null)
  useFocusTrap(ref, true)

  return (
    <motion.aside
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="History and prompts"
      initial={{ x: '-100%' }}
      animate={{ x: 0 }}
      transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
      className="absolute inset-y-0 left-0 w-[86vw] max-w-sm bg-bg-secondary border-r border-border shadow-2xl"
    >
      <ErrorBoundary label="Sidebar unavailable">
        <Sidebar drawer />
      </ErrorBoundary>
    </motion.aside>
  )
}

export default function App() {
  useAppConnection()
  const sidebarWidth = useStore((s) => s.sidebarWidth)
  const setSidebarWidth = useStore((s) => s.setSidebarWidth)
  const setShowMusicEditor = useStore((s) => s.setShowMusicEditor)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const showSettings = useStore((s) => s.showSettings)
  const settingsMounted = useKeepMounted(showSettings)

  // ?studio=1 — the Studio opened in its own tab/window (see the
  // "Open in Studio" button). The param stays in the URL so a refresh
  // of that tab comes back with the Studio open.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('studio') === '1') {
      setShowMusicEditor(true)
    }
  }, [setShowMusicEditor])

  return (
    <div className="h-screen h-dvh flex animated-gradient relative overflow-hidden">
      {/* Docked sidebar + resize handle — desktop / tablet only. On phones the
          same Sidebar is shown as an overlay drawer (below). */}
      <div className="hidden md:flex h-full">
        <ErrorBoundary label="Sidebar unavailable">
          <Sidebar />
        </ErrorBoundary>
        <DragDivider
          label="Resize sidebar"
          value={sidebarWidth}
          min={200}
          max={480}
          defaultValue={256}
          onChange={setSidebarWidth}
          direction={1}
        />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="mobile-drawer"
            className="fixed inset-0 z-40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />
            <MobileDrawer />
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorBoundary label="Workspace unavailable">
        <Layout />
      </ErrorBoundary>

      {settingsMounted && (
        <ErrorBoundary label="Settings failed to open">
          <Suspense fallback={<PanelLoader overlay label="Loading settings…" />}>
            <SettingsModal />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}
