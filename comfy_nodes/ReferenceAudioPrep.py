"""ReferenceAudioPrep — sample representative windows from a long reference clip.

ACE-Step's Python backend samples three 10 s windows (front / middle / back)
into a single 30 s clip before VAE-encoding, so a full song's timbre is
captured. ComfyUI's native path just encodes the whole file and truncates to
the generation length — a 4 min track generating a 60 s song only feeds the
intro. This node replicates the backend's sampling so the reference latents
cover the whole track.

Drop this file into ComfyUI/custom_nodes/ and restart ComfyUI. The app
probes for it and wires LoadAudio → ReferenceAudioPrep → VAEEncodeAudio
when present; without it the graph stays stock (full file, truncated).
"""

import torch
import torchaudio


class ReferenceAudioPrep:
    """Sample three windows from a long AUDIO clip into a ~30 s clip."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO", {}),
            },
            "optional": {
                "window_seconds": (
                    "FLOAT",
                    {"default": 10.0, "min": 1.0, "max": 30.0, "step": 0.5},
                ),
            },
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "execute"
    CATEGORY = "audio/ACE"

    def execute(self, audio, window_seconds=10.0):
        waveform = audio["waveform"]  # [batch, channels, samples]
        sr = audio["sample_rate"]
        win = int(window_seconds * sr)
        total = waveform.shape[-1]
        duration = total / sr

        # Short clips: nothing to gain, pass through untouched.
        if duration <= window_seconds * 3 + 5:
            return (audio,)

        # Anchor points: ~5 s in, midpoint, ~5 s from the end — avoids
        # leading silence and trailing fade-outs that skew the average.
        starts = [
            min(5, max(0, duration / 2 - window_seconds / 2)),
            max(0, duration / 2 - window_seconds / 2),
            max(0, duration - window_seconds - 5),
        ]

        chunks = []
        for start_sec in starts:
            start = int(start_sec * sr)
            end = min(start + win, total)
            chunk = waveform[..., start:end]
            # Pad the last window if the file ends before a full window.
            if chunk.shape[-1] < win:
                pad = win - chunk.shape[-1]
                chunk = torch.nn.functional.pad(chunk, (0, pad))
            chunks.append(chunk)

        out = torch.cat(chunks, dim=-1)
        return ({"waveform": out, "sample_rate": sr},)


NODE_CLASS_MAPPINGS = {
    "ReferenceAudioPrep": ReferenceAudioPrep,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ReferenceAudioPrep": "Reference Audio Prep (sample windows)",
}
