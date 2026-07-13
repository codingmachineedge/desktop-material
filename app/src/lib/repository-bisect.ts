export type RepositoryBisectVerdict = 'good' | 'bad' | 'skip'

export interface IRepositoryBisectRevisionRequest {
  readonly revision: string
  readonly args: ReadonlyArray<string>
}

export interface IRepositoryBisectRangeRequest {
  readonly goodOid: string
  readonly badOid: string
  readonly args: ReadonlyArray<string>
}

export type IRepositoryBisectStartRequest = IRepositoryBisectRangeRequest

export interface IRepositoryBisectMarkRequest {
  readonly verdict: RepositoryBisectVerdict
  readonly expectedHead: string
  readonly args: ReadonlyArray<string>
}

export interface IRepositoryBisectRefState {
  readonly active: boolean
  readonly badOid: string | null
  readonly goodOids: ReadonlyArray<string>
  readonly skippedOids: ReadonlyArray<string>
}

export interface IRepositoryBisectCommit {
  readonly oid: string
  readonly abbreviatedOid: string
  readonly subject: string
}

const MaximumRevisionBytes = 512
const MaximumStateBytes = 128 * 1024
const MaximumWorktreeBytes = 256 * 1024
const MaximumBisectRefs = 512
const MaximumSubjectBytes = 4 * 1024
const MaximumCandidateCount = 1_000_000_000
const ObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

function isValidFullRefName(ref: string): boolean {
  if (
    !ref.startsWith('refs/') ||
    ref.length > 1_024 ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(ref)
  ) {
    return false
  }

  return ref
    .split('/')
    .every(
      part =>
        part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock')
    )
}

/**
 * Accept a branch, tag, remote-tracking name, HEAD, or commit object ID. The
 * guided flow intentionally excludes revision expressions such as ranges,
 * reflog selectors, ancestry operators, options, and path lookups.
 */
export function normalizeRepositoryBisectRevision(value: string): string {
  const revision = value.trim()
  if (
    revision.length === 0 ||
    Buffer.byteLength(revision, 'utf8') > MaximumRevisionBytes ||
    revision.startsWith('-') ||
    /[\x00-\x20\x7f]/.test(revision)
  ) {
    throw new Error('Enter a branch, tag, HEAD, or commit ID.')
  }

  if (revision === 'HEAD' || /^(?:[0-9a-fA-F]{7,64})$/.test(revision)) {
    return revision
  }

  const fullRef = revision.startsWith('refs/')
    ? revision
    : `refs/heads/${revision}`
  if (
    !isValidFullRefName(fullRef) ||
    (revision.startsWith('refs/') &&
      !/^refs\/(?:heads|tags|remotes)\//.test(revision))
  ) {
    throw new Error('Enter a branch, tag, HEAD, or commit ID.')
  }
  return revision
}

export function normalizeRepositoryBisectObjectId(value: string): string {
  const oid = value.trim().toLowerCase()
  if (!ObjectIdPattern.test(oid)) {
    throw new Error('Git returned an invalid commit ID.')
  }
  return oid
}

export function prepareRepositoryBisectRevision(
  revision: string
): IRepositoryBisectRevisionRequest {
  const normalized = normalizeRepositoryBisectRevision(revision)
  return {
    revision: normalized,
    args: [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${normalized}^{commit}`,
    ],
  }
}

export function parseRepositoryBisectResolvedRevision(output: string): string {
  if (Buffer.byteLength(output, 'utf8') > 128) {
    throw new Error('Git returned an invalid commit ID.')
  }
  const oid = output.replace(/\r?\n$/, '')
  if (oid.includes('\n') || oid.includes('\r')) {
    throw new Error('Git returned an invalid commit ID.')
  }
  return normalizeRepositoryBisectObjectId(oid)
}

function normalizeRange(
  goodOid: string,
  badOid: string
): { readonly goodOid: string; readonly badOid: string } {
  const normalizedGood = normalizeRepositoryBisectObjectId(goodOid)
  const normalizedBad = normalizeRepositoryBisectObjectId(badOid)
  if (normalizedGood === normalizedBad) {
    throw new Error('Known-good and known-bad commits must be different.')
  }
  return { goodOid: normalizedGood, badOid: normalizedBad }
}

/** Check that the reviewed good commit is an ancestor of the bad commit. */
export function prepareRepositoryBisectRange(
  goodOid: string,
  badOid: string
): IRepositoryBisectRangeRequest {
  const range = normalizeRange(goodOid, badOid)
  return {
    ...range,
    args: ['merge-base', '--is-ancestor', range.goodOid, range.badOid],
  }
}

/** Start from exact reviewed objects, never from refs that can move later. */
export function prepareRepositoryBisectStart(
  goodOid: string,
  badOid: string
): IRepositoryBisectStartRequest {
  const range = normalizeRange(goodOid, badOid)
  return {
    ...range,
    args: ['bisect', 'start', range.badOid, range.goodOid],
  }
}

/** Mark only the exact HEAD object displayed during review. */
export function prepareRepositoryBisectMark(
  verdict: RepositoryBisectVerdict,
  expectedHead: string
): IRepositoryBisectMarkRequest {
  if (verdict !== 'good' && verdict !== 'bad' && verdict !== 'skip') {
    throw new Error('Choose a supported bisect result.')
  }
  const oid = normalizeRepositoryBisectObjectId(expectedHead)
  return {
    verdict,
    expectedHead: oid,
    args: ['bisect', verdict, oid],
  }
}

export const RepositoryBisectStateArgs = [
  'for-each-ref',
  '--format=%(refname)%00%(objectname)',
  'refs/bisect',
] as const

export const RepositoryBisectHeadArgs = [
  'show',
  '--no-patch',
  '--format=%H%x00%h%x00%s',
  'HEAD',
] as const

export const RepositoryBisectWorktreeArgs = [
  'status',
  '--porcelain=v1',
  '-z',
  '--untracked-files=all',
] as const

export const RepositoryBisectRemainingArgs = [
  'rev-list',
  '--count',
  'refs/bisect/bad',
  '--not',
  '--glob=refs/bisect/good-*',
] as const

export const RepositoryBisectResetArgs = ['bisect', 'reset'] as const

/** Parse only Git's private bisect refs, rejecting partial or duplicate state. */
export function parseRepositoryBisectRefState(
  output: string
): IRepositoryBisectRefState {
  if (Buffer.byteLength(output, 'utf8') > MaximumStateBytes) {
    throw new Error('The bisect session is too large to inspect safely.')
  }
  if (output.length === 0) {
    return { active: false, badOid: null, goodOids: [], skippedOids: [] }
  }

  let badOid: string | null = null
  const goodOids = new Set<string>()
  const skippedOids = new Set<string>()
  let count = 0
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      continue
    }
    count++
    if (count > MaximumBisectRefs) {
      throw new Error('The bisect session is too large to inspect safely.')
    }
    const fields = line.split('\0')
    if (fields.length !== 2) {
      throw new Error('Git returned invalid bisect session state.')
    }
    const [ref, rawOid] = fields
    const oid = normalizeRepositoryBisectObjectId(rawOid)
    if (ref === 'refs/bisect/bad') {
      if (badOid !== null) {
        throw new Error('Git returned duplicate known-bad state.')
      }
      badOid = oid
    } else if (/^refs\/bisect\/good-(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref)) {
      if (ref.slice('refs/bisect/good-'.length) !== oid) {
        throw new Error('Git returned invalid known-good bisect state.')
      }
      goodOids.add(oid)
    } else if (/^refs\/bisect\/skip-(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref)) {
      if (ref.slice('refs/bisect/skip-'.length) !== oid) {
        throw new Error('Git returned invalid skipped-commit state.')
      }
      skippedOids.add(oid)
    } else {
      throw new Error('Git returned an unknown bisect session ref.')
    }
  }

  if (badOid === null || goodOids.size === 0) {
    throw new Error('The bisect session is incomplete. Reset it with Git.')
  }
  if (goodOids.has(badOid)) {
    throw new Error('The bisect session has conflicting boundaries.')
  }
  return {
    active: true,
    badOid,
    goodOids: [...goodOids],
    skippedOids: [...skippedOids],
  }
}

export function parseRepositoryBisectHead(
  output: string
): IRepositoryBisectCommit {
  if (Buffer.byteLength(output, 'utf8') > MaximumSubjectBytes + 256) {
    throw new Error('Git returned an invalid current bisect commit.')
  }
  const normalized = output.replace(/\r?\n$/, '')
  const fields = normalized.split('\0')
  if (fields.length !== 3) {
    throw new Error('Git returned an invalid current bisect commit.')
  }
  const oid = normalizeRepositoryBisectObjectId(fields[0])
  const abbreviatedOid = fields[1]
  const subject = fields[2]
  if (
    !/^[0-9a-f]{4,64}$/.test(abbreviatedOid) ||
    !oid.startsWith(abbreviatedOid) ||
    Buffer.byteLength(subject, 'utf8') > MaximumSubjectBytes ||
    /[\x00-\x1f\x7f]/.test(subject)
  ) {
    throw new Error('Git returned an invalid current bisect commit.')
  }
  return { oid, abbreviatedOid, subject }
}

/** Return only a cleanliness boolean; file names never enter renderer copy. */
export function parseRepositoryBisectWorktreeClean(output: string): boolean {
  if (Buffer.byteLength(output, 'utf8') > MaximumWorktreeBytes) {
    return false
  }
  if (output.length === 0) {
    return true
  }
  if (!output.endsWith('\0')) {
    throw new Error('Git returned invalid working-tree state.')
  }
  return false
}

export function parseRepositoryBisectRemaining(output: string): number {
  if (Buffer.byteLength(output, 'utf8') > 32) {
    throw new Error('Git returned an invalid remaining-candidate count.')
  }
  const normalized = output.trim()
  if (!/^(?:0|[1-9][0-9]{0,9})$/.test(normalized)) {
    throw new Error('Git returned an invalid remaining-candidate count.')
  }
  const count = Number(normalized)
  if (!Number.isSafeInteger(count) || count > MaximumCandidateCount) {
    throw new Error('The bisect range is too large to display safely.')
  }
  return count
}

export function estimateRepositoryBisectSteps(candidateCount: number): number {
  if (
    !Number.isInteger(candidateCount) ||
    candidateCount < 0 ||
    candidateCount > MaximumCandidateCount
  ) {
    throw new Error('The remaining-candidate count is invalid.')
  }
  return candidateCount <= 1 ? 0 : Math.ceil(Math.log2(candidateCount))
}
