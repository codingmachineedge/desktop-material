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
import type { CheapLfsStorageProvider } from '../../models/build-run-preferences'
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
  getGitHubReleasesReadAccount,
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
import {
  CHEAP_LFS_OCI_MAXIMUM_POINTER_TEXT_BYTES,
  CHEAP_LFS_OCI_POINTER_VERSION,
  CheapLfsOciRegistryProvider,
  getCheapLfsOciRegistryProvider,
  ICheapLfsGhcrPointer,
  isCheapLfsGhcrPointerHeader,
  parseCheapLfsGhcrPointer,
} from './ghcr-pointer'
import type {
  CheapLfsRecommendedStorage,
  CheapLfsStorageRecommendationReason,
} from './storage-recommendation'
import { isCheapLfsRepositoryKeyPath } from './ghcr-key'
import { requireSafeCheapLfsMaterializationPath } from './materialization-path'
import {
  defaultCheapLfsTrackedPathStore,
  ICheapLfsTrackedFileProof,
  ICheapLfsTrackedPathStore,
  ICheapLfsVerifiedSourceCopy,
} from './tracked-path-store'

/**
 * Orchestration for the cheap-LFS flow: hashing a working-tree file, uploading
 * it as a GitHub Release asset, writing the committed pointer, and later
 * materializing the pointer back into the real bytes with end-to-end
 * verification. Every side effect (release CRUD, transfers, disk access) is
 * injected so the flow is unit-testable without a network or a real account,
 * while the exported defaults wire up the real implementations.
 */

/** Bound sequential rollover lookup to one million documented asset slots. */
const CheapLfsMaximumReleaseBuckets = 1000
/** Only a prefix is needed to recognize either exact pointer version header. */
const CheapLfsPointerHeaderBytes = 512
/** One full read can accommodate either provider's canonical pointer format. */
const CheapLfsMaximumAnyPointerTextBytes = Math.max(
  CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES,
  CHEAP_LFS_OCI_MAXIMUM_POINTER_TEXT_BYTES
)
/** Keep streamed preprocessing from flooding the renderer/store update path. */
const CheapLfsProgressReportIntervalMs = 250
/** Reduce per-2-GiB hash callbacks while keeping each in-memory chunk bounded. */
export const CheapLfsStreamChunkBytes = 1024 * 1024
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

export type CheapLfsWorkingTreePointerState =
  | 'pointer'
  | 'materialized'
  | 'modified'

/** A tracked pointer record merged with the current working-tree state. */
export interface ICheapLfsPointerCandidate {
  readonly relativePath: string
  readonly text: string
  /** Omitted by legacy test fakes; callers treat omission as `pointer`. */
  readonly workingTreeState?: CheapLfsWorkingTreePointerState
  /** Where the authoritative pointer text came from. */
  readonly metadataSource?: 'working-tree' | 'index' | 'head'
  /** Captured for raw worktree states so a publish can detect concurrent edits. */
  readonly workingTreeSha256?: string
  readonly workingTreeSizeInBytes?: number
}

/** One resolved pointer discovered by {@link listCheapLfsPointers}. */
export interface ICheapLfsPointerEntry {
  readonly relativePath: string
  readonly pointer: ICheapLfsPointer
  readonly workingTreeState: CheapLfsWorkingTreePointerState
}

/** A Release or OCI pointer shown by the provider-neutral manager. */
export type ICheapLfsManagedPointerEntry =
  | {
      readonly kind: 'release'
      readonly relativePath: string
      readonly provider: 'release'
      readonly pointer: ICheapLfsPointer
      readonly workingTreeState: CheapLfsWorkingTreePointerState
      readonly workingTreeSizeInBytes?: number
    }
  | {
      readonly kind: 'oci'
      readonly relativePath: string
      readonly provider: CheapLfsOciRegistryProvider
      readonly pointer: ICheapLfsGhcrPointer
      readonly workingTreeState: CheapLfsWorkingTreePointerState
      readonly workingTreeSizeInBytes?: number
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
  create(
    repository: Repository,
    draft: IGitHubReleaseDraft,
    publishImmediately: boolean,
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
  publish(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    signal?: AbortSignal
  ): Promise<IGitHubRelease>
  uploadAsset(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    sourcePath: string,
    name: string,
    label: string | null,
    signal: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void,
    range?: IGitHubReleaseAssetUploadRange,
    expectedDigest?: string
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

/** Byte progress for one streamed Cheap LFS preprocessing pass. */
export interface ICheapLfsFileProgress {
  readonly processedBytes: number
  readonly totalBytes: number
  readonly currentPath: string
}

/** Injectable disk seam so the flow can run against fakes or the real OS. */
export interface ICheapLfsFileSystem {
  /** Production tracked-path proof/CAS boundary; legacy fakes may omit it. */
  readonly trackedPaths?: ICheapLfsTrackedPathStore
  hashFile(
    path: string,
    signal?: AbortSignal
  ): Promise<{ readonly sha256: string; readonly sizeInBytes: number }>
  hashFileParts(
    path: string,
    partSize: number,
    signal?: AbortSignal,
    onProgress?: (processedBytes: number) => void
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
    const stream = createReadStream(path, {
      highWaterMark: CheapLfsStreamChunkBytes,
    })
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
  signal?: AbortSignal,
  onChunk?: (bytes: number) => void
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
      highWaterMark: CheapLfsStreamChunkBytes,
    })
    const onAbort = () =>
      stream.destroy(abortError('Cheap LFS hashing canceled.'))
    signal?.addEventListener('abort', onAbort, { once: true })
    stream.on('data', chunk => {
      streamed += chunk.length
      whole.update(chunk)
      part.update(chunk)
      onChunk?.(chunk.length)
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
  signal?: AbortSignal,
  onProgress?: (processedBytes: number) => void
): Promise<{
  readonly sha256: string
  readonly sizeInBytes: number
  readonly parts: ReadonlyArray<ICheapLfsHashedPart>
}> {
  const sizeInBytes = (await stat(path)).size
  const plan = planFileParts(sizeInBytes, partSize)
  const whole = createHash('sha256')
  const parts = new Array<ICheapLfsHashedPart>()
  let processedBytes = 0
  let lastReportedBytes = -1
  let lastReportedAt = 0
  const reportProgress = (bytes: number, force: boolean = false) => {
    if (onProgress === undefined || bytes === lastReportedBytes) {
      return
    }
    const now = Date.now()
    if (
      force ||
      lastReportedBytes < 0 ||
      now - lastReportedAt >= CheapLfsProgressReportIntervalMs
    ) {
      lastReportedBytes = bytes
      lastReportedAt = now
      onProgress(bytes)
    }
  }
  reportProgress(0, true)
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
        signal,
        bytes => {
          processedBytes += bytes
          reportProgress(processedBytes)
        }
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
  reportProgress(sizeInBytes, true)
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
  maximumBytes: number,
  rejectOversize: boolean = false
): Promise<string> {
  const handle = await open(path, 'r')
  try {
    // Keep one sentinel byte so callers can distinguish an exactly-at-limit
    // file from an oversized file instead of accidentally parsing a prefix.
    const capacity = maximumBytes + 1
    const buffer = Buffer.alloc(capacity)
    const { bytesRead } = await handle.read(buffer, 0, capacity, 0)
    if (rejectOversize && bytesRead > maximumBytes) {
      throw new Error(
        `Cheap LFS pointer text exceeds the ${maximumBytes}-byte format limit.`
      )
    }
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

function pointerHeaderMatches(text: string): boolean {
  return isCheapLfsPointerText(text) || isCheapLfsGhcrPointerHeader(text)
}

function pointerIdentity(text: string): {
  readonly sha256: string
  readonly sizeInBytes: number
} | null {
  if (
    isCheapLfsPointerText(text.slice(0, CheapLfsPointerHeaderBytes)) &&
    Buffer.byteLength(text, 'utf8') > CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES
  ) {
    throw new Error(
      `Cheap LFS Release pointer text exceeds the ${CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES}-byte format limit.`
    )
  }
  const release = parseCheapLfsPointer(text)
  if (release !== null) {
    return { sha256: release.sha256, sizeInBytes: release.sizeInBytes }
  }
  let oci: ICheapLfsGhcrPointer | null
  try {
    oci = parseCheapLfsGhcrPointer(text)
  } catch {
    return null
  }
  return oci === null
    ? null
    : {
        sha256: oci.object.slice('sha256:'.length),
        sizeInBytes: oci.sizeInBytes,
      }
}

function parseNulPaths(value: Buffer, revisionPrefix?: string): string[] {
  const fields = value
    .toString('utf8')
    .split('\0')
    .filter(field => field.length > 0)
  return fields.map(field =>
    revisionPrefix !== undefined && field.startsWith(revisionPrefix)
      ? field.slice(revisionPrefix.length)
      : field
  )
}

async function gitPointerPaths(
  root: string,
  source: 'working-tree' | 'index' | 'head'
): Promise<ReadonlyArray<string>> {
  const args = [
    'grep',
    '-I',
    '-l',
    '-z',
    '-F',
    '-e',
    `version ${CHEAP_LFS_POINTER_VERSION}`,
    '-e',
    `version ${CHEAP_LFS_OCI_POINTER_VERSION}`,
  ]
  if (source === 'working-tree') {
    args.push('--untracked')
  } else if (source === 'index') {
    args.push('--cached')
  } else {
    args.push('HEAD')
  }
  args.push('--')
  const result = await git(args, root, `listCheapLfs${source}Pointers`, {
    successExitCodes: new Set([0, 1, 128]),
    encoding: 'buffer',
    maxBuffer: Infinity,
  })
  if (result.exitCode === 128) {
    if (source === 'head') {
      return []
    }
    throw new Error(
      `Git could not inventory Cheap LFS ${source} pointer metadata.`
    )
  }
  return parseNulPaths(result.stdout, source === 'head' ? 'HEAD:' : undefined)
}

async function readGitPointerText(
  root: string,
  source: 'index' | 'head',
  relativePath: string
): Promise<string> {
  const object = `${source === 'index' ? '' : 'HEAD'}:${relativePath}`
  const sizeResult = await git(
    ['cat-file', '-s', object],
    root,
    'measureCheapLfsPointerBlob',
    { maxBuffer: 1024 }
  )
  const size = Number(sizeResult.stdout.trim())
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > CheapLfsMaximumAnyPointerTextBytes
  ) {
    throw new Error(
      `Tracked Cheap LFS pointer ${relativePath} exceeds its bounded format size.`
    )
  }
  const result = await git(
    ['cat-file', 'blob', object],
    root,
    'readCheapLfsPointerBlob',
    { encoding: 'buffer', maxBuffer: CheapLfsMaximumAnyPointerTextBytes }
  )
  if (result.stdout.length !== size) {
    throw new Error(
      `Git returned an incomplete Cheap LFS pointer for ${relativePath}.`
    )
  }
  return result.stdout.toString('utf8')
}

async function isGitWorkingTree(root: string): Promise<boolean> {
  const result = await git(
    ['rev-parse', '--is-inside-work-tree'],
    root,
    'detectCheapLfsGitWorkingTree',
    { successExitCodes: new Set([0, 128]), maxBuffer: 1024 }
  )
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

/**
 * Inventory pointer paths through Git instead of truncating a directory walk.
 * Worktree pointer text wins; otherwise the index (or HEAD as provenance for a
 * staged replacement) supplies metadata while verified raw bytes stay local.
 */
async function scanPointerCandidatesFromGit(
  root: string
): Promise<ReadonlyArray<ICheapLfsPointerCandidate>> {
  const [workingPaths, indexPaths, headPaths] = await Promise.all([
    gitPointerPaths(root, 'working-tree'),
    gitPointerPaths(root, 'index'),
    gitPointerPaths(root, 'head'),
  ])
  const working = new Set(workingPaths)
  const index = new Set(indexPaths)
  const head = new Set(headPaths)
  const paths = [...new Set([...working, ...index, ...head])].sort()
  const candidates = new Array<ICheapLfsPointerCandidate>()
  for (const untrustedPath of paths) {
    const relativePath = validateCheapLfsTrackedPath(untrustedPath)
    if (relativePath === null) {
      throw new Error('Git returned an unsafe Cheap LFS tracked path.')
    }
    const trackedProof = await defaultCheapLfsTrackedPathStore.proveDestination(
      root,
      relativePath
    )
    if (!trackedProof.exists) {
      // A deleted path is intentionally absent from the current inventory.
      continue
    }
    if (
      working.has(relativePath) &&
      trackedProof.sizeInBytes > CheapLfsMaximumAnyPointerTextBytes
    ) {
      throw new Error(
        `Tracked Cheap LFS pointer ${relativePath} exceeds the bounded pointer format limit.`
      )
    }
    const worktreeText =
      trackedProof.sizeInBytes <= CheapLfsMaximumAnyPointerTextBytes
        ? await defaultCheapLfsTrackedPathStore.readText(
            trackedProof,
            CheapLfsMaximumAnyPointerTextBytes
          )
        : ''
    const worktreePrefix = worktreeText.slice(0, CheapLfsPointerHeaderBytes)
    if (working.has(relativePath) && pointerHeaderMatches(worktreePrefix)) {
      const text = worktreeText
      if (!pointerHeaderMatches(text.slice(0, CheapLfsPointerHeaderBytes))) {
        throw new Error(
          `Cheap LFS pointer ${relativePath} changed while it was being inventoried.`
        )
      }
      if (pointerIdentity(text) === null) {
        continue
      }
      candidates.push({
        relativePath,
        text,
        workingTreeState: 'pointer',
        metadataSource: 'working-tree',
      })
      continue
    }

    if (!index.has(relativePath) && !head.has(relativePath)) {
      // `git grep` can find a version marker in a later line of ordinary text.
      // Only the exact prefix is pointer-shaped.
      continue
    }

    const metadataSource = index.has(relativePath) ? 'index' : 'head'
    const text = await readGitPointerText(root, metadataSource, relativePath)
    const identity = pointerIdentity(text)
    if (identity === null) {
      continue
    }
    const hashed = {
      sha256: trackedProof.sha256!,
      sizeInBytes: trackedProof.sizeInBytes,
    }
    // Suppression is safe only when the index pointer is itself committed.
    // A staged raw blob (HEAD still has a pointer), staged pointer rewrite, or
    // newly-added index pointer must remain visible and pass through re-pin
    // protection instead of being projected as clean.
    const indexMatchesHead =
      metadataSource === 'index' &&
      head.has(relativePath) &&
      (await readGitPointerText(root, 'head', relativePath)) === text
    candidates.push({
      relativePath,
      text,
      workingTreeState:
        indexMatchesHead &&
        hashed.sizeInBytes === identity.sizeInBytes &&
        hashed.sha256 === identity.sha256
          ? 'materialized'
          : 'modified',
      metadataSource,
      workingTreeSha256: hashed.sha256,
      workingTreeSizeInBytes: hashed.sizeInBytes,
    })
  }
  return candidates
}

async function scanPointerCandidatesFromDisk(
  root: string
): Promise<ReadonlyArray<ICheapLfsPointerCandidate>> {
  const candidates = new Array<ICheapLfsPointerCandidate>()
  const queue: Array<{ dir: string; depth: number; rel: string }> = [
    { dir: root, depth: 0, rel: '' },
  ]
  while (queue.length > 0) {
    const { dir, depth, rel } = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!CheapLfsSkipDirectories.has(entry.name)) {
          queue.push({
            dir: join(dir, entry.name),
            depth: depth + 1,
            rel: relPath,
          })
        }
      } else if (entry.isFile()) {
        let trackedProof: ICheapLfsTrackedFileProof
        try {
          trackedProof = await defaultCheapLfsTrackedPathStore.proveExisting(
            root,
            relPath
          )
        } catch {
          continue
        }
        if (trackedProof.sizeInBytes > CheapLfsMaximumAnyPointerTextBytes) {
          continue
        }
        const text = await defaultCheapLfsTrackedPathStore.readText(
          trackedProof,
          CheapLfsMaximumAnyPointerTextBytes
        )
        if (pointerHeaderMatches(text)) {
          const fullText = text
          if (pointerIdentity(fullText) === null) {
            continue
          }
          candidates.push({
            relativePath: relPath,
            text: fullText,
            workingTreeState: 'pointer',
            metadataSource: 'working-tree',
          })
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
  trackedPaths: defaultCheapLfsTrackedPathStore,
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
  scanPointerCandidates,
  resolveReleaseTargetCommitish,
}

/** Keep spread-based legacy test/adaptor seams on their injected disk methods. */
function trackedPathStoreFor(
  fs: ICheapLfsFileSystem
): ICheapLfsTrackedPathStore | undefined {
  if (fs.trackedPaths === undefined) {
    return undefined
  }
  return fs === defaultCheapLfsFileSystem ||
    fs.trackedPaths !== defaultCheapLfsTrackedPathStore
    ? fs.trackedPaths
    : undefined
}

function ensureReleasesAccount(repository: Repository, account: Account): void {
  if (getGitHubReleasesAccount(repository, [account]) === null) {
    throw new GitHubReleasesError(
      'authentication',
      'Sign in with the account selected for this repository to use cheap LFS.'
    )
  }
}

function ensureReleasesReadAccount(
  repository: Repository,
  account: Account
): void {
  if (getGitHubReleasesReadAccount(repository, [account]) === null) {
    throw new GitHubReleasesError(
      'authentication',
      'Sign in with the account selected for this repository to restore private or unverified cheap LFS files.'
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

/**
 * Manual handoffs are created on Windows' case-insensitive filesystem. Reserve
 * names with the same canonical comparison so two nested sources such as
 * `A/Foo.bin` and `B/foo.bin` cannot target one flat handoff entry.
 */
function manualAssetNameCollisionKey(name: string): string {
  // Uppercase folding deliberately unifies context-sensitive lowercase forms
  // such as Greek sigma/final-sigma. Trimming trailing dots/spaces mirrors the
  // Win32 path-name comparison used by the flat handoff folder.
  return name
    .normalize('NFC')
    .toUpperCase()
    .replace(/[ .]+$/u, '')
}

/** Append a short content hash before the extension to dodge a name clash. */
function dedupeAssetName(
  name: string,
  assets: ReadonlyArray<IGitHubReleaseAsset>,
  sha256: string,
  reservedNames: ReadonlySet<string> = new Set()
): string {
  const assetNames = new Set([
    ...assets.map(asset => manualAssetNameCollisionKey(asset.name)),
    ...[...reservedNames].map(manualAssetNameCollisionKey),
  ])
  if (!assetNames.has(manualAssetNameCollisionKey(name))) {
    return name
  }

  const short = sha256.slice(0, 7)
  for (let attempt = 0; attempt <= assetNames.size; attempt++) {
    const candidate = insertAssetNameHash(
      name,
      attempt === 0 ? short : `${short}-${attempt + 1}`
    )
    if (!assetNames.has(manualAssetNameCollisionKey(candidate))) {
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
  partCount: number,
  reservedNames: ReadonlySet<string> = new Set()
): string {
  const assetNames = new Set([
    ...assets.map(asset => manualAssetNameCollisionKey(asset.name)),
    ...[...reservedNames].map(manualAssetNameCollisionKey),
  ])
  const collides = (base: string) => {
    for (let index = 0; index < partCount; index++) {
      if (
        assetNames.has(
          manualAssetNameCollisionKey(partAssetName(base, index, partCount))
        )
      ) {
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
  for (let attempt = 0; attempt <= assetNames.size; attempt++) {
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
  onStage?: (stage: CheapLfsPinStage) => void,
  onHashProgress?: (processedBytes: number) => void
): Promise<ICheapLfsPinResult> {
  const trackedPaths = trackedPathStoreFor(fs)
  const trackedRelativePath = validateCheapLfsTrackedPath(
    options.trackedRelativePath
  )
  if (
    trackedRelativePath === null ||
    isCheapLfsRepositoryKeyPath(trackedRelativePath)
  ) {
    throw new Error(
      'Choose a safe repository-relative path without parent traversal or Git metadata to track with cheap LFS.'
    )
  }
  ensureReleasesAccount(repository, account)
  ensureCheapLfsReleaseFamilyTag(options.releaseTag)

  const baseName = normalizeGitHubReleaseAssetName(
    basename(options.absoluteFilePath)
  )
  let verifiedSource: ICheapLfsVerifiedSourceCopy | undefined
  let uploadSourcePath = options.absoluteFilePath
  let sourceSizeInBytes: number
  let hashed: {
    readonly sha256: string
    readonly sizeInBytes: number
    readonly parts: ReadonlyArray<ICheapLfsHashedPart>
  }
  onStage?.('hashing')
  if (trackedPaths !== undefined) {
    verifiedSource = await trackedPaths.prepareUpload(
      repository.path,
      trackedRelativePath,
      options.absoluteFilePath,
      CHEAP_LFS_PART_SIZE_BYTES,
      signal,
      onHashProgress
    )
    uploadSourcePath = verifiedSource.owned.path
    sourceSizeInBytes = verifiedSource.sizeInBytes
    hashed = {
      sha256: verifiedSource.sha256,
      sizeInBytes: verifiedSource.sizeInBytes,
      parts: verifiedSource.parts,
    }
  } else {
    sourceSizeInBytes = await fs.statSize(options.absoluteFilePath)
    preflightProjectedPointer(sourceSizeInBytes, options.releaseTag, baseName)
    hashed = await fs.hashFileParts(
      options.absoluteFilePath,
      CHEAP_LFS_PART_SIZE_BYTES,
      signal,
      onHashProgress
    )
  }
  preflightProjectedPointer(sourceSizeInBytes, options.releaseTag, baseName)
  try {
    onStage?.('release')
    const bucket = await allocateCheapLfsReleaseBucket(
      releases,
      repository,
      options.releaseTag,
      options.releaseName,
      hashed.parts.length,
      async (releaseTag, releaseName) =>
        await releases.create(
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
            // Published prerelease buckets never replace the installer's stable
            // /releases/latest update feed.
            prerelease: true,
          },
          true,
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
          uploadSourcePath,
          assetName,
          null,
          signal ?? new AbortController().signal,
          aggregateProgress(onProgress, 0, hashed.sizeInBytes, part.length),
          undefined,
          `sha256:${part.sha256}`
        )
        // Record ownership before validating the response. A digest or byte-count
        // mismatch still means GitHub accepted an asset that this attempt owns.
        attemptAssets.push(upload.asset)
        ensureRawUploadMatchesHash(upload, part.length, hashed.sha256)
        onStage?.('verifying')
        if (verifiedSource !== undefined && trackedPaths !== undefined) {
          await trackedPaths.revalidateSource(verifiedSource.source)
          await trackedPaths.publishText(
            verifiedSource.destination,
            pointerText
          )
        } else {
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
        }
        return { pointer, asset: upload.asset, releaseId: release.id }
      } catch (error) {
        return await rethrowAfterAttemptAssetCleanup(
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
          uploadSourcePath,
          pointerPart.name,
          null,
          signal ?? new AbortController().signal,
          aggregateProgress(
            onProgress,
            transferred,
            hashed.sizeInBytes,
            part.length
          ),
          { offset: part.offset, length: part.length },
          `sha256:${part.sha256}`
        )
        // Record ownership before validating the response. A digest or byte-count
        // mismatch still means GitHub accepted an asset that this attempt owns.
        attemptAssets.push(upload.asset)
        ensureRawUploadMatchesHash(upload, part.length, part.sha256)
        firstAsset ??= upload.asset
        transferred += part.length
      }

      onStage?.('verifying')
      if (verifiedSource !== undefined && trackedPaths !== undefined) {
        await trackedPaths.revalidateSource(verifiedSource.source)
        await trackedPaths.publishText(verifiedSource.destination, pointerText)
      } else {
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
      }

      if (firstAsset === undefined) {
        throw new Error('Cheap LFS uploaded no parts for this file.')
      }
      return { pointer, asset: firstAsset, releaseId: release.id }
    } catch (error) {
      return await rethrowAfterAttemptAssetCleanup(
        error,
        releases,
        repository,
        releaseTag,
        preexistingAssetIds,
        attemptAssets
      )
    }
  } finally {
    if (verifiedSource !== undefined && trackedPaths !== undefined) {
      await trackedPaths.cleanupOwned(verifiedSource.owned)
    }
  }
}

/** Release methods used by the browser-assisted manual fallback. */
export type ICheapLfsManualReleasesGateway = ICheapLfsReleasesGateway

/** One exact browser-upload asset, backed by a bounded source-file range. */
export interface ICheapLfsManualAssetPlan {
  readonly assetName: string
  readonly offset: number
  readonly sizeInBytes: number
  readonly sha256: string
  /** Exact preexisting provider object that this retry may safely reuse. */
  readonly reusableAsset?: IGitHubReleaseAsset
}

/** One source file, its browser-upload assets, and its eventual pointer. */
export interface ICheapLfsManualFilePlan {
  readonly absoluteFilePath: string
  readonly trackedRelativePath: string
  readonly pointer: ICheapLfsPointer
  readonly pointerText: string
  readonly assetName: string
  readonly sizeInBytes: number
  readonly sha256: string
  readonly assets: ReadonlyArray<ICheapLfsManualAssetPlan>
  /** Exact tracked destination captured before any provider mutation. */
  readonly trackedProof?: ICheapLfsTrackedFileProof
}

/** One release rendezvous containing every remaining selected large file. */
export interface ICheapLfsManualPinPlan {
  readonly release: IGitHubRelease
  readonly files: ReadonlyArray<ICheapLfsManualFilePlan>
  readonly preexistingAssetIds: ReadonlySet<number>
}

interface ICheapLfsManualHashedFile {
  readonly options: ICheapLfsPinOptions
  readonly trackedRelativePath: string
  readonly baseName: string
  readonly trackedProof?: ICheapLfsTrackedFileProof
  readonly hashed: {
    readonly sha256: string
    readonly sizeInBytes: number
    readonly parts: ReadonlyArray<ICheapLfsHashedPart>
  }
}

interface ICheapLfsResolvedManualFileAssets {
  readonly file: ICheapLfsManualHashedFile
  readonly assetName: string
  readonly assets: ReadonlyArray<ICheapLfsManualAssetPlan>
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

async function scanPointerCandidates(
  root: string
): Promise<ReadonlyArray<ICheapLfsPointerCandidate>> {
  return (await isGitWorkingTree(root))
    ? scanPointerCandidatesFromGit(root)
    : scanPointerCandidatesFromDisk(root)
}

/**
 * Publish an exact legacy Cheap LFS draft in place. Published prereleases are
 * visible to ordinary collaborators but remain outside GitHub's stable
 * `/releases/latest` feed. A concurrent publisher is accepted only when a
 * fresh lookup proves the same release id is now published.
 */
async function publishCheapLfsReleaseIfNeeded(
  releases: ICheapLfsReleasesGateway,
  repository: Repository,
  release: IGitHubRelease,
  releaseTag: string,
  signal?: AbortSignal
): Promise<IGitHubRelease> {
  ensureCheapLfsBucketTag(release, releaseTag)
  if (!release.draft) {
    return release
  }

  try {
    const published = await releases.publish(
      repository,
      releases.createMutationReview(repository, release),
      signal
    )
    ensureCheapLfsBucketTag(published, releaseTag)
    if (published.draft) {
      throw new Error(
        `GitHub left the Cheap LFS release tagged “${releaseTag}” as a draft.`
      )
    }
    return published
  } catch (publishError) {
    const refreshed = await releases.getReleaseByTag(
      repository,
      releaseTag,
      signal
    )
    if (refreshed === null || refreshed.id !== release.id || refreshed.draft) {
      throw publishError
    }
    ensureCheapLfsBucketTag(refreshed, releaseTag)
    return refreshed
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

function manualAssetCandidateBaseName(
  baseName: string,
  sha256: string,
  partCount: number,
  candidateIndex: number
): string {
  if (candidateIndex === 0) {
    return baseName
  }
  const suffix =
    candidateIndex === 1
      ? sha256.slice(0, 7)
      : `${sha256.slice(0, 7)}-${candidateIndex}`
  if (partCount === 1) {
    return insertAssetNameHash(baseName, suffix)
  }
  const width = Math.max(3, String(partCount).length)
  return appendAssetNameSuffix(
    baseName,
    `-${suffix}`,
    255 - `.part${'0'.repeat(width)}`.length
  )
}

/**
 * Resolve one deterministic manual asset family. Exact uploaded objects from a
 * prior browser attempt may occupy their own planned names when their size and
 * provider digest match. A digest-less exact-size object remains a candidate,
 * but manual-upload.ts must download and hash it before browser handoff.
 */
function resolveCheapLfsManualFileAssets(
  hashedFiles: ReadonlyArray<ICheapLfsManualHashedFile>,
  existingAssets: ReadonlyArray<IGitHubReleaseAsset>
): ReadonlyArray<ICheapLfsResolvedManualFileAssets> {
  const existingByName = new Map<string, Array<IGitHubReleaseAsset>>()
  for (const asset of existingAssets) {
    const key = manualAssetNameCollisionKey(asset.name)
    const matches = existingByName.get(key) ?? []
    matches.push(asset)
    existingByName.set(key, matches)
  }
  const reservedNames = new Set<string>()
  const resolved = new Array<ICheapLfsResolvedManualFileAssets>()
  for (const file of hashedFiles) {
    const partCount = file.hashed.parts.length
    let selected:
      | {
          readonly assetName: string
          readonly assets: ReadonlyArray<ICheapLfsManualAssetPlan>
        }
      | undefined
    const maximumCandidates = existingAssets.length + reservedNames.size + 2
    for (
      let candidateIndex = 0;
      candidateIndex < maximumCandidates;
      candidateIndex++
    ) {
      const assetName = manualAssetCandidateBaseName(
        file.baseName,
        file.hashed.sha256,
        partCount,
        candidateIndex
      )
      const candidateAssets = file.hashed.parts.map((part, index) => ({
        assetName:
          partCount > 1
            ? partAssetName(assetName, index, partCount)
            : assetName,
        offset: part.offset,
        sizeInBytes: part.length,
        sha256: part.sha256,
      }))
      if (
        candidateAssets.some(asset =>
          reservedNames.has(manualAssetNameCollisionKey(asset.assetName))
        )
      ) {
        continue
      }

      let incompatible = false
      const reusableByName = new Map<string, IGitHubReleaseAsset>()
      for (const candidate of candidateAssets) {
        const matches =
          existingByName.get(
            manualAssetNameCollisionKey(candidate.assetName)
          ) ?? []
        if (matches.length === 0) {
          continue
        }
        const exactMatches = matches.filter(
          asset => asset.name === candidate.assetName
        )
        const incomplete = exactMatches.find(
          asset => !isUploadedGitHubReleaseAsset(asset)
        )
        if (incomplete !== undefined) {
          throw new Error(
            `The release has an incomplete asset named “${candidate.assetName}”. Wait for GitHub to finish it or delete it in the Release editor before retrying manual Cheap LFS.`
          )
        }
        if (matches.length !== 1 || exactMatches.length !== 1) {
          incompatible = true
          break
        }
        const existing = exactMatches[0]
        const expectedDigest = `sha256:${candidate.sha256}`
        if (
          existing.sizeInBytes !== candidate.sizeInBytes ||
          (existing.digest !== null && existing.digest !== expectedDigest)
        ) {
          incompatible = true
          break
        }
        reusableByName.set(candidate.assetName, existing)
      }
      if (incompatible) {
        continue
      }

      const assets = candidateAssets.map(asset => ({
        ...asset,
        reusableAsset: reusableByName.get(asset.assetName),
      }))
      for (const asset of assets) {
        reservedNames.add(manualAssetNameCollisionKey(asset.assetName))
      }
      selected = { assetName, assets }
      break
    }
    if (selected === undefined) {
      throw new Error('Cheap LFS could not choose unique manual asset names.')
    }
    resolved.push({ file, ...selected })
  }
  return resolved
}

function countMissingCheapLfsManualAssets(
  hashedFiles: ReadonlyArray<ICheapLfsManualHashedFile>,
  existingAssets: ReadonlyArray<IGitHubReleaseAsset>
): number {
  return resolveCheapLfsManualFileAssets(hashedFiles, existingAssets).reduce(
    (count, file) =>
      count +
      file.assets.filter(asset => asset.reusableAsset === undefined).length,
    0
  )
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
  signal?: AbortSignal,
  requiredAssetCountForInventory?: (
    assets: ReadonlyArray<IGitHubReleaseAsset>
  ) => number
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
  const requiredFor = (assets: ReadonlyArray<IGitHubReleaseAsset>): number => {
    const required =
      requiredAssetCountForInventory?.(assets) ?? requiredAssetCount
    if (
      !Number.isSafeInteger(required) ||
      required < 0 ||
      required > requiredAssetCount
    ) {
      throw new Error('Cheap LFS produced an invalid resumable asset count.')
    }
    return required
  }

  const releaseCache = new Map<number, IGitHubRelease | null>()
  const releaseAt = async (index: number): Promise<IGitHubRelease | null> => {
    if (signal?.aborted) {
      throw abortError('Cheap LFS release preparation canceled.')
    }
    const releaseTag = cheapLfsReleaseBucketTag(baseTag, index)
    if (!releaseCache.has(index)) {
      const found = await releases.getReleaseByTag(
        repository,
        releaseTag,
        signal
      )
      releaseCache.set(
        index,
        found === null
          ? null
          : await publishCheapLfsReleaseIfNeeded(
              releases,
              repository,
              found,
              releaseTag,
              signal
            )
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
      GitHubReleaseAssetMaximumCount - requiredFor(firstAssets)
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
        const conflicted = await releases.getReleaseByTag(
          repository,
          releaseTag,
          signal
        )
        release =
          conflicted === null
            ? null
            : await publishCheapLfsReleaseIfNeeded(
                releases,
                repository,
                conflicted,
                releaseTag,
                signal
              )
        if (release === null) {
          throw createError
        }
      }
      // Keep provider identity validation outside the conflict-recovery catch:
      // a successful create that returns the wrong tag is never a conflict.
      ensureCheapLfsBucketTag(release, releaseTag)
      if (release.draft) {
        throw new Error(
          `GitHub created the Cheap LFS release tagged “${releaseTag}” as a draft.`
        )
      }
      releaseCache.set(index, release)
    }

    const listedAssets = await listAllCheapLfsReleaseAssets(
      releases,
      repository,
      release.id,
      signal
    )
    const assets = mergeCheapLfsReleaseAssetSnapshots(release, listedAssets)
    if (assets.length <= GitHubReleaseAssetMaximumCount - requiredFor(assets)) {
      return { release, releaseTag, assets, index }
    }
  }

  throw new Error(
    `Cheap LFS could not find room after checking ${CheapLfsMaximumReleaseBuckets} release buckets.`
  )
}

/**
 * Prepare one browser-upload batch without mutating the working tree. Sources
 * above the per-asset cap become ordered range assets in the same Release; the
 * complete batch shares one paginated snapshot and reserves every part name.
 */
export async function planCheapLfsManualUpload(
  releases: ICheapLfsManualReleasesGateway,
  repository: Repository,
  account: Account,
  options: ReadonlyArray<ICheapLfsPinOptions>,
  signal?: AbortSignal,
  onStage?: (stage: CheapLfsPinStage) => void,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem,
  onHashProgress?: (progress: ICheapLfsFileProgress) => void
): Promise<ICheapLfsManualPinPlan> {
  const trackedPaths = trackedPathStoreFor(fs)
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
  const preflightFiles = new Array<{
    readonly options: ICheapLfsPinOptions
    readonly trackedRelativePath: string
    readonly baseName: string
    readonly sourceSize: number
    readonly trackedProof?: ICheapLfsTrackedFileProof
  }>()
  let projectedAssetCount = 0
  const trackedPathKeys = new Set<string>()
  for (const candidate of options) {
    const trackedRelativePath = validateCheapLfsTrackedPath(
      candidate.trackedRelativePath
    )
    if (
      trackedRelativePath === null ||
      isCheapLfsRepositoryKeyPath(trackedRelativePath)
    ) {
      throw new Error(
        'Choose a safe repository-relative path without parent traversal or Git metadata to track with cheap LFS.'
      )
    }
    const trackedPathKey = trackedRelativePath.toLowerCase()
    if (trackedPathKeys.has(trackedPathKey)) {
      throw new Error(
        'A manual Cheap LFS batch cannot contain case-insensitive tracked-path collisions.'
      )
    }
    trackedPathKeys.add(trackedPathKey)
    const trackedProof = await trackedPaths?.proveDestination(
      repository.path,
      trackedRelativePath
    )
    const baseName = normalizeGitHubReleaseAssetName(
      basename(candidate.absoluteFilePath)
    )
    const sourceSize = await fs.statSize(candidate.absoluteFilePath)
    preflightProjectedPointer(sourceSize, baseReleaseTag, baseName)
    projectedAssetCount += Math.max(
      1,
      Math.ceil(sourceSize / CHEAP_LFS_PART_SIZE_BYTES)
    )
    if (projectedAssetCount > GitHubReleaseAssetMaximumCount) {
      throw new Error(
        `One manual cheap LFS batch can contain at most ${GitHubReleaseAssetMaximumCount} release assets after multipart splitting.`
      )
    }
    preflightFiles.push({
      options: candidate,
      trackedRelativePath,
      baseName,
      sourceSize,
      trackedProof,
    })
  }

  const hashedFiles = new Array<ICheapLfsManualHashedFile>()
  const totalHashBytes = preflightFiles.reduce(
    (sum, file) => sum + file.sourceSize,
    0
  )
  let completedHashBytes = 0
  let requiredAssetCount = 0
  for (const file of preflightFiles) {
    const hashed = await fs.hashFileParts(
      file.options.absoluteFilePath,
      CHEAP_LFS_PART_SIZE_BYTES,
      signal,
      processedBytes =>
        onHashProgress?.({
          processedBytes: completedHashBytes + processedBytes,
          totalBytes: totalHashBytes,
          currentPath: file.trackedRelativePath,
        })
    )
    if (hashed.sizeInBytes !== file.sourceSize) {
      throw new Error(
        `The cheap LFS source “${file.trackedRelativePath}” changed size while the manual upload was being planned.`
      )
    }
    if (hashed.parts.length === 0) {
      throw new Error('Cheap LFS produced no manual upload assets for a file.')
    }
    let expectedOffset = 0
    if (
      !/^[a-f0-9]{64}$/.test(hashed.sha256) ||
      hashed.parts.some(part => {
        const invalid =
          part.offset !== expectedOffset ||
          !Number.isSafeInteger(part.length) ||
          part.length < 0 ||
          part.length > CHEAP_LFS_PART_SIZE_BYTES ||
          (part.length === 0 && hashed.sizeInBytes !== 0) ||
          !/^[a-f0-9]{64}$/.test(part.sha256)
        expectedOffset += part.length
        return invalid
      }) ||
      expectedOffset !== hashed.sizeInBytes
    ) {
      throw new Error(
        `Cheap LFS produced an invalid manual upload part layout for “${file.trackedRelativePath}”.`
      )
    }
    completedHashBytes += hashed.sizeInBytes
    onHashProgress?.({
      processedBytes: completedHashBytes,
      totalBytes: totalHashBytes,
      currentPath: file.trackedRelativePath,
    })
    requiredAssetCount += hashed.parts.length
    if (requiredAssetCount > GitHubReleaseAssetMaximumCount) {
      throw new Error(
        `One manual cheap LFS batch can contain at most ${GitHubReleaseAssetMaximumCount} release assets after multipart splitting.`
      )
    }
    hashedFiles.push({
      options: file.options,
      trackedRelativePath: file.trackedRelativePath,
      baseName: file.baseName,
      trackedProof: file.trackedProof,
      hashed,
    })
  }

  onStage?.('release')
  const bucket = await allocateCheapLfsReleaseBucket(
    releases,
    repository,
    baseReleaseTag,
    options[0].releaseName,
    requiredAssetCount,
    async (releaseTag, releaseName) =>
      await releases.create(
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
          // Published prerelease buckets never replace the installer's stable
          // /releases/latest update feed.
          prerelease: true,
        },
        true,
        signal
      ),
    signal,
    assets => countMissingCheapLfsManualAssets(hashedFiles, assets)
  )
  const { release, releaseTag, assets: allAssets } = bucket
  const preexistingAssetIds = new Set(allAssets.map(asset => asset.id))
  const resolvedFiles = resolveCheapLfsManualFileAssets(hashedFiles, allAssets)
  const files = resolvedFiles.map(({ file, assetName, assets }) => {
    const multipart = file.hashed.parts.length > 1
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
      parts: multipart
        ? assets.map(asset => ({
            name: asset.assetName,
            sizeInBytes: asset.sizeInBytes,
            sha256: asset.sha256,
          }))
        : undefined,
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
      assets,
      trackedProof: file.trackedProof,
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

async function ensureMaterializeTargetUnchanged(
  fs: ICheapLfsFileSystem,
  repositoryPath: string,
  relativePath: string,
  trackedPath: string,
  expectedPointerText: string
): Promise<void> {
  const verifiedPath = await requireSafeCheapLfsMaterializationPath(
    repositoryPath,
    relativePath
  )
  const samePath =
    process.platform === 'win32'
      ? verifiedPath.toLowerCase() === trackedPath.toLowerCase()
      : verifiedPath === trackedPath
  if (!samePath) {
    throw new Error(
      'The cheap LFS materialization path changed while its content was downloading. The current file was left in place.'
    )
  }
  let currentText: string
  try {
    currentText = await fs.readPointerText(trackedPath)
  } catch {
    throw new Error(
      'The cheap LFS pointer changed or was removed while its content was downloading. The current file was left in place.'
    )
  }
  if (currentText !== expectedPointerText) {
    throw new Error(
      'The cheap LFS pointer changed or was removed while its content was downloading. The current file was left in place.'
    )
  }
}

function ensureMaterializeNotCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError(
      'Cheap LFS materialization was canceled before replacing the pointer.'
    )
  }
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
  expectedPointerText: string,
  trackedRelativePath: string,
  trackedPath: string,
  trackedProof: ICheapLfsTrackedFileProof | undefined,
  trackedPaths: ICheapLfsTrackedPathStore | undefined,
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
  let downloadedPath = temporaryPath
  let trackedStoreOwnsDownload = false
  try {
    const download = await releases.downloadAsset(
      repository,
      release.id,
      asset,
      temporaryPath,
      signal ?? new AbortController().signal,
      aggregateProgress(onProgress, 0, pointer.sizeInBytes, pointer.sizeInBytes)
    )
    downloadedPath = download.path
    const verified = await fs.hashFile(download.path, signal)
    if (
      verified.sha256 !== pointer.sha256 ||
      verified.sizeInBytes !== pointer.sizeInBytes
    ) {
      throw new Error(
        'The downloaded asset does not match the cheap LFS pointer. The pointer was left in place.'
      )
    }
    if (trackedProof !== undefined && trackedPaths !== undefined) {
      ensureMaterializeNotCanceled(signal)
      trackedStoreOwnsDownload = true
      await trackedPaths.replaceFromPath(
        trackedProof,
        download.path,
        pointer.sha256,
        pointer.sizeInBytes,
        signal
      )
    } else {
      await ensureMaterializeTargetUnchanged(
        fs,
        repository.path,
        trackedRelativePath,
        trackedPath,
        expectedPointerText
      )
      ensureMaterializeNotCanceled(signal)
      await fs.replaceFile(download.path, trackedPath)
    }
    return { path: trackedPath, bytes: verified.sizeInBytes }
  } catch (error) {
    if (!trackedStoreOwnsDownload) {
      await fs.removeFile(downloadedPath)
    }
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
  expectedPointerText: string,
  trackedRelativePath: string,
  parts: ReadonlyArray<ICheapLfsPointerPart>,
  trackedPath: string,
  trackedProof: ICheapLfsTrackedFileProof | undefined,
  trackedPaths: ICheapLfsTrackedPathStore | undefined,
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
  let trackedStoreOwnsAssembly = false
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
    if (trackedProof !== undefined && trackedPaths !== undefined) {
      ensureMaterializeNotCanceled(signal)
      trackedStoreOwnsAssembly = true
      await trackedPaths.replaceFromPath(
        trackedProof,
        assembledPath,
        pointer.sha256,
        pointer.sizeInBytes,
        signal
      )
    } else {
      await ensureMaterializeTargetUnchanged(
        fs,
        repository.path,
        trackedRelativePath,
        trackedPath,
        expectedPointerText
      )
      ensureMaterializeNotCanceled(signal)
      await fs.replaceFile(assembledPath, trackedPath)
    }
    assembledConsumed = true
    return { path: trackedPath, bytes: assembled.sizeInBytes }
  } finally {
    for (const partPath of partPaths) {
      await fs.removeFile(partPath)
    }
    for (const expandedPath of expandedPaths) {
      await fs.removeFile(expandedPath)
    }
    if (
      assembledPath !== null &&
      !assembledConsumed &&
      !trackedStoreOwnsAssembly
    ) {
      await fs.removeFile(assembledPath)
    }
  }
}

/** One batch-local cache for release metadata and complete asset inventories. */
export interface ICheapLfsMaterializeCache {
  readonly releasesByTag: Map<string, Promise<IGitHubRelease | null>>
  readonly completeReleasesById: Map<number, Promise<IGitHubRelease>>
}

export function createCheapLfsMaterializeCache(): ICheapLfsMaterializeCache {
  return {
    releasesByTag: new Map(),
    completeReleasesById: new Map(),
  }
}

function requiredPointerAssetNames(
  pointer: ICheapLfsPointer
): ReadonlyArray<string> {
  return pointer.parts?.map(part => part.name) ?? [pointer.assetName]
}

function releaseContainsUploadedAssets(
  release: IGitHubRelease,
  names: ReadonlyArray<string>
): boolean {
  const uploadedNames = new Set(
    release.assets
      .filter(isUploadedGitHubReleaseAsset)
      .map(candidate => candidate.name)
  )
  return names.every(name => uploadedNames.has(name))
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
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem,
  cache?: ICheapLfsMaterializeCache
): Promise<ICheapLfsMaterializeResult> {
  const trackedPaths = trackedPathStoreFor(fs)
  const relativePath = validateCheapLfsTrackedPath(trackedRelativePath)
  if (relativePath === null || isCheapLfsRepositoryKeyPath(relativePath)) {
    throw new Error(
      'Choose a safe repository-relative path without parent traversal or Git metadata to materialize.'
    )
  }
  ensureReleasesReadAccount(repository, account)

  const trackedProof = await trackedPaths?.proveExisting(
    repository.path,
    relativePath
  )
  const trackedPath =
    trackedProof?.absolutePath ??
    (await requireSafeCheapLfsMaterializationPath(
      repository.path,
      relativePath
    ))
  const pointerText =
    trackedProof === undefined || trackedPaths === undefined
      ? await fs.readPointerText(trackedPath)
      : await trackedPaths.readText(
          trackedProof,
          CHEAP_LFS_MAXIMUM_POINTER_TEXT_BYTES
        )
  const pointer = parseCheapLfsPointer(pointerText)
  if (pointer === null) {
    throw new Error('This file is not a cheap LFS pointer.')
  }

  let releasePromise = cache?.releasesByTag.get(pointer.releaseTag)
  if (releasePromise === undefined) {
    releasePromise = releases.getReleaseByTag(
      repository,
      pointer.releaseTag,
      signal
    )
    cache?.releasesByTag.set(pointer.releaseTag, releasePromise)
  }
  let release: IGitHubRelease | null
  try {
    release = await releasePromise
  } catch (error) {
    if (cache?.releasesByTag.get(pointer.releaseTag) === releasePromise) {
      cache.releasesByTag.delete(pointer.releaseTag)
    }
    throw error
  }
  if (release === null) {
    throw new Error(
      `No release tagged “${pointer.releaseTag}” holds this pointer's asset.`
    )
  }
  release = await publishCheapLfsReleaseIfNeeded(
    releases,
    repository,
    release,
    pointer.releaseTag,
    signal
  )
  // A shared batch cache may still hold the pre-publication draft promise.
  // Replace it so later pointers reuse the exact published provider snapshot.
  cache?.releasesByTag.set(pointer.releaseTag, Promise.resolve(release))
  const requiredNames = requiredPointerAssetNames(pointer)
  let completeRelease = release
  if (!releaseContainsUploadedAssets(release, requiredNames)) {
    let completeReleasePromise = cache?.completeReleasesById.get(release.id)
    if (completeReleasePromise === undefined) {
      completeReleasePromise = (async () => {
        const listedAssets = await listAllCheapLfsReleaseAssets(
          releases,
          repository,
          release.id,
          signal
        )
        return {
          ...release,
          assets: mergeCheapLfsReleaseAssetSnapshots(release, listedAssets),
        }
      })()
      cache?.completeReleasesById.set(release.id, completeReleasePromise)
    }
    try {
      completeRelease = await completeReleasePromise
    } catch (error) {
      if (
        cache?.completeReleasesById.get(release.id) === completeReleasePromise
      ) {
        cache.completeReleasesById.delete(release.id)
      }
      throw error
    }
  }

  if (pointer.parts === undefined) {
    return await materializeSingleAsset(
      releases,
      repository,
      completeRelease,
      pointer,
      pointerText,
      relativePath,
      trackedPath,
      trackedProof,
      trackedPaths,
      signal,
      onProgress,
      fs
    )
  }
  return await materializeMultiPart(
    releases,
    repository,
    completeRelease,
    pointer,
    pointerText,
    relativePath,
    pointer.parts,
    trackedPath,
    trackedProof,
    trackedPaths,
    signal,
    onProgress,
    fs
  )
}

/** List Release pointers from the complete Git/index-aware inventory. */
export async function listCheapLfsPointers(
  repository: Repository,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem
): Promise<ReadonlyArray<ICheapLfsPointerEntry>> {
  const candidates = await fs.scanPointerCandidates(repository.path)
  const entries = new Array<ICheapLfsPointerEntry>()
  for (const candidate of candidates) {
    pointerIdentity(candidate.text)
    const pointer = parseCheapLfsPointer(candidate.text)
    if (pointer !== null) {
      entries.push({
        relativePath: candidate.relativePath,
        pointer,
        workingTreeState: candidate.workingTreeState ?? 'pointer',
      })
    }
  }
  return entries
}

/**
 * List both historical GitHub Release pointers and OCI registry pointers.
 * Keeping the discriminant explicit prevents provider-specific restore or
 * removal code from accidentally interpreting one format as the other.
 */
export async function listAllCheapLfsPointers(
  repository: Repository,
  fs: ICheapLfsFileSystem = defaultCheapLfsFileSystem
): Promise<ReadonlyArray<ICheapLfsManagedPointerEntry>> {
  const candidates = await fs.scanPointerCandidates(repository.path)
  const entries = new Array<ICheapLfsManagedPointerEntry>()
  for (const candidate of candidates) {
    pointerIdentity(candidate.text)
    const releasePointer = parseCheapLfsPointer(candidate.text)
    if (releasePointer !== null) {
      entries.push({
        kind: 'release',
        relativePath: candidate.relativePath,
        provider: 'release',
        pointer: releasePointer,
        workingTreeState: candidate.workingTreeState ?? 'pointer',
        workingTreeSizeInBytes: candidate.workingTreeSizeInBytes,
      })
      continue
    }

    let ociPointer: ICheapLfsGhcrPointer | null
    try {
      ociPointer = parseCheapLfsGhcrPointer(candidate.text)
    } catch {
      continue
    }
    if (ociPointer === null) {
      continue
    }
    const provider = getCheapLfsOciRegistryProvider(ociPointer.image)
    if (provider !== null) {
      entries.push({
        kind: 'oci',
        relativePath: candidate.relativePath,
        provider,
        pointer: ociPointer,
        workingTreeState: candidate.workingTreeState ?? 'pointer',
        workingTreeSizeInBytes: candidate.workingTreeSizeInBytes,
      })
    }
  }
  return entries
}

/**
 * Whether the automatic materialize-on-detect flow should run: the per-repo
 * preference must be enabled (its back-compat default is on) and a validated
 * Release read account must be available. That account can be authenticated or
 * the anonymous account resolved for an explicitly public GitHub.com repo.
 * Pure so the detector's gating is unit-testable without an app store.
 */
export function shouldAutoMaterializeCheapLfs(
  autoMaterializeEnabled: boolean,
  releasesReadAccount: Account | null
): boolean {
  return autoMaterializeEnabled && releasesReadAccount !== null
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
  /** Persisted provider used for this operation. */
  readonly selectedStorageProvider?: CheapLfsStorageProvider
  /** Size/capability-based advice; informative and never silently overrides. */
  readonly recommendedStorageProvider?: CheapLfsRecommendedStorage
  readonly storageRecommendationReason?: CheapLfsStorageRecommendationReason
  readonly estimatedRegistryLayers?: number
  /** Successfully written pointers, in the batch. */
  readonly succeededFiles?: number
  /** Files whose automatic pin failed and remain as their original content. */
  readonly failedFiles?: number
  /**
   * A deterministic, input-ordered snapshot of the files currently active.
   * Automatic uploads publish at most three rows. Older/manual producers may
   * omit this field and continue to use `currentPath`.
   */
  readonly activeFiles?: ReadonlyArray<ICheapLfsActivePinProgress>
}

/** Structured progress for one active automatic pin worker. */
export interface ICheapLfsActivePinProgress {
  readonly relativePath: string
  readonly phase: CheapLfsAutoPinPhase
  /** Stage-local bytes (hash bytes while hashing, upload bytes while uploading). */
  readonly processedBytes: number
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

/** One automatic pin failure. Its source file is never safe to commit. */
export interface ICheapLfsAutoPinFailure {
  readonly relativePath: string
  readonly sizeInBytes: number
  readonly message: string
}

/** Settled automatic pin outcome, always ordered like the selected inputs. */
export interface ICheapLfsAutoPinResult {
  readonly pinned: ReadonlyArray<ICheapLfsAutoPinnedFile>
  readonly failures: ReadonlyArray<ICheapLfsAutoPinFailure>
  readonly totalBytes: number
  readonly canceled: boolean
}

/** Automatic pinning deliberately never exceeds three concurrent files. */
export const CheapLfsMaximumAutoPinConcurrency = 3

/** The disk and transfer seams the auto-pin-on-commit flow depends on. */
export interface ICheapLfsAutoPinDependencies {
  /** Opaque production containment/CAS seam; structural test fakes may omit. */
  readonly trackedPaths?: ICheapLfsTrackedPathStore
  /** Byte size of a working-tree file (stat). */
  readonly statSize: (absolutePath: string) => Promise<number>
  /** First bytes of a working-tree file, used to classify it as a pointer. */
  readonly readPointerText: (absolutePath: string) => Promise<string>
  /** Upload one file as a release asset and replace it with a pointer. */
  readonly pin: (
    target: ICheapLfsAutoPinTarget,
    signal: AbortSignal | undefined,
    onProgress: (progress: IGitHubReleaseTransferProgressEvent) => void,
    onStage?: (stage: CheapLfsAutoPinPhase) => void,
    onHashProgress?: (processedBytes: number) => void,
    /** Zero-based stable release lane for this file. */
    laneIndex?: number
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
  deps: Pick<ICheapLfsAutoPinDependencies, 'statSize' | 'readPointerText'> & {
    readonly trackedPaths?: ICheapLfsTrackedPathStore
  },
  signal?: AbortSignal
): Promise<ReadonlyArray<ICheapLfsAutoPinTarget>> {
  const targets = new Array<ICheapLfsAutoPinTarget>()
  const oversizedCandidates = new Array<ICheapLfsAutoPinTarget>()
  const seen = new Set<string>()
  const trackedPaths =
    deps.trackedPaths ??
    (deps.statSize === defaultCheapLfsFileSystem.statSize &&
    deps.readPointerText === defaultCheapLfsFileSystem.readPointerText
      ? defaultCheapLfsTrackedPathStore
      : undefined)
  for (const relativePath of selectedRelativePaths) {
    if (signal?.aborted) {
      throw abortError('Cheap LFS commit upload was canceled.')
    }
    const validated = validateCheapLfsTrackedPath(relativePath)
    if (
      validated === null ||
      isCheapLfsRepositoryKeyPath(validated) ||
      seen.has(validated.toLowerCase())
    ) {
      continue
    }
    seen.add(validated.toLowerCase())
    const absolutePath = join(repository.path, validated)
    try {
      const sizeInBytes = await deps.statSize(absolutePath)
      if (sizeInBytes > thresholdBytes) {
        oversizedCandidates.push({
          relativePath: validated,
          absolutePath,
          sizeInBytes,
        })
      }
    } catch {
      continue
    }
  }

  // Proving a destination hashes its contents. Stat every selected path first
  // so ordinary files never pay that cost while oversized files retain the
  // exact tracked-path containment and identity proof used by pinning.
  for (const candidate of oversizedCandidates) {
    if (signal?.aborted) {
      throw abortError('Cheap LFS commit upload was canceled.')
    }
    let sizeInBytes = candidate.sizeInBytes
    let trackedProof: ICheapLfsTrackedFileProof | undefined
    if (trackedPaths !== undefined) {
      try {
        trackedProof = await trackedPaths.proveDestination(
          repository.path,
          candidate.relativePath
        )
      } catch {
        continue
      }
      if (!trackedProof.exists || trackedProof.sizeInBytes <= thresholdBytes) {
        continue
      }
      sizeInBytes = trackedProof.sizeInBytes
    }
    if (sizeInBytes <= thresholdBytes) {
      continue
    }
    // A committed pointer is tiny, so an over-threshold file is almost never one
    // — but classify anyway so a mis-sized pointer is never re-pinned.
    try {
      const text =
        trackedProof !== undefined && trackedPaths !== undefined
          ? trackedProof.sizeInBytes <= CheapLfsMaximumAnyPointerTextBytes
            ? await trackedPaths.readText(
                trackedProof,
                CheapLfsMaximumAnyPointerTextBytes
              )
            : ''
          : await deps.readPointerText(candidate.absolutePath)
      if (
        parseCheapLfsPointer(text) !== null ||
        parseCheapLfsGhcrPointer(text) !== null
      ) {
        continue
      }
    } catch {
      // Unreadable as bounded text means it is certainly not a pointer; pin it.
    }
    targets.push({
      relativePath: candidate.relativePath,
      absolutePath: candidate.absolutePath,
      sizeInBytes,
    })
  }
  return targets
}

/**
 * Pin every over-threshold selected file before a commit so the working tree
 * holds committable pointers instead of unpushable large binaries. Work is
 * assigned to one-to-three stable release lanes; each lane is sequential while
 * the lanes run concurrently. This avoids concurrent mutations of one reviewed
 * release while still allowing three files to upload at once.
 *
 * Ordinary failures are collected and the other files continue. Cancellation
 * stops each lane from claiming more work and all started pins settle before
 * this function returns. Results, failures, and `onPinned` callbacks are always
 * ordered like the selected inputs. The caller must re-read status after any
 * success before committing so it stages pointers rather than original files.
 */
export async function autoPinLargeFilesForCommit(
  repository: Repository,
  selectedRelativePaths: ReadonlyArray<string>,
  thresholdBytes: number,
  deps: ICheapLfsAutoPinDependencies,
  signal?: AbortSignal,
  onProgress?: (progress: ICheapLfsAutoPinProgress) => void,
  onPinned?: (file: ICheapLfsAutoPinnedFile) => void,
  maximumConcurrency: number = 1
): Promise<ICheapLfsAutoPinResult> {
  const targets = await selectCheapLfsAutoPinTargets(
    repository,
    selectedRelativePaths,
    thresholdBytes,
    deps,
    signal
  )
  const totalBytes = targets.reduce(
    (sum, target) => sum + target.sizeInBytes,
    0
  )
  if (targets.length === 0) {
    return { pinned: [], failures: [], totalBytes, canceled: false }
  }

  const requestedConcurrency = Number.isFinite(maximumConcurrency)
    ? Math.floor(maximumConcurrency)
    : 1
  const concurrency = Math.min(
    CheapLfsMaximumAutoPinConcurrency,
    targets.length,
    Math.max(1, requestedConcurrency)
  )
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) {
    controller.abort()
  }

  type ActiveState = {
    readonly index: number
    phase: CheapLfsAutoPinPhase
    processedBytes: number
  }
  const active = new Map<number, ActiveState>()
  const successes = new Array<ICheapLfsAutoPinnedFile | undefined>(
    targets.length
  )
  const failures = new Array<ICheapLfsAutoPinFailure | undefined>(
    targets.length
  )
  let canceled = controller.signal.aborted

  const boundedStageBytes = (value: number, maximum: number): number => {
    if (!Number.isFinite(value) || value <= 0) {
      return 0
    }
    return Math.min(maximum, Math.floor(value))
  }

  const phasePriority = (phase: CheapLfsAutoPinPhase): number => {
    switch (phase) {
      case 'uploading':
        return 5
      case 'hashing':
        return 4
      case 'verifying':
        return 3
      case 'release':
        return 2
      default:
        return 1
    }
  }

  const emitProgress = (terminalPhase: CheapLfsAutoPinPhase = 'uploading') => {
    const activeStates = [...active.values()].sort((a, b) => a.index - b.index)
    const activeFiles: ReadonlyArray<ICheapLfsActivePinProgress> =
      activeStates.map(state => ({
        relativePath: targets[state.index].relativePath,
        phase: state.phase,
        processedBytes: boundedStageBytes(
          state.processedBytes,
          targets[state.index].sizeInBytes
        ),
        totalBytes: targets[state.index].sizeInBytes,
      }))
    const succeededFiles = successes.filter(Boolean).length
    const failedFiles = failures.filter(Boolean).length
    const transferredBytes = targets.reduce((sum, target, index) => {
      if (successes[index] !== undefined) {
        return sum + target.sizeInBytes
      }
      const state = active.get(index)
      return state?.phase === 'uploading'
        ? sum + boundedStageBytes(state.processedBytes, target.sizeInBytes)
        : sum
    }, 0)
    const phase =
      activeStates.length === 0
        ? terminalPhase
        : activeStates
            .slice(1)
            .reduce<CheapLfsAutoPinPhase>(
              (selected, state) =>
                phasePriority(state.phase) > phasePriority(selected)
                  ? state.phase
                  : selected,
              activeStates[0].phase
            )

    onProgress?.({
      phase,
      completedFiles: succeededFiles + failedFiles,
      succeededFiles,
      failedFiles,
      totalFiles: targets.length,
      currentPath: activeFiles[0]?.relativePath ?? null,
      transferredBytes,
      totalBytes,
      activeFiles,
    })
  }

  const runLane = async (laneIndex: number) => {
    for (
      let targetIndex = laneIndex;
      targetIndex < targets.length;
      targetIndex += concurrency
    ) {
      if (controller.signal.aborted) {
        canceled = true
        break
      }

      const target = targets[targetIndex]
      const state: ActiveState = {
        index: targetIndex,
        phase: 'preparing',
        processedBytes: 0,
      }
      active.set(targetIndex, state)
      emitProgress('preparing')

      const update = (phase: CheapLfsAutoPinPhase, processedBytes = 0) => {
        state.phase = phase
        state.processedBytes = boundedStageBytes(
          processedBytes,
          target.sizeInBytes
        )
        emitProgress(phase)
      }

      try {
        const result = await deps.pin(
          target,
          controller.signal,
          progress => update('uploading', progress.transferredBytes),
          stage => update(stage),
          processedBytes => update('hashing', processedBytes),
          laneIndex
        )
        successes[targetIndex] = {
          relativePath: target.relativePath,
          sizeInBytes: target.sizeInBytes,
          result,
        }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          canceled = true
          controller.abort()
        } else {
          failures[targetIndex] = {
            relativePath: target.relativePath,
            sizeInBytes: target.sizeInBytes,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      } finally {
        active.delete(targetIndex)
        emitProgress()
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: concurrency }, (_, laneIndex) => runLane(laneIndex))
    )
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  const pinned = successes.filter(
    (file): file is ICheapLfsAutoPinnedFile => file !== undefined
  )
  const failed = failures.filter(
    (failure): failure is ICheapLfsAutoPinFailure => failure !== undefined
  )
  for (const file of pinned) {
    onPinned?.(file)
  }

  return { pinned, failures: failed, totalBytes, canceled }
}
