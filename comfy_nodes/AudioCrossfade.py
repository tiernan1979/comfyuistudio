"""AudioCrossfade — ComfyUI custom node.

Crossfades the tail of audio1 into the head of audio2 over ``fade_seconds``
and returns a single seamless stream (length = len1 + len2 - fade). MiniMax H3
generates an *independent* soundtrack per chained window, so joining windows
with AudioConcat leaves an audible cut at every seam; this node overlaps and
blends them with an equal-power (cos/sin) curve so the joins disappear.

Drop this file into ComfyUI/custom_nodes/ and restart ComfyUI — the Studio app
detects it (via /object_info/AudioCrossfade) and threads it into every chained
H3 video graph. Pure torch, no ffmpeg needed.

When ``fade_seconds`` is 0 — or either clip is shorter than the fade — the two
clips are simply concatenated, matching AudioConcat's behaviour.
"""
import math

import torch


def _as_channels(w, target):
    """Coerce (batch, channels, samples) to exactly `target` channels."""
    if w.shape[1] == target:
        return w
    if w.shape[1] == 1 and target == 2:
        return w.repeat(1, 2, 1)
    if w.shape[1] > target:
        return w[:, :target]
    reps = target // w.shape[1] + 1
    return w.repeat(1, reps, 1)[:, :target]


class AudioCrossfade:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'audio1': ('AUDIO',),
                'audio2': ('AUDIO',),
                'fade_seconds': ('FLOAT', {'default': 0.5, 'min': 0.0, 'max': 5.0, 'step': 0.05}),
                'curve': (['equal_power', 'linear'], {'default': 'equal_power'}),
            }
        }

    RETURN_TYPES = ('AUDIO',)
    FUNCTION = 'crossfade'
    CATEGORY = 'audio'
    DESCRIPTION = (
        'Crossfades audio1 into audio2 over fade_seconds (overlapping the tail '
        'and head) for a seamless join. Equal-power curve. Falls back to a '
        'plain concatenation when fade_seconds is 0.'
    )

    def crossfade(self, audio1, audio2, fade_seconds, curve='equal_power'):
        if audio1 is None:
            return (audio2,)
        if audio2 is None:
            return (audio1,)
        w1 = audio1['waveform']
        w2 = audio2['waveform']
        sr = int(audio1['sample_rate'])
        ch = max(w1.shape[1], w2.shape[1])
        w1 = _as_channels(w1, ch)
        w2 = _as_channels(w2, ch)
        n = min(int(round(float(fade_seconds) * sr)), w1.shape[-1], w2.shape[-1])
        if n <= 1:
            out = torch.cat([w1, w2], dim=-1)
        else:
            t = torch.linspace(0.0, 1.0, n, device=w1.device, dtype=w1.dtype)
            if curve == 'linear':
                fade_out, fade_in = 1.0 - t, t
            else:  # equal power — constant loudness across the seam
                fade_out = torch.cos(t * (math.pi / 2.0))
                fade_in = torch.sin(t * (math.pi / 2.0))
            mid = w1[..., -n:] * fade_out + w2[..., :n] * fade_in
            out = torch.cat([w1[..., :-n], mid, w2[..., n:]], dim=-1)
        return ({'waveform': out, 'sample_rate': sr},)


NODE_CLASS_MAPPINGS = {'AudioCrossfade': AudioCrossfade}
NODE_DISPLAY_NAME_MAPPINGS = {'AudioCrossfade': 'Audio Crossfade'}
