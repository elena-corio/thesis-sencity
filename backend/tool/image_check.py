"""The "70% sharp and unblocked" check (brief §4, step 1). Runs only with --check-images.

The image is decoded in memory and dropped right after; nothing is written to disk.
Per tile of a grid, a tile counts when it is sharp (variance of the Laplacian) and not flat
(grey-level spread), which rejects blur and a bus side or plain wall filling the view.
Privacy blur on faces and plates is small and stays well under the 30% allowance.
"""
import io

import numpy as np
from PIL import Image


def sharp_share(image_bytes: bytes, cfg: dict) -> float:
    ic = cfg["image_check"]
    grey = np.asarray(Image.open(io.BytesIO(image_bytes)).convert("L"), dtype=np.float32)
    lap = (-4 * grey[1:-1, 1:-1] + grey[:-2, 1:-1] + grey[2:, 1:-1] + grey[1:-1, :-2] + grey[1:-1, 2:])
    g = ic["grid"]
    h, w = lap.shape
    ok = 0
    for i in range(g):
        for j in range(g):
            ys, xs = slice(i * h // g, (i + 1) * h // g), slice(j * w // g, (j + 1) * w // g)
            if lap[ys, xs].var() >= ic["tile_min_laplacian_var"] and grey[ys, xs].std() >= ic["tile_min_std"]:
                ok += 1
    return ok / (g * g)


def passes(image_bytes: bytes, cfg: dict) -> bool:
    return sharp_share(image_bytes, cfg) >= cfg["image_check"]["min_sharp_share"]
