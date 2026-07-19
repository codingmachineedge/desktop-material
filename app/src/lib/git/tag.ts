import { git } from './core'
import { Repository } from '../../models/repository'
import { IRemote } from '../../models/remote'
import { envForRemoteOperation } from './environment'

const MaxTagNameLength = 245
const MaxTagTargetLength = 512
const MaxTagMessageLength = 64 * 1024
const MaxTagInventoryEntries = 500
const MaxTagInventoryOutputBytes = 4 * 1024 * 1024

export type TagKind = 'lightweight' | 'annotated'

/** One bounded local tag row shown by the tag lifecycle manager. */
export interface ILocalTagLifecycleEntry {
  readonly name: string
  /** Object stored directly in refs/tags/name (a tag object when annotated). */
  readonly refObject: string
  /** Peeled target for annotated tags, or refObject for lightweight tags. */
  readonly target: string
  readonly kind: TagKind
  readonly message: string
  readonly tagger: string
  readonly taggedAt: string | null
  readonly signed: boolean
}

/** One tag advertised by the reviewed remote. */
export interface IRemoteTagLifecycleEntry {
  readonly name: string
  readonly refObject: string
  readonly target: string
}

export interface ITagLifecycleInventory {
  readonly local: ReadonlyArray<ILocalTagLifecycleEntry>
  /** Null until the user explicitly asks for a network-backed inventory. */
  readonly remote: ReadonlyArray<IRemoteTagLifecycleEntry> | null
  readonly remoteName: string | null
  readonly localTruncated: boolean
  readonly remoteTruncated: boolean
  readonly signingConfigured: boolean
  readonly signingFormat: string
}

export interface ICreateTagLifecycleOptions {
  readonly name: string
  readonly target: string
  readonly kind: TagKind
  readonly message?: string
  readonly sign?: boolean
}

export interface IMoveTagLifecycleOptions extends ICreateTagLifecycleOptions {
  /** Exact ref object reviewed by the user; rejects stale move confirmations. */
  readonly expectedRefObject: string
}

export interface ITagRefReview {
  readonly name: string
  /** Exact local or remote ref object reviewed by the user. */
  readonly expectedRefObject: string
}

export type IRemoteTagDeletionReview = ITagRefReview

/** A local object plus the exact remote state reviewed before push. */
export interface ITagPushReview extends ITagRefReview {
  /** Null means the reviewed remote did not advertise this tag. */
  readonly expectedRemoteRefObject: string | null
}

function assertBoundedString(
  value: string,
  label: string,
  maximumLength: number,
  allowEmpty = false
): string {
  if ((!allowEmpty && value.length === 0) || value.length > maximumLength) {
    throw new Error(
      `${label} must be ${
        allowEmpty ? 'at most' : 'between 1 and'
      } ${maximumLength} characters.`
    )
  }
  if (/\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} contains an unsupported control character.`)
  }
  return value
}

/**
 * Fail closed before any tag name reaches Git. `check-ref-format` remains the
 * final authority, while these checks also prevent argv option confusion.
 */
async function validateTagName(
  repository: Repository,
  rawName: string
): Promise<string> {
  const name = validateTagNameShape(rawName)

  const result = await git(
    ['check-ref-format', `refs/tags/${name}`],
    repository.path,
    'validateTagName',
    { successExitCodes: new Set([0, 1]) }
  )
  if (result.exitCode !== 0) {
    throw new Error(`'${name}' is not a valid Git tag name.`)
  }
  return name
}

/** Strict bulk-review validation without starting one Git process per tag. */
function validateTagNameShape(rawName: string): string {
  const name = assertBoundedString(rawName.trim(), 'Tag name', MaxTagNameLength)
  if (name.startsWith('-') || name !== rawName) {
    throw new Error(
      'Tag names cannot start with a dash or contain outer spaces.'
    )
  }
  if (
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.includes('..') ||
    name.includes('@{') ||
    name.includes('//') ||
    /[\0-\x20\x7f~^:?*\[\\]/.test(name) ||
    name.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))
  ) {
    throw new Error(`'${name}' is not a valid Git tag name.`)
  }
  return name
}

function validateRemote(remote: IRemote): IRemote {
  assertBoundedString(remote.name, 'Remote name', 255)
  if (remote.name.startsWith('-') || /\s/.test(remote.name)) {
    throw new Error('The selected remote has an invalid name.')
  }
  return remote
}

function validateExpectedObject(value: string, label: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) {
    throw new Error(`${label} is not a full Git object ID.`)
  }
  return value.toLowerCase()
}

async function resolveTagTarget(
  repository: Repository,
  rawTarget: string
): Promise<string> {
  const target = assertBoundedString(
    rawTarget.trim(),
    'Tag target',
    MaxTagTargetLength
  )
  if (target.startsWith('-') || target !== rawTarget) {
    throw new Error(
      'Tag targets cannot start with a dash or contain outer spaces.'
    )
  }

  const result = await git(
    ['rev-parse', '--verify', `${target}^{object}`],
    repository.path,
    'resolveTagTarget'
  )
  const oid = result.stdout.trim()
  return validateExpectedObject(oid, 'Resolved tag target')
}

function tagCreationArguments(
  options: ICreateTagLifecycleOptions,
  name: string,
  targetOid: string,
  force: boolean
): ReadonlyArray<string> {
  const args = ['tag']
  if (options.kind !== 'annotated' && options.kind !== 'lightweight') {
    throw new Error('Choose either a lightweight or annotated tag.')
  }
  if (force) {
    args.push('--force')
  }

  if (options.kind === 'annotated') {
    const message = assertBoundedString(
      options.message ?? '',
      'Tag message',
      MaxTagMessageLength,
      true
    )
    args.push(
      options.sign === true ? '--sign' : '--annotate',
      '--message',
      message
    )
  } else if (options.sign === true) {
    throw new Error('Only annotated tags can be signed.')
  }

  args.push(name, targetOid)
  return args
}

function assertInventoryOutput(stdout: string): void {
  if (Buffer.byteLength(stdout, 'utf8') > MaxTagInventoryOutputBytes) {
    throw new Error('The tag inventory is too large to display safely.')
  }
}

function displayText(value: string, maximumLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength)
}

/** Load local and, when requested, remote tags without exposing raw Git. */
export async function getTagLifecycleInventory(
  repository: Repository,
  remote: IRemote | null
): Promise<ITagLifecycleInventory> {
  const format = [
    '%(refname:strip=2)',
    '%(objecttype)',
    '%(objectname)',
    '%(*objectname)',
    '%(contents:subject)',
    '%(taggername)',
    '%(taggerdate:iso-strict)',
    '%(contents:signature)',
  ].join('%00')
  const localResult = await git(
    [
      'for-each-ref',
      '--sort=-creatordate',
      `--count=${MaxTagInventoryEntries + 1}`,
      `--format=${format}%1e`,
      'refs/tags',
    ],
    repository.path,
    'getTagLifecycleInventory'
  )
  assertInventoryOutput(localResult.stdout)

  const localRows = localResult.stdout
    .split('\x1e')
    .map(row => row.replace(/^\r?\n|\r?\n$/g, ''))
    .filter(row => row.length > 0)
  const local = localRows.slice(0, MaxTagInventoryEntries).map(row => {
    const [
      name,
      objectType,
      refObject,
      peeledObject,
      message,
      tagger,
      taggedAt,
      signature,
    ] = row.split('\0')
    if (
      name === undefined ||
      objectType === undefined ||
      refObject === undefined ||
      peeledObject === undefined
    ) {
      throw new Error('Git returned a malformed local tag inventory row.')
    }
    const kind: TagKind = objectType === 'tag' ? 'annotated' : 'lightweight'
    return {
      name,
      refObject: validateExpectedObject(refObject, 'Local tag object'),
      target: validateExpectedObject(
        kind === 'annotated' && peeledObject.length > 0
          ? peeledObject
          : refObject,
        'Local tag target'
      ),
      kind,
      message: displayText(message ?? '', 512),
      tagger: displayText(tagger ?? '', 256),
      taggedAt: taggedAt !== undefined && taggedAt.length > 0 ? taggedAt : null,
      signed: (signature ?? '').trim().length > 0,
    }
  })

  const signingKeyResult = await git(
    ['config', '--get', 'user.signingkey'],
    repository.path,
    'getTagSigningKey',
    { successExitCodes: new Set([0, 1]) }
  )
  const signingFormatResult = await git(
    ['config', '--get', 'gpg.format'],
    repository.path,
    'getTagSigningFormat',
    { successExitCodes: new Set([0, 1]) }
  )

  let remoteEntries: ReadonlyArray<IRemoteTagLifecycleEntry> | null = null
  let remoteTruncated = false
  if (remote !== null) {
    const reviewedRemote = validateRemote(remote)
    const remoteResult = await git(
      ['ls-remote', '--tags', reviewedRemote.name],
      repository.path,
      'getRemoteTagLifecycleInventory',
      { env: await envForRemoteOperation(reviewedRemote.url) }
    )
    assertInventoryOutput(remoteResult.stdout)
    const byName = new Map<
      string,
      { refObject?: string; peeledObject?: string }
    >()
    for (const line of remoteResult.stdout.split(/\r?\n/)) {
      if (line.length === 0) {
        continue
      }
      const match = /^([0-9a-f]{40,64})\trefs\/tags\/(.+?)(\^\{\})?$/.exec(line)
      if (match === null) {
        continue
      }
      const name = match[2]
      if (byName.size >= MaxTagInventoryEntries + 1 && !byName.has(name)) {
        remoteTruncated = true
        continue
      }
      const entry = byName.get(name) ?? {}
      if (match[3] === undefined) {
        entry.refObject = match[1]
      } else {
        entry.peeledObject = match[1]
      }
      byName.set(name, entry)
    }
    remoteTruncated ||= byName.size > MaxTagInventoryEntries
    remoteEntries = [...byName.entries()]
      .slice(0, MaxTagInventoryEntries)
      .filter(
        (
          entry
        ): entry is [string, { refObject: string; peeledObject?: string }] =>
          entry[1].refObject !== undefined
      )
      .map(([name, entry]) => ({
        name,
        refObject: validateExpectedObject(entry.refObject, 'Remote tag object'),
        target: validateExpectedObject(
          entry.peeledObject ?? entry.refObject,
          'Remote tag target'
        ),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  }

  const configuredSigningFormat = displayText(
    signingFormatResult.stdout,
    16
  ).toLowerCase()
  const signingFormat = ['openpgp', 'ssh', 'x509'].includes(
    configuredSigningFormat
  )
    ? configuredSigningFormat
    : 'openpgp'

  return {
    local,
    remote: remoteEntries,
    remoteName: remote?.name ?? null,
    localTruncated: localRows.length > MaxTagInventoryEntries,
    remoteTruncated,
    signingConfigured: signingKeyResult.stdout.trim().length > 0,
    signingFormat,
  }
}

/** Create a lightweight, annotated, or signed annotated tag. */
export async function createLifecycleTag(
  repository: Repository,
  options: ICreateTagLifecycleOptions
): Promise<void> {
  const name = await validateTagName(repository, options.name)
  const targetOid = await resolveTagTarget(repository, options.target)
  await git(
    [...tagCreationArguments(options, name, targetOid, false)],
    repository.path,
    'createLifecycleTag'
  )
}

/** Atomically recreate a reviewed local tag at a new target. */
export async function moveLifecycleTag(
  repository: Repository,
  options: IMoveTagLifecycleOptions
): Promise<void> {
  const name = await validateTagName(repository, options.name)
  const expected = validateExpectedObject(
    options.expectedRefObject,
    'Reviewed tag object'
  )
  const current = await git(
    ['rev-parse', '--verify', `refs/tags/${name}`],
    repository.path,
    'revalidateLifecycleTag'
  )
  if (current.stdout.trim().toLowerCase() !== expected) {
    throw new Error(
      `Tag '${name}' changed after review. Reload the inventory before moving it.`
    )
  }
  const targetOid = await resolveTagTarget(repository, options.target)
  await git(
    [...tagCreationArguments(options, name, targetOid, true)],
    repository.path,
    'moveLifecycleTag'
  )
}

/** Delete one local tag only if its exact ref object still matches review. */
export async function deleteReviewedLifecycleTag(
  repository: Repository,
  review: ITagRefReview
): Promise<void> {
  const name = await validateTagName(repository, review.name)
  const expected = validateExpectedObject(
    review.expectedRefObject,
    'Reviewed tag object'
  )
  const current = await git(
    ['rev-parse', '--verify', `refs/tags/${name}`],
    repository.path,
    'revalidateLifecycleTagForDeletion'
  )
  if (current.stdout.trim().toLowerCase() !== expected) {
    throw new Error(
      `Tag '${name}' changed after review. Reload the inventory before deleting it.`
    )
  }
  await git(
    ['update-ref', '-d', `refs/tags/${name}`, expected],
    repository.path,
    'deleteReviewedLifecycleTag'
  )
}

/** Push exactly the reviewed local tag objects through fixed refspecs. */
export async function pushLifecycleTags(
  repository: Repository,
  remote: IRemote,
  reviews: ReadonlyArray<ITagPushReview>
): Promise<void> {
  const reviewedRemote = validateRemote(remote)
  if (reviews.length === 0 || reviews.length > MaxTagInventoryEntries) {
    throw new Error('Select between 1 and 500 tags to push.')
  }
  const validatedNames = reviews.map(review =>
    validateTagNameShape(review.name)
  )
  const uniqueNames = [...new Set(validatedNames)]
  if (uniqueNames.length !== reviews.length) {
    throw new Error('The reviewed tag list contains duplicates.')
  }
  const reviewedObjects = reviews.map(review =>
    validateExpectedObject(review.expectedRefObject, 'Reviewed tag object')
  )
  const currentLocalTags = new Map(
    (await getTagLifecycleInventory(repository, null)).local.map(tag => [
      tag.name,
      tag.refObject,
    ])
  )
  for (let index = 0; index < uniqueNames.length; index++) {
    if (currentLocalTags.get(uniqueNames[index]) !== reviewedObjects[index]) {
      throw new Error(
        `Tag '${uniqueNames[index]}' changed after review. Reload the inventory before pushing it.`
      )
    }
  }
  await git(
    [
      'push',
      ...reviews.map(review => {
        const expectedRemote =
          review.expectedRemoteRefObject === null
            ? ''
            : validateExpectedObject(
                review.expectedRemoteRefObject,
                'Reviewed remote tag object'
              )
        return `--force-with-lease=refs/tags/${review.name}:${expectedRemote}`
      }),
      reviewedRemote.name,
      ...uniqueNames.map(
        (name, index) => `${reviewedObjects[index]}:refs/tags/${name}`
      ),
    ],
    repository.path,
    'pushLifecycleTags',
    { env: await envForRemoteOperation(reviewedRemote.url) }
  )
}

/** Fetch all tags, optionally pruning local tags absent from the remote. */
export async function fetchLifecycleTags(
  repository: Repository,
  remote: IRemote,
  prune: boolean,
  reviewedLocalTags: ReadonlyArray<ITagRefReview> = []
): Promise<void> {
  const reviewedRemote = validateRemote(remote)
  if (prune) {
    if (reviewedLocalTags.length > MaxTagInventoryEntries) {
      throw new Error('At most 500 reviewed local tags can be pruned.')
    }
    const current = await getTagLifecycleInventory(repository, null)
    if (current.localTruncated) {
      throw new Error('Reload a complete local inventory before pruning tags.')
    }
    const reviewed = new Map(
      reviewedLocalTags.map(tag => [
        tag.name,
        validateExpectedObject(tag.expectedRefObject, 'Reviewed tag object'),
      ])
    )
    if (
      reviewed.size !== reviewedLocalTags.length ||
      reviewed.size !== current.local.length ||
      current.local.some(
        tag => reviewed.get(tag.name) !== tag.refObject.toLowerCase()
      )
    ) {
      throw new Error(
        'Local tags changed after review. Reload the inventory before pruning.'
      )
    }
  }
  await git(
    [
      'fetch',
      '--tags',
      ...(prune ? ['--prune', '--prune-tags'] : []),
      reviewedRemote.name,
    ],
    repository.path,
    prune ? 'fetchAndPruneLifecycleTags' : 'fetchLifecycleTags',
    { env: await envForRemoteOperation(reviewedRemote.url) }
  )
}

/** Delete one remote tag only if its exact ref object still matches review. */
export async function deleteRemoteLifecycleTag(
  repository: Repository,
  remote: IRemote,
  review: IRemoteTagDeletionReview
): Promise<void> {
  const reviewedRemote = validateRemote(remote)
  const name = await validateTagName(repository, review.name)
  const expected = validateExpectedObject(
    review.expectedRefObject,
    'Reviewed remote tag object'
  )
  const current = await git(
    ['ls-remote', '--tags', '--refs', reviewedRemote.name, `refs/tags/${name}`],
    repository.path,
    'revalidateRemoteLifecycleTag',
    { env: await envForRemoteOperation(reviewedRemote.url) }
  )
  const currentObject = current.stdout
    .split(/\r?\n/)
    .map(line => line.split('\t'))
    .find(parts => parts[1] === `refs/tags/${name}`)?.[0]
  if (currentObject === undefined || currentObject.toLowerCase() !== expected) {
    throw new Error(
      `Remote tag '${name}' changed after review. Reload the remote inventory before deleting it.`
    )
  }
  await git(
    [
      'push',
      `--force-with-lease=refs/tags/${name}:${expected}`,
      reviewedRemote.name,
      `:refs/tags/${name}`,
    ],
    repository.path,
    'deleteRemoteLifecycleTag',
    { env: await envForRemoteOperation(reviewedRemote.url) }
  )
}

/**
 * Create a new tag on the given target commit.
 *
 * @param repository        - The repository in which to create the new tag.
 * @param name              - The name of the new tag.
 * @param targetCommitSha   - The SHA of the commit where the new tag will live on.
 */
export async function createTag(
  repository: Repository,
  name: string,
  targetCommitSha: string
): Promise<void> {
  const args = ['tag', '-a', '-m', '', name, targetCommitSha]

  await git(args, repository.path, 'createTag')
}

/**
 * Delete a tag.
 *
 * @param repository        - The repository in which to create the new tag.
 * @param name              - The name of the tag to delete.
 */
export async function deleteTag(
  repository: Repository,
  name: string
): Promise<void> {
  const args = ['tag', '-d', name]

  await git(args, repository.path, 'deleteTag')
}

/**
 * Gets all the local tags. Returns a Map with the tag name and the commit it points to.
 *
 * @param repository    The repository in which to get all the tags from.
 */
export async function getAllTags(
  repository: Repository
): Promise<Map<string, string>> {
  const args = ['show-ref', '--tags', '-d']

  const tags = await git(args, repository.path, 'getAllTags', {
    successExitCodes: new Set([0, 1]), // when there are no tags, git exits with 1.
  })

  const tagsArray: Array<[string, string]> = tags.stdout
    .split('\n')
    .filter(line => line !== '')
    .map(line => {
      const [commitSha, rawTagName] = line.split(' ')

      // Normalize tag names by removing the leading ref/tags/ and the trailing ^{}.
      //
      // git show-ref returns two entries for annotated tags:
      // deadbeef refs/tags/annotated-tag
      // de510b99 refs/tags/annotated-tag^{}
      //
      // The first entry sha correspond to the blob object of the annotation, while the second
      // entry corresponds to the actual commit where the tag was created.
      // By normalizing the tag name we can make sure that the commit sha gets stored in the returned
      // Map of commits (since git will always print the entry with the commit sha at the end).
      const tagName = rawTagName
        .replace(/^refs\/tags\//, '')
        .replace(/\^\{\}$/, '')

      return [tagName, commitSha]
    })

  return new Map(tagsArray)
}

/**
 * Fetches the tags that will get pushed to the remote repository (it does a network request).
 *
 * @param repository  - The repository in which to check for unpushed tags
 * @param account     - The account to use when authenticating with the remote
 * @param remote      - The remote to check for unpushed tags
 * @param branchName  - The branch that will be used on the push command
 */
export async function fetchTagsToPush(
  repository: Repository,
  remote: IRemote,
  branchName: string
): Promise<ReadonlyArray<string>> {
  const args = [
    'push',
    remote.name,
    branchName,
    '--follow-tags',
    '--dry-run',
    '--no-verify',
    '--porcelain',
  ]

  const result = await git(args, repository.path, 'fetchTagsToPush', {
    env: await envForRemoteOperation(remote.url),
    successExitCodes: new Set([0, 1, 128]),
  })

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    // Only when the exit code of git is 0 or 1, its stdout is parseable.
    // In other cases, we just rethrow the error so our memoization layer
    // doesn't cache it indefinitely.
    throw result.gitError
  }

  const lines = result.stdout.split('\n')
  let currentLine = 1
  const unpushedTags = []

  // the last line of this porcelain command is always 'Done'
  while (currentLine < lines.length && lines[currentLine] !== 'Done') {
    const line = lines[currentLine]
    const parts = line.split('\t')

    if (parts[0] === '*' && parts[2] === '[new tag]') {
      const [tagName] = parts[1].split(':')

      if (tagName !== undefined) {
        unpushedTags.push(tagName.replace(/^refs\/tags\//, ''))
      }
    }

    currentLine++
  }

  return unpushedTags
}
