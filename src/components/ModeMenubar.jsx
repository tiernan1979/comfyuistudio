import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AudioWaveform,
  Box,
  Check,
  ChevronDown,
  Clapperboard,
  FileJson2,
  Film,
  Gamepad2,
  Grid3X3,
  Image,
  Layers,
  LayoutGrid,
  Music,
  Palette,
  Scissors,
  Shirt,
  Wand2,
} from 'lucide-react'
import clsx from 'clsx'
import useStore from '../store/useStore'

// Top-level menus, each holding the modes that belong together. A single
// mega-dropdown hid the mode names and opened over the controls; a menubar
// keeps every option visible in its own small popover that is portalled to
// document.body, so the top bar's stacking context can't clip it.
const MENUS = [
  {
    key: 'image',
    label: 'Image',
    icon: Image,
    modes: [
      { key: 'image', label: 'Image', icon: Image },
      { key: 'edit', label: 'Image Edit', icon: Wand2 },
      { key: 'pixel', label: 'Pixel Art', icon: Grid3X3 },
    ],
  },
  {
    key: 'video',
    label: 'Video',
    icon: Film,
    modes: [
      { key: 'video', label: 'Video', icon: Film },
      { key: 'sprite', label: 'Sprites', icon: LayoutGrid },
    ],
  },
  {
    key: 'music',
    label: 'Music',
    icon: Music,
    modes: [
      { key: 'music', label: 'Music', icon: Music },
      { key: 'sfx', label: 'SFX', icon: AudioWaveform },
    ],
  },
  {
    key: 'games',
    label: 'Game Assets',
    icon: Gamepad2,
    modes: [
      { key: 'texture', label: 'Tiles & Textures', icon: Layers },
      { key: 'flipbook', label: 'VFX Flipbook', icon: Clapperboard },
      { key: 'material', label: 'PBR Material', icon: Palette },
      { key: 'parts', label: 'Character Parts', icon: Shirt },
      { key: 'split', label: 'Split', icon: Scissors },
    ],
  },
]

const MENU_FOR_MODE = {
  image: 'image',
  edit: 'image',
  pixel: 'image',
  custom: 'image',
  video: 'video',
  sprite: 'video',
  music: 'music',
  sfx: 'music',
  parts: 'games',
  split: 'games',
  texture: 'games',
  flipbook: 'games',
  material: 'games',
  '3d': 'games',
}

export default function ModeMenubar() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const customWorkflows = useStore((s) => s.customWorkflows)
  const threeDEnabled = useStore((s) => s.threeD.enabled)
  const [open, setOpen] = useState(null)
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 480 })
  const barRef = useRef(null)
  const panelRef = useRef(null)
  const buttonsRef = useRef({})
  const activeMenu = MENU_FOR_MODE[mode] || 'image'

  const menus = MENUS.map((menu) => {
    if (menu.key !== 'image') return menu
    const modes = [...menu.modes]
    if (customWorkflows.length) {
      modes.push({ key: 'custom', label: 'Custom Workflow', icon: FileJson2 })
    }
    return { ...menu, modes }
  }).map((menu) => {
    if (menu.key !== 'games' || !threeDEnabled) return menu
    return {
      ...menu,
      modes: [...menu.modes, { key: '3d', label: '3D Image', icon: Box }],
    }
  })

  const currentMenu = menus.find((m) => m.key === open)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const el = buttonsRef.current[open]
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = 224
      setPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        maxHeight: Math.max(160, window.innerHeight - rect.bottom - 18),
      })
    }
    const onDown = (e) => {
      if (barRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Position before paint so the portal never flashes at the top-left.
  useLayoutEffect(() => {
    if (!open) return
    const el = buttonsRef.current[open]
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 224
    setPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      maxHeight: Math.max(160, window.innerHeight - rect.bottom - 18),
    })
  }, [open])

  useEffect(() => {
    setOpen(null)
  }, [mode])

  const select = (key) => {
    setMode(key)
    setOpen(null)
  }

  return (
    <>
      <div ref={barRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar md:flex-none">
        {menus.map(({ key, label, icon: Icon }) => {
          const isOpen = open === key
          const isActive = activeMenu === key
          return (
            <button
              key={key}
              ref={(el) => {
                if (el) buttonsRef.current[key] = el
              }}
              type="button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : key)}
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                isOpen && 'bg-bg-hover text-text-primary',
              )}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
              <ChevronDown
                size={12}
                className={clsx('text-text-muted transition-transform', isOpen && 'rotate-180')}
              />
            </button>
          )
        })}
      </div>

      {currentMenu &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label={`${currentMenu.label} modes`}
            style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
            className="fixed z-[120] w-56 overflow-y-auto rounded-xl border border-border bg-bg-card p-1 shadow-2xl shadow-black/60"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {currentMenu.label}
            </p>
            {currentMenu.modes.map(({ key, label, icon: Icon }) => {
              const selected = mode === key
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => select(key)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {selected && <Check size={14} className="shrink-0" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
