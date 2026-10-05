import { motion } from 'framer-motion'
import { Image, Film, Wand2, Box, Music } from 'lucide-react'
import useStore from '../store/useStore'
import clsx from 'clsx'
import PromptInput from './PromptInput'
import SettingsPanel from './SettingsPanel'
import GenerateButton from './GenerateButton'
import ProgressBar from './ProgressBar'
import ImageViewer from './ImageViewer'
import VideoPlayer from './VideoPlayer'
import MusicPlayer from './MusicPlayer'
import ImageUpload from './ImageUpload'
import ErrorBanner from './ErrorBanner'
import WebSearchPanel from './WebSearchPanel'
import ThreeDPanel from './ThreeDPanel'
import MusicEditor from './MusicEditor'
import DragDivider from './DragDivider'

export default function Layout() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const threeDEnabled = useStore((s) => s.threeD.enabled)
  const controlsWidth = useStore((s) => s.controlsWidth)
  const setControlsWidth = useStore((s) => s.setControlsWidth)

  // The 3D tab only exists while the feature is on; if it gets switched
  // off while we're in 3D mode, fall back to Image.
  const effectiveMode = mode === '3d' && !threeDEnabled ? 'image' : mode

  const tabs = [
    { key: 'image', label: 'Image', icon: Image },
    { key: 'edit', label: 'Edit', icon: Wand2 },
    { key: 'video', label: 'Video', icon: Film },
    { key: 'music', label: 'Music', icon: Music },
    ...(threeDEnabled ? [{ key: '3d', label: '3D', icon: Box }] : []),
  ]

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-bg-secondary/50 backdrop-blur-sm">
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-bg-card">
          {tabs.map(({ key, label, icon: Icon }) => (
            <motion.button
              key={key}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setMode(key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all',
                effectiveMode === key
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              <Icon size={14} />
              {label}
            </motion.button>
          ))}
        </div>
      </div>

      {effectiveMode === '3d' ? (
        <ThreeDPanel />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Controls panel */}
          <div
            data-testid="controls-panel"
            className="flex flex-col border-r border-border bg-bg-secondary/30 overflow-y-auto shrink-0"
            style={{ width: controlsWidth }}
          >
            <div className="p-4 space-y-4 flex-1">
              {effectiveMode === 'edit' && <ImageUpload />}
              <PromptInput />
              <SettingsPanel />
            </div>
            <div className="p-4 border-t border-border space-y-3">
              <ProgressBar />
              <GenerateButton />
            </div>
          </div>

          <DragDivider
            label="Resize controls panel"
            value={controlsWidth}
            min={240}
            max={560}
            defaultValue={320}
            onChange={setControlsWidth}
            direction={1}
          />

          {/* Viewer */}
          <div className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
            <ErrorBanner />
            <div className="flex-1 min-h-0">
              {effectiveMode === 'video' ? (
                <VideoPlayer />
              ) : effectiveMode === 'music' ? (
                <MusicPlayer />
              ) : (
                <ImageViewer />
              )}
            </div>
          </div>
        </div>
      )}

      <WebSearchPanel />
      <MusicEditor />
    </div>
  )
}
