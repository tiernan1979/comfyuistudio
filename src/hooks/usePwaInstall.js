import { useCallback, useEffect, useState } from 'react'
import {
  getInstallPrompt,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from '../lib/pwa'

// Tracks the browser's install prompt and whether we are already running as
// an installed app. `canInstall` is true only when the browser has offered
// its native prompt; `installed` is true in standalone display mode.
export default function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState(() => getInstallPrompt())
  const [installed, setInstalled] = useState(() => isStandalone())

  useEffect(() => {
    const off = subscribeInstallPrompt(setPromptEvent)
    const query = window.matchMedia?.('(display-mode: standalone)')
    const onChange = () => setInstalled(isStandalone())
    const onInstalled = () => setInstalled(true)
    query?.addEventListener?.('change', onChange)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      off()
      query?.removeEventListener?.('change', onChange)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    const result = await promptInstall()
    if (result.outcome === 'accepted') setInstalled(true)
    return result
  }, [])

  return { canInstall: !!promptEvent && !installed, installed, install }
}
