# Structured data and TGA previews

Desktop Material provides bounded, in-app review modes for delimited text and
TGA image changes while preserving the existing Git diff as the source of
truth.

## CSV and TSV table diffs

Changed `.csv` and `.tsv` files offer **Code** and **Table** controls. Table is
the initial view. Code mounts the existing text-diff component unchanged, so
writable working-directory diffs retain line selection and discard behavior.
When Table is active on a writable diff, the toolbar explains that line-level
actions remain available in Code.

The parser supports RFC-4180 field quoting, escaped quotes, CRLF/LF records,
delimiters inside quoted fields, and multiline quoted fields. TSV uses the same
rules with a tab delimiter. Exact records are aligned before adjacent removal
and addition blocks are paired as changed records. The semantic HTML table has
scoped column and row headers, a caption, row status text, cell status text,
and native `ins`/`del` markup for changed values. Styling distinguishes added,
removed, and changed records and cells in both light and dark themes.

Parsing is capped at 512 KiB per side, 500 records, 128 columns, 20,000 cells,
and 64 KiB per cell. Malformed quoting or any exceeded limit deterministically
omits the table control and uses the ordinary Code view. The parser never
changes file contents or generates a replacement patch.

Visible controls and assistive copy follow the persisted language mode:
English, playful Hong Kong-style Cantonese, or the compact bilingual mode.

## TGA image previews

`.tga` changes use the existing image-diff modes after a local conversion to a
PNG data URL. The decoder supports:

- uncompressed true-color images (type 2) at 24 or 32 bits per pixel;
- uncompressed grayscale images (type 3) at 8 bits per pixel;
- RLE true-color images (type 10) at 24 or 32 bits per pixel; and
- top/bottom and left/right origin orientation flags.

Input is capped at 24 MiB, each dimension at 4,096 pixels, and decoded area at
4,194,304 pixels. Working-tree reads stop at the byte boundary, and Git blob
reads use the same bounded path. Truncated packets, invalid dimensions,
unsupported color maps or interleaving, unsupported pixel formats, and any
limit violation fall back to the binary-file experience. Decoder errors do not
escape into diff loading, and source bytes are never written back to disk.

## Verification

Focused tests cover RFC-compatible CSV/TSV parsing, malformed and oversized
fallbacks, row/cell alignment semantics, accessible table rendering, the
interactive Code/Table transition, uncompressed/RLE/grayscale TGA decoding,
orientation, invalid/oversized TGA handling, and Git-diff conversion to PNG or
binary fallback.
