/** GitHub's maximum documented page size for Releases. */
export const GitHubReleasePageSize = 30

/** Keep interactive browsing finite even for repositories with long histories. */
export const GitHubReleaseMaximumPages = 10

/** GitHub's maximum documented page size for release assets. */
export const GitHubReleaseAssetPageSize = 100

/** GitHub permits at most 1,000 assets on one release. */
export const GitHubReleaseAssetMaximumCount = 1000

/** Cover one release's complete documented asset capacity. */
export const GitHubReleaseAssetMaximumPages =
  GitHubReleaseAssetMaximumCount / GitHubReleaseAssetPageSize

/** Asset uploads are streamed from disk by the isolated main-process transfer. */
export const GitHubReleaseAssetMaximumUploadBytes = 2 * 1024 * 1024 * 1024

/** Downloads are streamed, but unexpectedly large assets are still rejected. */
export const GitHubReleaseAssetMaximumDownloadBytes = 5 * 1024 * 1024 * 1024

export interface IGitHubReleaseAsset {
  readonly id: number
  readonly name: string
  readonly label: string | null
  /** Provider lifecycle state; only `uploaded` assets may be downloaded. */
  readonly state: string
  readonly contentType: string
  readonly sizeInBytes: number
  readonly downloadCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  /** Normalized `sha256:<lowercase hex>` when supplied by GitHub. */
  readonly digest: string | null
}

export interface IGitHubRelease {
  readonly id: number
  readonly tagName: string
  readonly targetCommitish: string
  readonly name: string
  readonly body: string
  readonly draft: boolean
  readonly prerelease: boolean
  readonly createdAt: Date
  readonly publishedAt: Date | null
  readonly authorLogin: string
  /** Provider web page for this exact release, absent on older GHES versions. */
  readonly htmlURL?: string | null
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
}

export interface IGitHubReleaseList {
  readonly releases: ReadonlyArray<IGitHubRelease>
  readonly page: number
  readonly nextPage: number | null
  readonly capped: boolean
}

export interface IGitHubReleaseAssetList {
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
  readonly page: number
  readonly nextPage: number | null
  readonly capped: boolean
}

export interface IGitHubReleaseDraft {
  readonly tagName: string
  readonly targetCommitish: string
  readonly name: string
  readonly body: string
  readonly prerelease: boolean
}

export interface IGitHubReleaseUpdate extends IGitHubReleaseDraft {
  readonly releaseId: number
}

/** Stable semantic fingerprint used to fail closed when reviewed assets change. */
export function getGitHubReleaseAssetFingerprint(
  asset: IGitHubReleaseAsset
): string {
  return JSON.stringify([
    asset.id,
    asset.name,
    asset.label,
    asset.state,
    asset.contentType,
    asset.sizeInBytes,
    asset.downloadCount,
    asset.createdAt.toISOString(),
    asset.updatedAt.toISOString(),
    asset.digest,
  ])
}

/** Stable semantic fingerprint used to fail closed when a reviewed release changes. */
export function getGitHubReleaseFingerprint(release: IGitHubRelease): string {
  return JSON.stringify([
    release.id,
    release.tagName,
    release.targetCommitish,
    release.name,
    release.body,
    release.draft,
    release.prerelease,
    release.createdAt.toISOString(),
    release.publishedAt?.toISOString() ?? null,
    release.authorLogin,
    release.htmlURL ?? null,
    [...release.assets]
      .sort((left, right) => left.id - right.id)
      .map(getGitHubReleaseAssetFingerprint),
  ])
}

const controlCharacters = /[\u0000-\u001f\u007f]/
const invalidRepositoryPartCharacters = /[\u0000-\u001f\u007f/\\?#]/
const invalidAssetNameCharacters = /[\u0000-\u001f\u007f/\\?#]/
const sha256Digest = /^sha256:([a-f0-9]{64})$/i

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function positiveIdentifier(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty: boolean = false
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    (!allowEmpty && value.length === 0) ||
    controlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function nullableText(
  value: unknown,
  label: string,
  maximumLength: number
): string | null {
  return value === null ? null : boundedText(value, label, maximumLength, true)
}

function nullableNonEmptyText(
  value: unknown,
  label: string,
  maximumLength: number
): string | null {
  const text = nullableText(value, label, maximumLength)
  return text === '' ? null : text
}

// Remove control characters that are unsafe in free-form multi-line text while
// keeping tab, newline, and carriage return — release notes are markdown and
// legitimately contain those. Written as a codepoint scan rather than a regex
// literal so the source carries no raw control bytes.
function stripUnsafeControlCharacters(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0)!
    const isSafeWhitespace = code === 9 || code === 10 || code === 13
    const isControl = code <= 0x1f || code === 0x7f
    if (!isControl || isSafeWhitespace) {
      out += ch
    }
  }
  return out
}

// Sanitize an untrusted, free-form multi-line display field (a release
// name/body from the API). Unlike boundedText, a non-string, an over-long
// value, or one with unusual characters is coerced rather than thrown: one
// malformed release body must never fail the entire releases load.
function sanitizeMultilineText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return ''
  }
  const stripped = stripUnsafeControlCharacters(value)
  return stripped.length > maximumLength
    ? stripped.slice(0, maximumLength)
    : stripped
}

// Normalize a user-supplied multi-line field (a release draft's body) before it
// is sent to GitHub: trim, keep tab/newline/CR, drop the remaining control
// characters, and reject only when it is not text or exceeds the length cap.
function normalizeMultilineField(
  value: unknown,
  label: string,
  maximumLength: number
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }
  const cleaned = stripUnsafeControlCharacters(value).trim()
  if (cleaned.length > maximumLength) {
    throw new Error(`${label} is too long.`)
  }
  return cleaned
}

function date(value: unknown, label: string): Date {
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed
}

function nullableDate(value: unknown, label: string): Date | null {
  return value === null ? null : date(value, label)
}

function digest(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('GitHub returned an invalid release asset digest.')
  }
  const match = sha256Digest.exec(value)
  if (match === null) {
    throw new Error('GitHub returned an unsupported release asset digest.')
  }
  return `sha256:${match[1].toLowerCase()}`
}

function parseReleaseAsset(value: unknown): IGitHubReleaseAsset {
  const input = record(value, 'release asset')
  const state = boundedText(input.state, 'release asset state', 32)
  const name = boundedText(input.name, 'release asset name', 255)
  if (invalidAssetNameCharacters.test(name) || name === '.' || name === '..') {
    throw new Error('GitHub returned an unsafe release asset name.')
  }
  return {
    id: positiveIdentifier(input.id, 'release asset id'),
    name,
    // GitHub represents an absent release-asset label as either `null` or an
    // empty string depending on the upload/read path. Treat both provider
    // spellings as the same semantic value so an unlabeled upload is not
    // rejected after its bytes and digest have already been verified.
    label: nullableNonEmptyText(input.label, 'release asset label', 255),
    state,
    contentType: boundedText(
      input.content_type,
      'release asset content type',
      255,
      true
    ),
    sizeInBytes: nonNegativeInteger(input.size, 'release asset size'),
    downloadCount: nonNegativeInteger(
      input.download_count,
      'release asset download count'
    ),
    createdAt: date(input.created_at, 'release asset creation date'),
    updatedAt: date(input.updated_at, 'release asset update date'),
    digest: digest(input.digest),
  }
}

/** Incomplete provider assets still consume release capacity but are not files. */
export function isUploadedGitHubReleaseAsset(
  asset: IGitHubReleaseAsset
): boolean {
  return asset.state === 'uploaded'
}

function parseRelease(value: unknown): IGitHubRelease {
  const input = record(value, 'release')
  if (
    typeof input.draft !== 'boolean' ||
    typeof input.prerelease !== 'boolean'
  ) {
    throw new Error('GitHub returned an invalid release state.')
  }
  if (
    !Array.isArray(input.assets) ||
    input.assets.length > GitHubReleaseAssetMaximumCount
  ) {
    throw new Error('GitHub returned an invalid release asset preview.')
  }
  const author = record(input.author, 'release author')
  const assetIds = new Set<number>()
  const assets = input.assets.map(parseReleaseAsset)
  for (const asset of assets) {
    if (assetIds.has(asset.id)) {
      throw new Error('GitHub returned duplicate release asset ids.')
    }
    assetIds.add(asset.id)
  }
  return {
    id: positiveIdentifier(input.id, 'release id'),
    tagName: boundedText(input.tag_name, 'release tag', 255),
    targetCommitish: boundedText(
      input.target_commitish,
      'release target',
      1024
    ),
    name: nullableText(input.name, 'release name', 1024) ?? '',
    body: sanitizeMultilineText(input.body, 125_000),
    draft: input.draft,
    prerelease: input.prerelease,
    createdAt: date(input.created_at, 'release creation date'),
    publishedAt: nullableDate(input.published_at, 'release publication date'),
    authorLogin: boundedText(author.login, 'release author login', 255),
    htmlURL:
      input.html_url === null || input.html_url === undefined
        ? null
        : boundedText(input.html_url, 'release HTML URL', 4096),
    assets,
  }
}

function validatePage(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`The requested ${label} page exceeds the app safety limit.`)
  }
  return value
}

function parsePage<T>(
  value: unknown,
  page: number,
  pageSize: number,
  maximumPages: number,
  label: string,
  parser: (item: unknown) => T,
  identifier: (item: T) => number
): {
  readonly items: ReadonlyArray<T>
  readonly nextPage: number | null
  readonly capped: boolean
} {
  if (!Array.isArray(value) || value.length > pageSize) {
    throw new Error(`GitHub returned an invalid ${label} list.`)
  }
  const ids = new Set<number>()
  const items = value.map(parser)
  for (const item of items) {
    const id = identifier(item)
    if (ids.has(id)) {
      throw new Error(`GitHub returned duplicate ${label} ids.`)
    }
    ids.add(id)
  }
  const hasAnotherPage = items.length === pageSize
  const capped = hasAnotherPage && page === maximumPages
  return {
    items,
    nextPage: hasAnotherPage && !capped ? page + 1 : null,
    capped,
  }
}

export function parseGitHubReleaseList(
  value: unknown,
  page: number = 1
): IGitHubReleaseList {
  validatePage(page, GitHubReleaseMaximumPages, 'release')
  const parsed = parsePage(
    value,
    page,
    GitHubReleasePageSize,
    GitHubReleaseMaximumPages,
    'release',
    parseRelease,
    release => release.id
  )
  return {
    releases: parsed.items,
    page,
    nextPage: parsed.nextPage,
    capped: parsed.capped,
  }
}

export function parseGitHubReleaseAssetList(
  value: unknown,
  page: number = 1
): IGitHubReleaseAssetList {
  validatePage(page, GitHubReleaseAssetMaximumPages, 'release asset')
  const parsed = parsePage(
    value,
    page,
    GitHubReleaseAssetPageSize,
    GitHubReleaseAssetMaximumPages,
    'release asset',
    parseReleaseAsset,
    asset => asset.id
  )
  return {
    assets: parsed.items,
    page,
    nextPage: parsed.nextPage,
    capped: parsed.capped,
  }
}

export function parseGitHubRelease(
  value: unknown,
  expectedReleaseId?: number
): IGitHubRelease {
  const release = parseRelease(value)
  if (expectedReleaseId !== undefined && release.id !== expectedReleaseId) {
    throw new Error(
      'GitHub returned a different release than the app requested.'
    )
  }
  return release
}

export function parseGitHubReleaseAsset(
  value: unknown,
  expectedReleaseId?: number
): IGitHubReleaseAsset {
  const asset = parseReleaseAsset(value)
  if (expectedReleaseId !== undefined && asset.id !== expectedReleaseId) {
    throw new Error(
      'GitHub returned a different release asset than the app requested.'
    )
  }
  return asset
}

export function validateGitHubReleaseIdentifier(
  value: number,
  label: string = 'release id'
): number {
  return positiveIdentifier(value, label)
}

export function validateGitHubReleaseRepositoryPart(
  value: string,
  label: string
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    invalidRepositoryPartCharacters.test(value)
  ) {
    throw new Error(`The ${label} is not safe for a GitHub Releases request.`)
  }
  return value
}

function normalizeField(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty: boolean
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }
  const normalized = value.trim()
  if (
    normalized.length > maximumLength ||
    (!allowEmpty && normalized.length === 0) ||
    controlCharacters.test(normalized)
  ) {
    throw new Error(
      `${label} must be ${
        allowEmpty ? `at most ${maximumLength}` : `1–${maximumLength}`
      } characters and contain no control characters.`
    )
  }
  return normalized
}

export function normalizeGitHubReleaseDraft(
  value: IGitHubReleaseDraft
): IGitHubReleaseDraft {
  const tagName = normalizeField(value.tagName, 'Tag', 255, false)
  if (/\s/.test(tagName) || tagName.startsWith('-')) {
    throw new Error('Tag must not contain whitespace or begin with a dash.')
  }
  return {
    tagName,
    targetCommitish: normalizeField(
      value.targetCommitish,
      'Target',
      1024,
      false
    ),
    name: normalizeField(value.name, 'Release name', 1024, true),
    body: normalizeMultilineField(value.body, 'Release notes', 125_000),
    prerelease: value.prerelease === true,
  }
}

export function normalizeGitHubReleaseUpdate(
  value: IGitHubReleaseUpdate
): IGitHubReleaseUpdate {
  return {
    releaseId: validateGitHubReleaseIdentifier(value.releaseId),
    ...normalizeGitHubReleaseDraft(value),
  }
}

export function validateGitHubReleaseTag(value: string): string {
  const tag = normalizeField(value, 'Tag', 255, false)
  if (/\s/.test(tag) || tag.startsWith('-') || tag === '.' || tag === '..') {
    throw new Error('Tag must not contain whitespace or begin with a dash.')
  }
  return tag
}

export function normalizeGitHubReleaseAssetName(value: string): string {
  const name = normalizeField(value, 'Asset name', 255, false)
  if (name === '.' || name === '..' || invalidAssetNameCharacters.test(name)) {
    throw new Error('Asset name contains characters GitHub cannot safely use.')
  }
  return name
}

export function normalizeGitHubReleaseAssetLabel(value: string): string | null {
  const label = normalizeField(value, 'Asset label', 255, true)
  return label.length === 0 ? null : label
}

export function isSupportedGitHubReleaseAssetDigest(value: string): boolean {
  return sha256Digest.test(value)
}
