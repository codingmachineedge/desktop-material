import { Buffer } from 'buffer'
import { randomBytes } from 'crypto'
import { Stats } from 'fs'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'fs/promises'
import * as Path from 'path'
import {
  BatchCloneRecoveryIdBytes,
  IBatchCloneItem,
  MaxBatchCloneAccountKeyLength,
  MaxBatchClonePathLength,
  isBatchCloneRecoveryId,
} from '../../models/batch-clone'
import { git } from '../git/core'
import { urlsMatch } from '../repository-matching'

export const BatchCloneStagingVersion = 1
export const BatchCloneStagingDirectoryName =
  '.desktop-material-clone-staging-v1'
export const BatchCloneStagingCheckoutName = 'checkout'
export const BatchCloneStagingMarkerName = 'owner.json'
export const BatchClonePromotionMarkerName =
  'desktop-material-clone-promotion-v1.json'
const MaxBatchCloneStagingMarkerBytes = 64 * 1024

interface IBatchCloneStagingMarker {
  readonly version: typeof BatchCloneStagingVersion
  readonly kind: 'desktop-material-batch-clone-staging'
  readonly recoveryId: string
  readonly finalPath: string
  readonly url: string
  readonly name: string
  readonly preferredAccountKey: string | null
  readonly cloneCompleted: boolean
  readonly successfulAccountKey?: string | null
}

interface IBatchClonePromotionMarker {
  readonly version: typeof BatchCloneStagingVersion
  readonly kind: 'desktop-material-batch-clone-promotion'
  readonly recoveryId: string
  readonly finalPath: string
  readonly url: string
  readonly successfulAccountKey: string | null
}

export interface IBatchCloneStagingPaths {
  readonly basePath: string
  readonly containerPath: string
  readonly recoveryRootPath: string
  readonly markerPath: string
  readonly checkoutPath: string
}

export type BatchCloneStagingPreparation =
  | { readonly kind: 'clone'; readonly clonePath: string }
  | { readonly kind: 'done'; readonly accountKey: string | null }
  | { readonly kind: 'review'; readonly error: Error }

export type BatchCloneStagingCompletion =
  | { readonly kind: 'done'; readonly accountKey: string | null }
  | { readonly kind: 'review'; readonly error: Error }

export interface IBatchCloneStagingManager {
  prepare(item: IBatchCloneItem): Promise<BatchCloneStagingPreparation>
  reinspect(item: IBatchCloneItem, clonePath: string): Promise<boolean>
  completeAndPromote(
    item: IBatchCloneItem,
    clonePath: string,
    successfulAccountKey: string | null
  ): Promise<BatchCloneStagingCompletion>
  cleanupPromoted(item: IBatchCloneItem): Promise<boolean>
  discard(item: IBatchCloneItem): Promise<boolean>
}

export function createBatchCloneRecoveryId(): string {
  return randomBytes(BatchCloneRecoveryIdBytes).toString('hex')
}

export function getBatchCloneStagingPaths(
  item: IBatchCloneItem
): IBatchCloneStagingPaths {
  if (!isBatchCloneRecoveryId(item.recoveryId)) {
    throw new Error('The clone recovery identity is missing or invalid.')
  }

  const finalPath = Path.resolve(item.path)
  const basePath = Path.dirname(finalPath)
  const containerPath = Path.join(basePath, BatchCloneStagingDirectoryName)
  const recoveryRootPath = Path.join(containerPath, item.recoveryId)
  const checkoutPath = Path.join(
    recoveryRootPath,
    BatchCloneStagingCheckoutName
  )

  for (const path of [containerPath, recoveryRootPath, checkoutPath]) {
    if (path.length > MaxBatchClonePathLength) {
      throw new Error('The staged clone path exceeds the supported length.')
    }
  }

  return {
    basePath,
    containerPath,
    recoveryRootPath,
    markerPath: Path.join(recoveryRootPath, BatchCloneStagingMarkerName),
    checkoutPath,
  }
}

/**
 * Owns v2 batch-clone staging. Only a strictly matching marker permits cleanup
 * or promotion; ambiguous paths are retained for explicit user review.
 */
export class FileBatchCloneStagingManager implements IBatchCloneStagingManager {
  public async prepare(
    item: IBatchCloneItem
  ): Promise<BatchCloneStagingPreparation> {
    try {
      const paths = getBatchCloneStagingPaths(item)
      if (!(await isCanonicalOrdinaryDirectory(paths.basePath))) {
        return review(
          'The clone base directory is missing, linked, or no longer resolves to the selected location.'
        )
      }

      const finalEntry = await lstatOrNull(item.path)
      if (finalEntry !== null) {
        if (!isOrdinaryDirectory(finalEntry)) {
          return review(
            'The final clone destination is occupied or linked and will not be changed.'
          )
        }
        const promoted = await this.recoverPromoted(item, paths)
        return (
          promoted ??
          review(
            'The final clone destination is occupied and is not a verified promotion owned by this queue.'
          )
        )
      }

      const container = await this.ensureContainer(paths)
      if (!container) {
        return review(
          'The clone staging container is missing, linked, or not owned safely.'
        )
      }

      const recoveryRoot = await lstatOrNull(paths.recoveryRootPath)
      if (recoveryRoot === null) {
        return await this.createOwnedRoot(item, paths)
      }
      if (!isOrdinaryDirectory(recoveryRoot)) {
        return review(
          'The clone recovery root is linked or is not an ordinary directory.'
        )
      }

      const marker = await readStagingMarker(item, paths)
      if (marker === null) {
        return review(
          'The clone recovery marker is missing or does not match this queue.'
        )
      }

      const checkout = await lstatOrNull(paths.checkoutPath)
      if (marker.cloneCompleted) {
        if (checkout === null || !isOrdinaryDirectory(checkout)) {
          return review(
            'The completed staged clone is missing or linked and cannot be promoted.'
          )
        }
        return await this.promoteReadyCheckout(item, paths, marker)
      }

      if (checkout === null) {
        return { kind: 'clone', clonePath: paths.checkoutPath }
      }
      if (!isOrdinaryDirectory(checkout)) {
        return review(
          'The interrupted staged clone is linked and will not be deleted or resumed.'
        )
      }

      // A clone process never resumes safely in-place. A valid ownership marker
      // permits removing only this app-owned checkout and starting it again.
      if (!(await this.discardOwnedRoot(item, paths, marker))) {
        return review(
          'The interrupted staged clone contains unexpected data and will not be deleted.'
        )
      }
      if (!(await this.ensureContainer(paths))) {
        return review(
          'The clone staging container changed while the interrupted clone was being restarted.'
        )
      }
      return await this.createOwnedRoot(item, paths)
    } catch (error) {
      log.error('Unable to prepare a staged batch clone', error)
      return review(
        'The clone staging area could not be inspected safely and was left unchanged.'
      )
    }
  }

  public async reinspect(
    item: IBatchCloneItem,
    clonePath: string
  ): Promise<boolean> {
    try {
      const paths = getBatchCloneStagingPaths(item)
      if (!pathsEqual(paths.checkoutPath, clonePath)) {
        return false
      }
      if (
        !(await isCanonicalOrdinaryDirectory(paths.basePath)) ||
        !(await isCanonicalOrdinaryDirectory(paths.containerPath)) ||
        !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
        (await lstatOrNull(item.path)) !== null ||
        (await lstatOrNull(paths.checkoutPath)) !== null
      ) {
        return false
      }

      const marker = await readStagingMarker(item, paths)
      return marker !== null && marker.cloneCompleted === false
    } catch (error) {
      log.error('Unable to reinspect a staged batch clone', error)
      return false
    }
  }

  public async completeAndPromote(
    item: IBatchCloneItem,
    clonePath: string,
    successfulAccountKey: string | null
  ): Promise<BatchCloneStagingCompletion> {
    try {
      if (
        successfulAccountKey !== null &&
        successfulAccountKey.length > MaxBatchCloneAccountKeyLength
      ) {
        return review('The successful clone account identity is invalid.')
      }

      const paths = getBatchCloneStagingPaths(item)
      if (
        !pathsEqual(paths.checkoutPath, clonePath) ||
        !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
        (await lstatOrNull(item.path)) !== null
      ) {
        return review(
          'The final destination or staging root changed while cloning and was left unchanged.'
        )
      }

      const marker = await readStagingMarker(item, paths)
      if (marker === null || marker.cloneCompleted) {
        return review(
          'The clone recovery marker changed while cloning and was left unchanged.'
        )
      }
      if (
        !(await inspectStagedCloneRepository(
          paths.checkoutPath,
          item.url,
          true
        ))
      ) {
        return review(
          'The staged repository is incomplete, dirty, has unfinished submodules, or has a different origin.'
        )
      }

      const completedMarker: IBatchCloneStagingMarker = {
        ...marker,
        cloneCompleted: true,
        successfulAccountKey,
      }
      await replaceStagingMarker(paths.markerPath, completedMarker)
      return await this.promoteReadyCheckout(item, paths, completedMarker)
    } catch (error) {
      log.error('Unable to promote a staged batch clone', error)
      return review(
        'The staged repository could not be promoted safely and was left for review.'
      )
    }
  }

  public async cleanupPromoted(item: IBatchCloneItem): Promise<boolean> {
    try {
      const paths = getBatchCloneStagingPaths(item)
      const promotionPath = promotionMarkerPath(item.path)
      const root = await lstatOrNull(paths.recoveryRootPath)
      const promotionEntry = await lstatOrNull(promotionPath)

      // A previous cleanup may have removed the outer marker first. The inner
      // marker remains sufficient ownership proof, but only when the final
      // repository still matches this exact queue item.
      if (root === null) {
        if (promotionEntry === null) {
          return true
        }
        if (
          (await readPromotionMarker(item, promotionPath)) === null ||
          !(await inspectStagedCloneRepository(item.path, item.url, true))
        ) {
          return false
        }
        await unlink(promotionPath)
        return (await lstatOrNull(promotionPath)) === null
      }
      if (!isOrdinaryDirectory(root)) {
        return false
      }
      const marker = await readStagingMarker(item, paths)
      if (marker === null || !marker.cloneCompleted) {
        return false
      }
      if ((await lstatOrNull(paths.checkoutPath)) !== null) {
        return false
      }
      if (!(await inspectStagedCloneRepository(item.path, item.url, true))) {
        return false
      }

      if (promotionEntry !== null) {
        const promotion = await readPromotionMarker(item, promotionPath)
        if (
          promotion === null ||
          promotion.successfulAccountKey !==
            (marker.successfulAccountKey ?? null)
        ) {
          return false
        }
        await unlink(promotionPath)
      }
      if (!(await removeEmptyOwnedRoot(item, paths, marker))) {
        return false
      }
      return (
        (await lstatOrNull(paths.recoveryRootPath)) === null &&
        (await lstatOrNull(promotionPath)) === null
      )
    } catch (error) {
      log.error('Unable to clean promoted clone staging metadata', error)
      return false
    }
  }

  public async discard(item: IBatchCloneItem): Promise<boolean> {
    try {
      const paths = getBatchCloneStagingPaths(item)
      const root = await lstatOrNull(paths.recoveryRootPath)
      if (root === null) {
        return true
      }
      if (
        !isOrdinaryDirectory(root) ||
        (await lstatOrNull(item.path)) !== null
      ) {
        return false
      }
      const marker = await readStagingMarker(item, paths)
      return marker !== null
        ? await this.discardOwnedRoot(item, paths, marker)
        : false
    } catch (error) {
      log.error('Unable to discard clone staging metadata', error)
      return false
    }
  }

  private async ensureContainer(
    paths: IBatchCloneStagingPaths
  ): Promise<boolean> {
    const existing = await lstatOrNull(paths.containerPath)
    if (existing === null) {
      try {
        await mkdir(paths.containerPath, { mode: 0o700 })
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          throw error
        }
      }
    }
    return isCanonicalOrdinaryDirectory(paths.containerPath)
  }

  private async createOwnedRoot(
    item: IBatchCloneItem,
    paths: IBatchCloneStagingPaths
  ): Promise<BatchCloneStagingPreparation> {
    if ((await lstatOrNull(item.path)) !== null) {
      return review(
        'The final clone destination became occupied and will not be changed.'
      )
    }
    try {
      await mkdir(paths.recoveryRootPath, { mode: 0o700 })
    } catch (error) {
      return review(
        errorCode(error) === 'EEXIST'
          ? 'The clone recovery identity is already in use and will not be trusted.'
          : 'The clone recovery root could not be created safely.'
      )
    }

    const marker = initialStagingMarker(item)
    try {
      await writeMarkerExclusive(paths.markerPath, marker)
    } catch (error) {
      log.error('Unable to write clone staging ownership marker', error)
      return review(
        'The clone recovery marker could not be created; the staging root was left unchanged.'
      )
    }

    if (
      !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
      (await readStagingMarker(item, paths)) === null
    ) {
      return review(
        'The clone recovery root changed while it was being created.'
      )
    }
    return { kind: 'clone', clonePath: paths.checkoutPath }
  }

  private async recoverPromoted(
    item: IBatchCloneItem,
    paths: IBatchCloneStagingPaths
  ): Promise<BatchCloneStagingPreparation | null> {
    if (
      !(await isCanonicalOrdinaryDirectory(paths.containerPath)) ||
      !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
      (await lstatOrNull(paths.checkoutPath)) !== null
    ) {
      return null
    }
    const marker = await readStagingMarker(item, paths)
    if (marker === null || !marker.cloneCompleted) {
      return null
    }
    const promotion = await readPromotionMarker(
      item,
      promotionMarkerPath(item.path)
    )
    if (
      promotion === null ||
      promotion.successfulAccountKey !==
        (marker.successfulAccountKey ?? null) ||
      !(await inspectStagedCloneRepository(item.path, item.url, true))
    ) {
      return null
    }
    return {
      kind: 'done',
      accountKey: marker.successfulAccountKey ?? null,
    }
  }

  private async promoteReadyCheckout(
    item: IBatchCloneItem,
    paths: IBatchCloneStagingPaths,
    marker: IBatchCloneStagingMarker
  ): Promise<BatchCloneStagingCompletion> {
    if (!marker.cloneCompleted) {
      return review('The staged clone has not completed successfully.')
    }
    if (
      !(await isCanonicalOrdinaryDirectory(paths.basePath)) ||
      !(await isCanonicalOrdinaryDirectory(paths.containerPath)) ||
      !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
      !isOrdinaryDirectory(await requireEntry(paths.checkoutPath)) ||
      (await lstatOrNull(item.path)) !== null ||
      !(await inspectStagedCloneRepository(paths.checkoutPath, item.url, true))
    ) {
      return review(
        'The staged clone or final destination changed before promotion and was left unchanged.'
      )
    }

    const successfulAccountKey = marker.successfulAccountKey ?? null
    const promotionMarker: IBatchClonePromotionMarker = {
      version: BatchCloneStagingVersion,
      kind: 'desktop-material-batch-clone-promotion',
      recoveryId: marker.recoveryId,
      finalPath: marker.finalPath,
      url: marker.url,
      successfulAccountKey,
    }
    const promotionPath = promotionMarkerPath(paths.checkoutPath)
    const existingPromotion = await lstatOrNull(promotionPath)
    if (existingPromotion === null) {
      await writeMarkerExclusive(promotionPath, promotionMarker)
    } else {
      const parsed = await readPromotionMarker(item, promotionPath)
      if (
        parsed === null ||
        parsed.successfulAccountKey !== successfulAccountKey
      ) {
        return review(
          'The staged clone promotion marker is missing or does not match this queue.'
        )
      }
    }

    // Revalidate after writing the durable promotion proof. rename is the only
    // operation which publishes the checkout into the user-visible path.
    if (
      (await lstatOrNull(item.path)) !== null ||
      !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
      !(await inspectStagedCloneRepository(paths.checkoutPath, item.url, true))
    ) {
      return review(
        'The staged clone or final destination changed before the atomic promotion.'
      )
    }

    try {
      await rename(paths.checkoutPath, item.path)
    } catch (error) {
      return review(
        errorCode(error) === 'EEXIST' || errorCode(error) === 'ENOTEMPTY'
          ? 'The final clone destination became occupied and was not replaced.'
          : 'The staged clone could not be promoted atomically and was left unchanged.'
      )
    }

    const finalPromotion = await readPromotionMarker(
      item,
      promotionMarkerPath(item.path)
    )
    if (
      finalPromotion === null ||
      finalPromotion.successfulAccountKey !== successfulAccountKey ||
      !(await inspectStagedCloneRepository(item.path, item.url, true))
    ) {
      return review(
        'The promoted repository could not be verified and was left for review.'
      )
    }
    return { kind: 'done', accountKey: successfulAccountKey }
  }

  private async discardOwnedRoot(
    item: IBatchCloneItem,
    paths: IBatchCloneStagingPaths,
    marker: IBatchCloneStagingMarker
  ): Promise<boolean> {
    if (
      marker.recoveryId !== item.recoveryId ||
      !(await isCanonicalOrdinaryDirectory(paths.recoveryRootPath)) ||
      (await lstatOrNull(item.path)) !== null
    ) {
      return false
    }

    const names = await readdir(paths.recoveryRootPath)
    if (
      names.some(
        name =>
          name !== BatchCloneStagingMarkerName &&
          name !== BatchCloneStagingCheckoutName
      )
    ) {
      return false
    }
    const checkout = await lstatOrNull(paths.checkoutPath)
    if (checkout !== null) {
      if (!isOrdinaryDirectory(checkout)) {
        return false
      }
      // fs.rm unlinks symlinks encountered inside the owned checkout instead
      // of traversing them. Boundary links were rejected above.
      await rm(paths.checkoutPath, { recursive: true, force: false })
    }
    await unlink(paths.markerPath)
    await rmdir(paths.recoveryRootPath)
    return true
  }
}

function initialStagingMarker(item: IBatchCloneItem): IBatchCloneStagingMarker {
  if (!isBatchCloneRecoveryId(item.recoveryId)) {
    throw new Error('The clone recovery identity is invalid.')
  }
  return {
    version: BatchCloneStagingVersion,
    kind: 'desktop-material-batch-clone-staging',
    recoveryId: item.recoveryId,
    finalPath: item.path,
    url: item.url,
    name: item.name,
    preferredAccountKey: item.accountKey ?? null,
    cloneCompleted: false,
  }
}

async function readStagingMarker(
  item: IBatchCloneItem,
  paths: IBatchCloneStagingPaths
): Promise<IBatchCloneStagingMarker | null> {
  const value = await readBoundedMarker(paths.markerPath)
  if (!isStagingMarker(value)) {
    return null
  }
  return value.recoveryId === item.recoveryId &&
    value.finalPath === item.path &&
    value.url === item.url &&
    value.name === item.name &&
    value.preferredAccountKey === (item.accountKey ?? null)
    ? value
    : null
}

async function readPromotionMarker(
  item: IBatchCloneItem,
  path: string
): Promise<IBatchClonePromotionMarker | null> {
  const value = await readBoundedMarker(path)
  if (!isPromotionMarker(value)) {
    return null
  }
  return value.recoveryId === item.recoveryId &&
    value.finalPath === item.path &&
    value.url === item.url
    ? value
    : null
}

async function readBoundedMarker(path: string): Promise<unknown | null> {
  try {
    const metadata = await lstat(path)
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > MaxBatchCloneStagingMarkerBytes
    ) {
      return null
    }
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      log.error(`Unable to read clone staging marker ${path}`, error)
    }
    return null
  }
}

function isStagingMarker(value: unknown): value is IBatchCloneStagingMarker {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const marker = value as Partial<IBatchCloneStagingMarker>
  const allowed = new Set([
    'version',
    'kind',
    'recoveryId',
    'finalPath',
    'url',
    'name',
    'preferredAccountKey',
    'cloneCompleted',
    'successfulAccountKey',
  ])
  if (Object.keys(marker).some(key => !allowed.has(key))) {
    return false
  }
  const accountValid = (value: unknown) =>
    value === null ||
    (typeof value === 'string' && value.length <= MaxBatchCloneAccountKeyLength)
  return (
    marker.version === BatchCloneStagingVersion &&
    marker.kind === 'desktop-material-batch-clone-staging' &&
    isBatchCloneRecoveryId(marker.recoveryId) &&
    typeof marker.finalPath === 'string' &&
    marker.finalPath.length <= MaxBatchClonePathLength &&
    Path.isAbsolute(marker.finalPath) &&
    typeof marker.url === 'string' &&
    typeof marker.name === 'string' &&
    accountValid(marker.preferredAccountKey) &&
    typeof marker.cloneCompleted === 'boolean' &&
    (marker.cloneCompleted
      ? accountValid(marker.successfulAccountKey)
      : marker.successfulAccountKey === undefined)
  )
}

function isPromotionMarker(
  value: unknown
): value is IBatchClonePromotionMarker {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const marker = value as Partial<IBatchClonePromotionMarker>
  const keys = Object.keys(marker).sort().join(',')
  return (
    keys === 'finalPath,kind,recoveryId,successfulAccountKey,url,version' &&
    marker.version === BatchCloneStagingVersion &&
    marker.kind === 'desktop-material-batch-clone-promotion' &&
    isBatchCloneRecoveryId(marker.recoveryId) &&
    typeof marker.finalPath === 'string' &&
    marker.finalPath.length <= MaxBatchClonePathLength &&
    Path.isAbsolute(marker.finalPath) &&
    typeof marker.url === 'string' &&
    (marker.successfulAccountKey === null ||
      (typeof marker.successfulAccountKey === 'string' &&
        marker.successfulAccountKey.length <= MaxBatchCloneAccountKeyLength))
  )
}

async function writeMarkerExclusive(
  path: string,
  value: unknown
): Promise<void> {
  const raw = serializeMarker(value)
  await writeFile(path, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

async function replaceStagingMarker(
  markerPath: string,
  marker: IBatchCloneStagingMarker
): Promise<void> {
  const temporaryPath = `${markerPath}.tmp-${randomBytes(8).toString('hex')}`
  await writeMarkerExclusive(temporaryPath, marker)
  try {
    await rename(temporaryPath, markerPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function serializeMarker(value: unknown): string {
  const raw = `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(raw, 'utf8') > MaxBatchCloneStagingMarkerBytes) {
    throw new Error('The clone staging marker exceeds its supported size.')
  }
  return raw
}

function promotionMarkerPath(repositoryPath: string): string {
  return Path.join(repositoryPath, '.git', BatchClonePromotionMarkerName)
}

/**
 * Validate a completed staged checkout without network access. Empty
 * repositories are accepted only because the durable staging marker records
 * that `git clone` returned success.
 */
export async function inspectStagedCloneRepository(
  repositoryPath: string,
  expectedOrigin: string,
  allowEmptyRepository: boolean
): Promise<boolean> {
  try {
    const repositoryEntry = await lstat(repositoryPath)
    const gitDirectoryPath = Path.join(repositoryPath, '.git')
    const gitDirectory = await lstat(gitDirectoryPath)
    if (
      !isOrdinaryDirectory(repositoryEntry) ||
      !isOrdinaryDirectory(gitDirectory)
    ) {
      return false
    }

    const repository = await git(
      ['rev-parse', '--is-inside-work-tree'],
      repositoryPath,
      'batchCloneStagingRepository',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    const bare = await git(
      ['rev-parse', '--is-bare-repository'],
      repositoryPath,
      'batchCloneStagingBareRepository',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (
      repository.exitCode !== 0 ||
      repository.stdout.trim() !== 'true' ||
      bare.exitCode !== 0 ||
      bare.stdout.trim() !== 'false'
    ) {
      return false
    }

    const origin = await git(
      ['remote', 'get-url', 'origin'],
      repositoryPath,
      'batchCloneStagingOrigin',
      { successExitCodes: new Set([0, 2, 128]), isBackgroundTask: true }
    )
    if (
      origin.exitCode !== 0 ||
      !urlsMatch(origin.stdout.trim(), expectedOrigin)
    ) {
      return false
    }

    const head = await git(
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      repositoryPath,
      'batchCloneStagingHead',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (head.exitCode !== 0 || head.stdout.trim().length === 0) {
      if (!allowEmptyRepository) {
        return false
      }
      const symbolicHead = await git(
        ['symbolic-ref', '-q', 'HEAD'],
        repositoryPath,
        'batchCloneStagingEmptyHead',
        { successExitCodes: new Set([0, 1, 128]), isBackgroundTask: true }
      )
      const refs = await git(
        [
          'for-each-ref',
          '--format=%(objectname)',
          'refs/heads',
          'refs/remotes',
        ],
        repositoryPath,
        'batchCloneStagingEmptyRefs',
        { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
      )
      if (
        symbolicHead.exitCode !== 0 ||
        !symbolicHead.stdout.trim().startsWith('refs/heads/') ||
        refs.exitCode !== 0 ||
        refs.stdout.trim().length > 0
      ) {
        return false
      }
    }

    const checkout = await git(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      repositoryPath,
      'batchCloneStagingCheckout',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (checkout.exitCode !== 0 || checkout.stdout.trim().length > 0) {
      return false
    }

    const submodules = await git(
      ['submodule', 'status', '--recursive'],
      repositoryPath,
      'batchCloneStagingSubmodules',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (submodules.exitCode !== 0) {
      return false
    }
    return submodules.stdout
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .every(line => line.startsWith(' '))
  } catch (error) {
    log.error(`Unable to inspect staged clone ${repositoryPath}`, error)
    return false
  }
}

async function isCanonicalOrdinaryDirectory(path: string): Promise<boolean> {
  const resolved = Path.resolve(path)
  const parsed = Path.parse(resolved)
  let current = parsed.root
  const segments = resolved
    .slice(parsed.root.length)
    .split(Path.sep)
    .filter(segment => segment.length > 0)

  try {
    const root = await lstat(current)
    if (!isOrdinaryDirectory(root)) {
      return false
    }
    for (const segment of segments) {
      current = Path.join(current, segment)
      const metadata = await lstat(current)
      if (!isOrdinaryDirectory(metadata)) {
        return false
      }
    }
    return pathsEqual(resolved, await realpath(resolved))
  } catch {
    return false
  }
}

function isOrdinaryDirectory(metadata: Stats): boolean {
  return metadata.isDirectory() && !metadata.isSymbolicLink()
}

async function requireEntry(path: string): Promise<Stats> {
  return await lstat(path)
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null
    }
    throw error
  }
}

function pathsEqual(first: string, second: string): boolean {
  const normalize = (path: string) => {
    const normalized = Path.normalize(path)
    return process.platform === 'win32'
      ? normalized.toLocaleLowerCase('en-US')
      : normalized
  }
  return normalize(first) === normalize(second)
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined
}

function review(message: string): {
  readonly kind: 'review'
  readonly error: Error
} {
  return { kind: 'review', error: new Error(message) }
}

async function removeEmptyOwnedRoot(
  item: IBatchCloneItem,
  paths: IBatchCloneStagingPaths,
  expectedMarker: IBatchCloneStagingMarker
): Promise<boolean> {
  const names = await readdir(paths.recoveryRootPath)
  const marker = await readStagingMarker(item, paths)
  if (
    names.length !== 1 ||
    names[0] !== BatchCloneStagingMarkerName ||
    marker === null ||
    !marker.cloneCompleted ||
    marker.successfulAccountKey !== expectedMarker.successfulAccountKey
  ) {
    return false
  }
  await unlink(paths.markerPath)
  await rmdir(paths.recoveryRootPath)
  return true
}
