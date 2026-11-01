import useStore from '../store/useStore'
import CustomSettings from './settings/CustomSettings'
import EditSettings from './settings/EditSettings'
import ImageSettings from './settings/ImageSettings'
import MusicSettings from './settings/MusicSettings'
import SfxSettings from './settings/SfxSettings'
import SpriteSettings from './settings/SpriteSettings'
import VideoSettings from './settings/VideoSettings'

// The controls column is mode-driven: each mode owns a small panel that
// reads only the store slices it needs. Unknown modes (including "3d", which
// renders its own panel) fall back to the video controls.
const PANELS = {
  custom: CustomSettings,
  edit: EditSettings,
  image: ImageSettings,
  music: MusicSettings,
  sfx: SfxSettings,
  sprite: SpriteSettings,
  video: VideoSettings,
}

export default function SettingsPanel() {
  const mode = useStore((s) => s.mode)
  const Panel = PANELS[mode] || VideoSettings
  return <Panel />
}
