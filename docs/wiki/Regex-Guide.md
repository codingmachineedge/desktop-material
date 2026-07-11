# Regex guide — how search works in Desktop Material

Every search bar in Desktop Material (Changes, History, Branches, Repositories, Clone, Actions)
has three power tools:

1. **Filter chips** — contextual toggles (file status, unpushed/tagged commits, repo visibility, run status…).
2. **Regex mode** — the \`.*\` toggle switches the field from plain-text to regular-expression matching.
3. **Regex builder** — a dialog that composes a pattern from building blocks, tests it live, and applies it back to the search that opened it. The builder's second tab, *How regex works*, is this guide in-app.

An **invalid pattern outlines the field in red** and filters nothing until fixed.

## How matching works

A regular expression is a tiny program that scans text one character at a time, left to right.
Each token must match at the current position for the engine to advance; when a token fails, the
engine *backtracks* and tries another interpretation. A search matches when the whole pattern can
be satisfied somewhere in the text. Plain characters match themselves: \`material\` finds
"material" anywhere in a path or commit summary.

## Anchors — match positions, not characters

| Token | Meaning |
| --- | --- |
| \`^\` | start of the text (start of each line with the \`m\` flag) |
| \`$\` | end of the text (end of each line with \`m\`) |
| \`\\b\` | word boundary — between a word character and anything else |
| \`\\B\` | anywhere that is *not* a word boundary |

Example: \`^app/.*\\.scss$\` — paths that start with \`app/\` and end in \`.scss\`.

## Character classes — match one character from a set

| Token | Meaning |
| --- | --- |
| \`.\` | any character (add the \`s\` flag to cross newlines) |
| \`\\d\` / \`\\D\` | digit / non-digit |
| \`\\w\` / \`\\W\` | word character / non-word |
| \`\\s\` / \`\\S\` | whitespace / non-whitespace |
| \`[abc]\` | any of a, b, c |
| \`[^abc]\` | anything except a, b, c |
| \`[a-z]\` | a range |
| \`\\t\` \`\\n\` | tab, newline |

Example: \`[0-9a-f]{7}\` — exactly seven hex characters, i.e. a short commit sha.

## Quantifiers — repeat the previous token

| Token | Meaning |
| --- | --- |
| \`*\` | zero or more |
| \`+\` | one or more |
| \`?\` | optional (zero or one) |
| \`{3}\` | exactly 3 |
| \`{2,}\` | 2 or more |
| \`{2,5}\` | between 2 and 5 |
| \`*?\` \`+?\` \`??\` | lazy variants |

Quantifiers are **greedy**: they grab as much as possible, then give text back while backtracking.
Appending \`?\` makes one **lazy** so it stops as early as it can — \`".*?"\` matches each quoted
string separately instead of one giant match from the first quote to the last.

## Groups and backreferences

| Token | Meaning |
| --- | --- |
| \`( )\` | capture group |
| \`(?: )\` | non-capturing group |
| \`(?<name> )\` | named capture group |
| \`\\1\` | re-match the exact text group 1 captured |
| \`\\k<name>\` | re-match a named group |

Example: \`(\\w+)-\\1\` — a word, a dash, then the *same* word again ("tab-tab").

## Alternation

\`|\` means *or*. Scope it with a group: \`gr(a|e)y\` matches gray and grey;
\`\\.(scss|tsx?)$\` matches files ending in .scss, .ts, or .tsx. Without a group,
the \`|\` splits the entire pattern.

## Lookaround — test without consuming

| Token | Meaning |
| --- | --- |
| \`(?= )\` | lookahead — followed by |
| \`(?! )\` | negative lookahead — NOT followed by |
| \`(?<= )\` | lookbehind — preceded by |
| \`(?<! )\` | negative lookbehind — NOT preceded by |

Example: \`ui/(?!lib)\` — \`ui/\` paths except the ones under \`ui/lib\`.

## Flags

| Flag | Meaning |
| --- | --- |
| \`g\` | global — find every match, not just the first |
| \`i\` | ignore case (the app's default search flag) |
| \`m\` | multiline — \`^\` and \`$\` work per line |
| \`s\` | dotall — \`.\` also matches newlines |
| \`u\` | full Unicode semantics |
| \`y\` | sticky — each match must start where the last ended |

## Tips

- Escape special characters with a backslash to match them literally: \`\\.\` \`\\(\` \`\\[\` \`\\|\`.
- Prefer specific classes over \`.*\` — nested unbounded quantifiers like \`(a+)+\` can backtrack
  catastrophically on long inputs; the app caps pattern length as a guard.
- The builder's test area runs your pattern with the \`g\` flag added so the match count reflects
  every occurrence, and highlights each match inline.
