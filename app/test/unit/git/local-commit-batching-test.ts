import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  createLocalCommitBatchPlan,
  decideLocalCommitPushBatching,
  executeLocalCommitBatchPlan,
  handleLocalCommitPushBatching,
  ILocalCommitBatchingFingerprint,
  ILocalCommitBatchingInspection,
  ILocalCommitBatchingOperations,
  ILocalCommitBatchCommitResult,
  LocalCommitBatchingError,
  validateLocalCommitBatchingInspection,
} from '../../../src/lib/git/local-commit-batching'
import { AutomaticLocalCommitBatchFileCountLimit } from '../../../src/lib/commit-push-batching'

const oid = (digit: string) => digit.repeat(40)
const BaseSha = oid('1')
const FirstOldSha = oid('2')
const SecondOldSha = oid('3')
const FirstNewSha = oid('4')
const SecondNewSha = oid('5')
const BaseTreeSha = oid('a')
const HeadTreeSha = oid('b')
const FirstNewTreeSha = oid('c')
const SecondNewTreeSha = oid('d')
const EmptyTreeSha = oid('e')

function clone<T>(value: T): T {
  return structuredClone(value)
}

type DeepMutable<T> = T extends ReadonlyArray<infer U>
  ? DeepMutable<U>[]
  : T extends object
  ? { -readonly [P in keyof T]: DeepMutable<T[P]> }
  : T

function mutable<T>(value: T): DeepMutable<T> {
  return value as DeepMutable<T>
}

function makeInspection(
  commitSizes: ReadonlyArray<number>,
  netSizes: ReadonlyArray<number> = commitSizes
): ILocalCommitBatchingInspection {
  const localOnlyCommits = commitSizes.map((size, index) => ({
    sha: index === 0 ? FirstOldSha : SecondOldSha,
    parentShas: [index === 0 ? BaseSha : FirstOldSha],
    message: `original message ${index + 1}`,
    payloadSizeInBytes: size,
    changes: [{ path: `commit-${index + 1}.bin`, sizeInBytes: size }],
  }))
  const headSha = localOnlyCommits[localOnlyCommits.length - 1]?.sha ?? BaseSha
  const fingerprint: ILocalCommitBatchingFingerprint = {
    branchRef: 'refs/heads/main',
    upstreamRef: 'refs/remotes/origin/main',
    headSha,
    upstreamSha: BaseSha,
    indexTreeSha: HeadTreeSha,
    worktreeFingerprint: 'exact-final-worktree',
    isIndexClean: true,
    isWorktreeClean: true,
    hasConflicts: false,
    operationState: null,
  }
  return {
    remoteName: 'origin',
    remoteBranchRef: 'refs/heads/main',
    headTreeSha: HeadTreeSha,
    upstreamTreeSha: BaseTreeSha,
    ahead: localOnlyCommits.length,
    behind: 0,
    localOnlyCommits,
    netChanges: netSizes.map((size, index) => ({
      path: `net-${index + 1}.bin`,
      sizeInBytes: size,
    })),
    fingerprint,
  }
}

function makeInitialPublicationInspection(
  commitSizes: ReadonlyArray<number>,
  netSizes: ReadonlyArray<number> = commitSizes
): ILocalCommitBatchingInspection {
  const inspection = makeInspection(commitSizes, netSizes)
  mutable(inspection).fingerprint.upstreamSha = null
  mutable(inspection).upstreamTreeSha = EmptyTreeSha
  mutable(inspection).localOnlyCommits[0].parentShas = []
  return inspection
}

/**
 * Build an inspection whose local-only commits each contain a chosen number of
 * one-byte files, so the file-count ceiling can be exercised independently of
 * the byte ceiling. Supports up to two commits (the fixture SHAs available).
 */
function makeMultiFileInspection(
  perCommitFileCounts: ReadonlyArray<number>
): ILocalCommitBatchingInspection {
  assert(perCommitFileCounts.length <= 2)
  const localOnlyCommits = perCommitFileCounts.map((fileCount, index) => {
    const changes = Array.from({ length: fileCount }, (_unused, file) => ({
      path: `c${index + 1}-f${file}.bin`,
      sizeInBytes: 1,
    }))
    return {
      sha: index === 0 ? FirstOldSha : SecondOldSha,
      parentShas: [index === 0 ? BaseSha : FirstOldSha],
      message: `original message ${index + 1}`,
      payloadSizeInBytes: fileCount,
      changes,
    }
  })
  const headSha = localOnlyCommits[localOnlyCommits.length - 1]?.sha ?? BaseSha
  const netChanges = localOnlyCommits.flatMap(commit => commit.changes)
  const fingerprint: ILocalCommitBatchingFingerprint = {
    branchRef: 'refs/heads/main',
    upstreamRef: 'refs/remotes/origin/main',
    headSha,
    upstreamSha: BaseSha,
    indexTreeSha: HeadTreeSha,
    worktreeFingerprint: 'exact-final-worktree',
    isIndexClean: true,
    isWorktreeClean: true,
    hasConflicts: false,
    operationState: null,
  }
  return {
    remoteName: 'origin',
    remoteBranchRef: 'refs/heads/main',
    headTreeSha: HeadTreeSha,
    upstreamTreeSha: BaseTreeSha,
    ahead: localOnlyCommits.length,
    behind: 0,
    localOnlyCommits,
    netChanges,
    fingerprint,
  }
}

type PushBehavior =
  | 'success'
  | 'rejected'
  | 'throw-after-success'
  | 'throw-without-update'
  | 'reported-success-without-update'

interface IHarnessOptions {
  readonly pushBehaviors?: ReadonlyArray<PushBehavior>
  readonly replacementCommits?: ReadonlyArray<
    Omit<ILocalCommitBatchCommitResult, 'paths' | 'sizeInBytes'> &
      Partial<Pick<ILocalCommitBatchCommitResult, 'paths' | 'sizeInBytes'>>
  >
  readonly reachableCommitShas?: ReadonlySet<string>
  readonly failCommitAt?: number
  readonly failReset?: 'before' | 'after' | 'after-head-only'
  readonly inspectOverrideAtCall?: number
  readonly inspectOverride?: ILocalCommitBatchingInspection
  readonly raceOnFingerprintRead?: number
  readonly initialRemoteTip?: string | null
}

function makeHarness(
  reviewed: ILocalCommitBatchingInspection,
  options: IHarnessOptions = {}
) {
  const events = new Array<string>()
  const backups = new Map<string, string>()
  const initialFingerprint = clone(reviewed.fingerprint)
  let fingerprint = clone(initialFingerprint)
  let remoteTip: string | null =
    options.initialRemoteTip === undefined
      ? reviewed.fingerprint.upstreamSha
      : options.initialRemoteTip
  let inspectCalls = 0
  let fingerprintReads = 0
  let commitCalls = 0
  let pushCalls = 0
  const replacementCommits = options.replacementCommits ?? [
    {
      headSha: FirstNewSha,
      parentSha: BaseSha,
      treeSha: FirstNewTreeSha,
    },
    {
      headSha: SecondNewSha,
      parentSha: FirstNewSha,
      treeSha: HeadTreeSha,
    },
  ]

  const operations: ILocalCommitBatchingOperations = {
    inspect: async () => {
      inspectCalls++
      events.push(`inspect:${inspectCalls}`)
      if (options.inspectOverrideAtCall === inspectCalls) {
        return clone(options.inspectOverride as ILocalCommitBatchingInspection)
      }
      return clone(reviewed)
    },
    readFingerprint: async () => {
      fingerprintReads++
      events.push(`fingerprint:${fingerprintReads}`)
      if (options.raceOnFingerprintRead === fingerprintReads) {
        fingerprint = {
          ...fingerprint,
          worktreeFingerprint: 'external-race',
        }
      }
      return clone(fingerprint)
    },
    createBackupNonce: () => 'unit-test-nonce',
    createBackupRef: async request => {
      events.push(
        `backup:create:${request.ref}:${String(request.expectedOldSha)}`
      )
      assert.equal(request.expectedOldSha, null)
      assert.equal(backups.has(request.ref), false)
      backups.set(request.ref, request.newSha)
    },
    deleteBackupRef: async request => {
      events.push(`backup:delete:${request.ref}:${request.expectedOldSha}`)
      assert.equal(backups.get(request.ref), request.expectedOldSha)
      backups.delete(request.ref)
    },
    mixedReset: async request => {
      events.push(`reset:${request.mode}:${request.targetSha}`)
      assert.deepStrictEqual(request.expected, fingerprint)
      if (options.failReset === 'before') {
        throw new Error('reset rejected before mutation')
      }
      if (options.failReset === 'after-head-only') {
        fingerprint = {
          ...fingerprint,
          headSha: request.targetSha,
          isIndexClean: false,
          isWorktreeClean: true,
        }
        throw new Error('reset failed after the branch CAS')
      }
      fingerprint = {
        ...fingerprint,
        headSha: request.targetSha,
        indexTreeSha: reviewed.upstreamTreeSha as string,
        isWorktreeClean: false,
      }
      if (options.failReset === 'after') {
        throw new Error('reset transport failed after mutation')
      }
    },
    commitPaths: async request => {
      events.push(`commit:${request.paths.join(',')}:${request.message}`)
      assert.deepStrictEqual(request.expected, fingerprint)
      assert.equal(request.allowEmpty, request.paths.length === 0)
      const index = commitCalls++
      if (options.failCommitAt === index) {
        throw new Error('commit rejected')
      }
      const fixture = replacementCommits[index]
      assert(fixture !== undefined)
      assert.equal(fixture.parentSha, fingerprint.headSha)
      const result: ILocalCommitBatchCommitResult = {
        ...fixture,
        paths: fixture.paths ?? request.paths,
        sizeInBytes:
          fixture.sizeInBytes ??
          reviewed.netChanges
            .filter(change => request.paths.includes(change.path))
            .reduce((sum, change) => sum + change.sizeInBytes, 0),
      }
      assert.equal(result.sizeInBytes, request.expectedSizeInBytes)
      fingerprint = {
        ...fingerprint,
        headSha: result.headSha,
        indexTreeSha: result.treeSha,
        isWorktreeClean: index === replacementCommits.length - 1,
      }
      return result
    },
    push: async request => {
      const index = pushCalls++
      const behavior = options.pushBehaviors?.[index] ?? 'success'
      events.push(
        `push:${request.expectedRemoteSha}:${request.headSha}:force=${String(
          request.force
        )}:${behavior}`
      )
      assert.equal(request.force, false)
      assert.equal(request.expectedRemoteSha, remoteTip)
      if (behavior === 'success') {
        remoteTip = request.headSha
        return 'pushed'
      }
      if (behavior === 'throw-after-success') {
        remoteTip = request.headSha
        throw new Error('connection closed after receive')
      }
      if (behavior === 'throw-without-update') {
        throw new Error('connection closed before receive')
      }
      if (behavior === 'reported-success-without-update') {
        return 'pushed'
      }
      return 'rejected'
    },
    readRemoteTip: async () => {
      events.push(`remote:${remoteTip}`)
      return remoteTip
    },
    isCommitReachableFromAnyRemote: async request => {
      const reachable =
        options.reachableCommitShas?.has(request.commitSha) ?? false
      events.push(`reachable:${request.commitSha}:${String(reachable)}`)
      return reachable
    },
    restoreFromBackup: async request => {
      events.push(
        `restore:${request.mode}:${request.expected.headSha}:${request.backupSha}`
      )
      assert.equal(request.mode, 'mixed')
      assert.deepStrictEqual(request.expected, fingerprint)
      assert.equal(backups.get(request.backupRef), request.backupSha)
      fingerprint = clone(initialFingerprint)
    },
  }

  return {
    operations,
    events,
    backups,
    getFingerprint: () => clone(fingerprint),
    getRemoteTip: () => remoteTip,
  }
}

async function expectBatchingError(
  promise: Promise<unknown>,
  code: string
): Promise<LocalCommitBatchingError> {
  let caught: LocalCommitBatchingError | undefined
  await assert.rejects(promise, error => {
    assert(error instanceof LocalCommitBatchingError)
    assert.equal(error.code, code)
    caught = error
    return true
  })
  return caught as LocalCommitBatchingError
}

describe('git/local-commit-batching', () => {
  it('creates stable exact-boundary plans with explicit messages', () => {
    const plan = createLocalCommitBatchPlan(
      [
        { path: 'one.bin', sizeInBytes: 40 },
        { path: 'two.bin', sizeInBytes: 60 },
        { path: 'three.bin', sizeInBytes: 1 },
      ],
      (paths, index, total) =>
        `batch ${index + 1}/${total}: ${paths.join('+')}`,
      100
    )

    assert.deepStrictEqual(
      plan.batches.map(batch => ({
        paths: batch.changes.map(change => change.path),
        size: batch.sizeInBytes,
        message: batch.message,
      })),
      [
        {
          paths: ['one.bin', 'two.bin'],
          size: 100,
          message: 'batch 1/2: one.bin+two.bin',
        },
        { paths: ['three.bin'], size: 1, message: 'batch 2/2: three.bin' },
      ]
    )

    const oneBatch = createLocalCommitBatchPlan(
      [{ path: 'final.bin', sizeInBytes: 20 }],
      () => 'replacement',
      100
    )
    assert.equal(oneBatch.batches.length, 1)
    const emptyNetBatch = createLocalCommitBatchPlan(
      [],
      (paths, index, total) =>
        `empty ${index + 1}/${total}: ${paths.join('+')}`,
      100
    )
    assert.deepStrictEqual(emptyNetBatch, {
      byteLimit: 100,
      fileCountLimit: AutomaticLocalCommitBatchFileCountLimit,
      totalSizeInBytes: 0,
      batches: [
        {
          changes: [],
          sizeInBytes: 0,
          message: 'empty 1/1: ',
        },
      ],
    })
    assert.throws(
      () =>
        createLocalCommitBatchPlan(
          [{ path: '../escape.bin', sizeInBytes: 1 }],
          () => 'unsafe',
          100
        ),
      error => error instanceof LocalCommitBatchingError
    )
    assert.throws(
      () =>
        createLocalCommitBatchPlan(
          [{ path: 'too-large.bin', sizeInBytes: 101 }],
          () => 'oversized file',
          100
        ),
      error => error instanceof LocalCommitBatchingError
    )
  })

  it('does not block an ordinary small push because the worktree is dirty', async () => {
    const reviewed = makeInspection([40])
    mutable(reviewed).fingerprint.isWorktreeClean = false
    const harness = makeHarness(reviewed)

    const decision = decideLocalCommitPushBatching(reviewed, 100)
    assert.deepStrictEqual(decision, {
      kind: 'not-needed',
      reason: 'within-limit',
      totalSizeInBytes: 40,
    })
    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      undefined,
      100
    )
    assert.deepStrictEqual(result, {
      status: 'not-needed',
      reason: 'within-limit',
      totalSizeInBytes: 40,
    })
    assert.deepStrictEqual(harness.events, [])
  })

  it('flushes a safe existing tip before a new automatic commit', async () => {
    const reviewed = makeInspection([40])
    mutable(reviewed).fingerprint.isWorktreeClean = false
    const harness = makeHarness(reviewed)

    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      undefined,
      100,
      true
    )

    assert.equal(result.status, 'completed')
    assert.deepStrictEqual(
      harness.events.filter(event => event.startsWith('push:')),
      [`push:${BaseSha}:${FirstOldSha}:force=false:success`]
    )
    assert.equal(harness.getRemoteTip(), FirstOldSha)
  })

  it('fails closed on every unsafe eligibility state once batching is needed', () => {
    const unsafe = new Array<
      [string, (value: ILocalCommitBatchingInspection) => void]
    >(
      ['dirty', value => (mutable(value).fingerprint.isWorktreeClean = false)],
      ['diverged', value => (mutable(value).behind = 1)],
      [
        'operation-in-progress',
        value => (mutable(value).fingerprint.operationState = 'rebase'),
      ],
      ['conflicts', value => (mutable(value).fingerprint.hasConflicts = true)],
      ['no-upstream', value => (mutable(value).remoteName = null)],
      [
        'non-linear',
        value =>
          (mutable(value).localOnlyCommits[1].parentShas = [
            FirstOldSha,
            BaseSha,
          ]),
      ]
    )

    for (const [code, mutate] of unsafe) {
      const reviewed = makeInspection([60, 60])
      mutate(reviewed)
      assert.throws(
        () => validateLocalCommitBatchingInspection(reviewed),
        error =>
          error instanceof LocalCommitBatchingError && error.code === code,
        code
      )
    }
  })

  it('pushes safe existing commits in order without rewriting or forcing', async () => {
    const reviewed = makeInspection([60, 60])
    const harness = makeHarness(reviewed, {
      pushBehaviors: ['success', 'throw-after-success'],
    })
    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      undefined,
      100
    )

    assert.deepStrictEqual(result, {
      status: 'completed',
      mode: 'existing-commits',
      backupRef: null,
      batchesCommitted: 0,
      batchesPushed: 2,
      finalHeadSha: SecondOldSha,
    })
    const pushes = harness.events.filter(event => event.startsWith('push:'))
    assert.deepStrictEqual(pushes, [
      `push:${BaseSha}:${FirstOldSha}:force=false:success`,
      `push:${FirstOldSha}:${SecondOldSha}:force=false:throw-after-success`,
    ])
    assert.equal(
      harness.events.some(event => event.startsWith('backup:')),
      false
    )
    assert.equal(
      harness.events.some(event => event.startsWith('reset:')),
      false
    )
    assert.equal(
      harness.events.some(event => event.startsWith('commit:')),
      false
    )
    assert.equal(harness.getRemoteTip(), SecondOldSha)
  })

  it('pushes exact existing commit tips without requiring a clean worktree', async () => {
    const reviewed = makeInspection([60, 60])
    mutable(reviewed).fingerprint.indexTreeSha = FirstNewTreeSha
    mutable(reviewed).fingerprint.isIndexClean = false
    mutable(reviewed).fingerprint.isWorktreeClean = false
    const harness = makeHarness(reviewed)

    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      undefined,
      100
    )

    assert.equal(result.status, 'completed')
    assert.equal(harness.getRemoteTip(), SecondOldSha)
    assert.equal(
      harness.events.some(event => event.startsWith('reset:')),
      false
    )
  })

  it('rebuilds an oversized first publication from a root batch and proves every push', async () => {
    const reviewed = makeInitialPublicationInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      (_paths, index, total) => `initial batch ${index + 1}/${total}`,
      100
    )
    const harness = makeHarness(reviewed, {
      initialRemoteTip: null,
      replacementCommits: [
        {
          headSha: FirstNewSha,
          parentSha: null,
          treeSha: FirstNewTreeSha,
        },
        {
          headSha: SecondNewSha,
          parentSha: FirstNewSha,
          treeSha: HeadTreeSha,
        },
      ],
    })

    const result = await executeLocalCommitBatchPlan(
      reviewed,
      plan,
      harness.operations
    )

    assert.equal(result.status, 'completed')
    assert.equal(harness.getRemoteTip(), SecondNewSha)
    assert.deepStrictEqual(
      harness.events.filter(event => event.startsWith('push:')),
      [
        `push:null:${FirstNewSha}:force=false:success`,
        `push:${FirstNewSha}:${SecondNewSha}:force=false:success`,
      ]
    )
    assert.equal(
      harness.events.filter(event => event.startsWith('remote:')).length >= 4,
      true
    )
  })

  it('creates a CAS backup, revalidates, then rewrites and proves each push', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      (_paths, index, total) =>
        `original message 1 (batch ${index + 1}/${total})`,
      100
    )
    const harness = makeHarness(reviewed)
    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      plan,
      100
    )

    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed result')
    }
    assert.equal(result.mode, 'rewritten-commits')
    assert.equal(result.batchesCommitted, 2)
    assert.equal(result.batchesPushed, 2)
    assert.equal(result.finalHeadSha, SecondNewSha)
    assert.equal(harness.backups.size, 0)

    const relevant = harness.events.filter(
      event =>
        event.startsWith('backup:') ||
        event.startsWith('reset:') ||
        event.startsWith('commit:') ||
        event.startsWith('push:')
    )
    assert.deepStrictEqual(relevant, [
      `backup:create:refs/desktop-material/commit-batch-backup/unit-test-nonce:null`,
      `reset:mixed:${BaseSha}`,
      'commit:net-1.bin:original message 1 (batch 1/2)',
      `push:${BaseSha}:${FirstNewSha}:force=false:success`,
      'commit:net-2.bin:original message 1 (batch 2/2)',
      `push:${FirstNewSha}:${SecondNewSha}:force=false:success`,
      `backup:delete:refs/desktop-material/commit-batch-backup/unit-test-nonce:${FirstOldSha}`,
    ])
  })

  it('rewrites an oversized historical commit into one smaller batch', async () => {
    const reviewed = makeInspection([120], [40])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'smaller replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      replacementCommits: [
        {
          headSha: FirstNewSha,
          parentSha: BaseSha,
          treeSha: HeadTreeSha,
        },
      ],
    })

    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      plan,
      100
    )

    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed result')
    }
    assert.equal(result.batchesCommitted, 1)
    assert.equal(result.batchesPushed, 1)
    assert.equal(result.finalHeadSha, FirstNewSha)
    assert.equal(harness.backups.size, 0)
  })

  it('rejects hook-added future paths before push and restores the original tip', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      replacementCommits: [
        {
          headSha: FirstNewSha,
          parentSha: BaseSha,
          treeSha: HeadTreeSha,
          paths: ['net-1.bin', 'net-2.bin'],
          sizeInBytes: 120,
        },
      ],
    })

    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'commit-failed'
    )

    assert.equal(error.publishedBatches, 0)
    assert.equal(error.restoredOriginalTip, true)
    assert.equal(harness.backups.size, 0)
    assert.equal(harness.getRemoteTip(), BaseSha)
    assert.equal(
      harness.events.some(event => event.startsWith('push:')),
      false
    )
  })

  it('rewrites an oversized historical range with an empty final delta', async () => {
    const reviewed = makeInspection([120, 0], [])
    mutable(reviewed).headTreeSha = BaseTreeSha
    mutable(reviewed).fingerprint.indexTreeSha = BaseTreeSha
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'empty replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      replacementCommits: [
        {
          headSha: FirstNewSha,
          parentSha: BaseSha,
          treeSha: BaseTreeSha,
        },
      ],
    })

    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      plan,
      100
    )

    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed result')
    }
    assert.equal(result.batchesCommitted, 1)
    assert.equal(result.batchesPushed, 1)
    assert.equal(result.finalHeadSha, FirstNewSha)
    assert.equal(
      harness.events.some(event =>
        event.startsWith('commit::empty replacement')
      ),
      true
    )
  })

  it('does not push or discard the backup for a mismatched rebuilt final tree', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      replacementCommits: [
        {
          headSha: FirstNewSha,
          parentSha: BaseSha,
          treeSha: FirstNewTreeSha,
        },
        {
          headSha: SecondNewSha,
          parentSha: FirstNewSha,
          treeSha: SecondNewTreeSha,
        },
      ],
    })

    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'commit-failed'
    )

    assert.equal(error.publishedBatches, 1)
    assert.equal(error.backupRetained, true)
    assert.equal(harness.backups.size, 1)
    assert.equal(harness.getRemoteTip(), FirstNewSha)
    assert.equal(
      harness.events.filter(event => event.startsWith('push:')).length,
      1
    )
  })

  it('deletes the backup without resetting when CAS revalidation goes stale', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const stale = clone(reviewed)
    mutable(stale).netChanges[0].sizeInBytes++
    const harness = makeHarness(reviewed, {
      inspectOverrideAtCall: 2,
      inspectOverride: stale,
    })
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'stale-state'
    )

    assert.equal(error.backupRetained, false)
    assert.equal(error.restoredOriginalTip, false)
    assert.equal(harness.backups.size, 0)
    assert.equal(
      harness.events.some(event => event.startsWith('reset:')),
      false
    )
  })

  it('never rewrites a commit reachable from any remote ref', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      reachableCommitShas: new Set([FirstOldSha]),
    })
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'remote-proof-failed'
    )

    assert.equal(error.backupRetained, false)
    assert.equal(error.restoredOriginalTip, false)
    assert.equal(harness.backups.size, 0)
    assert.equal(
      harness.events.some(event => event.startsWith('reset:')),
      false
    )
  })

  it('restores the exact original tip when the first push is rejected', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, { pushBehaviors: ['rejected'] })
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'push-failed'
    )

    assert.equal(error.publishedBatches, 0)
    assert.equal(error.backupRetained, false)
    assert.equal(error.restoredOriginalTip, true)
    assert.deepStrictEqual(harness.getFingerprint(), reviewed.fingerprint)
    assert.equal(harness.backups.size, 0)
    assert.equal(
      harness.events.some(event => event.startsWith('restore:mixed:')),
      true
    )
  })

  it('retains the backup rather than restoring a remote-reachable replacement', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      pushBehaviors: ['rejected'],
      reachableCommitShas: new Set([FirstNewSha]),
    })
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'restore-failed'
    )

    assert.equal(error.backupRetained, true)
    assert.equal(error.restoredOriginalTip, false)
    assert.equal(harness.backups.size, 1)
    assert.equal(harness.getFingerprint().headSha, FirstNewSha)
    assert.equal(
      harness.events.some(event => event.startsWith('restore:')),
      false
    )
  })

  it('never restores after one batch is proven pushed', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      pushBehaviors: ['success', 'rejected'],
    })
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'push-failed'
    )

    assert.equal(error.publishedBatches, 1)
    assert.equal(error.backupRetained, true)
    assert.equal(error.restoredOriginalTip, false)
    assert.equal(harness.backups.size, 1)
    assert.equal(harness.getRemoteTip(), FirstNewSha)
    assert.equal(harness.getFingerprint().headSha, SecondNewSha)
    assert.equal(
      harness.events.some(event => event.startsWith('restore:')),
      false
    )
  })

  it('retains the backup when a fingerprint race makes restoration unsafe', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, { raceOnFingerprintRead: 2 })
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'stale-state'
    )

    assert.equal(error.backupRetained, true)
    assert.equal(error.restoredOriginalTip, false)
    assert.equal(harness.backups.size, 1)
    assert.equal(
      harness.events.some(event => event.startsWith('commit:')),
      false
    )
    assert.equal(
      harness.events.some(event => event.startsWith('restore:')),
      false
    )
  })

  it('restores after a commit failure and reconciles an after-reset error', async () => {
    for (const options of [
      { failCommitAt: 0 },
      { failReset: 'after' as const },
      { failReset: 'after-head-only' as const },
    ]) {
      const reviewed = makeInspection([120], [60, 60])
      const plan = createLocalCommitBatchPlan(
        reviewed.netChanges,
        () => 'replacement',
        100
      )
      const harness = makeHarness(reviewed, options)
      const expectedCode =
        'failCommitAt' in options ? 'commit-failed' : 'reset-failed'
      const error = await expectBatchingError(
        executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
        expectedCode
      )

      assert.equal(error.restoredOriginalTip, true)
      assert.equal(error.backupRetained, false)
      assert.deepStrictEqual(harness.getFingerprint(), reviewed.fingerprint)
      assert.equal(harness.backups.size, 0)
    }
  })

  it('retains the backup if a reported push cannot pass final remote proof', async () => {
    const reviewed = makeInspection([120], [60, 60])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      () => 'replacement',
      100
    )
    const harness = makeHarness(reviewed, {
      pushBehaviors: ['reported-success-without-update'],
    })
    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'remote-proof-failed'
    )

    assert.equal(error.backupRetained, false)
    assert.equal(error.restoredOriginalTip, true)
    assert.equal(harness.getRemoteTip(), BaseSha)
    assert.equal(harness.backups.size, 0)
  })

  it('closes a batch on the file-count cap before the size cap is reached', () => {
    const changes = Array.from({ length: 5 }, (_unused, file) => ({
      path: `tiny-${file}.bin`,
      sizeInBytes: 1,
    }))
    const plan = createLocalCommitBatchPlan(
      changes,
      (paths, index, total) =>
        `count ${index + 1}/${total}: ${paths.join('+')}`,
      1_000_000, // The 5-byte total is far within the size ceiling.
      2 // Two files per batch is reached first.
    )

    assert.equal(plan.fileCountLimit, 2)
    assert.deepStrictEqual(
      plan.batches.map(batch => batch.changes.map(change => change.path)),
      [
        ['tiny-0.bin', 'tiny-1.bin'],
        ['tiny-2.bin', 'tiny-3.bin'],
        ['tiny-4.bin'],
      ]
    )
    // Every batch is within both ceilings.
    assert.equal(
      plan.batches.every(
        batch => batch.changes.length <= 2 && batch.sizeInBytes <= 1_000_000
      ),
      true
    )
  })

  it('decides batching from the file-count cap even when every byte fits', () => {
    // One commit whose file count alone exceeds the limit must be rewritten.
    const single = makeMultiFileInspection([5])
    assert.equal(
      decideLocalCommitPushBatching(single, 1_000_000, 3).kind,
      'rewrite'
    )
    assert.deepStrictEqual(
      decideLocalCommitPushBatching(single, 1_000_000, 10),
      {
        kind: 'not-needed',
        reason: 'within-limit',
        totalSizeInBytes: 5,
      }
    )

    // Two commits under the per-commit cap whose combined file count crosses it
    // are pushed one existing tip at a time rather than rewritten.
    const pair = makeMultiFileInspection([3, 3])
    assert.equal(
      decideLocalCommitPushBatching(pair, 1_000_000, 4).kind,
      'push-existing'
    )
    assert.equal(
      decideLocalCommitPushBatching(pair, 1_000_000, 10).kind,
      'not-needed'
    )
  })

  it('rewrites a file-count-oversized commit and proves each push between batches', async () => {
    const reviewed = makeMultiFileInspection([4])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      (_paths, index, total) => `count batch ${index + 1}/${total}`,
      1_000_000,
      2
    )
    assert.equal(plan.batches.length, 2)
    assert.equal(
      decideLocalCommitPushBatching(reviewed, 1_000_000, 2).kind,
      'rewrite'
    )
    const harness = makeHarness(reviewed)

    const result = await handleLocalCommitPushBatching(
      reviewed,
      harness.operations,
      plan,
      1_000_000,
      false,
      2
    )

    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed rewrite')
    }
    assert.equal(result.batchesCommitted, 2)
    assert.equal(result.batchesPushed, 2)
    // Each batch commit is immediately followed by its own proven push, before
    // the next commit begins.
    assert.deepStrictEqual(
      harness.events.filter(
        event => event.startsWith('commit:') || event.startsWith('push:')
      ),
      [
        'commit:c1-f0.bin,c1-f1.bin:count batch 1/2',
        `push:${BaseSha}:${FirstNewSha}:force=false:success`,
        'commit:c1-f2.bin,c1-f3.bin:count batch 2/2',
        `push:${FirstNewSha}:${SecondNewSha}:force=false:success`,
      ]
    )
    assert.equal(harness.getRemoteTip(), SecondNewSha)
  })

  it('stops a file-count rewrite before the next commit when a push is rejected', async () => {
    const reviewed = makeMultiFileInspection([4])
    const plan = createLocalCommitBatchPlan(
      reviewed.netChanges,
      (_paths, index, total) => `count batch ${index + 1}/${total}`,
      1_000_000,
      2
    )
    const harness = makeHarness(reviewed, { pushBehaviors: ['rejected'] })

    const error = await expectBatchingError(
      executeLocalCommitBatchPlan(reviewed, plan, harness.operations),
      'push-failed'
    )

    assert.equal(error.publishedBatches, 0)
    assert.equal(error.restoredOriginalTip, true)
    // The second batch never committed once the first push was rejected.
    assert.equal(
      harness.events.filter(event => event.startsWith('commit:')).length,
      1
    )
    assert.equal(harness.getRemoteTip(), BaseSha)
    assert.equal(harness.backups.size, 0)
  })
})
