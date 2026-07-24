import { createHash } from 'crypto'
import { realpath } from 'fs/promises'
import { basename, join, resolve } from 'path'
import {
  CheapLfsGhcrVerifiedVisibility,
  CheapLfsRegistryRepositoryKeyPath,
  cheapLfsRegistryRepositoryKeyId,
  cheapLfsRegistryRepositoryKeyTextSha256,
  resolveCheapLfsRegistryRepositoryKeyForId,
} from './ghcr-key'
import {
  CHEAP_LFS_OCI_MAXIMUM_POINTER_TEXT_BYTES,
  ICheapLfsGhcrPointer,
  parseCheapLfsGhcrPointer,
} from './ghcr-pointer'
import { validateCheapLfsTrackedPath } from './pointer'
import { defaultCheapLfsTrackedPathStore } from './tracked-path-store'
import { git } from '../git/core'

export interface ICheapLfsRequiredCommitFile {
  readonly relativePath: typeof CheapLfsRegistryRepositoryKeyPath
  /** SHA-256 of the exact canonical file text, without a prefix. */
  readonly contentSha256: string
  /** Whether HEAD does not already carry these exact canonical bytes. */
  readonly changesTree: boolean
  /**
   * Exact selected pointer bytes which name this key. Commit hooks may update
   * the index, so proving only the key would allow a hook to substitute a
   * pointer bound to another key or image after the working-tree review.
   */
  readonly boundPointerFiles: ReadonlyArray<{
    readonly relativePath: string
    readonly contentSha256: string
  }>
}

/**
 * Live status metadata for one selected Git change. A deletion is the only
 * selected change that may safely bypass path-based pointer classification:
 * it cannot introduce new pointer bytes, and Git repositories cloned from
 * another platform can legitimately contain names Windows cannot materialize.
 */
export interface ICheapLfsCommitSelection {
  readonly relativePath: string
  readonly deleted: boolean
}

export class CheapLfsCommitKeyError extends Error {
  public constructor(
    message: string,
    public readonly pointerPaths: ReadonlyArray<string>
  ) {
    super(message)
    this.name = 'CheapLfsCommitKeyError'
  }
}

async function readSelectedOciPointer(
  repositoryPath: string,
  relativePath: string,
  cheapLfsEligible: boolean
): Promise<{
  readonly pointer: ICheapLfsGhcrPointer
  readonly contentSha256: string
} | null> {
  const proof = cheapLfsEligible
    ? await defaultCheapLfsTrackedPathStore.proveDestination(
        repositoryPath,
        relativePath
      )
    : await defaultCheapLfsTrackedPathStore.proveManagedPath(
        repositoryPath,
        relativePath,
        relativePath
      )
  if (
    !proof.exists ||
    proof.sizeInBytes <= 0 ||
    proof.sizeInBytes > CHEAP_LFS_OCI_MAXIMUM_POINTER_TEXT_BYTES
  ) {
    return null
  }
  const text = await defaultCheapLfsTrackedPathStore.readText(
    proof,
    CHEAP_LFS_OCI_MAXIMUM_POINTER_TEXT_BYTES
  )
  const pointer = parseCheapLfsGhcrPointer(text)
  return pointer === null
    ? null
    : {
        pointer,
        contentSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      }
}

interface ISelectedCommitPath {
  readonly relativePath: string
  readonly cheapLfsEligible: boolean
}

/**
 * Selected Git files include control-plane paths such as `.github/*` and
 * `.gitignore` which Cheap LFS deliberately refuses to track. Permit those
 * exact spellings only for bounded pointer classification. The surrogate
 * retains every character and descendant segment, so all other Windows/path
 * safety rules still come from the canonical Cheap LFS validator; `.git`
 * itself remains inaccessible.
 */
function validateSelectedCommitPath(
  relativePathInput: string
): ISelectedCommitPath | null {
  const trackedPath = validateCheapLfsTrackedPath(relativePathInput)
  if (trackedPath !== null) {
    return { relativePath: trackedPath, cheapLfsEligible: true }
  }
  if (typeof relativePathInput !== 'string') {
    return null
  }
  const normalized = relativePathInput.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const firstSegment = segments[0]
  if (
    firstSegment === undefined ||
    !/^\.git/i.test(firstSegment) ||
    /^\.git$/i.test(firstSegment)
  ) {
    return null
  }
  const safetySurrogate = [
    `selected-control-path${firstSegment}`,
    ...segments.slice(1),
  ].join('/')
  if (validateCheapLfsTrackedPath(safetySurrogate) === null) {
    return null
  }
  return { relativePath: normalized, cheapLfsEligible: false }
}

/**
 * Resolve the one canonical key file that every selected private OCI pointer
 * names. Legacy pointers without a key identity fail closed offline; callers
 * may materialize/re-pin them (or add a bounded config-pull migration) first.
 */
export async function resolveCheapLfsCommitKeyRequirement(
  repositoryPath: string,
  selectedRelativePaths: ReadonlyArray<string | ICheapLfsCommitSelection>,
  visibility: CheapLfsGhcrVerifiedVisibility
): Promise<ICheapLfsRequiredCommitFile | null> {
  const entries = new Array<{
    readonly relativePath: string
    readonly pointer: ICheapLfsGhcrPointer
    readonly contentSha256: string
  }>()
  const selectedPathSpellings = new Map<string, ISelectedCommitPath>()
  for (const selectedPath of selectedRelativePaths) {
    const relativePath =
      typeof selectedPath === 'string'
        ? selectedPath
        : selectedPath.relativePath
    if (typeof selectedPath !== 'string' && selectedPath.deleted) {
      continue
    }
    const validated = validateSelectedCommitPath(relativePath)
    if (validated === null) {
      throw new CheapLfsCommitKeyError(
        'Cheap LFS cannot prove a private registry key for an unsafe selected path.',
        [relativePath]
      )
    }
    const collisionKey = validated.relativePath.toLowerCase()
    const existingSpelling = selectedPathSpellings.get(collisionKey)
    if (
      existingSpelling !== undefined &&
      existingSpelling.relativePath !== validated.relativePath
    ) {
      throw new CheapLfsCommitKeyError(
        'Cheap LFS refused selected paths whose Windows spellings collide case-insensitively.',
        [existingSpelling.relativePath, validated.relativePath]
      )
    }
    selectedPathSpellings.set(collisionKey, validated)
  }
  for (const selectedPath of selectedPathSpellings.values()) {
    const { relativePath, cheapLfsEligible } = selectedPath
    const selectedPointer = await readSelectedOciPointer(
      repositoryPath,
      relativePath,
      cheapLfsEligible
    )
    if (selectedPointer !== null) {
      if (!cheapLfsEligible) {
        throw new CheapLfsCommitKeyError(
          'Cheap LFS cannot prove a private registry key for an unsafe selected path.',
          [relativePath]
        )
      }
      entries.push({ relativePath, ...selectedPointer })
    }
  }
  if (entries.length === 0) {
    return null
  }
  const pointerPaths = entries.map(entry => entry.relativePath)
  const pointers = entries.map(entry => entry.pointer)
  if (visibility === 'unknown') {
    throw new CheapLfsCommitKeyError(
      'Cheap LFS cannot commit an OCI pointer until repository visibility is verified.',
      pointerPaths
    )
  }
  if (visibility === 'verified-public') {
    if (pointers.some(pointer => pointer.keyId !== undefined)) {
      throw new CheapLfsCommitKeyError(
        'A public repository cannot commit a private Cheap LFS OCI pointer or its repository key.',
        pointerPaths
      )
    }
    return null
  }

  const keyIds = new Set(pointers.map(pointer => pointer.keyId))
  if (keyIds.has(undefined)) {
    throw new CheapLfsCommitKeyError(
      'This legacy private Cheap LFS OCI pointer has no key identity. Materialize and pin it again before committing, or retry where its bounded image config can be verified.',
      pointerPaths
    )
  }
  if (keyIds.size !== 1) {
    throw new CheapLfsCommitKeyError(
      'The selected private Cheap LFS OCI pointers require different repository keys.',
      pointerPaths
    )
  }
  const expectedKeyId = [...keyIds][0]!
  let resolved
  try {
    resolved = await resolveCheapLfsRegistryRepositoryKeyForId({
      repositoryPath,
      keyId: expectedKeyId,
    })
  } catch (error) {
    throw new CheapLfsCommitKeyError(
      error instanceof Error ? error.message : String(error),
      pointerPaths
    )
  }
  if (resolved.path === null || resolved.key === null) {
    throw new CheapLfsCommitKeyError(
      'Cheap LFS could not resolve the canonical tracked repository key.',
      pointerPaths
    )
  }
  try {
    const expectedPath = join(
      resolve(repositoryPath),
      ...CheapLfsRegistryRepositoryKeyPath.split('/')
    )
    if (basename(resolved.path) !== 'cheap-lfs-registry-key-v1') {
      throw new CheapLfsCommitKeyError(
        'The selected private pointer requires the canonical tracked Cheap LFS repository key; a legacy key is not migrated during commit validation.',
        pointerPaths
      )
    }
    let actualCanonical: string
    let expectedCanonical: string
    try {
      ;[actualCanonical, expectedCanonical] = await Promise.all([
        realpath(resolved.path),
        realpath(expectedPath),
      ])
    } catch {
      throw new CheapLfsCommitKeyError(
        'Cheap LFS could not prove the canonical tracked repository key without changing the checkout.',
        pointerPaths
      )
    }
    if (
      actualCanonical.toLowerCase() !== expectedCanonical.toLowerCase() ||
      cheapLfsRegistryRepositoryKeyId(resolved.key) !== expectedKeyId
    ) {
      throw new CheapLfsCommitKeyError(
        'The canonical tracked Cheap LFS repository key does not match the selected private pointer.',
        pointerPaths
      )
    }
    const contentSha256 = cheapLfsRegistryRepositoryKeyTextSha256(resolved.key)
    const head = await git(
      ['show', `HEAD:${CheapLfsRegistryRepositoryKeyPath}`],
      repositoryPath,
      'readCheapLfsCommitKeyFromHead',
      { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
    )
    const headSha256 =
      head.exitCode === 0
        ? createHash('sha256').update(head.stdout, 'utf8').digest('hex')
        : null
    return {
      relativePath: CheapLfsRegistryRepositoryKeyPath,
      contentSha256,
      changesTree: headSha256 !== contentSha256,
      boundPointerFiles: entries.map(entry => ({
        relativePath: entry.relativePath,
        contentSha256: entry.contentSha256,
      })),
    }
  } finally {
    resolved.key.fill(0)
  }
}
