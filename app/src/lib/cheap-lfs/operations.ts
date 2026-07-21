import { createHash, randomBytes } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import {
  chmod,
  FileHandle,
  lstat,
  open,
  readdir,
  rename,
  stat,
  unlink,
} from 'fs/promises'
import { Transform } from 'stream'
import { finished, pipeline } from 'stream/promises'
import { createInflateRaw } from 'zlib'
import { basename, dirname, join } from 'path'
import { Account } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
  IGitHubReleaseAssetList,
  IGitHubReleaseDraft,
  GitHubReleaseAssetMaximumCount,
  GitHubReleaseAssetMaximumPages,
  isUploadedGitHubReleaseAsset,
  normalizeGitHubReleaseAssetName,
  validateGitHubReleaseTag,
} from '../github-releases'
import {
  IGitHubReleaseAssetUploadRange,
  IGitHubReleaseTransferProgressEvent,
} from '../github-release-transfer'
import { git } from '../git/core'
import {
  getGitHubReleasesAccount,
  GitHubReleasesAvailability,
  GitHubReleasesError,
  IGitHubReleaseMutationReview,
} from '../stores/github-releases-store'
import {
  cheapLfsPointerTextSizeInBytes,
  CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES,
  CHEAP_LFS_PART_SIZE_BYTES,
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
  ICheapLfsPointerPart,
  isCheapLfsPointerText,
  parseCheapLfsPointer,
  planFileParts,
  serializeCheapLfsPointer,
  validateCheapLfsTrackedPath,
} from './pointer'

/**
 * Orchestration for the cheap-LFS flow: hashing a working-tree file, uploading
 * it as a GitHub Release asset, writing the committed pointer, and later
 * materializing the pointer back into the real bytes with end-to-end
 * verification. Every side effect (release CRUD, transfers, disk access) is
 * injected so the flow is unit-testable without a network or a real account,
 * while the exported defaults wire up the real implementations.
 */

/** Cap on files inspected while listing pointers, keeping the walk bounded. */
const CheapLfsMaximumWalkEntries = 4000
/** Depth cap for the pointer-listing walk. */
const CheapLfsMaximumWalkDepth = 8
/** Cap on pointers returned by {@link listCheapLfsPointers}. */
const CheapLfsMaximumPointerEntries = 256
/** Bound sequential rollover lookup to one million documented asset slots. */
const CheapLfsMaximumReleaseBuckets = 1000
/** Only the first bytes of a file are read to classify it as a pointer. */
const CheapLfsSniffBytes = 4096
/** Directories skipped by the pointer-listing walk. */
const CheapLfsSkipDirectories = new Set([
  '.git',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'out',
  'build',
  '.venv',
  '__pycache__',
])

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/** A file that looked like a pointer during a bounded working-tree scan. */
export interface ICheapLfsPointerCandidate {
  readonly relativePath: string
  readonly text: string
}

/** One resolved pointer discovered by {@link listCheapLfsPointers}. */
export interface ICheapLfsPointerEntry {
  readonly relativePath: string
  readonly pointer: ICheapLfsPointer
}

/**
 * The subset of the `GitHubReleasesStore` the cheap-LFS flow depends on.
 * `GitHubReleasesStore` satisfies this structurally, and tests inject a store
 * built from fake transfer dependencies.
 */
export interface ICheapLfsReleasesGateway {
  getReleaseByTag(
    repository: Repository,
    tag: string,
    signal?: AbortSignal
  ): Promise<IGitHubRelease | null>
  createDraft(
    repository: Repository,
    draft: IGitHubReleaseDraft,
    signal?: AbortSignal
  ): Promise<IGitHubRelease>
  listAssets(
    repository: Repository,
    releaseId: number,
    page?: number,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseAssetList>
  createMutationReview(
    repository: Repository,
    release: IGitHubRelease,
    asset?: IGitHubReleaseAsset | null
  ): IGitHubReleaseMutationReview
  uploadAsset(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    sourcePath: string,
    name: string,
    label: string | null,
    signal: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void,
    range?: IGitHubReleaseAssetUploadRange
  ): Promise<{
    readonly asset: IGitHubReleaseAsset
    readonly bytes: number
    readonly localDigest: string
  }>
  deleteAsset(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    signal?: AbortSignal
  ): Promise<void>
  downloadAsset(
    repository: Repository,
    releaseId: number,
    asset: IGitHubReleaseAsset,
    destination: string,
    signal: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<{ readonly path: string; readonly bytes: number }>
}

/** One part's byte range and content hash from a single streamed pass. */
export interface ICheapLfsHashedPart {
  readonly offset: number
  readonly length: number
  readonly sha256: string
}

/** Injectable disk seam so the flow can run against fakes or the real OS. */
export interface ICheapLfsFileSystem {
  hashFile(
    path: string,
    signal?: AbortSignal
  ): Promise<{ readonly sha256: string; readonly sizeInBytes: number }>
  hashFileParts(
    path: string,
    partSize: number,
    signal?: AbortSignal
  ): Promise<{
    readonly sha256: string
    readonly sizeInBytes: number
    readonly parts: ReadonlyArray<ICheapLfsHashedPart>
  }>
  statSize(path: string): Promise<number>
  readPointerText(path: string): Promise<string>
  writePointer(path: string, text: string): Promise<void>
  replaceFile(from: string, to: string): Promise<void>
  removeFile(path: string): Promise<void>
  temporaryPathFor(path: string): string
  /**
   * Concatenate `sources` in order into `destination`, streaming the combined
   * SHA-256 and byte size. Used to reassemble a split file's downloaded parts.
   */
  assembleParts(
    sources: ReadonlyArray<string>,
    destination: string,
    signal?: AbortSignal
  ): Promise<{ readonly sha256: string; readonly sizeInBytes: number }>
  /** Expand one raw-DEFLATE asset to a new temp file. */
  decompressFile?(
    source: string,
    destination: string,
    maximumOutputBytes: number,
    signal?: AbortSignal
  ): Promise<void>
  scanPointerCandidates(
    root: string
  ): Promise<ReadonlyArray<ICheapLfsPointerCandidate>>
  /** Resolve the checked-out branch or detached commit for a new release. */
  resolveReleaseTargetCommitish(repository: Repository): Promise<string | null>
}

export interface ICheapLfsPinOptions {
  readonly absoluteFilePath: string
  readonly trackedRelativePath: string
  readonly releaseTag: string
  readonly releaseName?: string
  readonly targetCommitish?: string
}

export interface ICheapLfsPinResult {
  readonly pointer: ICheapLfsPointer
  readonly asset: IGitHubReleaseAsset
  readonly releaseId: number
}

/** Fine-grained stages shared by automatic and manual pin workflows. */
export type CheapLfsPinStage = 'hashing' | 'release' | 'uploading' | 'verifying'

export interface ICheapLfsMaterializeResult {
  readonly path: string
  readonly bytes: number
}

/**
 * Stream a file through a SHA-256 hash without buffering it, returning the
 * lowercase hex digest and the exact byte size. The download side streams, so
 * hashing streams too — a multi-gigabyte pin must never be read into memory.
 */
export function hashFileSha256(
  path: string,
  signal?: AbortSignal
): Promise<{ readonly sha256: string; readonly sizeInBytes: number }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError('Cheap LFS hashing canceled.'))
      return
    }
    const hash = createHash('sha256')
    let sizeInBytes = 0
    const stream = createReadStream(path)
    const onAbort = () =>
      stream.destroy(abortError('Cheap LFS hashing canceled.'))
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', chunk => {
      sizeInBytes += chunk.length
      hash.update(chunk)
    })
    stream.once('error', error => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    stream.once('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ sha256: hash.digest('hex'), sizeInBytes })
    })
  })
}

/** Stream one byte range, feeding both the whole-file and the part hash. */
function hashFileRange(
  path: string,
  offset: number,
  length: number,
  whole: ReturnType<typeof createHash>,
  part: ReturnType<typeof createHash>,
  signal?: AbortSignal
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError('Cheap LFS hashing canceled.'))
      return
    }
    let streamed = 0
    const stream = createReadStream(path, {
      start: offset,
      end: offset + length - 1,
    })
    const onAbort = () =>
      stream.destroy(abortError('Cheap LFS hashing canceled.'))
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', chunk => {
      streamed += chunk.length
      whole.update(chunk)
      part.update(chunk)
    })
    stream.once('error', error => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    stream.once('end', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve(streamed)
    })
  })
}

/**
 * Stream a file once, computing the whole-file SHA-256 and byte size plus a
 * SHA-256 for every `partSize` range it would be split into. Ranges are read in
 * order and nothing is buffered, so hashing a multi-gigabyte file stays cheap.
 * A file at or under `partSize` yields a single whole-file part (the N=1 case).
 */
export async function hashFilePartsSha256(
  path: string,
  partSize: number,
  signal?: AbortSignal
): Promise<{
  readonly sha256: string
  readonly sizeInBytes: number
  readonly parts: ReadonlyArray<ICheapLfsHashedPart>
}> {
  const sizeInBytes = (await stat(path)).size
  const plan = planFileParts(sizeInBytes, partSize)
  const whole = createHash('sha256')
  const parts = new Array<ICheapLfsHashedPart>()
  for (const range of plan) {
    if (signal?.aborted) {
      throw abortError('Cheap LFS hashing canceled.')
    }
    const partHash = createHash('sha256')
    if (range.length > 0) {
      const streamed = await hashFileRange(
        path,
        range.offset,
        range.length,
        whole,
        partHash,
        signal
      )
      if (streamed !== range.length) {
        throw new Error(
          'The file changed size while it was being hashed for cheap LFS.'
        )
      }
    }
    parts.push({
      offset: range.offset,
      length: range.length,
      sha256: partHash.digest('hex'),
    })
  }
  return { sha256: whole.digest('hex'), sizeInBytes, parts }
}

/**
 * Concatenate `sources` in order into a fresh `destination`, streaming the
 * combined SHA-256 and byte size. The write uses `wx` so it never clobbers an
 * existing file (the destination is always a just-minted temp path).
 */
async function assemblePartsOnDisk(
  sources: ReadonlyArray<string>,
  destination: string,
  signal?: AbortSignal
): Promise<{ readonly sha256: string; readonly sizeInBytes: number }> {
  const whole = createHash('sha256')
  let sizeInBytes = 0
  const out = createWriteStream(destination, { flags: 'wx' })
  try {
    for (const source of sources) {
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          whole.update(chunk as Buffer)
          sizeInBytes += (chunk as Buffer).length
          callback(null, chunk)
        },
      })
      await pipeline(createReadStream(source), meter, out, {
        end: false,
        signal,
      })
    }
    out.end()
    await finished(out)
    return { sha256: whole.digest('hex'), sizeInBytes }
  } catch (error) {
    out.destroy()
    throw error
  }
}

async function decompressFileOnDisk(
  source: string,
  destination: string,
  maximumOutputBytes: number,
  signal?: AbortSignal
): Promise<void> {
  let outputBytes = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      outputBytes += (chunk as Buffer).length
      callback(
        outputBytes > maximumOutputBytes
          ? new Error(
              'A compressed cheap LFS part expands past its pointer size.'
            )
          : null,
        chunk
      )
    },
  })
  await pipeline(
    createReadStream(source),
    createInflateRaw(),
    limiter,
    createWriteStream(destination, { flags: 'wx' }),
    { signal }
  )
}

async function readBoundedText(
  path: string,
  maximumBytes: number
): Promise<string> {
  const handle = await open(path, 'r')
  try {
    // Keep one sentinel byte so callers can distinguish an exactly-at-limit
    // file from an oversized file instead of accidentally parsing a prefix.
    const capacity = maximumBytes + 1
    const buffer = Buffer.alloc(capacity)
    const { bytesRead } = await handle.read(buffer, 0, capacity, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function scanPointerCandidatesFromDisk(
  root: string
): Promise<ReadonlyArray<ICheapLfsPointerCandidate>> {
  const candidates = new Array<ICheapLfsPointerCandidate>()
  const queue: Array<{ dir: string; depth: number; rel: string }> = [
    { dir: root, depth: 0, rel: '' },
  ]
  let entryCount = 0

  while (queue.length > 0 && entryCount < CheapLfsMaximumWalkEntries) {
    const { dir, depth, rel } = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (
        entryCount >= CheapLfsMaximumWalkEntries ||
        candidates.length >= CheapLfsMaximumPointerEntries
      ) {
        break
      }
      entryCount++
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (
          !CheapLfsSkipDirectories.has(entry.name) &&
          depth < CheapLfsMaximumWalkDepth
        ) {
          queue.push({
            dir: join(dir, entry.name),
            depth: depth + 1,
            rel: relPath,
          })
        }
      } else if (entry.isFile()) {
        let text: string
        try {
          text = await readBoundedText(
            join(dir, entry.name),
            CheapLfsSniffBytes
          )
        } catch {
          continue
        }
        if (isCheapLfsPointerText(text)) {
          candidates.push({ relativePath: relPath, text })
        }
      }
    }
  }
  return candidates
}

type CheapLfsPointerTempWriter = (
  file: FileHandle,
  text: string
) => Promise<void>

const writePointerToTemp: CheapLfsPointerTempWriter = (file, text) =>
  file.writeFile(text, 'utf8')

function temporaryPathFor(path: string): string {
  return join(dirname(path), `.cheeplfs-${randomBytes(8).toString('hex')}.tmp`)
}

/**
 * Persist a pointer beside its source, then atomically replace the source only
 * after the complete pointer has been written and flushed. The exclusive temp
 * create means cleanup only ever removes a file this operation owns.
 *
 * `writeTemporaryFile` is injectable solely to exercise partial-write failure
 * handling against the real filesystem.
 */
export async function writeCheapLfsPointerAtomically(
  path: string,
  text: string,
  writeTemporaryFile: CheapLfsPointerTempWriter = writePointerToTemp
): Promise<void> {
  const tempPath = temporaryPathFor(path)
  let tempFile: FileHandle | undefined
  let ownsTemp = false
  const sourceMode =
    process.platform === 'win32' ? null : (await lstat(path)).mode & 0o777

  try {
    tempFile = await open(tempPath, 'wx')
    ownsTemp = true
    await writeTemporaryFile(tempFile, text)
    if (sourceMode !== null) {
      await tempFile.chmod(sourceMode)
    }
    await tempFile.sync()
    await tempFile.close()
    tempFile = undefined
    await rename(tempPath, path)
    ownsTemp = false
  } catch (error) {
    await tempFile?.close().catch(() => undefined)
    if (ownsTemp) {
      await unlink(tempPath).catch(() => undefined)
    }
    throw error
  }
}

async function replaceFilePreservingMode(
  from: string,
  to: string
): Promise<void> {
  if (process.platform !== 'win32') {
    const targetMode = (await lstat(to)).mode & 0o777
    await chmod(from, targetMode)
  }
  await rename(from, to)
}

async function resolveReleaseTargetCommitish(
  repository: Repository
): Promise<string | null> {
  try {
    const branch = await git(
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      repository.path,
      'getCheapLfsReleaseTargetBranch',
      { successExitCodes: new Set([0, 1, 128]) }
    )
    if (branch.exitCode === 0 && branch.stdout.trim().length > 0) {
      return branch.stdout.trim()
    }

    const detached = await git(
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      repository.path,
      'getCheapLfsReleaseTargetCommit',
      { successExitCodes: new Set([0, 128]) }
    )
    return detached.exitCode === 0 && detached.stdout.trim().length > 0
      ? detached.stdout.trim()
      : null
  } catch {
    return null
  }
}

/** The real-OS disk seam used unless a caller injects a fake. */
export const defaultCheapLfsFileSystem: ICheapLfsFileSystem = {
  hashFile: hashFileSha256,
  hashFileParts: hashFilePartsSha256,
  // lstat measures the selected working-tree entry itself. Following a symlink
  // here could auto-pin its multi-gigabyte target even though Git stores only
  // the short link text.
  statSize: async path => (await lstat(path)).size,
  readPointerText: path =>
    readBoundedText(path, CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES),
  // Written with the pointer's own `\n` bytes; never routed through the
  // autocrlf-aware .gitignore writer so the committed pointer is byte-stable.
  writePointer: writeCheapLfsPointerAtomically,
  replaceFile: replaceFilePreservingMode,
  removeFile: async path => {
    await unlink(path).catch(() => undefined)
  },
  temporaryPathFor,
  assembleParts: assemblePartsOnDisk,
  decompressFile: decompressFileOnDisk,
  scanPointerCandidates: scanPointerCandidatesFromDisk,
  resolveReleaseTargetCommitish,
}

function ensureReleasesAccount(repository: Repository, account: Account): void {
  if (getGitHubReleasesAccount(repository, [account]) === null) {
    throw new GitHubReleasesError(
      'authentication',
      'Sign in with the account selected for this repository to use cheap LFS.'
    )
  }
}

/** Add a deterministic suffix without exceeding an asset-name length cap. */
function appendAssetNameSuffix(
  name: string,
  suffix: string,
  maximumLength: number = 255
): string {
  const maximumPrefixLength = maximumLength - suffix.length
  if (maximumPrefixLength < 1) {
    throw new Error('The cheap LFS release asset suffix is too long.')
  }
  let prefix = name.slice(0, maximumPrefixLength)
  // Avoid ending on the first half of a UTF-16 surrogate pair.
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1)
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1)
  }
  return normalizeGitHubReleaseAssetName(`${prefix}${suffix}`)
}

function insertAssetNameHash(name: string, shortHash: string): string {
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    const suffix = `-${shortHash}${name.slice(dot)}`
    if (suffix.length < 255) {
      return appendAssetNameSuffix(name.slice(0, dot), suffix)
    }
  }
  return appendAssetNameSuffix(name, `-${shortHash}`)
}

/** Append a short content hash before the extension to dodge a name clash. */
function dedupeAssetName(
  name: string,
  assets: ReadonlyArray<IGitHubReleaseAsset>,
  sha256: string,
  reservedNames: ReadonlySet<string> = new Set()
): string {
  const assetNames = new Set([
    ...assets.map(asset => asset.name),
    ...reservedNames,
  ])
  if (!assetNames.has(name)) {
    return name
  }

  const short = sha256.slice(0, 7)
  for (let attempt = 0; attempt <= assets.length; attempt++) {
    const candidate = insertAssetNameHash(
      name,
      attempt === 0 ? short : `${short}-${attempt + 1}`
    )
    if (!assetNames.has(candidate)) {
      return candidate
    }
  }
  throw new Error('Cheap LFS could not choose a unique release asset name.')
}

/**
 * Pick a base name whose `<base>.partNNN` family cannot collide with any asset
 * already on the release. If any existing asset already uses this base's part
 * prefix, a short content hash is appended so the whole family is fresh.
 */
function dedupeMultiPartBaseName(
  name: string,
  assets: ReadonlyArray<IGitHubReleaseAsset>,
  sha256: string,
  partCount: number
): string {
  const assetNames = new Set(assets.map(asset => asset.name))
  const collides = (base: string) => {
    for (let index = 0; index < partCount; index++) {
      if (assetNames.has(partAssetName(base, index, partCount))) {
        return true
      }
    }
    return false
  }
  if (!collides(name)) {
    return name
  }

  const width = Math.max(3, String(partCount).length)
  const maximumBaseLength = 255 - `.part${'0'.repeat(width)}`.length
  const short = sha256.slice(0, 7)
  for (let attempt = 0; attempt <= assets.length; attempt++) {
    const suffix = attempt === 0 ? `-${short}` : `-${short}-${attempt + 1}`
    const candidate = appendAssetNameSuffix(name, suffix, maximumBaseLength)
    if (!collides(candidate)) {
      return candidate
    }
  }
  throw new Error('Cheap LFS could not choose unique release part names.')
}

/** The `<base>.partNNN` name for one part, zero-padded to a stable width. */
function partAssetName(
  base: string,
  index: number,
  count: number,
  deflated: boolean = false
): string {
  const width = Math.max(3, String(count).length)
  return appendAssetNameSuffix(
    base,
    `.part${String(index + 1).padStart(width, '0')}${
      deflated ? '.deflate' : ''
    }`
  )
}

/**
 * Wrap a caller's progress callback so per-transfer events (whose totals cover
 * only one part) are re-expressed as cumulative progress over the whole file.
 */
function aggregateProgress(
  onProgress:
    | ((progress: IGitHubReleaseTransferProgressEvent) => void)
    | undefined,
  transferredBefore: number,
  wholeSize: number,
  logicalPartSize: number
): ((progress: IGitHubReleaseTransferProgressEvent) => void) | undefined {
  if (onProgress === undefined) {
    return undefined
  }
  return progress => {
    const fraction =
      progress.totalBytes > 0
        ? Math.min(1, progress.transferredBytes / progress.totalBytes)
        : progress.transferredBytes > 0
        ? 1
        : 0
    onProgress({
      ...progress,
      transferredBytes:
        transferredBefore + Math.round(fraction * logicalPartSize),
      totalBytes: wholeSize,
    })
  }
}

/**
 * Ensure the bytes accepted by the release transfer are still the bytes hashed
 * for the pointer. The source can be modified by another process during a
 * multi-gigabyte pin, so a successful HTTP upload alone is not sufficient.
 */
function ensureRawUploadMatchesHash(
  upload: { readonly bytes: number; readonly localDigest: string },
  expectedBytes: number,
  expectedSha256: string
): void {
  if (
    upload.bytes !== expectedBytes ||
    upload.localDigest !== `sha256:${expectedSha256}`
  ) {
    throw new Error(
      'The uploaded cheap LFS asset no longer matches the file that was hashed. The original file was left in place.'
    )
  }
}

/** Re-read the complete source before replacing it with a pointer. */
async function ensureSourceStillMatchesHash(
  fs: ICheapLfsFileSystem,
  sourcePath: string,
  expectedBytes: number,
  expectedSha256: string,
  signal?: AbortSignal
): Promise<void> {
  const current = await fs.hashFile(sourcePath, signal)
  if (
    current.sizeInBytes !== expectedBytes ||
    current.sha256 !== expectedSha256
  ) {
    throw new Error(
      'The cheap LFS source changed after it was uploaded. The original file was left in place.'
    )
  }
}

async function releaseTargetCommitish(
  repository: Repository,
  options: ICheapLfsPinOptions,
  fs: ICheapLfsFileSystem
): Promise<string> {
  const target =
    options.targetCommitish ??
    (await fs.resolveReleaseTargetCommitish(repository)) ??
    repository.defaultBranch
  if (target === null || target.trim().length === 0) {
    throw new Error(
      "Cheap LFS could not determine this repository's release target branch. Refresh the repository metadata or choose a target branch before retrying."
    )
  }
  return target
}

function ensurePointerFitsOnDisk(pointerText: string): void {
  if (
    cheapLfsPointerTextSizeInBytes(pointerText) >
    CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES
  ) {
    throw new Error(
      'This file would need a cheap LFS pointer larger than the 512 KiB safety limit. No release assets were uploaded.'
    )
  }
}

/**
 * Reject a manifest which is already projected to exceed the pointer limit
 * using only the source's stat size. This runs before hashing or any release
 * lookup/mutation. Asset-name collision handling can change the final text, so
 * pinning retains the exact serialized check after hashing and release lookup.
 */
function preflightProjectedPointer(
  sourceSizeInBytes: number,
  releaseTag: string,
  baseName: string
): void {
  if (!Number.isSafeInteger(sourceSizeInBytes) || sourceSizeInBytes < 0) {
    throw new Error('Cheap LFS cannot plan parts for this file size.')
  }

  const partCount = Math.max(
    1,
    Math.ceil(sourceSizeInBytes / CHEAP_LFS_PART_SIZE_BYTES)
  )
  if (partCount > GitHubReleaseAssetMaximumCount) {
    throw new Error(
      `This file needs ${partCount} cheap LFS parts, but one object may use at most ${GitHubReleaseAssetMaximumCount} assets in a single release.`
    )
  }
  const placeholderSha256 = '0'.repeat(64)
  let projectedBytes = cheapLfsPointerTextSizeInBytes(
    serializeCheapLfsPointer({
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag,
      assetName: baseName,
      sizeInBytes: sourceSizeInBytes,
      sha256: placeholderSha256,
      parts: partCount > 1 ? [] : undefined,
    })
  )

  for (let index = 0; index < partCount; index++) {
    if (partCount <= 1) {
      break
    }
    const partSize =
      index === partCount - 1
        ? sourceSizeInBytes - CHEAP_LFS_PART_SIZE_BYTES * index
        : CHEAP_LFS_PART_SIZE_BYTES
    projectedBytes += cheapLfsPointerTextSizeInBytes(
      `part ${placeholderSha256} ${partSize} ${partAssetName(
        baseName,
        index,
        partCount
      )}\n`
    )
    if (projectedBytes > CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES) {
      throw new Error(
        'This file would need a cheap LFS pointer larger than the 512 KiB safety limit. No release assets were uploaded.'
      )
    }
  }

  if (projectedBytes > CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES) {
    throw new Error(
      'This file would need a cheap LFS pointer larger than the 512 KiB safety limit. No release assets were uploaded.'
    )
  }
}

/**
 * Best-effort rollback for a failed upload attempt. Only asset identifiers
 * returned by this attempt, and never identifiers present before it began, are
 * eligible. A fresh signal lets cancellation roll back already-uploaded assets.
 */
async function removeAttemptAssets(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  releaseTag: string,
  preexistingAssetIds: ReadonlySet<number>,
  attemptAssets: ReadonlyArray<IGitHubReleaseAsset>
): Promise<ReadonlyArray<unknown>> {
  const failures = new Array<unknown>()
  const reviewedIds = new Set<number>()

  for (let index = attemptAssets.length - 1; index >= 0; index--) {
    const asset = attemptAssets[index]
    if (preexistingAssetIds.has(asset.id) || reviewedIds.has(asset.id)) {
      continue
    }
    reviewedIds.add(asset.id)
    try {
      const currentRelease = await releases.getReleaseByTag(
        repository,
        releaseTag,
        new AbortController().signal
      )
      if (currentRelease === null) {
        throw new Error(
          `The release tagged “${releaseTag}” disappeared before cheap LFS could remove this attempt's uploaded assets.`
        )
      }
      ensureCheapLfsBucketTag(currentRelease, releaseTag)
      const review = releases.createMutationReview(
        repository,
        currentRelease,
        asset
      )
      await releases.deleteAsset(
        repository,
        review,
        new AbortController().signal
      )
    } catch (error) {
      failures.push(error)
    }
  }

  return failures
}

async function rethrowAfterAttemptAssetCleanup(
  error: unknown,
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  releaseTag: string,
  preexistingAssetIds: ReadonlySet<number>,
  attemptAssets: ReadonlyArray<IGitHubReleaseAsset>
): Promise<never> {
  const cleanupFailures = await removeAttemptAssets(
    releases,
    repository,
    releaseTag,
    preexistingAssetIds,
    attemptAssets
  )
  if (cleanupFailures.length > 0) {
    const primaryMessage =
      error instanceof Error ? error.message : 'Cheap LFS upload failed.'
    throw new AggregateError(
      [error, ...cleanupFailures],
      `${primaryMessage} Cheap LFS also could not remove ${
        cleanupFailures.length
      } attempt-owned release ${
        cleanupFailures.length === 1 ? 'asset' : 'assets'
      } safely.`
    )
  }
  throw error
}

/**
 * Upload a working-tree file to one or more release assets and replace it with a
 * pointer.
 *
 * Validates the tracked path, then hashes the file once to compute its whole
 * SHA-256, byte size, and per-part digests. Files at or under the per-asset cap
 * upload as a single asset (named from the file's basename, deduped with a short
 * hash if the release already has one). Larger files are split into
 * `ceil(size / cap)` parts, each uploaded as its own `<base>.partNNN` asset into
 * the same release via a ranged upload, and every part is recorded in the
 * committed pointer so materialize can reassemble the original file.
 */
export async function pinFileToRelease(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  account: Account,
  options: ICheapLfsPinOptions,
  signal?: AbortSignal,
  onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem,
  onStage?: (stage: CheapLfsPinStage) => void
): Promise<ICheapLfsPinResult> {
  const trackedRelativePath = validateCheapLfsTrackedPath(
    options.trackedRelativePath
  )
  if (trackedRelativePath === null) {
    throw new Error(
      'Choose a safe repository-relative path without parent traversal or Git metadata to track with cheap LFS.'
    )
  }
  ensureReleasesAccount(repository, account)
  ensureCheapLfsReleaseFamilyTag(options.releaseTag)

  const baseName = normalizeGitHubReleaseAssetName(
    basename(options.absoluteFilePath)
  )
  const sourceSizeInBytes = await fs.statSize(options.absoluteFilePath)
  preflightProjectedPointer(sourceSizeInBytes, options.releaseTag, baseName)

  onStage?.('hashing')
  const hashed = await fs.hashFileParts(
    options.absoluteFilePath,
    CHEAP_LFS_PART_SIZE_BYTES,
    signal
  )
  onStage?.('release')
  const bucket = await allocateCheapLfsReleaseBucket(
    releases,
    repository,
    options.releaseTag,
    options.releaseName,
    hashed.parts.length,
    async (releaseTag, releaseName) =>
      await releases.createDraft(
        repository,
        {
          tagName: releaseTag,
          targetCommitish: await releaseTargetCommitish(
            repository,
            options,
            fs
          ),
          name: releaseName,
          body: '',
          prerelease: false,
        },
        signal
      ),
    signal
  )
  const { release, releaseTag, assets: releaseAssets } = bucket
  preflightProjectedPointer(sourceSizeInBytes, releaseTag, baseName)

  if (hashed.parts.length <= 1) {
    const part = hashed.parts[0]
    const assetName = dedupeAssetName(baseName, releaseAssets, hashed.sha256)
    const pointer: ICheapLfsPointer = {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag,
      assetName,
      sizeInBytes: hashed.sizeInBytes,
      sha256: hashed.sha256,
    }
    const pointerText = serializeCheapLfsPointer(pointer)
    ensurePointerFitsOnDisk(pointerText)

    const preexistingAssetIds = new Set(releaseAssets.map(asset => asset.id))
    const attemptAssets = new Array<IGitHubReleaseAsset>()
    try {
      onStage?.('uploading')
      const review = releases.createMutationReview(repository, release)
      const upload = await releases.uploadAsset(
        repository,
        review,
        options.absoluteFilePath,
        assetName,
        null,
        signal ?? new AbortController().signal,
        aggregateProgress(onProgress, 0, hashed.sizeInBytes, part.length)
      )
      // Record ownership before validating the response. A digest or byte-count
      // mismatch still means GitHub accepted an asset that this attempt owns.
      attemptAssets.push(upload.asset)
      ensureRawUploadMatchesHash(upload, part.length, hashed.sha256)
      onStage?.('verifying')
      await ensureSourceStillMatchesHash(
        fs,
        options.absoluteFilePath,
        hashed.sizeInBytes,
        hashed.sha256,
        signal
      )
      await fs.writePointer(
        join(repository.path, trackedRelativePath),
        pointerText
      )
      return { pointer, asset: upload.asset, releaseId: release.id }
    } catch (error) {
      return rethrowAfterAttemptAssetCleanup(
        error,
        releases,
        repository,
        releaseTag,
        preexistingAssetIds,
        attemptAssets
      )
    }
  }

  const partBaseName = dedupeMultiPartBaseName(
    baseName,
    releaseAssets,
    hashed.sha256,
    hashed.parts.length
  )
  const parts: ReadonlyArray<ICheapLfsPointerPart> = hashed.parts.map(
    (part, index) => ({
      name: partAssetName(partBaseName, index, hashed.parts.length),
      sizeInBytes: part.length,
      sha256: part.sha256,
    })
  )
  const pointer: ICheapLfsPointer = {
    version: CHEAP_LFS_POINTER_VERSION,
    releaseTag,
    assetName: partBaseName,
    sizeInBytes: hashed.sizeInBytes,
    sha256: hashed.sha256,
    parts,
  }
  const pointerText = serializeCheapLfsPointer(pointer)
  ensurePointerFitsOnDisk(pointerText)

  let firstAsset: IGitHubReleaseAsset | undefined
  let transferred = 0
  const preexistingAssetIds = new Set(releaseAssets.map(asset => asset.id))
  const attemptAssets = new Array<IGitHubReleaseAsset>()
  // The release snapshot is refreshed before each part: an earlier part adds an
  // asset, so the mutation review must reflect the release's current state.
  let currentRelease = release
  try {
    onStage?.('uploading')
    for (let index = 0; index < hashed.parts.length; index++) {
      const part = hashed.parts[index]
      const pointerPart = parts[index]
      if (index > 0) {
        const refreshed = await releases.getReleaseByTag(
          repository,
          releaseTag,
          signal
        )
        if (refreshed === null) {
          throw new Error(
            `The release tagged “${releaseTag}” disappeared while its parts were uploading.`
          )
        }
        ensureCheapLfsBucketTag(refreshed, releaseTag)
        currentRelease = refreshed
      }
      const review = releases.createMutationReview(repository, currentRelease)
      const upload = await releases.uploadAsset(
        repository,
        review,
        options.absoluteFilePath,
        pointerPart.name,
        null,
        signal ?? new AbortController().signal,
        aggregateProgress(
          onProgress,
          transferred,
          hashed.sizeInBytes,
          part.length
        ),
        { offset: part.offset, length: part.length }
      )
      // Record ownership before validating the response. A digest or byte-count
      // mismatch still means GitHub accepted an asset that this attempt owns.
      attemptAssets.push(upload.asset)
      ensureRawUploadMatchesHash(upload, part.length, part.sha256)
      firstAsset ??= upload.asset
      transferred += part.length
    }

    onStage?.('verifying')
    await ensureSourceStillMatchesHash(
      fs,
      options.absoluteFilePath,
      hashed.sizeInBytes,
      hashed.sha256,
      signal
    )
    await fs.writePointer(
      join(repository.path, trackedRelativePath),
      pointerText
    )

    if (firstAsset === undefined) {
      throw new Error('Cheap LFS uploaded no parts for this file.')
    }
    return { pointer, asset: firstAsset, releaseId: release.id }
  } catch (error) {
    return rethrowAfterAttemptAssetCleanup(
      error,
      releases,
      repository,
      releaseTag,
      preexistingAssetIds,
      attemptAssets
    )
  }
}

/** Release methods used by the browser-assisted manual fallback. */
export type ICheapLfsManualReleasesGateway = ICheapLfsReleasesGateway

/** One exact release asset and eventual pointer in a manual batch. */
export interface ICheapLfsManualFilePlan {
  readonly absoluteFilePath: string
  readonly trackedRelativePath: string
  readonly pointer: ICheapLfsPointer
  readonly pointerText: string
  readonly assetName: string
  readonly sizeInBytes: number
  readonly sha256: string
}

/** One release rendezvous containing every remaining selected large file. */
export interface ICheapLfsManualPinPlan {
  readonly release: IGitHubRelease
  readonly files: ReadonlyArray<ICheapLfsManualFilePlan>
  readonly preexistingAssetIds: ReadonlySet<number>
}

async function listAllCheapLfsReleaseAssets(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  releaseId: number,
  signal?: AbortSignal
): Promise<ReadonlyArray<IGitHubReleaseAsset>> {
  const assets = new Array<IGitHubReleaseAsset>()
  const assetIds = new Set<number>()
  let page = 1
  for (let request = 0; request < GitHubReleaseAssetMaximumPages; request++) {
    const result = await releases.listAssets(
      repository,
      releaseId,
      page,
      signal
    )
    if (result.page !== page) {
      throw new Error('GitHub returned an unexpected release asset page.')
    }
    for (const asset of result.assets) {
      if (assetIds.has(asset.id)) {
        throw new Error('GitHub returned duplicate release asset ids.')
      }
      assetIds.add(asset.id)
      assets.push(asset)
    }
    if (result.capped && assets.length !== GitHubReleaseAssetMaximumCount) {
      throw new Error(
        'This release has too many assets to count safely because GitHub capped its inventory early.'
      )
    }
    if (assets.length > GitHubReleaseAssetMaximumCount) {
      throw new Error('GitHub returned too many assets for one release.')
    }
    if (result.nextPage === null) {
      return assets
    }
    if (result.nextPage <= page) {
      throw new Error('GitHub returned an invalid release asset page.')
    }
    page = result.nextPage
  }
  throw new Error(
    'This release has too many assets to count safely because GitHub capped its inventory early.'
  )
}

interface ICheapLfsReleaseBucket {
  readonly release: IGitHubRelease
  readonly releaseTag: string
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
  readonly index: number
}

function cheapLfsReleaseBucketTag(baseTag: string, index: number): string {
  return validateGitHubReleaseTag(index === 1 ? baseTag : `${baseTag}-${index}`)
}

function ensureCheapLfsReleaseFamilyTag(baseTag: string): void {
  try {
    cheapLfsReleaseBucketTag(baseTag, 1)
    cheapLfsReleaseBucketTag(baseTag, CheapLfsMaximumReleaseBuckets)
  } catch {
    throw new Error(
      'The cheap LFS release tag is too long to reserve safe rollover suffixes.'
    )
  }
}

function cheapLfsReleaseBucketName(
  configuredName: string | undefined,
  releaseTag: string
): string {
  // Reuse an explicitly configured display name. Appending a bucket suffix can
  // push an otherwise valid 1,024-character name over GitHub's API limit; the
  // exact derived tag already identifies the bucket unambiguously.
  return configuredName ?? releaseTag
}

function ensureCheapLfsBucketTag(
  release: IGitHubRelease,
  expectedTag: string
): void {
  if (release.tagName !== expectedTag) {
    throw new Error(
      `GitHub returned release “${release.tagName}” while cheap LFS requested “${expectedTag}”.`
    )
  }
}

function mergeCheapLfsReleaseAssetSnapshots(
  release: IGitHubRelease,
  listedAssets: ReadonlyArray<IGitHubReleaseAsset>
): ReadonlyArray<IGitHubReleaseAsset> {
  const byId = new Map(listedAssets.map(asset => [asset.id, asset]))
  // A GET-by-tag preview and the paginated inventory are separate provider
  // snapshots. Retaining a preview-only id is conservative under concurrent
  // deletion and also prevents a stale name from being reused accidentally.
  for (const asset of release.assets) {
    if (!byId.has(asset.id)) {
      byId.set(asset.id, asset)
    }
  }
  return [...byId.values()]
}

/**
 * Choose the latest contiguous release bucket with enough room for one atomic
 * cheap-LFS object group. Exponential and binary exact-tag probes avoid paging
 * every historical bucket on each upload. Buckets use `<base>`, `<base>-2`,
 * `<base>-3`, and never exceed GitHub's documented 1,000-asset capacity.
 */
async function allocateCheapLfsReleaseBucket(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  baseTag: string,
  configuredName: string | undefined,
  requiredAssetCount: number,
  createRelease: (
    releaseTag: string,
    releaseName: string
  ) => Promise<IGitHubRelease>,
  signal?: AbortSignal
): Promise<ICheapLfsReleaseBucket> {
  if (
    !Number.isSafeInteger(requiredAssetCount) ||
    requiredAssetCount < 1 ||
    requiredAssetCount > GitHubReleaseAssetMaximumCount
  ) {
    throw new Error(
      `One cheap LFS object group must use between 1 and ${GitHubReleaseAssetMaximumCount} release assets.`
    )
  }

  const releaseCache = new Map<number, IGitHubRelease | null>()
  const releaseAt = async (index: number): Promise<IGitHubRelease | null> => {
    if (signal?.aborted) {
      throw abortError('Cheap LFS release preparation canceled.')
    }
    const releaseTag = cheapLfsReleaseBucketTag(baseTag, index)
    if (!releaseCache.has(index)) {
      releaseCache.set(
        index,
        await releases.getReleaseByTag(repository, releaseTag, signal)
      )
    }
    const release = releaseCache.get(index) ?? null
    if (release !== null) {
      ensureCheapLfsBucketTag(release, releaseTag)
    }
    return release
  }

  let activeIndex = 1
  const firstRelease = await releaseAt(1)
  let derivedTagsSupported = true
  try {
    cheapLfsReleaseBucketTag(baseTag, 2)
  } catch {
    derivedTagsSupported = false
  }
  if (firstRelease !== null) {
    const firstListedAssets = await listAllCheapLfsReleaseAssets(
      releases,
      repository,
      firstRelease.id,
      signal
    )
    const firstAssets = mergeCheapLfsReleaseAssetSnapshots(
      firstRelease,
      firstListedAssets
    )
    if (
      firstAssets.length <=
      GitHubReleaseAssetMaximumCount - requiredAssetCount
    ) {
      return {
        release: firstRelease,
        releaseTag: cheapLfsReleaseBucketTag(baseTag, 1),
        assets: firstAssets,
        index: 1,
      }
    }
    activeIndex = 2
  }
  if (
    firstRelease !== null &&
    derivedTagsSupported &&
    (await releaseAt(2)) !== null
  ) {
    let lower = 2
    let upper = 4
    while (upper <= CheapLfsMaximumReleaseBuckets) {
      const candidate = await releaseAt(upper)
      if (candidate === null) {
        break
      }
      lower = upper
      if (lower === CheapLfsMaximumReleaseBuckets) {
        break
      }
      upper = Math.min(CheapLfsMaximumReleaseBuckets, upper * 2)
    }
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2)
      if ((await releaseAt(middle)) === null) {
        upper = middle
      } else {
        lower = middle
      }
    }
    activeIndex = lower
  }

  for (
    let index = activeIndex;
    index <= CheapLfsMaximumReleaseBuckets;
    index++
  ) {
    if (signal?.aborted) {
      throw abortError('Cheap LFS release preparation canceled.')
    }
    const releaseTag = cheapLfsReleaseBucketTag(baseTag, index)
    const releaseName = cheapLfsReleaseBucketName(configuredName, releaseTag)
    let release = await releaseAt(index)
    if (release === null) {
      try {
        release = await createRelease(releaseTag, releaseName)
      } catch (createError) {
        // A second operation may have claimed the same missing bucket after our
        // lookup. Re-read once; otherwise retain the provider's original error.
        release = await releases.getReleaseByTag(repository, releaseTag, signal)
        if (release === null) {
          throw createError
        }
      }
      // Keep provider identity validation outside the conflict-recovery catch:
      // a successful create that returns the wrong tag is never a conflict.
      ensureCheapLfsBucketTag(release, releaseTag)
      releaseCache.set(index, release)
    }

    const listedAssets = await listAllCheapLfsReleaseAssets(
      releases,
      repository,
      release.id,
      signal
    )
    const assets = mergeCheapLfsReleaseAssetSnapshots(release, listedAssets)
    if (assets.length <= GitHubReleaseAssetMaximumCount - requiredAssetCount) {
      return { release, releaseTag, assets, index }
    }
  }

  throw new Error(
    `Cheap LFS could not find room after checking ${CheapLfsMaximumReleaseBuckets} release buckets.`
  )
}

/**
 * Prepare one browser-upload batch without mutating the working tree. Every
 * selected source must fit one asset under 2 GiB; the complete batch shares a
 * single paginated preexisting snapshot and reserves names across all files.
 */
export async function planCheapLfsManualUpload(
  releases: ICheapLfsManualReleasesGateway,
  repository: Repository,
  account: Account,
  options: ReadonlyArray<ICheapLfsPinOptions>,
  signal?: AbortSignal,
  onStage?: (stage: CheapLfsPinStage) => void,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem
): Promise<ICheapLfsManualPinPlan> {
  if (options.length === 0) {
    throw new Error('Cheap LFS has no files to prepare for manual upload.')
  }
  if (options.length > GitHubReleaseAssetMaximumCount) {
    throw new Error(
      `One manual cheap LFS batch can contain at most ${GitHubReleaseAssetMaximumCount} files.`
    )
  }
  const baseReleaseTag = options[0].releaseTag
  if (options.some(candidate => candidate.releaseTag !== baseReleaseTag)) {
    throw new Error('A manual cheap LFS batch must use one release tag.')
  }
  ensureCheapLfsReleaseFamilyTag(baseReleaseTag)
  ensureReleasesAccount(repository, account)
  onStage?.('hashing')
  const hashedFiles = new Array<{
    readonly options: ICheapLfsPinOptions
    readonly trackedRelativePath: string
    readonly baseName: string
    readonly hashed: Awaited<ReturnType<ICheapLfsFileSystem['hashFileParts']>>
  }>()
  for (const candidate of options) {
    const trackedRelativePath = validateCheapLfsTrackedPath(
      candidate.trackedRelativePath
    )
    if (trackedRelativePath === null) {
      throw new Error(
        'Choose a safe repository-relative path without parent traversal or Git metadata to track with cheap LFS.'
      )
    }
    const baseName = normalizeGitHubReleaseAssetName(
      basename(candidate.absoluteFilePath)
    )
    const sourceSize = await fs.statSize(candidate.absoluteFilePath)
    preflightProjectedPointer(sourceSize, baseReleaseTag, baseName)
    if (sourceSize > CHEAP_LFS_PART_SIZE_BYTES) {
      throw new Error(
        `“${trackedRelativePath}” needs multipart assets. Manual cheap LFS upload currently supports files under 2 GiB; use the automatic upload for this file.`
      )
    }
    const hashed = await fs.hashFileParts(
      candidate.absoluteFilePath,
      CHEAP_LFS_PART_SIZE_BYTES,
      signal
    )
    if (hashed.parts.length !== 1) {
      throw new Error(
        `“${trackedRelativePath}” cannot be represented as one manual cheap LFS release asset.`
      )
    }
    hashedFiles.push({
      options: candidate,
      trackedRelativePath,
      baseName,
      hashed,
    })
  }

  onStage?.('release')
  const bucket = await allocateCheapLfsReleaseBucket(
    releases,
    repository,
    baseReleaseTag,
    options[0].releaseName,
    hashedFiles.length,
    async (releaseTag, releaseName) =>
      await releases.createDraft(
        repository,
        {
          tagName: releaseTag,
          targetCommitish: await releaseTargetCommitish(
            repository,
            options[0],
            fs
          ),
          name: releaseName,
          body: '',
          prerelease: false,
        },
        signal
      ),
    signal
  )
  const { release, releaseTag, assets: allAssets } = bucket
  const preexistingAssetIds = new Set(allAssets.map(asset => asset.id))
  const reservedNames = new Set(allAssets.map(asset => asset.name))
  const files = hashedFiles.map(file => {
    const assetName = dedupeAssetName(
      file.baseName,
      allAssets,
      file.hashed.sha256,
      reservedNames
    )
    reservedNames.add(assetName)
    preflightProjectedPointer(
      file.hashed.sizeInBytes,
      releaseTag,
      file.baseName
    )
    const pointer: ICheapLfsPointer = {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag,
      assetName,
      sizeInBytes: file.hashed.sizeInBytes,
      sha256: file.hashed.sha256,
    }
    const pointerText = serializeCheapLfsPointer(pointer)
    ensurePointerFitsOnDisk(pointerText)
    return {
      absoluteFilePath: file.options.absoluteFilePath,
      trackedRelativePath: file.trackedRelativePath,
      pointer,
      pointerText,
      assetName,
      sizeInBytes: file.hashed.sizeInBytes,
      sha256: file.hashed.sha256,
    }
  })
  return { release, files, preexistingAssetIds }
}

function resolveReleaseAsset(
  release: IGitHubRelease,
  name: string,
  releaseTag: string
): IGitHubReleaseAsset {
  const asset = release.assets.find(candidate => candidate.name === name)
  if (asset === undefined) {
    throw new Error(`Release “${releaseTag}” has no asset named “${name}”.`)
  }
  if (!isUploadedGitHubReleaseAsset(asset)) {
    throw new Error(
      `Release “${releaseTag}” has not finished uploading asset “${name}”.`
    )
  }
  return asset
}

/**
 * Download a single-asset pointer's asset to a sibling temp, verify its streamed
 * SHA-256 and size against the pointer, and atomically rename it over the
 * tracked path. Any failure deletes the temp file and leaves the pointer intact.
 */
async function materializeSingleAsset(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  release: IGitHubRelease,
  pointer: ICheapLfsPointer,
  trackedPath: string,
  signal: AbortSignal | undefined,
  onProgress:
    | ((progress: IGitHubReleaseTransferProgressEvent) => void)
    | undefined,
  fs: ICheapLfsFileSystem
): Promise<ICheapLfsMaterializeResult> {
  const asset = resolveReleaseAsset(
    release,
    pointer.assetName,
    pointer.releaseTag
  )
  const temporaryPath = fs.temporaryPathFor(trackedPath)
  const download = await releases.downloadAsset(
    repository,
    release.id,
    asset,
    temporaryPath,
    signal ?? new AbortController().signal,
    aggregateProgress(onProgress, 0, pointer.sizeInBytes, pointer.sizeInBytes)
  )
  try {
    const verified = await fs.hashFile(download.path, signal)
    if (
      verified.sha256 !== pointer.sha256 ||
      verified.sizeInBytes !== pointer.sizeInBytes
    ) {
      throw new Error(
        'The downloaded asset does not match the cheap LFS pointer. The pointer was left in place.'
      )
    }
    await fs.replaceFile(download.path, trackedPath)
    return { path: trackedPath, bytes: verified.sizeInBytes }
  } catch (error) {
    await fs.removeFile(download.path)
    throw error
  }
}

/**
 * Reassemble a split pointer. Every part asset is resolved by name first, then
 * each is downloaded to its own sibling temp and verified against the pointer's
 * part digest and size. The verified parts are concatenated in order into one
 * assembled temp while its whole-file SHA-256 and size are streamed; only when
 * both match the pointer is the assembled file atomically renamed over the
 * tracked path. Every temp is removed on success or failure, and any
 * verification failure leaves the committed pointer untouched.
 */
async function materializeMultiPart(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  release: IGitHubRelease,
  pointer: ICheapLfsPointer,
  parts: ReadonlyArray<ICheapLfsPointerPart>,
  trackedPath: string,
  signal: AbortSignal | undefined,
  onProgress:
    | ((progress: IGitHubReleaseTransferProgressEvent) => void)
    | undefined,
  fs: ICheapLfsFileSystem
): Promise<ICheapLfsMaterializeResult> {
  // Resolve every part up front so a missing one fails before any download.
  const resolved = parts.map(part => {
    const asset = resolveReleaseAsset(release, part.name, pointer.releaseTag)
    const expectedStoredSize = part.deflatedSizeInBytes ?? part.sizeInBytes
    if (asset.sizeInBytes !== expectedStoredSize) {
      throw new Error(
        'A cheap LFS release asset size does not match its pointer. The pointer was left in place.'
      )
    }
    return { part, asset }
  })
  const partPaths = new Array<string>()
  const expandedPaths = new Array<string>()
  const assemblySources = new Array<string>()
  let assembledPath: string | null = null
  let assembledConsumed = false
  try {
    let transferred = 0
    for (const { part, asset } of resolved) {
      const partPath = fs.temporaryPathFor(trackedPath)
      partPaths.push(partPath)
      const download = await releases.downloadAsset(
        repository,
        release.id,
        asset,
        partPath,
        signal ?? new AbortController().signal,
        aggregateProgress(
          onProgress,
          transferred,
          pointer.sizeInBytes,
          part.sizeInBytes
        )
      )
      let verificationPath = download.path
      if (part.deflatedSizeInBytes !== undefined) {
        if (
          download.bytes !== part.deflatedSizeInBytes ||
          fs.decompressFile === undefined
        ) {
          throw new Error(
            'A compressed cheap LFS part does not match the pointer. The pointer was left in place.'
          )
        }
        const expandedPath = fs.temporaryPathFor(trackedPath)
        expandedPaths.push(expandedPath)
        await fs.decompressFile(
          download.path,
          expandedPath,
          part.sizeInBytes,
          signal
        )
        verificationPath = expandedPath
      }
      const verified = await fs.hashFile(verificationPath, signal)
      if (
        verified.sha256 !== part.sha256 ||
        verified.sizeInBytes !== part.sizeInBytes
      ) {
        throw new Error(
          'A downloaded cheap LFS part does not match the pointer. The pointer was left in place.'
        )
      }
      assemblySources.push(verificationPath)
      transferred += part.sizeInBytes
    }
    assembledPath = fs.temporaryPathFor(trackedPath)
    const assembled = await fs.assembleParts(
      assemblySources,
      assembledPath,
      signal
    )
    if (
      assembled.sha256 !== pointer.sha256 ||
      assembled.sizeInBytes !== pointer.sizeInBytes
    ) {
      throw new Error(
        'The reassembled cheap LFS file does not match the pointer. The pointer was left in place.'
      )
    }
    await fs.replaceFile(assembledPath, trackedPath)
    assembledConsumed = true
    return { path: trackedPath, bytes: assembled.sizeInBytes }
  } finally {
    for (const partPath of partPaths) {
      await fs.removeFile(partPath)
    }
    for (const expandedPath of expandedPaths) {
      await fs.removeFile(expandedPath)
    }
    if (assembledPath !== null && !assembledConsumed) {
      await fs.removeFile(assembledPath)
    }
  }
}

/**
 * Replace a committed pointer with its real bytes.
 *
 * Parses the pointer and finds the release it names. A single-asset pointer
 * downloads its one asset, verifies it, and renames it into place. A split
 * pointer downloads and verifies each part, concatenates them in order, verifies
 * the reassembled whole against the pointer, and only then renames it into
 * place. Any failure deletes every temp file and leaves the pointer untouched.
 */
export async function materializePointer(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  account: Account,
  trackedRelativePath: string,
  signal?: AbortSignal,
  onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem
): Promise<ICheapLfsMaterializeResult> {
  const relativePath = validateCheapLfsTrackedPath(trackedRelativePath)
  if (relativePath === null) {
    throw new Error(
      'Choose a safe repository-relative path without parent traversal or Git metadata to materialize.'
    )
  }
  ensureReleasesAccount(repository, account)

  const trackedPath = join(repository.path, relativePath)
  const pointer = parseCheapLfsPointer(await fs.readPointerText(trackedPath))
  if (pointer === null) {
    throw new Error('This file is not a cheap LFS pointer.')
  }

  const release = await releases.getReleaseByTag(
    repository,
    pointer.releaseTag,
    signal
  )
  if (release === null) {
    throw new Error(
      `No release tagged “${pointer.releaseTag}” holds this pointer's asset.`
    )
  }

  if (pointer.parts === undefined) {
    return await materializeSingleAsset(
      releases,
      repository,
      release,
      pointer,
      trackedPath,
      signal,
      onProgress,
      fs
    )
  }
  return await materializeMultiPart(
    releases,
    repository,
    release,
    pointer,
    pointer.parts,
    trackedPath,
    signal,
    onProgress,
    fs
  )
}

/**
 * List the committed pointers in a repository's working tree. The scan is
 * bounded (skips `.git`/`node_modules` and other heavy directories, caps the
 * entries walked and the pointers returned) and only sniffs each file's first
 * {@link CheapLfsSniffBytes} bytes, so it stays cheap even on large trees.
 */
export async function listCheapLfsPointers(
  repository: Repository,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem
): Promise<ReadonlyArray<ICheapLfsPointerEntry>> {
  const candidates = await fs.scanPointerCandidates(repository.path)
  const entries = new Array<ICheapLfsPointerEntry>()
  for (const candidate of candidates) {
    const pointer = parseCheapLfsPointer(candidate.text)
    if (pointer !== null) {
      entries.push({ relativePath: candidate.relativePath, pointer })
    }
  }
  return entries
}

/**
 * Whether the automatic materialize-on-detect flow should run: the per-repo
 * preference must be enabled (its back-compat default is on) and a
 * Releases-capable account must be selected for the repository. Pure so the
 * detector's gating is unit-testable without an app store.
 */
export function shouldAutoMaterializeCheapLfs(
  autoMaterializeEnabled: boolean,
  releasesAccount: Account | null
): boolean {
  return autoMaterializeEnabled && releasesAccount !== null
}

/**
 * Whether the automatic pin-large-files-on-commit flow should run: the per-repo
 * preference must be enabled (its back-compat default is on) and the repository
 * must have a Releases-capable account available (excludes non-GitHub repos and
 * signed-out or unsupported endpoints). Pure so the commit gate is unit-testable
 * without an app store.
 */
export function shouldAutoPinLargeFilesOnCommit(
  autoPinEnabled: boolean,
  availability: GitHubReleasesAvailability
): boolean {
  return autoPinEnabled && availability === 'available'
}

/** Cumulative progress across a batch materialize or auto-pin of many files. */
export interface ICheapLfsBatchProgress {
  /** Files whose transfer has finished (succeeded or failed). */
  readonly completedFiles: number
  /** Total files in the batch. */
  readonly totalFiles: number
  /** The file currently transferring, or `null` between files. */
  readonly currentPath: string | null
  /** Bytes transferred so far across the whole batch. */
  readonly transferredBytes: number
  /** Sum of every file's byte size in the batch. */
  readonly totalBytes: number
}

/** Observable automatic and browser-assisted cheap-LFS commit stages. */
export type CheapLfsAutoPinPhase =
  | CheapLfsPinStage
  | 'preparing'
  | 'manual-preparing'
  | 'manual-waiting'
  | 'manual-verifying'
  | 'manual-detected'

/** Batch progress with enough phase detail for honest commit UI messaging. */
export interface ICheapLfsAutoPinProgress extends ICheapLfsBatchProgress {
  readonly phase: CheapLfsAutoPinPhase
}

/** One pointer that could not be materialized during a batch. */
export interface ICheapLfsMaterializeFailure {
  readonly relativePath: string
  readonly message: string
}

/** The outcome of a batch materialize; never surfaced as a thrown error. */
export interface ICheapLfsBatchMaterializeResult {
  readonly materialized: ReadonlyArray<ICheapLfsMaterializeResult>
  readonly failures: ReadonlyArray<ICheapLfsMaterializeFailure>
  readonly totalBytes: number
  /** True when the batch stopped early because its signal was aborted. */
  readonly canceled: boolean
}

/**
 * Materialize a set of committed pointers in sequence under one shared abort
 * signal, reporting cumulative progress over the whole batch. A per-pointer
 * failure is recorded and the remaining pointers still run; only cancellation
 * (an `AbortError`) stops the batch early. This never throws — the caller reads
 * the returned summary — so it is safe to drive from a fire-and-forget hook.
 */
export async function materializeCheapLfsPointers(
  entries: ReadonlyArray<ICheapLfsPointerEntry>,
  materialize: (
    relativePath: string,
    signal: AbortSignal,
    onProgress: (progress: IGitHubReleaseTransferProgressEvent) => void
  ) => Promise<ICheapLfsMaterializeResult>,
  signal: AbortSignal,
  onProgress?: (progress: ICheapLfsBatchProgress) => void
): Promise<ICheapLfsBatchMaterializeResult> {
  const totalBytes = entries.reduce(
    (sum, entry) => sum + entry.pointer.sizeInBytes,
    0
  )
  const materialized = new Array<ICheapLfsMaterializeResult>()
  const failures = new Array<ICheapLfsMaterializeFailure>()
  let completedBytes = 0
  let completedFiles = 0
  let canceled = false

  for (const entry of entries) {
    if (signal.aborted) {
      canceled = true
      break
    }
    const transferredBefore = completedBytes
    try {
      const result = await materialize(entry.relativePath, signal, progress =>
        onProgress?.({
          completedFiles,
          totalFiles: entries.length,
          currentPath: entry.relativePath,
          transferredBytes: transferredBefore + progress.transferredBytes,
          totalBytes,
        })
      )
      materialized.push(result)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        canceled = true
        break
      }
      failures.push({
        relativePath: entry.relativePath,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    completedBytes += entry.pointer.sizeInBytes
    completedFiles++
    onProgress?.({
      completedFiles,
      totalFiles: entries.length,
      currentPath: null,
      transferredBytes: completedBytes,
      totalBytes,
    })
  }

  return { materialized, failures, totalBytes, canceled }
}

/** One selected file large enough to require an automatic pin before commit. */
export interface ICheapLfsAutoPinTarget {
  readonly relativePath: string
  readonly absolutePath: string
  readonly sizeInBytes: number
}

/** One file pinned automatically as part of a commit. */
export interface ICheapLfsAutoPinnedFile {
  readonly relativePath: string
  readonly sizeInBytes: number
  readonly result: ICheapLfsPinResult
}

/** The disk and transfer seams the auto-pin-on-commit flow depends on. */
export interface ICheapLfsAutoPinDependencies {
  /** Byte size of a working-tree file (stat). */
  readonly statSize: (absolutePath: string) => Promise<number>
  /** First bytes of a working-tree file, used to classify it as a pointer. */
  readonly readPointerText: (absolutePath: string) => Promise<string>
  /** Upload one file as a release asset and replace it with a pointer. */
  readonly pin: (
    target: ICheapLfsAutoPinTarget,
    signal: AbortSignal | undefined,
    onProgress: (progress: IGitHubReleaseTransferProgressEvent) => void,
    onStage?: (stage: CheapLfsAutoPinPhase) => void
  ) => Promise<ICheapLfsPinResult>
}

/**
 * Choose which of `selectedRelativePaths` must be pinned before committing:
 * every selected file strictly larger than `thresholdBytes` that is not already
 * a cheap-LFS pointer. Files at or under the threshold, files that cannot be
 * stat'd (deletions, vanished paths), and files that already hold a committed
 * pointer are skipped.
 */
export async function selectCheapLfsAutoPinTargets(
  repository: Repository,
  selectedRelativePaths: ReadonlyArray<string>,
  thresholdBytes: number,
  deps: Pick<ICheapLfsAutoPinDependencies, 'statSize' | 'readPointerText'>
): Promise<ReadonlyArray<ICheapLfsAutoPinTarget>> {
  const targets = new Array<ICheapLfsAutoPinTarget>()
  for (const relativePath of selectedRelativePaths) {
    const validated = validateCheapLfsTrackedPath(relativePath)
    if (validated === null) {
      continue
    }
    const absolutePath = join(repository.path, validated)
    let sizeInBytes: number
    try {
      sizeInBytes = await deps.statSize(absolutePath)
    } catch {
      continue
    }
    if (sizeInBytes <= thresholdBytes) {
      continue
    }
    // A committed pointer is tiny, so an over-threshold file is almost never one
    // — but classify anyway so a mis-sized pointer is never re-pinned.
    try {
      if (
        parseCheapLfsPointer(await deps.readPointerText(absolutePath)) !== null
      ) {
        continue
      }
    } catch {
      // Unreadable as bounded text means it is certainly not a pointer; pin it.
    }
    targets.push({ relativePath: validated, absolutePath, sizeInBytes })
  }
  return targets
}

/**
 * Pin every over-threshold selected file before a commit so the working tree
 * holds committable pointers instead of unpushable large binaries. Pins run in
 * sequence; the FIRST failure re-throws so the caller can abort the commit
 * without ever committing a half-pinned tree. Returns the files it pinned, in
 * order (empty when nothing qualified). The caller must re-read status after a
 * non-empty result so the committed content is the pointer, not the binary.
 */
export async function autoPinLargeFilesForCommit(
  repository: Repository,
  selectedRelativePaths: ReadonlyArray<string>,
  thresholdBytes: number,
  deps: ICheapLfsAutoPinDependencies,
  signal?: AbortSignal,
  onProgress?: (progress: ICheapLfsAutoPinProgress) => void,
  onPinned?: (file: ICheapLfsAutoPinnedFile) => void
): Promise<ReadonlyArray<ICheapLfsAutoPinnedFile>> {
  const targets = await selectCheapLfsAutoPinTargets(
    repository,
    selectedRelativePaths,
    thresholdBytes,
    deps
  )
  const totalBytes = targets.reduce(
    (sum, target) => sum + target.sizeInBytes,
    0
  )
  const pinned = new Array<ICheapLfsAutoPinnedFile>()
  let completedBytes = 0
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index]
    const transferredBefore = completedBytes
    // Hashing and release preparation happen inside `pin` before the transfer
    // callback can fire. Emit this first so a multi-gigabyte preprocessing pass
    // never masquerades as an ordinary Git commit in the UI.
    onProgress?.({
      phase: 'preparing',
      completedFiles: index,
      totalFiles: targets.length,
      currentPath: target.relativePath,
      transferredBytes: transferredBefore,
      totalBytes,
    })
    const emit = (phase: CheapLfsAutoPinPhase, transferred = 0) =>
      onProgress?.({
        phase,
        completedFiles: index,
        totalFiles: targets.length,
        currentPath: target.relativePath,
        transferredBytes: transferredBefore + transferred,
        totalBytes,
      })
    const result = await deps.pin(
      target,
      signal,
      progress => emit('uploading', progress.transferredBytes),
      stage => emit(stage)
    )
    const pinnedFile = {
      relativePath: target.relativePath,
      sizeInBytes: target.sizeInBytes,
      result,
    }
    pinned.push(pinnedFile)
    onPinned?.(pinnedFile)
    completedBytes += target.sizeInBytes
    onProgress?.({
      phase: 'uploading',
      completedFiles: index + 1,
      totalFiles: targets.length,
      currentPath: null,
      transferredBytes: completedBytes,
      totalBytes,
    })
  }
  return pinned
}
