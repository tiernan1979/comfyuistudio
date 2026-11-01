import { Field, ChoiceGrid, Hint } from './controls'

export const QUALITY_OPTIONS = [
  { value: 'wav', label: 'WAV (lossless)' },
  { value: '320k', label: 'MP3 320k' },
  { value: 'V0', label: 'MP3 V0' },
  { value: '128k', label: 'MP3 128k' },
]

// ComfyUI writes lossless audio as .flac; the player converts it on download.
export default function QualityPicker({ value, onChange, disabled }) {
  return (
    <Field label="Output quality">
      <ChoiceGrid
        options={QUALITY_OPTIONS}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <Hint>
        ComfyUI stores lossless renders as .flac — the player converts them to a real .wav on
        download (a .flac original stays available too).
      </Hint>
    </Field>
  )
}
