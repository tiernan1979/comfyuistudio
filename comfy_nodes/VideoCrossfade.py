"""VideoCrossfade — blend two frame batches at a seam.

Companion to AudioCrossfade for the app's chained MiniMax H3 video. Each
chained window is a fresh sampling pass conditioned on the previous window's
last frame, so consecutive windows match closely at the join — but the audio
crossfade overlaps the soundtracks by `fade` seconds, which *shortens* the
audio timeline. To keep A/V locked, the video must lose the same duration.

This node overlaps the last `fade_frames` of the running batch with the first
`fade_frames` of the next window and blends them (alpha ramp 0->1), so the
output is `len(images1) + len(images2) - fade_frames` frames — exactly the
`fade_frames / fps` seconds the audio node removes. Feed both nodes the same
duration and the two streams stay in sync across any number of joins.

A linear ramp is the default: for images a linear dissolve keeps average
luminance constant, whereas an equal-power ramp brightens the overlap of two
identical images.
"""

import torch


class VideoCrossfade:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images1": ("IMAGE",),
                "images2": ("IMAGE",),
                "fade_frames": ("INT", {"default": 12, "min": 0, "max": 240, "step": 1}),
                "curve": (["linear", "equal_power"], {"default": "linear"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGE",)
    FUNCTION = "crossfade"
    CATEGORY = "image/transform"
    DESCRIPTION = (
        "Crossfades images1 into images2 over fade_frames (overlapping the tail "
        "and head) for a seamless join. Linear curve. Falls back to a plain "
        "concatenation when fade_frames is 0."
    )

    def crossfade(self, images1, images2, fade_frames, curve="linear"):
        n1, n2 = images1.shape[0], images2.shape[0]
        f = min(int(fade_frames), n1, n2)
        if f <= 0:
            return (torch.cat([images1, images2], dim=0),)

        head = images1[: n1 - f]
        tail = images2[f:]
        a = images1[n1 - f :]
        b = images2[:f]

        t = torch.linspace(0.0, 1.0, f, device=images1.device, dtype=images1.dtype).view(-1, 1, 1, 1)
        if curve == "equal_power":
            # cos/sin pair: constant power, no mid-point dip (brighter overlap).
            import math

            w = t * (math.pi / 2)
            wa, wb = torch.cos(w), torch.sin(w)
        else:
            wa, wb = 1.0 - t, t

        blended = a * wa + b * wb
        return (torch.cat([head, blended, tail], dim=0),)


NODE_CLASS_MAPPINGS = {"VideoCrossfade": VideoCrossfade}
NODE_DISPLAY_NAME_MAPPINGS = {"VideoCrossfade": "Video Crossfade (seam blend)"}
