"""AudioTailTrim — ComfyUI custom node.

Trims trailing silence from an AUDIO stream so a track ends when the music
does, instead of fading into dead air. Both ACE-Step and MiniMax Music 3
fill their latent to the planned duration; when the song is musically done
early the model pads the rest with silence codes (measured: up to 7.5s of
dead tail on a 30s track). Drop this file into ComfyUI/custom_nodes/ and
restart ComfyUI — the Studio app detects it automatically and wires it into
every music graph (decode → trim → save), so the saved mp3 itself is
trimmed; all clients, downloads and the REST API get the clean file.

Pure torch, no ffmpeg needed.
"""
import torch


def _trim_point(wave, sr, threshold_db, min_silence, keep_tail):
    """Returns the sample index to cut at, or None to keep the item as-is.

    wave: (channels, samples) float tensor.
    """
    mono = wave.float().abs().mean(dim=0)
    total = mono.numel()
    if total < int(sr * 0.5):
        return None
    hop = max(1, int(sr * 0.02))  # 20 ms analysis frames
    n_frames = total // hop
    if n_frames < 4:
        return None
    frames = mono[: n_frames * hop].reshape(n_frames, hop)
    # True RMS per frame (x is already abs → squaring gives x²). A
    # sqrt(mean(abs)) shortcut reads ~40 dB hot on quiet mp3 noise and
    # misses real tails.
    rms = frames.pow(2).mean(dim=1).sqrt()
    db = 20.0 * torch.log10(rms + 1e-9)
    quiet = db < threshold_db
    if bool(quiet.all()):
        return None  # all silence — never gut a track
    loud = (~quiet).nonzero(as_tuple=True)[0]
    last_loud_end = (int(loud[-1].item()) + 1) * hop
    trail = total - last_loud_end
    if trail < int(min_silence * sr):
        return None  # ending is already tight
    cut = min(total, last_loud_end + int(keep_tail * sr))
    if cut < int(sr * 0.5):
        return None
    return cut


class AudioTailTrim:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'audio': ('AUDIO',),
                'threshold_db': ('FLOAT', {'default': -50.0, 'min': -90.0, 'max': -10.0, 'step': 1.0}),
                'min_silence': ('FLOAT', {'default': 0.4, 'min': 0.05, 'max': 5.0, 'step': 0.05}),
                'keep_tail': ('FLOAT', {'default': 0.3, 'min': 0.0, 'max': 2.0, 'step': 0.05}),
            }
        }

    RETURN_TYPES = ('AUDIO',)
    FUNCTION = 'trim'
    CATEGORY = 'audio'
    DESCRIPTION = (
        'Trims trailing silence so the track ends when the music does. '
        'keep_tail seconds of the silence are kept as reverb room, with a '
        'short fade to avoid a click. Tracks without a silent tail pass through unchanged.'
    )

    def trim(self, audio, threshold_db, min_silence, keep_tail):
        waveform = audio['waveform']
        sr = int(audio['sample_rate'])
        kept = []
        for i in range(waveform.shape[0]):
            wave = waveform[i]
            cut = _trim_point(wave, sr, threshold_db, min_silence, keep_tail)
            if cut is None:
                kept.append(wave)
                continue
            part = wave[:, :cut].clone()
            fade_n = min(int(0.12 * sr), max(1, part.shape[-1] // 5))
            if fade_n > 1 and part.shape[-1] >= fade_n:
                fade = torch.linspace(1.0, 0.0, fade_n, device=part.device, dtype=part.dtype)
                part[:, -fade_n:] = part[:, -fade_n:] * fade
            kept.append(part)
        max_len = max(k.shape[-1] for k in kept)
        out = waveform.new_zeros((len(kept), waveform.shape[1], max_len))
        for i, k in enumerate(kept):
            out[i, :, : k.shape[-1]] = k
        return ({'waveform': out, 'sample_rate': sr},)


NODE_CLASS_MAPPINGS = {'AudioTailTrim': AudioTailTrim}
NODE_DISPLAY_NAME_MAPPINGS = {'AudioTailTrim': 'Audio Tail Trim'}
