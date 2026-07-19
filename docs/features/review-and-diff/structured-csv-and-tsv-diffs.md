# Structured CSV and TSV diffs

Changed `.csv` and `.tsv` files can switch between the ordinary **Code** diff
and an accessible **Table** diff. RFC-4180 quoting, escaped delimiters,
CRLF/LF, and multiline quoted fields are supported. Exact rows align first;
adjacent removals/additions are paired into changed records with semantic row
and cell status.

Code remains the source-of-truth view for line selection and discard. Table
never generates or applies a patch. Parsing stops at 512 KiB per side, 500
records, 128 columns, 20,000 cells, or 64 KiB per cell; malformed/oversized
input deterministically falls back to Code.

Visible and assistive copy follows English, playful Hong Kong Cantonese, or
bilingual mode. Tests cover quoting, multiline data, row/cell alignment,
accessibility, bounds, fallback, and the interactive view switch. See
[Structured data and TGA previews](structured-data-and-tga-previews.md) for the
full parser contract.
