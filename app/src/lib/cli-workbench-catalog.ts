import type { CLIWorkbenchTool, ICLICommandCatalogEntry } from './cli-workbench'

function cleanSummary(summary: string | undefined): string {
  return summary?.trim().replace(/\s+/g, ' ') ?? ''
}

function uniqueEntries(
  entries: ReadonlyArray<ICLICommandCatalogEntry>
): ReadonlyArray<ICLICommandCatalogEntry> {
  const seen = new Set<string>()
  return entries.filter(entry => {
    const key = `${entry.tool}\0${entry.command}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/**
 * Parse the stable, column-based output produced by `git help -a`.
 *
 * Git may include configured aliases and external commands in addition to its
 * built-ins. Rows without a synopsis (notably external helpers) are retained,
 * while prose and section headings are ignored.
 */
export function parseGitHelpCatalog(
  output: string
): ReadonlyArray<ICLICommandCatalogEntry> {
  let category = 'Other'
  const entries = new Array<ICLICommandCatalogEntry>()

  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) {
      continue
    }

    if (!/^\s/.test(rawLine)) {
      if (!rawLine.startsWith('See ') && !rawLine.startsWith("'git help")) {
        category = rawLine.trim().replace(/:$/, '')
      }
      continue
    }

    const match = /^\s{2,}([A-Za-z0-9][A-Za-z0-9-]*)(?:\s{2,}(.+?))?\s*$/.exec(
      rawLine
    )
    if (match === null) {
      continue
    }

    entries.push({
      tool: 'git',
      command: match[1],
      summary: /alias/i.test(category) ? '' : cleanSummary(match[2]),
      category,
    })
  }

  return uniqueEntries(entries)
}

function githubCommandFromSignature(signature: string): string | null {
  const words = signature.trim().split(/\s+/)
  const command = new Array<string>()
  for (const word of words) {
    if (/^[\[<{(]/.test(word) || word === '--') {
      break
    }
    if (word.startsWith('-')) {
      break
    }
    command.push(word)
  }
  return command.length === 0 ? null : command.join(' ')
}

function titleCase(value: string): string {
  return value.length === 0
    ? 'Other'
    : `${value[0].toUpperCase()}${value.slice(1)}`
}

/**
 * Parse `gh help reference`, whose level-two and level-three Markdown headings
 * enumerate the complete installed command tree. The first prose line after a
 * heading is used as its synopsis.
 */
export function parseGitHubReferenceCatalog(
  output: string
): ReadonlyArray<ICLICommandCatalogEntry> {
  const entries = new Array<ICLICommandCatalogEntry>()
  let pendingIndex: number | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const heading = /^(##|###)\s+gh\s+(.+?)\s*$/.exec(rawLine)
    if (heading !== null) {
      const command = githubCommandFromSignature(heading[2])
      if (command !== null) {
        entries.push({
          tool: 'gh',
          command,
          summary: '',
          category: titleCase(command.split(' ', 1)[0]),
        })
        pendingIndex = entries.length - 1
      } else {
        pendingIndex = null
      }
      continue
    }

    if (pendingIndex === null) {
      continue
    }

    const trimmed = rawLine.trim()
    if (
      trimmed.length === 0 ||
      trimmed === 'Aliases' ||
      trimmed.startsWith('gh ')
    ) {
      continue
    }

    entries[pendingIndex] = {
      ...entries[pendingIndex],
      summary: cleanSummary(trimmed),
    }
    pendingIndex = null
  }

  return uniqueEntries(entries)
}

/**
 * Parse the top-level command tables emitted by `gh help`. This is a fallback
 * for older GitHub CLI versions which do not provide `gh help reference`.
 */
export function parseGitHubHelpCatalog(
  output: string
): ReadonlyArray<ICLICommandCatalogEntry> {
  let category = 'Other'
  const entries = new Array<ICLICommandCatalogEntry>()

  for (const rawLine of output.split(/\r?\n/)) {
    const heading = /^([A-Z][A-Z ]+COMMANDS)$/.exec(rawLine.trim())
    if (heading !== null) {
      category = titleCase(heading[1].replace(/ COMMANDS$/, '').toLowerCase())
      continue
    }

    const command = /^\s{2}([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*?)\s*$/.exec(
      rawLine
    )
    if (command === null) {
      continue
    }

    entries.push({
      tool: 'gh',
      command: command[1],
      summary: /alias/i.test(category) ? '' : cleanSummary(command[2]),
      category,
    })
  }

  return uniqueEntries(entries)
}

/** Extract the first non-empty version line without retaining other output. */
export function parseCLIWorkbenchVersion(
  tool: CLIWorkbenchTool,
  output: string
): string | null {
  const line = output
    .split(/\r?\n/)
    .map(x => x.trim())
    .find(x => x.length > 0)
  if (line === undefined) {
    return null
  }

  if (tool === 'git') {
    return line.replace(/^git version\s+/i, '') || null
  }

  const match = /^gh version\s+([^\s]+)/i.exec(line)
  return match?.[1] ?? line
}
