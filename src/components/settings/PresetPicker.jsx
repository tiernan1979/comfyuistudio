import { motion } from 'framer-motion'
import clsx from 'clsx'
import { presetLabel } from '../../store/useStore'
import { FieldLabel, Hint } from './controls'

// Shared engine/model preset switcher used by the image, music, SFX, video,
// texture and material panels. `renderMeta` decides the sub-label (engine
// name, unet, …).
export default function PresetPicker({
  label,
  presets,
  active,
  onSelect,
  disabled,
  icon: Icon,
  renderMeta,
  hint,
}) {
  if (!presets.length) return null
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="grid grid-cols-2 gap-1.5">
        {presets.map((p, i) => {
          const on = active === i
          return (
            <motion.button
              key={p.name || i}
              type="button"
              whileHover={disabled ? undefined : { scale: 1.02 }}
              whileTap={disabled ? undefined : { scale: 0.98 }}
              onClick={() => onSelect(i)}
              disabled={disabled}
              title={presetLabel(p)}
              className={clsx(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
                on
                  ? 'border-accent bg-accent text-white shadow-sm shadow-accent/30'
                  : 'border-border bg-bg-card text-text-secondary hover:bg-bg-hover',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {Icon && <Icon size={14} className="shrink-0" />}
              <div className="min-w-0">
                <p className="truncate font-medium">{p.name || `Preset ${i + 1}`}</p>
                <p
                  className={clsx(
                    'truncate text-[10px]',
                    on ? 'text-white/70' : 'text-text-muted',
                  )}
                >
                  {renderMeta ? renderMeta(p) : p.unet}
                </p>
              </div>
            </motion.button>
          )
        })}
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}
