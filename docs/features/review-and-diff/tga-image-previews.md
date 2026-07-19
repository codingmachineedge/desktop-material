# TGA image previews

Desktop Material can review supported `.tga` changes through the existing
image-diff modes after an in-memory conversion to a PNG data URL. It supports
uncompressed 24/32-bit true color, 8-bit grayscale, RLE 24/32-bit true color,
and all standard top/bottom and left/right origin flags.

Inputs are capped at 24 MiB, each dimension at 4,096 pixels, and decoded area
at 4,194,304 pixels. Working-tree and Git-blob reads share the same bound.
Color maps, interleaving, unsupported formats, malformed packets, truncated
bytes, and over-limit images fall back to the ordinary binary-file experience.

Source bytes are never written or executed. Decoder errors remain contained in
diff loading. Tests cover uncompressed, grayscale, RLE, orientation, invalid
and oversized inputs, Git blob conversion, and deterministic binary fallback.
See [Structured data and TGA
previews](structured-data-and-tga-previews.md) for format details.
