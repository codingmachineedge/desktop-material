import { createHash, randomBytes } from 'crypto'
import { dirname, isAbsolute, join, parse, resolve } from 'path'
import { FileHandle, link, open, unlink } from 'fs/promises'
import {
  GitHubReleaseAssetMaximumDownloadBytes,
  IGitHubReleaseAsset,
} from './github-releases'

export type GitHubReleaseAssetDownloadFailure =
  | 'destination'
  | 'too-large'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'missing-body'

export class GitHubReleaseAssetDownloadError extends Error {
  public constructor(
    message: string,
    public readonly kind: GitHubReleaseAssetDownloadFailure
  ) {
    super(message)
    this.name = 'GitHubReleaseAssetDownloadError'
  }
}

export interface IGitHubReleaseAssetDownloadProgress {
  readonly transferredBytes: number
  readonly totalBytes: number
  readonly direction: 'download'
}

export interface IGitHubReleaseAssetDownloadResult {
  readonly path: string
  readonly bytes: number
  readonly localDigest: string
  readonly matchesGitHubDigest: boolean | null
}

function abortError(): Error {
  const error = new Error('Release asset download canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw abortError()
  }
}

/** Require an absolute file destination without silently changing its suffix. */
export function normalizeGitHubReleaseAssetDestination(
  destination: string
): string {
  if (
    typeof destination !== 'string' ||
    destination.length === 0 ||
    destination.includes('\u0000') ||
    !isAbsolute(destination)
  ) {
    throw new GitHubReleaseAssetDownloadError(
      'Choose an absolute destination for the release asset.',
      'destination'
    )
  }
  const normalized = resolve(destination)
  const parsed = parse(normalized)
  if (parsed.base.length === 0 || normalized === parsed.root) {
    throw new GitHubReleaseAssetDownloadError(
      'Choose a file destination for the release asset.',
      'destination'
    )
  }
  return normalized
}

function destinationCandidate(destination: string, index: number): string {
  if (index === 1) {
    return destination
  }
  const parsed = parse(destination)
  return join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`)
}

async function createPartialFile(destination: string): Promise<{
  readonly path: string
  readonly handle: FileHandle
}> {
  const directory = dirname(destination)
  const base = parse(destination).base
  for (let attempt = 0; attempt < 10; attempt++) {
    const path = join(
      directory,
      `.${base}.${randomBytes(8).toString('hex')}.partial`
    )
    try {
      return { path, handle: await open(path, 'wx') }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new GitHubReleaseAssetDownloadError(
          'The temporary release asset could not be created at the selected destination.',
          'destination'
        )
      }
    }
  }
  throw new GitHubReleaseAssetDownloadError(
    'Could not create a unique temporary release asset file.',
    'destination'
  )
}

async function writeAll(handle: FileHandle, bytes: Uint8Array) {
  let offset = 0
  while (offset < bytes.byteLength) {
    let written: number
    try {
      written = (
        await handle.write(bytes, offset, bytes.byteLength - offset, null)
      ).bytesWritten
    } catch {
      throw new GitHubReleaseAssetDownloadError(
        'The release asset could not be written at the selected destination.',
        'destination'
      )
    }
    if (written <= 0) {
      throw new GitHubReleaseAssetDownloadError(
        'The release asset could not be written at the selected destination.',
        'destination'
      )
    }
    offset += written
  }
}

async function publishWithoutOverwrite(
  partialPath: string,
  destination: string,
  signal: AbortSignal
): Promise<string> {
  let published: string | null = null
  try {
    for (let index = 1; index <= 1000; index++) {
      const candidate = destinationCandidate(destination, index)
      try {
        await link(partialPath, candidate)
        published = candidate
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new GitHubReleaseAssetDownloadError(
            'The release asset could not be published at the selected destination.',
            'destination'
          )
        }
      }
    }
    if (published === null) {
      throw new GitHubReleaseAssetDownloadError(
        'Too many files already use this release asset name.',
        'destination'
      )
    }
    throwIfAborted(signal)
    await unlink(partialPath)
    throwIfAborted(signal)
    const completed = published
    published = null
    return completed
  } catch (error) {
    if (published !== null) {
      await unlink(published).catch(() => undefined)
    }
    throw error
  }
}

function advertisedLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (value === null) {
    return null
  }
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new GitHubReleaseAssetDownloadError(
      'GitHub returned an invalid release asset size.',
      'size-mismatch'
    )
  }
  return Number(value)
}

/** Stream, hash, verify, and atomically publish one exact release asset. */
export async function downloadGitHubReleaseAsset(
  asset: IGitHubReleaseAsset,
  response: Response,
  destination: string,
  signal: AbortSignal,
  onProgress?: (progress: IGitHubReleaseAssetDownloadProgress) => void
): Promise<IGitHubReleaseAssetDownloadResult> {
  let target: string
  try {
    throwIfAborted(signal)
    if (asset.sizeInBytes > GitHubReleaseAssetMaximumDownloadBytes) {
      throw new GitHubReleaseAssetDownloadError(
        'This release asset exceeds the app’s 5 GiB safety limit.',
        'too-large'
      )
    }
    const length = advertisedLength(response)
    if (
      length !== null &&
      (length > GitHubReleaseAssetMaximumDownloadBytes ||
        length !== asset.sizeInBytes)
    ) {
      throw new GitHubReleaseAssetDownloadError(
        'GitHub’s release asset size does not match the response.',
        length > GitHubReleaseAssetMaximumDownloadBytes
          ? 'too-large'
          : 'size-mismatch'
      )
    }
    if (response.body === null && asset.sizeInBytes !== 0) {
      throw new GitHubReleaseAssetDownloadError(
        'GitHub returned the release asset without content.',
        'missing-body'
      )
    }
    target = normalizeGitHubReleaseAssetDestination(destination)
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throw error
  }

  const reader = response.body?.getReader() ?? null
  const partial = await createPartialFile(target).catch(async error => {
    await reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
    throw error
  })
  let openHandle: FileHandle | null = partial.handle
  const hash = createHash('sha256')
  let transferredBytes = 0
  const cancelReader = () => reader?.cancel(abortError()).catch(() => undefined)
  signal.addEventListener('abort', cancelReader, { once: true })
  try {
    onProgress?.({
      transferredBytes,
      totalBytes: asset.sizeInBytes,
      direction: 'download',
    })
    if (reader !== null) {
      while (true) {
        throwIfAborted(signal)
        const next = await reader.read()
        throwIfAborted(signal)
        if (next.done) {
          break
        }
        transferredBytes += next.value.byteLength
        if (
          transferredBytes > asset.sizeInBytes ||
          transferredBytes > GitHubReleaseAssetMaximumDownloadBytes
        ) {
          throw new GitHubReleaseAssetDownloadError(
            'The downloaded release asset exceeded its advertised size.',
            'size-mismatch'
          )
        }
        hash.update(next.value)
        await writeAll(partial.handle, next.value)
        onProgress?.({
          transferredBytes,
          totalBytes: asset.sizeInBytes,
          direction: 'download',
        })
      }
    }
    if (transferredBytes !== asset.sizeInBytes) {
      throw new GitHubReleaseAssetDownloadError(
        'The downloaded release asset was incomplete.',
        'size-mismatch'
      )
    }
    const localDigest = `sha256:${hash.digest('hex')}`
    const matchesGitHubDigest =
      asset.digest === null ? null : asset.digest === localDigest
    if (matchesGitHubDigest === false) {
      throw new GitHubReleaseAssetDownloadError(
        'The release asset digest does not match GitHub’s digest.',
        'digest-mismatch'
      )
    }
    await partial.handle.sync()
    await partial.handle.close()
    openHandle = null
    throwIfAborted(signal)
    return {
      path: await publishWithoutOverwrite(partial.path, target, signal),
      bytes: transferredBytes,
      localDigest,
      matchesGitHubDigest,
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined)
    await openHandle?.close().catch(() => undefined)
    await unlink(partial.path).catch(() => undefined)
    if (signal.aborted && (error as Error)?.name !== 'AbortError') {
      throw abortError()
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancelReader)
    reader?.releaseLock()
  }
}
