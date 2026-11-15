import { lazy, Suspense, useEffect } from 'react'
import { Menu } from 'lucide-react'
import useStore from '../store/useStore'
import useKeepMounted from '../hooks/useKeepMounted'
import PromptInput from './PromptInput'
import SettingsPanel from './SettingsPanel'
import GenerateButton from './GenerateButton'
import ProgressBar from './ProgressBar'
import ImageViewer from './ImageViewer'
import VideoPlayer from './VideoPlayer'
import MusicPlayer from './MusicPlayer'
import SfxPlayer from './SfxPlayer'
import SpritePlayer from './SpritePlayer'
import ImageUpload from './ImageUpload'
import ErrorBanner from './ErrorBanner'
import WebSearchPanel from './WebSearchPanel'
import SplitPanel from './SplitPanel'
import PartsPanel from './PartsPanel'
import DragDivider from './DragDivider'
import PanelLoader from './PanelLoader'
import QueuePanel from './QueuePanel'
import ModeMenubar from './ModeMenubar'

// Heavy, rarely-needed panels are split out of the main bundle: the 3D
// workspace, the music editor and the 3D model viewer. Each is only fetched
// when first opened, so the initial image/video/music UI stays small.
const ThreeDPanel = lazy(() => import('./ThreeDPanel'))
const MusicEditor = lazy(() => import('./MusicEditor'))
const ModelViewerModal = lazy(() => import('./ModelViewerModal'))

export default function Layout() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const threeDEnabled = useStore((s) => s.threeD.enabled)
  const customWorkflows = useStore((s) => s.customWorkflows)
  const controlsWidth = useStore((s) => s.controlsWidth)
  const setControlsWidth = useStore((s) => s.setControlsWidth)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const showMusicEditor = useStore((s) => s.showMusicEditor)
  const viewing3d = useStore((s) => s.viewing3d)
  const musicMounted = useKeepMounted(showMusicEditor)
  const viewerMounted = useKeepMounted(!!viewing3d)
  // The 3D tab only exists while the feature is on; if it gets switched
  // off while we're in 3D mode, fall back to Image. The Custom tab appears
  // once at least one workflow is imported.
  const effectiveMode =
    mode === '3d' && !threeDEnabled
      ? 'image'
      : mode === 'custom' && customWorkflows.length === 0
        ? 'image'
        : mode

  // Keep the store's mode in sync when a tab disappears (3D turned off, or
  // the last imported workflow deleted) — otherwise the controls column
  // would render the hidden mode's panel while the tab rail shows Image.
  useEffect(() => {
    if (mode !== effectiveMode) setMode(effectiveMode)
  }, [mode, effectiveMode, setMode])

  // Menubar groups related modes (Image / Video / Music / More); Custom and
  // 3D only appear while they are available.
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="h-14 px-2 sm:px-4 md:px-6 flex items-center gap-2 border-b border-border/80 bg-bg-secondary/60 backdrop-blur-md shrink-0">
        {/* Phone: open the history / prompts drawer */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="md:hidden p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors shrink-0"
        >
          <Menu size={18} />
        </button>
        <ModeMenubar />
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <QueuePanel />
        </div>
      </div>

      {effectiveMode === '3d' ? (
        <Suspense fallback={<PanelLoader label="Loading 3D workspace…" />}>
          <ThreeDPanel />
        </Suspense>
      ) : effectiveMode === 'split' ? (
        <SplitPanel />
      ) : effectiveMode === 'parts' ? (
        <PartsPanel />
      ) : (
        <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden overflow-y-auto">
          {/* Controls panel — full-width and stacked on phones, a fixed
              resizable column on md+. The width lives in a CSS variable so the
              inline drag value can be ignored below md. */}
          <div
            data-testid="controls-panel"
            style={{ '--controls-w': `${controlsWidth}px` }}
            className="flex flex-col border-b md:border-b-0 md:border-r border-border bg-bg-secondary/30 w-full md:w-[var(--controls-w)] md:shrink-0 md:overflow-y-auto"
          >
            <div className="p-3 sm:p-4 space-y-4 flex-1">
              {effectiveMode === 'edit' && <ImageUpload />}
              <PromptInput />
              <SettingsPanel />
            </div>
            <div className="p-3 sm:p-4 border-t border-border space-y-3">
              <ProgressBar />
              <GenerateButton />
            </div>
          </div>

          <DragDivider
            className="hidden md:block"
            label="Resize controls panel"
            value={controlsWidth}
            min={240}
            max={560}
            defaultValue={320}
            onChange={setControlsWidth}
            direction={1}
          />

          {/* Viewer */}
          <div className="flex-1 p-3 sm:p-4 flex flex-col gap-3 md:overflow-hidden min-h-[60vh] md:min-h-0">
            <ErrorBanner />
            <div className="flex-1 min-h-0">
              {effectiveMode === 'video' ? (
                <VideoPlayer />
              ) : effectiveMode === 'music' ? (
                <MusicPlayer />
              ) : effectiveMode === 'sfx' ? (
                <SfxPlayer />
              ) : effectiveMode === 'sprite' ? (
                <SpritePlayer />
              ) : (
                <ImageViewer />
              )}
            </div>
          </div>
        </div>
      )}

      <WebSearchPanel />
      {musicMounted && (
        <Suspense fallback={<PanelLoader overlay label="Loading music editor…" />}>
          <MusicEditor />
        </Suspense>
      )}
      {viewerMounted && (
        <Suspense fallback={null}>
          <ModelViewerModal />
        </Suspense>
      )}
    </div>
  )
}
