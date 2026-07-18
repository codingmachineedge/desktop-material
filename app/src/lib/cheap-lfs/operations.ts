import { createHash, randomBytes } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { open, readdir, rename, stat, unlink, writeFile } from 'fs/promises'
import { Transform } from 'stream'
import { finished, pipeline } from 'stream/promises'
import { basename, join } from 'path'
import { Account } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
  IGitHubReleaseDraft,
  normalizeGitHubReleaseAssetName,
} from '../github-releases'
import {
  IGitHubReleaseAssetUploadRange,
  IGitHubReleaseTransferProgressEvent,
} from '../github-release-transfer'
import {
  getGitHubReleasesAccount,
  GitHubReleasesAvailability,
  GitHubReleasesError,
  IGitHubReleaseMutationReview,
} from '../stores/github-releases-store'
import {
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
/** Only the first bytes of a file are read to classify it as a pointer. */
const CheapLfsSniffBytes = 4096
/**
 * The whole committed pointer is read up to this bound before parsing. A split
 * pointer for a very large file lists one line per part, so this is well above
 * the sniff size yet still far below any real binary.
 */
const CheapLfsMaximumPointerBytes = 512 * 1024
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
  ): Promise<{ readonly asset: IGitHubReleaseAsset; readonly bytes: number }>
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
  scanPointerCandidates(
    root: string
  ): Promise<ReadonlyArray<ICheapLfsPointerCandidate>>
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

async function readBoundedText(
  path: string,
  maximumBytes: number
): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maximumBytes)
    const { bytesRead } = await handle.read(buffer, 0, maximumBytes, 0)
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

/** The real-OS disk seam used unless a caller injects a fake. */
export const defaultCheapLfsFileSystem: ICheapLfsFileSystem = {
  hashFile: hashFileSha256,
  hashFileParts: hashFilePartsSha256,
  statSize: async path => (await stat(path)).size,
  readPointerText: path => readBoundedText(path, CheapLfsMaximumPointerBytes),
  // Written with the pointer's own `\n` bytes; never routed through the
  // autocrlf-aware .gitignore writer so the committed pointer is byte-stable.
  writePointer: (path, text) => writeFile(path, text, 'utf8'),
  replaceFile: (from, to) => rename(from, to),
  removeFile: async path => {
    await unlink(path).catch(() => undefined)
  },
  temporaryPathFor: path =>
    `${path}.cheeplfs-${randomBytes(8).toString('hex')}.tmp`,
  assembleParts: assemblePartsOnDisk,
  scanPointerCandidates: scanPointerCandidatesFromDisk,
}

function ensureReleasesAccount(repository: Repository, account: Account): void {
  if (getGitHubReleasesAccount(repository, [account]) === null) {
    throw new GitHubReleasesError(
      'authentication',
      'Sign in with the account selected for this repository to use cheap LFS.'
    )
  }
}

/** Append a short content hash before the extension to dodge a name clash. */
function dedupeAssetName(
  name: string,
  assets: ReadonlyArray<IGitHubReleaseAsset>,
  sha256: string
): string {
  if (!assets.some(asset => asset.name === name)) {
    return name
  }
  const short = sha256.slice(0, 7)
  const dot = name.lastIndexOf('.')
  const deduped =
    dot <= 0
      ? `${name}-${short}`
      : `${name.slice(0, dot)}-${short}${name.slice(dot)}`
  return normalizeGitHubReleaseAssetName(deduped)
}

/**
 * Pick a base name whose `<base>.partNNN` family cannot collide with any asset
 * already on the release. If any existing asset already uses this base's part
 * prefix, a short content hash is appended so the whole family is fresh.
 */
function dedupeMultiPartBaseName(
  name: string,
  assets: ReadonlyArray<IGitHubReleaseAsset>,
  sha256: string
): string {
  if (!assets.some(asset => asset.name.startsWith(`${name}.part`))) {
    return name
  }
  const short = sha256.slice(0, 7)
  const dot = name.lastIndexOf('.')
  const deduped =
    dot <= 0
      ? `${name}-${short}`
      : `${name.slice(0, dot)}-${short}${name.slice(dot)}`
  return normalizeGitHubReleaseAssetName(deduped)
}

/** The `<base>.partNNN` name for one part, zero-padded to a stable width. */
function partAssetName(base: string, index: number, count: number): string {
  const width = Math.max(3, String(count).length)
  return normalizeGitHubReleaseAssetName(
    `${base}.part${String(index + 1).padStart(width, '0')}`
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
  wholeSize: number
): ((progress: IGitHubReleaseTransferProgressEvent) => void) | undefined {
  if (onProgress === undefined) {
    return undefined
  }
  return progress =>
    onProgress({
      ...progress,
      transferredBytes: transferredBefore + progress.transferredBytes,
      totalBytes: wholeSize,
    })
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
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem
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

  const hashed = await fs.hashFileParts(
    options.absoluteFilePath,
    CHEAP_LFS_PART_SIZE_BYTES,
    signal
  )
  const existing = await releases.getReleaseByTag(
    repository,
    options.releaseTag,
    signal
  )
  const release =
    existing ??
    (await releases.createDraft(
      repository,
      {
        tagName: options.releaseTag,
        targetCommitish: options.targetCommitish ?? 'main',
        name: options.releaseName ?? options.releaseTag,
        body: '',
        prerelease: false,
      },
      signal
    ))

  const baseName = normalizeGitHubReleaseAssetName(
    basename(options.absoluteFilePath)
  )

  if (hashed.parts.length <= 1) {
    const assetName = dedupeAssetName(baseName, release.assets, hashed.sha256)
    const review = releases.createMutationReview(repository, release)
    const upload = await releases.uploadAsset(
      repository,
      review,
      options.absoluteFilePath,
      assetName,
      null,
      signal ?? new AbortController().signal,
      onProgress
    )
    const pointer: ICheapLfsPointer = {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag: options.releaseTag,
      assetName,
      sizeInBytes: hashed.sizeInBytes,
      sha256: hashed.sha256,
    }
    await fs.writePointer(
      join(repository.path, trackedRelativePath),
      serializeCheapLfsPointer(pointer)
    )
    return { pointer, asset: upload.asset, releaseId: release.id }
  }

  const partBaseName = dedupeMultiPartBaseName(
    baseName,
    release.assets,
    hashed.sha256
  )
  const parts = new Array<ICheapLfsPointerPart>()
  let firstAsset: IGitHubReleaseAsset | undefined
  let transferred = 0
  // The release snapshot is refreshed before each part: an earlier part adds an
  // asset, so the mutation review must reflect the release's current state.
  let currentRelease = release
  for (let index = 0; index < hashed.parts.length; index++) {
    const part = hashed.parts[index]
    const name = partAssetName(partBaseName, index, hashed.parts.length)
    if (index > 0) {
      const refreshed = await releases.getReleaseByTag(
        repository,
        options.releaseTag,
        signal
      )
      if (refreshed === null) {
        throw new Error(
          `The release tagged “${options.releaseTag}” disappeared while its parts were uploading.`
        )
      }
      currentRelease = refreshed
    }
    const review = releases.createMutationReview(repository, currentRelease)
    const upload = await releases.uploadAsset(
      repository,
      review,
      options.absoluteFilePath,
      name,
      null,
      signal ?? new AbortController().signal,
      aggregateProgress(onProgress, transferred, hashed.sizeInBytes),
      { offset: part.offset, length: part.length }
    )
    firstAsset ??= upload.asset
    parts.push({ name, sizeInBytes: part.length, sha256: part.sha256 })
    transferred += part.length
  }

  const pointer: ICheapLfsPointer = {
    version: CHEAP_LFS_POINTER_VERSION,
    releaseTag: options.releaseTag,
    assetName: partBaseName,
    sizeInBytes: hashed.sizeInBytes,
    sha256: hashed.sha256,
    parts,
  }
  await fs.writePointer(
    join(repository.path, trackedRelativePath),
    serializeCheapLfsPointer(pointer)
  )

  if (firstAsset === undefined) {
    throw new Error('Cheap LFS uploaded no parts for this file.')
  }
  return { pointer, asset: firstAsset, releaseId: release.id }
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
    onProgress
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
  const resolved = parts.map(part => ({
    part,
    asset: resolveReleaseAsset(release, part.name, pointer.releaseTag),
  }))
  const partPaths = new Array<string>()
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
        aggregateProgress(onProgress, transferred, pointer.sizeInBytes)
      )
      const verified = await fs.hashFile(download.path, signal)
      if (
        verified.sha256 !== part.sha256 ||
        verified.sizeInBytes !== part.sizeInBytes
      ) {
        throw new Error(
          'A downloaded cheap LFS part does not match the pointer. The pointer was left in place.'
        )
      }
      transferred += part.sizeInBytes
    }
    assembledPath = fs.temporaryPathFor(trackedPath)
    const assembled = await fs.assembleParts(partPaths, assembledPath, signal)
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
    onProgress: (progress: IGitHubReleaseTransferProgressEvent) => void
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
  onProgress?: (progress: ICheapLfsBatchProgress) => void
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
    const result = await deps.pin(target, signal, progress =>
      onProgress?.({
        completedFiles: index,
        totalFiles: targets.length,
        currentPath: target.relativePath,
        transferredBytes: transferredBefore + progress.transferredBytes,
        totalBytes,
      })
    )
    pinned.push({
      relativePath: target.relativePath,
      sizeInBytes: target.sizeInBytes,
      result,
    })
    completedBytes += target.sizeInBytes
  }
  return pinned
}
