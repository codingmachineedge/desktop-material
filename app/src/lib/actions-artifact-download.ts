import { createHash, randomBytes } from 'crypto'
import { dirname, extname, isAbsolute, join, parse, resolve } from 'path'
import { FileHandle, link, open, unlink } from 'fs/promises'
import {
  ActionsArtifactMaximumDownloadBytes,
  IActionsArtifact,
} from './actions-artifacts'

export type ActionsArtifactDownloadFailure =
  | 'destination'
  | 'too-large'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'missing-body'

export class ActionsArtifactDownloadError extends Error {
  public constructor(
    message: string,
    public readonly kind: ActionsArtifactDownloadFailure
  ) {
    super(message)
    this.name = 'ActionsArtifactDownloadError'
  }
}

export interface IActionsArtifactDownloadProgress {
  readonly receivedBytes: number
  readonly totalBytes: number
}

export interface IActionsArtifactDownloadResult {
  readonly path: string
  readonly bytes: number
  /** The digest computed over the downloaded archive by this app. */
  readonly localDigest: string
  /** Null when GitHub did not provide a digest for this artifact. */
  readonly matchesGitHubDigest: boolean | null
}

export interface IActionsArtifactDownloadOptions {
  readonly artifact: IActionsArtifact
  readonly response: Response
  readonly destination: string
  readonly signal: AbortSignal
  readonly onProgress?: (progress: IActionsArtifactDownloadProgress) => void
}

function abortError(): Error {
  const error = new Error('Artifact download canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError()
  }
}

function advertisedContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null) {
    return null
  }
  if (!/^\d+$/.test(raw)) {
    throw new ActionsArtifactDownloadError(
      'GitHub returned an invalid artifact archive size.',
      'size-mismatch'
    )
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new ActionsArtifactDownloadError(
      'GitHub returned an artifact archive size that is too large to process safely.',
      'too-large'
    )
  }
  return value
}

/** Require a safe absolute archive target and preserve the user's directory. */
export function normalizeActionsArtifactDestination(
  destination: string
): string {
  if (
    destination.length === 0 ||
    destination.includes('\u0000') ||
    !isAbsolute(destination)
  ) {
    throw new ActionsArtifactDownloadError(
      'Choose an absolute destination for the artifact archive.',
      'destination'
    )
  }

  const normalized = resolve(destination)
  const fileName = parse(normalized).base
  if (fileName.length === 0 || normalized === parse(normalized).root) {
    throw new ActionsArtifactDownloadError(
      'Choose a file destination for the artifact archive.',
      'destination'
    )
  }
  return extname(fileName).toLowerCase() === '.zip'
    ? normalized
    : `${normalized}.zip`
}

/** Return a sibling name; index 1 is the exact user-selected destination. */
export function getActionsArtifactDestinationCandidate(
  destination: string,
  index: number
): string {
  if (!Number.isSafeInteger(index) || index < 1) {
    throw new Error('Artifact destination index must be a positive integer.')
  }
  if (index === 1) {
    return destination
  }
  const target = parse(destination)
  return join(target.dir, `${target.name} (${index})${target.ext}`)
}

async function createPartialFile(destination: string): Promise<{
  readonly path: string
  readonly handle: FileHandle
}> {
  const directory = dirname(destination)
  const base = parse(destination).base
  for (let attempt = 0; attempt < 10; attempt++) {
    const partialPath = join(
      directory,
      `.${base}.${randomBytes(8).toString('hex')}.partial`
    )
    try {
      return { path: partialPath, handle: await open(partialPath, 'wx') }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new ActionsArtifactDownloadError(
          'The artifact temporary file could not be created at the selected destination.',
          'destination'
        )
      }
    }
  }
  throw new ActionsArtifactDownloadError(
    'Could not create a unique temporary artifact file.',
    'destination'
  )
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    let result: { readonly bytesWritten: number }
    try {
      result = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        null
      )
    } catch {
      throw new ActionsArtifactDownloadError(
        'The artifact archive could not be written at the selected destination.',
        'destination'
      )
    }
    if (result.bytesWritten <= 0) {
      throw new ActionsArtifactDownloadError(
        'The artifact archive could not be written at the selected destination.',
        'destination'
      )
    }
    offset += result.bytesWritten
  }
}

export async function publishActionsArtifactWithoutOverwrite(
  partial: string,
  destination: string,
  signal: AbortSignal
): Promise<string> {
  let published: string | null = null
  try {
    for (let index = 1; index <= 1000; index++) {
      const candidate = getActionsArtifactDestinationCandidate(
        destination,
        index
      )
      try {
        // A same-directory hard link is atomic and fails when the candidate
        // already exists. Existing user files are therefore never replaced.
        await link(partial, candidate)
        published = candidate
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw new ActionsArtifactDownloadError(
            'The artifact archive could not be published at the selected destination.',
            'destination'
          )
        }
      }
    }
    if (published === null) {
      throw new ActionsArtifactDownloadError(
        'Too many files already use this artifact archive name. Choose another destination.',
        'destination'
      )
    }

    // Cancellation and partial-file cleanup are part of the publish boundary.
    // A candidate is not handed to the caller until both checks have passed.
    throwIfAborted(signal)
    try {
      await unlink(partial)
    } catch {
      throw new ActionsArtifactDownloadError(
        'The completed artifact archive could not be finalized at the selected destination.',
        'destination'
      )
    }
    throwIfAborted(signal)
    const completed = published
    published = null
    return completed
  } catch (error) {
    if (published !== null) {
      try {
        await unlink(published)
      } catch {
        throw new ActionsArtifactDownloadError(
          'The incomplete artifact archive could not be removed from the selected destination.',
          'destination'
        )
      }
    }
    throw error
  }
}

/**
 * Stream an artifact archive into a same-directory partial file, incrementally
 * hash it, and atomically publish a unique name only after every check passes.
 */
export async function downloadActionsArtifactArchive({
  artifact,
  response,
  destination,
  signal,
  onProgress,
}: IActionsArtifactDownloadOptions): Promise<IActionsArtifactDownloadResult> {
  let target: string
  try {
    throwIfAborted(signal)
    if (artifact.expired) {
      throw new ActionsArtifactDownloadError(
        'This artifact has expired and can no longer be downloaded.',
        'destination'
      )
    }
    if (artifact.sizeInBytes > ActionsArtifactMaximumDownloadBytes) {
      throw new ActionsArtifactDownloadError(
        'This artifact is larger than the app’s 5 GiB download safety limit.',
        'too-large'
      )
    }

    const contentLength = advertisedContentLength(response)
    if (
      contentLength !== null &&
      contentLength > ActionsArtifactMaximumDownloadBytes
    ) {
      throw new ActionsArtifactDownloadError(
        'The artifact response is larger than the app’s 5 GiB download safety limit.',
        'too-large'
      )
    }
    if (contentLength !== null && contentLength !== artifact.sizeInBytes) {
      throw new ActionsArtifactDownloadError(
        'GitHub’s artifact size does not match the archive response size.',
        'size-mismatch'
      )
    }
    if (response.body === null && artifact.sizeInBytes !== 0) {
      throw new ActionsArtifactDownloadError(
        'GitHub returned an artifact archive without a response body.',
        'missing-body'
      )
    }

    target = normalizeActionsArtifactDestination(destination)
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throw error
  }

  const hash = createHash('sha256')
  let reader: ReadableStreamDefaultReader<Uint8Array> | null
  try {
    reader = response.body?.getReader() ?? null
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throw error
  }

  let partial: Awaited<ReturnType<typeof createPartialFile>>
  try {
    partial = await createPartialFile(target)
  } catch (error) {
    try {
      await reader?.cancel().catch(() => undefined)
    } finally {
      reader?.releaseLock()
    }
    throw error
  }
  const { path: partialPath, handle } = partial
  let openHandle: FileHandle | null = handle
  let receivedBytes = 0
  const cancelReader = () => {
    reader?.cancel(abortError()).catch(() => undefined)
  }
  signal.addEventListener('abort', cancelReader, { once: true })

  try {
    onProgress?.({ receivedBytes, totalBytes: artifact.sizeInBytes })
    if (reader !== null) {
      while (true) {
        throwIfAborted(signal)
        const next = await reader.read()
        throwIfAborted(signal)
        if (next.done) {
          break
        }

        receivedBytes += next.value.byteLength
        if (
          receivedBytes > artifact.sizeInBytes ||
          receivedBytes > ActionsArtifactMaximumDownloadBytes
        ) {
          throw new ActionsArtifactDownloadError(
            'The artifact archive exceeded its advertised size.',
            'size-mismatch'
          )
        }
        hash.update(next.value)
        await writeAll(handle, next.value)
        onProgress?.({
          receivedBytes,
          totalBytes: artifact.sizeInBytes,
        })
      }
    }

    if (receivedBytes !== artifact.sizeInBytes) {
      throw new ActionsArtifactDownloadError(
        'The downloaded artifact archive was incomplete.',
        'size-mismatch'
      )
    }

    const localDigest = `sha256:${hash.digest('hex')}`
    const matchesGitHubDigest =
      artifact.digest === null ? null : localDigest === artifact.digest
    if (matchesGitHubDigest === false) {
      throw new ActionsArtifactDownloadError(
        'The downloaded archive digest does not match the digest reported by GitHub.',
        'digest-mismatch'
      )
    }

    try {
      await handle.sync()
      await handle.close()
    } catch {
      throw new ActionsArtifactDownloadError(
        'The artifact archive could not be finalized at the selected destination.',
        'destination'
      )
    }
    openHandle = null
    throwIfAborted(signal)
    const publishedPath = await publishActionsArtifactWithoutOverwrite(
      partialPath,
      target,
      signal
    )
    return {
      path: publishedPath,
      bytes: receivedBytes,
      localDigest,
      matchesGitHubDigest,
    }
  } catch (error) {
    await reader?.cancel().catch(() => undefined)
    if (openHandle !== null) {
      await openHandle.close().catch(() => undefined)
    }
    await unlink(partialPath).catch(() => undefined)
    if (signal.aborted && (error as Error).name !== 'AbortError') {
      throw abortError()
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancelReader)
    reader?.releaseLock()
  }
}
