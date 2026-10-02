import { motion } from 'framer-motion'
import { Image, Film, Wand2 } from 'lucide-react'
import useStore from '../store/useStore'
import clsx from 'clsx'
import PromptInput from './PromptInput'
import SettingsPanel from './SettingsPanel'
import GenerateButton from './GenerateButton'
import ProgressBar from './ProgressBar'
import ImageViewer from './ImageViewer'
import VideoPlayer from './VideoPlayer'
import ImageUpload from './ImageUpload'
import ErrorBanner from './ErrorBanner'
import WebSearchPanel from './WebSearchPanel'

export default function Layout() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-bg-secondary/50 backdrop-blur-sm">
        <div className="flex items-center gap-1 p-0.5 rounded-xl bg-bg-card">
          {[
            { key: 'image', label: 'Image', icon: Image },
            { key: 'edit', label: 'Edit', icon: Wand2 },
            { key: 'video', label: 'Video', icon: Film },
          ].map(({ key, label, icon: Icon }) => (
            <motion.button
              key={key}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setMode(key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all',
                mode === key
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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Controls panel */}
        <div className="w-80 flex flex-col border-r border-border bg-bg-secondary/30 overflow-y-auto">
          <div className="p-4 space-y-4 flex-1">
            {mode === 'edit' && <ImageUpload />}
            <PromptInput />
            <SettingsPanel />
          </div>
          <div className="p-4 border-t border-border space-y-3">
            <ProgressBar />
            <GenerateButton />
          </div>
        </div>

        {/* Viewer */}
        <div className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
          <ErrorBanner />
          <div className="flex-1 min-h-0">
            {mode === 'video' ? <VideoPlayer /> : <ImageViewer />}
          </div>
        </div>
      </div>

      <WebSearchPanel />
    </div>
  )
}
