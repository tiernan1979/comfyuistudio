import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import useStore from './store/useStore.js'
import { fetchRuntimeConfig } from './lib/config.js'

// Deployment config (config.json, baked into the container) is shared
// across browsers: fresh browsers seed from it, and once it's been marked
// synced by a Settings save it wins on every load.
fetchRuntimeConfig().then((config) => {
  useStore.getState().applyServerConfig(config)
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // Re-apply the synced config whenever this window/tab comes to the
  // foreground, so a Settings → Save in one window shows up in the other
  // as soon as you switch to it (API keys stay browser-local either way).
  const refreshFromServer = () => {
    fetchRuntimeConfig().then((c) => useStore.getState().applyServerConfig(c))
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromServer()
  })
  window.addEventListener('focus', refreshFromServer)
})
