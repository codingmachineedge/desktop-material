import {
  GitHubProjectsMaximumItems,
  IGitHubProject,
  IGitHubProjectsSnapshot,
  sanitizeGitHubProjectsSnapshot,
} from './github-projects'
import { IGitHubProjectsRepositoryIdentity } from './github-projects-loader'

export const GitHubProjectsCacheStorageKey =
  'desktop-material-github-projects-cache-v1'
export const GitHubProjectsCacheMaximumEntries = 20
export const GitHubProjectsCacheMaximumBytes = 512 * 1024
export const GitHubProjectsCacheMaximumSnapshotBytes = 256 * 1024
export const GitHubProjectsCacheStaleAfterMilliseconds = 24 * 60 * 60 * 1000

export interface IGitHubProjectsCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface ICacheEntry {
  readonly key: string
  readonly lastAccessed: string
  readonly snapshot: IGitHubProjectsSnapshot
}

interface ICacheDocument {
  readonly version: 1
  readonly entries: ReadonlyArray<ICacheEntry>
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function storageOrNull(): IGitHubProjectsCacheStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function normalizedEndpoint(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(
      /\/+$/,
      ''
    )}`.toLowerCase()
  } catch {
    return null
  }
}

export function getGitHubProjectsCacheKey(
  identity: IGitHubProjectsRepositoryIdentity
): string | null {
  const endpoint = normalizedEndpoint(identity.endpoint)
  const owner = identity.owner.trim().toLowerCase()
  const repository = identity.repository.trim().toLowerCase()
  if (
    endpoint === null ||
    owner.length < 1 ||
    owner.length > 256 ||
    repository.length < 1 ||
    repository.length > 256 ||
    /[\u0000-\u001f\u007f/\\]/.test(owner) ||
    /[\u0000-\u001f\u007f/\\]/.test(repository)
  ) {
    return null
  }
  return `${endpoint}/${encodeURIComponent(owner)}/${encodeURIComponent(
    repository
  )}`
}

function parseEntry(value: unknown): ICacheEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const entry = value as Record<string, unknown>
  if (
    typeof entry.key !== 'string' ||
    entry.key.length > 1_024 ||
    typeof entry.lastAccessed !== 'string' ||
    Number.isNaN(new Date(entry.lastAccessed).getTime())
  ) {
    return null
  }
  const snapshot = sanitizeGitHubProjectsSnapshot(entry.snapshot)
  if (snapshot === null) {
    return null
  }
  return {
    key: entry.key,
    lastAccessed: new Date(entry.lastAccessed).toISOString(),
    snapshot,
  }
}

function parseDocument(serialized: string): ICacheDocument | null {
  if (bytes(serialized) > GitHubProjectsCacheMaximumBytes) {
    return null
  }
  try {
    const value: unknown = JSON.parse(serialized)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    const document = value as Record<string, unknown>
    if (document.version !== 1 || !Array.isArray(document.entries)) {
      return null
    }
    return {
      version: 1,
      entries: document.entries
        .slice(0, GitHubProjectsCacheMaximumEntries)
        .map(parseEntry)
        .filter((entry): entry is ICacheEntry => entry !== null),
    }
  } catch {
    return null
  }
}

function readDocument(storage: IGitHubProjectsCacheStorage): ICacheDocument {
  const serialized = storage.getItem(GitHubProjectsCacheStorageKey)
  if (serialized === null) {
    return { version: 1, entries: [] }
  }
  const parsed = parseDocument(serialized)
  if (parsed !== null) {
    return parsed
  }
  // This is an app-owned disposable cache; malformed/oversized data is never
  // interpreted or migrated and is removed so it cannot repeatedly fail reads.
  storage.removeItem(GitHubProjectsCacheStorageKey)
  return { version: 1, entries: [] }
}

function snapshotWithProjects(
  snapshot: IGitHubProjectsSnapshot,
  projects: ReadonlyArray<IGitHubProject>,
  projectsWereRemoved: boolean
): IGitHubProjectsSnapshot | null {
  return sanitizeGitHubProjectsSnapshot({
    ...snapshot,
    projects,
    partialReasons: [
      ...snapshot.partialReasons,
      'items-capped',
      ...(projectsWereRemoved ? ['projects-capped'] : []),
    ],
  })
}

/** Trim only display metadata until one cache entry fits its owned budget. */
export function fitGitHubProjectsSnapshotForCache(
  snapshot: IGitHubProjectsSnapshot
): IGitHubProjectsSnapshot | null {
  let candidate = sanitizeGitHubProjectsSnapshot(snapshot)
  if (candidate === null) {
    return null
  }
  if (
    bytes(JSON.stringify(candidate)) <= GitHubProjectsCacheMaximumSnapshotBytes
  ) {
    return candidate
  }

  const projects = candidate.projects.map(project => ({
    ...project,
    items: [...project.items],
  }))
  let itemCount = projects.reduce(
    (count, project) => count + project.items.length,
    0
  )
  while (
    itemCount > 0 &&
    bytes(JSON.stringify(candidate)) > GitHubProjectsCacheMaximumSnapshotBytes
  ) {
    const largest = projects.reduce(
      (selected, project, index, all) =>
        project.items.length > all[selected].items.length ? index : selected,
      0
    )
    projects[largest].items.pop()
    projects[largest] = { ...projects[largest], partial: true }
    itemCount--
    candidate = snapshotWithProjects(candidate, projects, false)
    if (candidate === null) {
      return null
    }
  }

  while (
    projects.length > 0 &&
    bytes(JSON.stringify(candidate)) > GitHubProjectsCacheMaximumSnapshotBytes
  ) {
    projects.pop()
    candidate = snapshotWithProjects(candidate, projects, true)
    if (candidate === null) {
      return null
    }
  }
  return bytes(JSON.stringify(candidate)) <=
    GitHubProjectsCacheMaximumSnapshotBytes
    ? candidate
    : null
}

function writeDocument(
  storage: IGitHubProjectsCacheStorage,
  entries: ReadonlyArray<ICacheEntry>
): void {
  const kept = [...entries]
    .sort(
      (left, right) =>
        new Date(right.lastAccessed).getTime() -
        new Date(left.lastAccessed).getTime()
    )
    .slice(0, GitHubProjectsCacheMaximumEntries)
  let serialized = JSON.stringify({ version: 1, entries: kept })
  while (
    kept.length > 0 &&
    bytes(serialized) > GitHubProjectsCacheMaximumBytes
  ) {
    kept.pop()
    serialized = JSON.stringify({ version: 1, entries: kept })
  }
  storage.setItem(GitHubProjectsCacheStorageKey, serialized)
}

export interface IGitHubProjectsCache {
  read(
    identity: IGitHubProjectsRepositoryIdentity
  ): IGitHubProjectsSnapshot | null
  write(
    identity: IGitHubProjectsRepositoryIdentity,
    snapshot: IGitHubProjectsSnapshot,
    now?: Date
  ): void
}

export class GitHubProjectsCache implements IGitHubProjectsCache {
  public constructor(
    private readonly storage: IGitHubProjectsCacheStorage | null = storageOrNull()
  ) {}

  public read(
    identity: IGitHubProjectsRepositoryIdentity
  ): IGitHubProjectsSnapshot | null {
    const key = getGitHubProjectsCacheKey(identity)
    if (this.storage === null || key === null) {
      return null
    }
    const document = readDocument(this.storage)
    const entry = document.entries.find(candidate => candidate.key === key)
    if (entry === undefined) {
      return null
    }
    const expected = getGitHubProjectsCacheKey({
      endpoint: entry.snapshot.endpoint,
      owner: entry.snapshot.owner,
      repository: entry.snapshot.repository,
    })
    return expected === key ? entry.snapshot : null
  }

  public write(
    identity: IGitHubProjectsRepositoryIdentity,
    snapshot: IGitHubProjectsSnapshot,
    now: Date = new Date()
  ): void {
    const key = getGitHubProjectsCacheKey(identity)
    const fitted = fitGitHubProjectsSnapshotForCache(snapshot)
    if (this.storage === null || key === null || fitted === null) {
      return
    }
    const snapshotKey = getGitHubProjectsCacheKey({
      endpoint: fitted.endpoint,
      owner: fitted.owner,
      repository: fitted.repository,
    })
    if (snapshotKey !== key) {
      return
    }
    const document = readDocument(this.storage)
    const entries = document.entries.filter(entry => entry.key !== key)
    entries.unshift({
      key,
      lastAccessed: now.toISOString(),
      snapshot: fitted,
    })
    try {
      writeDocument(this.storage, entries)
    } catch {
      // Quota/private-mode failures leave the live read-only view intact.
    }
  }
}

export function isGitHubProjectsSnapshotStale(
  snapshot: IGitHubProjectsSnapshot,
  now: Date = new Date()
): boolean {
  const fetchedAt = new Date(snapshot.fetchedAt).getTime()
  return (
    Number.isNaN(fetchedAt) ||
    now.getTime() - fetchedAt > GitHubProjectsCacheStaleAfterMilliseconds
  )
}

/** Test helper proving the hard model cap is unchanged by cache trimming. */
export function countGitHubProjectItems(
  snapshot: IGitHubProjectsSnapshot
): number {
  return Math.min(
    GitHubProjectsMaximumItems,
    snapshot.projects.reduce(
      (count, project) => count + project.items.length,
      0
    )
  )
}
