import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import useStore from './store/useStore.js'
import { fetchRuntimeConfig } from './lib/config.js'

// Deployment config (config.json, mounted into the container in production)
// seeds the defaults on a browser's first visit. Saved per-browser settings
// always win — see seedFromConfig in the store.
fetchRuntimeConfig().then((config) => {
  useStore.getState().seedFromConfig(config)
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
