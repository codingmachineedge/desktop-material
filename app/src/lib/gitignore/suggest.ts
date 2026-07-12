import { readdir } from 'fs/promises'
import * as Path from 'path'
import {
  getTemplateCatalog,
  IGitIgnoreMarkers,
  IGitIgnoreTemplate,
} from './catalog'

/** A ranked suggestion produced by {@link rankGitIgnoreTemplates}. */
export interface IGitIgnoreSuggestion {
  readonly templateId: string
  readonly score: number
  readonly reasons: ReadonlyArray<string>
}

/**
 * A read-only probe of a repository's working tree. The pure ranking function
 * consumes this so it can be unit-tested without touching disk.
 */
export interface IRepoFileProbe {
  /** True when the given repo-relative path exists (file or directory). */
  readonly exists: (relativePath: string) => boolean
  /** A bounded sample of repo-relative file paths (forward-slash separated). */
  readonly sampleFiles: ReadonlyArray<string>
  /** The host platform, used for OS template suggestions. */
  readonly platform: NodeJS.Platform
}

/** Maximum number of suggestions surfaced to the UI. */
const MAX_SUGGESTIONS = 6

/** Walk limits for the {@link suggestGitIgnoreTemplates} disk wrapper. */
const MAX_WALK_DEPTH = 3
const MAX_WALK_ENTRIES = 2000
const WALK_SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', '.terraform'])

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/** Compile a simple `*`/`?` glob into a path-suffix matcher. */
function globToRegExp(glob: string): RegExp {
  const pattern = escapeRegExp(glob)
    .replace(/\\\*/g, '.*')
    .replace(/\\\?/g, '.')
  return new RegExp(`(^|/)${pattern}$`)
}

function platformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

interface IScoreResult {
  readonly score: number
  readonly reasons: ReadonlyArray<string>
}

function scoreMarkers(
  markers: IGitIgnoreMarkers,
  probe: IRepoFileProbe
): IScoreResult {
  let score = 0
  const reasons: string[] = []

  for (const file of markers.files ?? []) {
    if (probe.exists(file)) {
      score += 10
      reasons.push(`${file} found`)
    }
  }

  for (const dir of markers.dirs ?? []) {
    if (probe.exists(dir)) {
      score += 9
      reasons.push(`${dir}/ directory`)
    }
  }

  for (const glob of markers.globs ?? []) {
    const re = globToRegExp(glob)
    const count = probe.sampleFiles.filter(f => re.test(f)).length
    if (count > 0) {
      score += 8
      reasons.push(pluralize(count, `${glob} file`))
    }
  }

  for (const extension of markers.extensions ?? []) {
    const count = probe.sampleFiles.filter(f => f.endsWith(extension)).length
    if (count > 0) {
      // +3 for a single hit, scaling up to +6 for a strong signal.
      const points = count >= 8 ? 6 : count >= 4 ? 5 : count >= 2 ? 4 : 3
      score += points
      reasons.push(pluralize(count, `${extension} file`))
    }
  }

  return { score, reasons }
}

function scoreTemplate(
  template: IGitIgnoreTemplate,
  probe: IRepoFileProbe
): IScoreResult {
  const markerResult = template.markers
    ? scoreMarkers(template.markers, probe)
    : { score: 0, reasons: [] as string[] }

  let score = markerResult.score
  const reasons = [...markerResult.reasons]

  if (template.platform && template.platform === probe.platform) {
    score += 5
    reasons.push(`matches your ${platformLabel(template.platform)} system`)
  }

  return { score, reasons }
}

/**
 * Rank templates against a repository probe. Pure and deterministic: results
 * are sorted by score descending, then by label ascending, and only templates
 * with a positive score are returned (capped at {@link MAX_SUGGESTIONS}).
 */
export function rankGitIgnoreTemplates(
  probe: IRepoFileProbe,
  catalog: ReadonlyArray<IGitIgnoreTemplate> = getTemplateCatalog()
): ReadonlyArray<IGitIgnoreSuggestion> {
  const labelById = new Map(catalog.map(t => [t.id, t.label]))

  const suggestions: IGitIgnoreSuggestion[] = []
  for (const template of catalog) {
    const { score, reasons } = scoreTemplate(template, probe)
    if (score > 0) {
      suggestions.push({ templateId: template.id, score, reasons })
    }
  }

  suggestions.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    const labelA = labelById.get(a.templateId) ?? a.templateId
    const labelB = labelById.get(b.templateId) ?? b.templateId
    return labelA.localeCompare(labelB)
  })

  return suggestions.slice(0, MAX_SUGGESTIONS)
}

/** Build a bounded probe of a repository's working tree. */
async function buildProbe(
  repoPath: string,
  platform: NodeJS.Platform
): Promise<IRepoFileProbe> {
  const paths = new Set<string>()
  const sampleFiles: string[] = []
  let entryCount = 0

  const queue: Array<{ dir: string; depth: number; rel: string }> = [
    { dir: repoPath, depth: 0, rel: '' },
  ]

  while (queue.length > 0 && entryCount < MAX_WALK_ENTRIES) {
    const { dir, depth, rel } = queue.shift()!

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entryCount >= MAX_WALK_ENTRIES) {
        break
      }
      entryCount++

      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      paths.add(relPath)

      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(entry.name) && depth < MAX_WALK_DEPTH) {
          queue.push({
            dir: Path.join(dir, entry.name),
            depth: depth + 1,
            rel: relPath,
          })
        }
      } else if (entry.isFile()) {
        sampleFiles.push(relPath)
      }
    }
  }

  return {
    exists: relativePath => paths.has(relativePath),
    sampleFiles,
    platform,
  }
}

/**
 * Bounded-walk wrapper around {@link rankGitIgnoreTemplates}. Runs once on tab
 * mount; skips heavy directories and caps the number of entries scanned.
 */
export async function suggestGitIgnoreTemplates(
  repoPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<ReadonlyArray<IGitIgnoreSuggestion>> {
  const probe = await buildProbe(repoPath, platform)
  return rankGitIgnoreTemplates(probe)
}
