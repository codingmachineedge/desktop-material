import { IGitIgnoreTemplate } from './catalog'

/**
 * Managed-section merge engine for `.gitignore` files.
 *
 * Templates applied through the manager are wrapped in machine-parseable
 * markers so they can later be replaced or removed without disturbing any
 * hand-written content outside the block:
 *
 *   # ──── Desktop Material: Node ────  (dm-template:node)
 *   <body…>
 *   # ──── end Desktop Material: Node ────  (dm-template:node)
 *
 * The engine is strictly LF-only in memory; the CRLF/EOL authority remains
 * `formatGitIgnoreContents` at save time. Parsing is CRLF-tolerant.
 */

/** A managed template block discovered in a `.gitignore`. */
export interface IAppliedTemplate {
  readonly templateId: string
  readonly label: string
}

const MARKER_BAR = '────'
/** Matches the machine-parseable id token on any marker line. */
const TEMPLATE_ID_RE = /\(dm-template:([^)]+)\)/
/** Distinguishes the closing marker from the opening one. */
const END_MARKER_RE = /(^|[^a-z])end\s+Desktop Material/i
/** Extracts the human label from an opening marker line. */
const LABEL_RE = /Desktop Material:\s*(.*?)\s*─+\s*\(dm-template:/

function normalize(content: string | null): string {
  return content == null ? '' : content.replace(/\r\n?/g, '\n')
}

function beginMarkerLine(id: string, label: string): string {
  return `# ${MARKER_BAR} Desktop Material: ${label} ${MARKER_BAR}  (dm-template:${id})`
}

function endMarkerLine(id: string, label: string): string {
  return `# ${MARKER_BAR} end Desktop Material: ${label} ${MARKER_BAR}  (dm-template:${id})`
}

function buildBlockLines(template: IGitIgnoreTemplate): ReadonlyArray<string> {
  const body = normalize(template.body).replace(/\n+$/, '')
  const bodyLines = body.length > 0 ? body.split('\n') : []
  return [
    beginMarkerLine(template.id, template.label),
    ...bodyLines,
    endMarkerLine(template.id, template.label),
  ]
}

type TextPart = { readonly type: 'text'; readonly lines: string[] }
type BlockPart = {
  readonly type: 'block'
  readonly id: string
  readonly label: string
  readonly lines: string[]
}
type Part = TextPart | BlockPart

/** Split normalized content into ordered text and managed-block parts. */
function parseParts(content: string): Part[] {
  const lines = content.split('\n')
  const parts: Part[] = []
  let text: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const idMatch = line.match(TEMPLATE_ID_RE)
    const isBegin =
      idMatch != null &&
      !END_MARKER_RE.test(line) &&
      /Desktop Material:/.test(line)

    if (isBegin) {
      const id = idMatch![1]
      let end = -1
      for (let j = i + 1; j < lines.length; j++) {
        const endMatch = lines[j].match(TEMPLATE_ID_RE)
        if (endMatch && END_MARKER_RE.test(lines[j]) && endMatch[1] === id) {
          end = j
          break
        }
      }

      if (end !== -1) {
        if (text.length > 0) {
          parts.push({ type: 'text', lines: text })
          text = []
        }
        const label = line.match(LABEL_RE)?.[1] || id
        parts.push({
          type: 'block',
          id,
          label,
          lines: lines.slice(i, end + 1),
        })
        i = end
        continue
      }
    }

    text.push(line)
  }

  if (text.length > 0) {
    parts.push({ type: 'text', lines: text })
  }

  return parts
}

function isSignificant(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && !trimmed.startsWith('#')
}

/**
 * Reserialize parts to an LF-only string. Significant (non-blank, non-comment)
 * lines that duplicate managed-block content are pruned from text segments so
 * hand-written rules already covered by a template don't linger.
 */
function serialize(parts: ReadonlyArray<Part>): string {
  const blockLines = new Set<string>()
  for (const part of parts) {
    if (part.type === 'block') {
      for (const line of part.lines) {
        if (isSignificant(line)) {
          blockLines.add(line.trim())
        }
      }
    }
  }

  const segments: string[] = []
  for (const part of parts) {
    if (part.type === 'block') {
      segments.push(part.lines.join('\n'))
      continue
    }

    const kept = part.lines.filter(
      line => !(isSignificant(line) && blockLines.has(line.trim()))
    )
    let start = 0
    let end = kept.length
    while (start < end && kept[start].trim() === '') {
      start++
    }
    while (end > start && kept[end - 1].trim() === '') {
      end--
    }
    const body = kept.slice(start, end).join('\n')
    if (body.length > 0) {
      segments.push(body)
    }
  }

  const out = segments.join('\n\n')
  return out.length > 0 ? `${out}\n` : ''
}

/**
 * Parse the managed template blocks present in a `.gitignore`. CRLF-tolerant;
 * accepts `null` (no file) and returns an empty list.
 */
export function getAppliedTemplates(
  content: string | null
): ReadonlyArray<IAppliedTemplate> {
  const parts = parseParts(normalize(content))
  const applied: IAppliedTemplate[] = []
  for (const part of parts) {
    if (part.type === 'block') {
      applied.push({ templateId: part.id, label: part.label })
    }
  }
  return applied
}

/**
 * Append (or, if already present, replace in place) a template's managed block.
 * `null` seeds a fresh file. Output is LF-only; the caller's save path owns EOL
 * normalization.
 */
export function applyTemplate(
  content: string | null,
  template: IGitIgnoreTemplate
): string {
  const parts = parseParts(normalize(content))
  const block: BlockPart = {
    type: 'block',
    id: template.id,
    label: template.label,
    lines: [...buildBlockLines(template)],
  }

  const existingIndex = parts.findIndex(
    part => part.type === 'block' && part.id === template.id
  )
  if (existingIndex !== -1) {
    parts[existingIndex] = block
  } else {
    parts.push(block)
  }

  return serialize(parts)
}

/**
 * Remove a template's managed block. Removing the last block from an
 * otherwise-empty file yields `''` (which the save path treats as a delete).
 */
export function removeTemplateSection(
  content: string,
  templateId: string
): string {
  const parts = parseParts(normalize(content))
  const filtered = parts.filter(
    part => !(part.type === 'block' && part.id === templateId)
  )
  return serialize(filtered)
}
