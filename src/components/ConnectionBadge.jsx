import { motion } from 'framer-motion'
import { Wifi, WifiOff } from 'lucide-react'
import useStore from '../store/useStore'

export default function ConnectionBadge() {
  const connected = useStore((s) => s.connected)
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const modelsUnloaded = useStore((s) => s.modelsUnloaded)
  const target = useProxy ? `${serverUrl} (via proxy)` : serverUrl

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs"
    >
      {connected ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <Wifi size={12} className="text-green-400" />
          <span className="text-green-400 font-medium">Connected</span>
          {modelsUnloaded && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium"
              title="Models unloaded after 5 min idle — they reload automatically on the next generate"
            >
              models idle
            </span>
          )}
        </>
      ) : (
        <>
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <WifiOff size={12} className="text-red-400" />
          <span className="text-red-400 font-medium">Disconnected</span>
        </>
      )}
      <span className="text-text-muted ml-1 max-w-[140px] truncate" title={target}>{target}</span>
    </motion.div>
  )
}
