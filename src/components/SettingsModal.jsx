import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Server, HardDrive, Save, RefreshCw, Bot, Globe, Box, FileJson2 } from 'lucide-react'
import clsx from 'clsx'
import useSettingsModal from '../hooks/useSettingsModal'
import { useFocusTrap } from '../hooks/useFocusTrap'
import ServerSection from './settings-modal/ServerSection'
import ModelsSection from './settings-modal/ModelsSection'
import LlmSection from './settings-modal/LlmSection'
import SearchSection from './settings-modal/SearchSection'
import ThreeDSection from './settings-modal/ThreeDSection'
import WorkflowsSection from './settings-modal/WorkflowsSection'

// Left-hand menu of the settings screen. Each entry switches which
// section renders in the content pane.
const SETTINGS_TABS = [
  { id: 'server', label: 'ComfyUI Server', icon: Server },
  { id: 'models', label: 'Models', icon: HardDrive },
  { id: 'workflows', label: 'Workflows', icon: FileJson2 },
  { id: 'llm', label: 'AI Prompt Writer', icon: Bot },
  { id: 'search', label: 'Web Image Search', icon: Globe },
  { id: 'threed', label: '3D Generation', icon: Box },
]

export default function SettingsModal() {
  const s = useSettingsModal()
  const dialogRef = useRef(null)
  useFocusTrap(dialogRef, s.showSettings)

  if (!s.showSettings) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={() => s.setShowSettings(false)}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="glass flex h-[min(92vh,880px)] max-h-[92dvh] w-[min(97vw,1180px)] flex-col overflow-hidden rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
                <Server size={20} className="text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight">Settings</h2>
                <p className="text-xs text-text-muted">Server, models, workflows, AI, search, 3D</p>
              </div>
            </div>
            <motion.button
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => s.setShowSettings(false)}
              aria-label="Close settings"
              title="Close (Esc)"
              className="shrink-0 rounded-lg p-2 transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <X size={18} />
            </motion.button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Section menu — a left rail on md+, a horizontal swipeable strip
                on phones. */}
            <nav className="no-scrollbar flex w-full shrink-0 gap-1 overflow-x-auto border-b border-border p-2 md:block md:w-56 md:space-y-1 md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
              {SETTINGS_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => s.setTab(t.id)}
                  aria-current={s.tab === t.id ? 'page' : undefined}
                  className={clsx(
                    'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm transition-colors md:w-full',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                    s.tab === t.id
                      ? 'bg-accent/15 font-medium text-accent ring-1 ring-inset ring-accent/20'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  <t.icon size={16} className="shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {s.tab === 'server' && (
                  <ServerSection
                    useProxy={s.useProxy}
                    setUseProxy={s.setUseProxy}
                    autoUnload={s.autoUnload}
                    setAutoUnload={s.setAutoUnload}
                    vramGuard={s.vramGuard}
                    setVramGuard={s.setVramGuard}
                    modelsUnloaded={s.modelsUnloaded}
                    localUrl={s.localUrl}
                    setLocalUrl={s.setLocalUrl}
                  />
                )}

                {s.tab === 'models' && (
                  <ModelsSection
                    localUrl={s.localUrl}
                    loadModelLists={s.loadModelLists}
                    loadingLists={s.loadingLists}
                    listsError={s.listsError}
                    modelLists={s.modelLists}
                    localModels={s.localModels}
                    setLocalModels={s.setLocalModels}
                    editDraft={s.editDraft}
                    setEditDraft={s.setEditDraft}
                    videoDraft={s.videoDraft}
                    setVideoDraft={s.setVideoDraft}
                    sfxDraft={s.sfxDraft}
                    setSfxDraft={s.setSfxDraft}
                  />
                )}

                {s.tab === 'workflows' && <WorkflowsSection />}

                {s.tab === 'llm' && (
                  <LlmSection
                    localProvider={s.localProvider}
                    onProviderChange={s.changeProvider}
                    localConfigs={s.localConfigs}
                    setLocalConfig={s.setLocalConfig}
                    llmModels={s.llmModels}
                    loadLlmModels={s.loadLlmModels}
                    loadingLlmModels={s.loadingLlmModels}
                    llmModelsError={s.llmModelsError}
                  />
                )}

                {s.tab === 'search' && (
                  <SearchSection
                    localSearchEngine={s.localSearchEngine}
                    setLocalSearchEngine={s.setLocalSearchEngine}
                    localSearchUrl={s.localSearchUrl}
                    setLocalSearchUrl={s.setLocalSearchUrl}
                    localSearchApiKey={s.localSearchApiKey}
                    setLocalSearchApiKey={s.setLocalSearchApiKey}
                    localSearchCseId={s.localSearchCseId}
                    setLocalSearchCseId={s.setLocalSearchCseId}
                  />
                )}

                {s.tab === 'threed' && (
                  <ThreeDSection
                    localThreeD={s.localThreeD}
                    setLocalThreeD={s.setLocalThreeD}
                    threeDCheck={s.threeDCheck}
                    threeDChecking={s.threeDChecking}
                    toggleThreeD={s.toggleThreeD}
                    changePipeline={s.changePipeline}
                    threeDLists={s.threeDLists}
                  />
                )}
              </div>

              {/* Footer — Save is always reachable, whatever section is open */}
              <div className="flex shrink-0 items-center gap-3 border-t border-border bg-bg-card/50 px-4 py-3.5 sm:gap-4 sm:px-6">
                {s.saveError ? (
                  <p className="min-w-0 flex-1 text-[11px] text-warning">
                    Saved in this browser only — {s.saveError}
                  </p>
                ) : s.pullNote ? (
                  <p
                    className={clsx(
                      'min-w-0 flex-1 text-[11px]',
                      s.pullNote.kind === 'ok' ? 'text-green-400' : 'text-warning',
                    )}
                  >
                    {s.pullNote.text}
                  </p>
                ) : (
                  <p className="min-w-0 flex-1 text-[11px] text-text-muted">
                    Shared by every device — API keys stay in this browser
                  </p>
                )}
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={s.handlePull}
                  disabled={s.pulling}
                  className="flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  title="Load the settings saved by any device (Save Settings) from the server"
                >
                  <RefreshCw size={14} className={s.pulling ? 'animate-spin' : ''} />
                  {s.pulling ? 'Updating…' : 'Update from server'}
                </motion.button>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={s.handleSave}
                  className={clsx(
                    'flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                    s.saved ? 'bg-green-500' : 'bg-accent hover:bg-accent-hover',
                  )}
                >
                  <Save size={14} />
                  {s.saved ? 'Saved!' : 'Save Settings'}
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
