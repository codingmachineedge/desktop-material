import assert from 'node:assert'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import { describe, it } from 'node:test'
import { exec } from 'dugite'

import {
  buildLocalCommitArgv,
  buildLocalCommitBatchingExactPushArgv,
  buildLocalCommitExplicitStageArgv,
  buildLocalCommitRawDiffArgv,
  createLocalCommitBatchingGitSession,
  ILocalCommitBatchingGitResult,
  LocalCommitBatchingGitError,
  LocalCommitBatchingGitRunner,
  parseLocalCommitLogZ,
  parseLocalCommitLsRemote,
  parseLocalCommitRawDiffZ,
  pushLocalCommitBatchExactly,
} from '../../../src/lib/git/local-commit-batching-git'
import {
  handleLocalCommitPushBatching,
  LocalCommitBatchingError,
} from '../../../src/lib/git/local-commit-batching'
import { git } from '../../../src/lib/git/core'
import { Repository } from '../../../src/models/repository'

const oid = (digit: string) => digit.repeat(40)

interface ITestRepository {
  readonly root: string
  readonly worktree: string
  readonly bare: string
  readonly repository: Repository
  readonly baseSha: string
}

async function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
  successExitCodes: ReadonlySet<number> = new Set([0])
) {
  const result = await exec([...args], cwd)
  assert(successExitCodes.has(result.exitCode), result.stderr || result.stdout)
  return result
}

async function revParse(cwd: string, revision = 'HEAD') {
  const result = await runGit(cwd, ['rev-parse', revision])
  return result.stdout.trim()
}

async function commitFile(
  repositoryPath: string,
  path: string,
  contents: string,
  message: string
) {
  await writeFile(Path.join(repositoryPath, path), contents)
  await runGit(repositoryPath, ['add', '--', path])
  await runGit(repositoryPath, ['commit', '-m', message])
  return revParse(repositoryPath)
}

async function setupRepository(t: {
  after: (callback: () => unknown) => void
}) {
  const root = await mkdtemp(
    Path.join(tmpdir(), 'desktop-material-local-commit-batching-test-')
  )
  t.after(() => rm(root, { recursive: true, force: true }))
  const worktree = Path.join(root, 'worktree')
  const bare = Path.join(root, 'remote.git')
  await mkdir(worktree)
  await runGit(root, ['init', '--bare', '--initial-branch=main', bare])
  await runGit(worktree, ['init', '--initial-branch=main'])
  await runGit(worktree, ['config', 'user.name', 'Batch Test'])
  await runGit(worktree, ['config', 'user.email', 'batch@example.invalid'])
  const hooks = Path.join(root, 'hooks')
  await mkdir(hooks)
  await runGit(worktree, ['config', 'core.hooksPath', hooks])
  const baseSha = await commitFile(worktree, 'base.txt', 'base', 'base')
  await runGit(worktree, ['remote', 'add', 'origin', bare])
  await runGit(worktree, ['push', '--set-upstream', 'origin', 'main'])
  const fixture: ITestRepository = {
    root,
    worktree,
    bare,
    repository: new Repository(worktree, -101, null, false),
    baseSha,
  }
  return fixture
}

function captureRunner(
  calls: Array<{
    readonly args: ReadonlyArray<string>
    readonly name: string
    readonly stdin?: string | Buffer
  }>
): LocalCommitBatchingGitRunner {
  return async (args, path, name, options) => {
    calls.push({ args: [...args], name, stdin: options?.stdin })
    return (await git(
      args,
      path,
      name,
      options
    )) as ILocalCommitBatchingGitResult
  }
}

function throwAfterSuccessfulBatchCommitRunner(
  calls: Array<{
    readonly args: ReadonlyArray<string>
    readonly name: string
    readonly stdin?: string | Buffer
  }>
): LocalCommitBatchingGitRunner {
  return async (args, path, name, options) => {
    calls.push({ args: [...args], name, stdin: options?.stdin })
    const executionOptions =
      name === 'localCommitBatchingCommit'
        ? { ...options, interceptHooks: undefined }
        : options
    const result = (await git(
      args,
      path,
      name,
      executionOptions
    )) as ILocalCommitBatchingGitResult
    if (name === 'localCommitBatchingCommit') {
      throw new Error('synthetic post-commit maintenance failure')
    }
    return result
  }
}

const runGitWithNativeHooks: LocalCommitBatchingGitRunner = async (
  args,
  path,
  name,
  options
) =>
  (await git(
    args,
    path,
    name,
    name === 'localCommitBatchingCommit'
      ? { ...options, interceptHooks: undefined }
      : options
  )) as ILocalCommitBatchingGitResult

describe('git/local-commit-batching-git', () => {
  it('uses process-local cheap packing for only the exact batching push', async () => {
    const repository = new Repository('C:\\batch-repository', -102, null, false)
    const headSha = oid('a')
    const onHookProgress = () => undefined
    const onHookFailure = async () => 'abort' as const
    const onTerminalOutputAvailable = () => undefined
    const remoteEnvironment = { GIT_ASKPASS: 'batch-test-askpass' }
    const calls = new Array<{
      readonly args: ReadonlyArray<string>
      readonly path: string
      readonly name: string
      readonly options?: Parameters<LocalCommitBatchingGitRunner>[3]
    }>()

    await pushLocalCommitBatchExactly(
      {
        repository,
        remote: { name: 'origin', url: 'https://example.invalid/repo.git' },
        headSha,
        remoteBranch: 'refs/heads/main',
        accountKey: 'batch-account',
        hookOptions: {
          onHookProgress,
          onHookFailure,
          onTerminalOutputAvailable,
        },
      },
      {
        runGit: async (args, path, name, options) => {
          calls.push({ args: [...args], path, name, options })
          return { stdout: '', stderr: '', exitCode: 0 }
        },
        remoteEnvironment: async url => {
          assert.equal(url, 'https://example.invalid/repo.git')
          return remoteEnvironment
        },
      }
    )

    assert.deepStrictEqual(
      buildLocalCommitBatchingExactPushArgv(
        'origin',
        headSha,
        'refs/heads/main'
      ),
      [
        '-c',
        'pack.window=0',
        '-c',
        'pack.compression=0',
        'push',
        'origin',
        `${headSha}:refs/heads/main`,
      ]
    )
    assert.equal(calls.length, 1)
    assert.deepStrictEqual(calls[0], {
      args: [
        '-c',
        'pack.window=0',
        '-c',
        'pack.compression=0',
        'push',
        'origin',
        `${headSha}:refs/heads/main`,
      ],
      path: repository.path,
      name: 'push',
      options: {
        env: remoteEnvironment,
        credentialAccountKey: 'batch-account',
        interceptHooks: ['pre-push'],
        onHookProgress,
        onHookFailure,
        onTerminalOutputAvailable,
      },
    })
  })

  it('parses bounded raw object, commit, and remote records', () => {
    const oldSha = oid('1')
    const newSha = oid('2')
    const zero = oid('0')
    const raw = [
      `:100644 000000 ${oldSha} ${zero} D`,
      'old name.bin',
      `:000000 100644 ${zero} ${newSha} A`,
      'new name.bin',
      '',
    ].join('\0')
    assert.deepStrictEqual(parseLocalCommitRawDiffZ(raw), [
      {
        status: 'D',
        oldMode: '100644',
        newMode: '000000',
        oldObjectId: oldSha,
        newObjectId: zero,
        path: 'old name.bin',
      },
      {
        status: 'A',
        oldMode: '000000',
        newMode: '100644',
        oldObjectId: zero,
        newObjectId: newSha,
        path: 'new name.bin',
      },
    ])

    const first = oid('3')
    const second = oid('4')
    assert.deepStrictEqual(
      parseLocalCommitLogZ(
        `${first}\0${oldSha}\0first message\n\0${second}\0${first}\0second message\n\0`
      ),
      [
        { sha: first, parentShas: [oldSha], message: 'first message\n' },
        { sha: second, parentShas: [first], message: 'second message\n' },
      ]
    )
    assert.deepStrictEqual(
      parseLocalCommitLsRemote(`${second}\tHEAD\n${second}\trefs/heads/main\n`),
      [
        { sha: second, ref: 'HEAD' },
        { sha: second, ref: 'refs/heads/main' },
      ]
    )
  })

  it('keeps paths and messages out of argv and rejects object-id injection', () => {
    const base = oid('a')
    const target = oid('b')
    const rawArgs = buildLocalCommitRawDiffArgv(base, target)
    assert.deepStrictEqual(rawArgs.slice(-3), [base, target, '--'])
    assert(rawArgs.includes('--no-renames'))
    assert.equal(
      rawArgs.some(arg => arg.includes('secret.txt')),
      false
    )
    assert.deepStrictEqual(buildLocalCommitExplicitStageArgv(), [
      '--literal-pathspecs',
      'add',
      '--all',
      '--pathspec-from-file=-',
      '--pathspec-file-nul',
    ])
    assert.deepStrictEqual(buildLocalCommitArgv(), [
      '-c',
      'gc.auto=0',
      'commit',
      '-F',
      '-',
    ])
    assert.deepStrictEqual(buildLocalCommitArgv(true), [
      '-c',
      'gc.auto=0',
      'commit',
      '-F',
      '-',
      '--allow-empty',
    ])
    assert.throws(
      () => buildLocalCommitRawDiffArgv(`${base} --upload-pack=evil`, target),
      error => error instanceof LocalCommitBatchingGitError
    )
    assert.throws(
      () =>
        parseLocalCommitRawDiffZ(
          `:100644 100644 ${base} ${target} R100\0old\0new\0`
        ),
      error => error instanceof LocalCommitBatchingGitError
    )
  })

  it('inspects raw commit objects and expands a rename into delete/add paths', async t => {
    const fixture = await setupRepository(t)
    await runGit(fixture.worktree, ['mv', 'base.txt', 'renamed.txt'])
    await runGit(fixture.worktree, ['commit', '-m', 'rename base'])
    const session = createLocalCommitBatchingGitSession(fixture.repository)
    const inspection = await session.inspect()

    assert.equal(inspection.ahead, 1)
    assert.equal(inspection.behind, 0)
    assert.equal(inspection.localOnlyCommits.length, 1)
    assert(inspection.localOnlyCommits[0].message.startsWith('rename base'))
    assert.equal(inspection.localOnlyCommits[0].payloadSizeInBytes, 4)
    assert.deepStrictEqual(
      [...inspection.localOnlyCommits[0].changes].sort((a, b) =>
        a.path.localeCompare(b.path)
      ),
      [
        { path: 'base.txt', sizeInBytes: 0 },
        { path: 'renamed.txt', sizeInBytes: 4 },
      ]
    )
    assert.equal(inspection.fingerprint.isIndexClean, true)
    assert.equal(inspection.fingerprint.isWorktreeClean, true)

    await writeFile(
      Path.join(fixture.worktree, '.git', 'CHERRY_PICK_HEAD'),
      inspection.fingerprint.headSha as string
    )
    const operationInspection = await session.inspect()
    assert.match(
      operationInspection.fingerprint.operationState ?? '',
      /cherry-pick/
    )
  })

  it('pushes existing under-limit commit tips one at a time', async t => {
    const fixture = await setupRepository(t)
    const first = await commitFile(
      fixture.worktree,
      'one.bin',
      '1234',
      'first small commit'
    )
    const second = await commitFile(
      fixture.worktree,
      'two.bin',
      '5678',
      'second small commit'
    )
    const session = createLocalCommitBatchingGitSession(fixture.repository)
    const preparation = await session.prepare(() => 'unused', 5)
    assert.equal(preparation.decision.kind, 'push-existing')

    const result = await handleLocalCommitPushBatching(
      preparation.inspection,
      session.operations,
      preparation.rewritePlan,
      5
    )
    assert.deepStrictEqual(result, {
      status: 'completed',
      mode: 'existing-commits',
      backupRef: null,
      batchesCommitted: 0,
      batchesPushed: 2,
      finalHeadSha: second,
    })
    assert.notEqual(first, second)
    assert.equal(await revParse(fixture.bare, 'refs/heads/main'), second)
  })

  it('rewrites one oversized legacy commit using CAS refs and stdin-only paths', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const originalHead = await revParse(fixture.worktree)
    const calls = new Array<{
      readonly args: ReadonlyArray<string>
      readonly name: string
      readonly stdin?: string | Buffer
    }>()
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: { runGit: captureRunner(calls) },
    })
    const preparation = await session.prepare(
      (_paths, index, total) => `legacy batch ${index + 1}/${total}`,
      5
    )
    assert.equal(preparation.decision.kind, 'rewrite')
    assert.equal(preparation.rewritePlan?.batches.length, 2)

    const result = await handleLocalCommitPushBatching(
      preparation.inspection,
      session.operations,
      preparation.rewritePlan,
      5
    )
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed rewrite')
    }
    assert.equal(result.mode, 'rewritten-commits')
    assert.equal(result.batchesCommitted, 2)
    assert.equal(result.batchesPushed, 2)
    assert.notEqual(result.finalHeadSha, originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      result.finalHeadSha
    )

    const stages = calls.filter(
      call => call.name === 'localCommitBatchingStagePaths'
    )
    assert.equal(stages.length, 2)
    for (const stage of stages) {
      assert.deepStrictEqual(stage.args, buildLocalCommitExplicitStageArgv())
      assert.equal(
        stage.args.some(arg => arg.endsWith('.bin')),
        false
      )
      assert.match(String(stage.stdin), /\.bin\0$/)
    }
    const commits = calls.filter(
      call => call.name === 'localCommitBatchingCommit'
    )
    assert.deepStrictEqual(
      commits.map(call => call.args),
      [buildLocalCommitArgv(), buildLocalCommitArgv()]
    )
    assert.deepStrictEqual(
      commits.map(call => call.stdin),
      ['legacy batch 1/2', 'legacy batch 2/2']
    )
    const backupCreate = calls.find(
      call => call.name === 'localCommitBatchingCreateBackup'
    )
    assert(backupCreate !== undefined)
    assert.equal(backupCreate.args[3], '0'.repeat(originalHead.length))
    assert.equal(
      calls.some(
        call => call.args.includes('--force') || call.args.includes('-f')
      ),
      false
    )
    const backup = await runGit(
      fixture.worktree,
      ['show-ref', '--verify', '--quiet', result.backupRef as string],
      new Set([0, 1])
    )
    assert.equal(backup.exitCode, 1)
    assert.equal(
      (await runGit(fixture.worktree, ['status', '--porcelain'])).stdout,
      ''
    )
  })

  it('uses an existing exact remote branch as the base without writing upstream config', async t => {
    const fixture = await setupRepository(t)
    await runGit(fixture.worktree, ['branch', '--unset-upstream'])
    await commitFile(fixture.worktree, 'one.bin', '1234', 'first local commit')
    const finalHead = await commitFile(
      fixture.worktree,
      'two.bin',
      '5678',
      'second local commit'
    )
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      remote: { name: 'origin', url: fixture.bare },
      remoteBranchRef: 'refs/heads/main',
    })
    const preparation = await session.prepare(() => 'unused', 5)
    assert.equal(
      preparation.inspection.fingerprint.upstreamSha,
      fixture.baseSha
    )
    assert.equal(preparation.decision.kind, 'push-existing')

    const result = await handleLocalCommitPushBatching(
      preparation.inspection,
      session.operations,
      preparation.rewritePlan,
      5
    )
    assert.equal(result.status, 'completed')
    assert.equal(await revParse(fixture.bare, 'refs/heads/main'), finalHead)
    const upstream = await runGit(
      fixture.worktree,
      ['rev-parse', '--verify', '@{upstream}'],
      new Set([0, 1, 128])
    )
    assert.notEqual(upstream.exitCode, 0)
  })

  it('rebuilds an oversized unpublished history as bounded root commits without configuring upstream', async t => {
    const fixture = await setupRepository(t)
    await runGit(fixture.bare, ['update-ref', '-d', 'refs/heads/main'])
    await runGit(fixture.worktree, ['branch', '--unset-upstream'])
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, [
      'commit',
      '-m',
      'legacy unpublished payload',
    ])
    const originalHead = await revParse(fixture.worktree)
    const calls = new Array<{
      readonly args: ReadonlyArray<string>
      readonly name: string
      readonly stdin?: string | Buffer
    }>()
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      remote: { name: 'origin', url: fixture.bare },
      remoteBranchRef: 'refs/heads/main',
      dependencies: { runGit: captureRunner(calls) },
    })
    const preparation = await session.prepare(
      (_paths, index, total) => `initial batch ${index + 1}/${total}`,
      5
    )
    assert.equal(preparation.inspection.fingerprint.upstreamSha, null)
    assert.equal(preparation.decision.kind, 'rewrite')

    const result = await handleLocalCommitPushBatching(
      preparation.inspection,
      session.operations,
      preparation.rewritePlan,
      5
    )
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed first-publication rewrite')
    }
    assert.notEqual(result.finalHeadSha, originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      result.finalHeadSha
    )
    assert.equal(
      Number(
        (
          await runGit(fixture.bare, ['rev-list', '--count', 'refs/heads/main'])
        ).stdout.trim()
      ),
      3
    )
    const root = (
      await runGit(fixture.bare, [
        'rev-list',
        '--max-parents=0',
        'refs/heads/main',
      ])
    ).stdout.trim()
    assert.match(root, /^[0-9a-f]{40}$/)
    assert.equal(
      (
        await runGit(
          fixture.worktree,
          ['rev-parse', '--verify', '@{upstream}'],
          new Set([0, 1, 128])
        )
      ).exitCode,
      128
    )
    assert.equal(
      calls.some(
        call => call.args.includes('--force') || call.args.includes('-f')
      ),
      false
    )
    assert.equal(
      calls.filter(call => call.name === 'localCommitBatchingCommit').length,
      3
    )
    assert.equal(
      (await runGit(fixture.worktree, ['status', '--porcelain'])).stdout,
      ''
    )
  })

  it('accepts an exact hook-mutated commit after a simulated nonzero post-commit exit without persisting gc config', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const hookPath = Path.join(fixture.root, 'hooks', 'commit-msg')
    await writeFile(
      hookPath,
      ['#!/bin/sh', 'printf \'\\nHook-mutated message\\n\' >> "$1"', ''].join(
        '\n'
      )
    )
    await chmod(hookPath, 0o755)
    const calls = new Array<{
      readonly args: ReadonlyArray<string>
      readonly name: string
      readonly stdin?: string | Buffer
    }>()
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: {
        runGit: throwAfterSuccessfulBatchCommitRunner(calls),
      },
    })
    const preparation = await session.prepare(
      (_paths, index, total) => `recovered batch ${index + 1}/${total}`,
      5
    )
    const result = await handleLocalCommitPushBatching(
      preparation.inspection,
      session.operations,
      preparation.rewritePlan,
      5
    )
    assert.equal(result.status, 'completed')
    const messages = (
      await runGit(fixture.worktree, [
        'log',
        '--format=%B%x00',
        `${fixture.baseSha}..HEAD`,
      ])
    ).stdout
    assert.equal((messages.match(/Hook-mutated message/g) ?? []).length, 2)
    assert.equal(
      calls
        .filter(call => call.name === 'localCommitBatchingCommit')
        .every(
          call =>
            call.args[0] === '-c' &&
            call.args[1] === 'gc.auto=0' &&
            call.args[2] === 'commit'
        ),
      true
    )
    assert.equal(
      (
        await runGit(
          fixture.worktree,
          ['config', '--local', '--get', 'gc.auto'],
          new Set([0, 1])
        )
      ).exitCode,
      1
    )
  })

  it('restores the protected tip after a genuine commit failure without writing gc config', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const originalHead = await revParse(fixture.worktree)
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: {
        runGit: async (args, path, name, options) => {
          if (name === 'localCommitBatchingCommit') {
            throw new Error('synthetic commit did not run')
          }
          return (await git(
            args,
            path,
            name,
            options
          )) as ILocalCommitBatchingGitResult
        },
      },
    })
    const preparation = await session.prepare(() => 'replacement batch', 5)

    await assert.rejects(
      handleLocalCommitPushBatching(
        preparation.inspection,
        session.operations,
        preparation.rewritePlan,
        5
      ),
      error =>
        error instanceof LocalCommitBatchingError &&
        error.code === 'commit-failed' &&
        error.restoredOriginalTip
    )
    assert.equal(await revParse(fixture.worktree), originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      fixture.baseSha
    )
    assert.equal(
      (
        await runGit(
          fixture.worktree,
          ['config', '--local', '--get', 'gc.auto'],
          new Set([0, 1])
        )
      ).exitCode,
      1
    )
  })

  it('proves exact committed paths and refuses a hook-staged future batch before push', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const originalHead = await revParse(fixture.worktree)
    const hookPath = Path.join(fixture.root, 'hooks', 'pre-commit')
    await writeFile(
      hookPath,
      [
        '#!/bin/sh',
        "if git diff --cached --name-only | grep -qx 'one.bin'; then",
        '  git add -- two.bin',
        'fi',
        '',
      ].join('\n')
    )
    await chmod(hookPath, 0o755)

    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: { runGit: runGitWithNativeHooks },
    })
    const preparation = await session.prepare(() => 'replacement batch', 5)
    await assert.rejects(
      handleLocalCommitPushBatching(
        preparation.inspection,
        session.operations,
        preparation.rewritePlan,
        5
      ),
      error =>
        error instanceof LocalCommitBatchingError &&
        error.code === 'commit-failed' &&
        error.publishedBatches === 0 &&
        error.restoredOriginalTip
    )
    assert.equal(await revParse(fixture.worktree), originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      fixture.baseSha
    )
    assert.equal(
      (await runGit(fixture.worktree, ['status', '--porcelain'])).stdout,
      ''
    )
  })

  it('refuses same-size hook substitution before publishing the first replacement batch', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const originalHead = await revParse(fixture.worktree)
    const hookPath = Path.join(fixture.root, 'hooks', 'pre-commit')
    await writeFile(
      hookPath,
      [
        '#!/bin/sh',
        "if git diff --cached --name-only | grep -qx 'one.bin'; then",
        "  evil=$(printf 'EVIL' | git hash-object -w --stdin)",
        '  git update-index --cacheinfo 100644,$evil,one.bin',
        'fi',
        '',
      ].join('\n')
    )
    await chmod(hookPath, 0o755)
    let pushes = 0
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: {
        runGit: runGitWithNativeHooks,
        pushExact: async () => {
          pushes++
        },
      },
    })
    const preparation = await session.prepare(() => 'replacement batch', 5)

    await assert.rejects(
      handleLocalCommitPushBatching(
        preparation.inspection,
        session.operations,
        preparation.rewritePlan,
        5
      ),
      error =>
        error instanceof LocalCommitBatchingError &&
        error.code === 'commit-failed' &&
        error.publishedBatches === 0 &&
        error.restoredOriginalTip
    )
    assert.equal(pushes, 0)
    assert.equal(await revParse(fixture.worktree), originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      fixture.baseSha
    )
  })

  it('refuses to rewrite a commit reachable from a second configured remote', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const originalHead = await revParse(fixture.worktree)
    const secondRemote = Path.join(fixture.root, 'second.git')
    await runGit(fixture.root, [
      'init',
      '--bare',
      '--initial-branch=main',
      secondRemote,
    ])
    await runGit(fixture.worktree, ['remote', 'add', 'second', secondRemote])
    await runGit(fixture.worktree, ['push', 'second', 'HEAD:refs/heads/main'])
    const session = createLocalCommitBatchingGitSession(fixture.repository)
    const preparation = await session.prepare(() => 'replacement batch', 5)

    await assert.rejects(
      handleLocalCommitPushBatching(
        preparation.inspection,
        session.operations,
        preparation.rewritePlan,
        5
      ),
      error =>
        error instanceof LocalCommitBatchingError &&
        error.code === 'remote-proof-failed' &&
        error.publishedBatches === 0
    )
    assert.equal(await revParse(fixture.worktree), originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      fixture.baseSha
    )
    assert.equal(await revParse(secondRemote, 'refs/heads/main'), originalHead)
  })

  it('rewrites an oversized add-delete range as one empty commit', async t => {
    const fixture = await setupRepository(t)
    const transient = Path.join(fixture.worktree, 'transient.bin')
    await writeFile(transient, '123456')
    await runGit(fixture.worktree, ['add', '--', 'transient.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized add'])
    await rm(transient)
    await runGit(fixture.worktree, ['add', '--all', '--', 'transient.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'remove transient'])

    const calls = new Array<{
      readonly args: ReadonlyArray<string>
      readonly name: string
      readonly stdin?: string | Buffer
    }>()
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: { runGit: captureRunner(calls) },
    })
    const preparation = await session.prepare(() => 'empty replacement', 5)
    assert.equal(preparation.decision.kind, 'rewrite')
    assert.deepStrictEqual(preparation.rewritePlan?.batches, [
      { changes: [], sizeInBytes: 0, message: 'empty replacement' },
    ])

    const result = await handleLocalCommitPushBatching(
      preparation.inspection,
      session.operations,
      preparation.rewritePlan,
      5
    )
    assert.equal(result.status, 'completed')
    if (result.status !== 'completed') {
      assert.fail('expected completed rewrite')
    }
    assert.equal(result.batchesCommitted, 1)
    assert.equal(result.batchesPushed, 1)
    assert.equal(
      await revParse(fixture.worktree, `${result.finalHeadSha}^{tree}`),
      await revParse(fixture.worktree, `${fixture.baseSha}^{tree}`)
    )
    assert.equal(
      calls.some(call => call.name === 'localCommitBatchingStagePaths'),
      false
    )
    assert.deepStrictEqual(
      calls.find(call => call.name === 'localCommitBatchingCommit')?.args,
      buildLocalCommitArgv(true)
    )
  })

  it('restores the original clean tip when the first real push never starts', async t => {
    const fixture = await setupRepository(t)
    await writeFile(Path.join(fixture.worktree, 'one.bin'), '1234')
    await writeFile(Path.join(fixture.worktree, 'two.bin'), '5678')
    await runGit(fixture.worktree, ['add', '--', 'one.bin', 'two.bin'])
    await runGit(fixture.worktree, ['commit', '-m', 'legacy oversized commit'])
    const originalHead = await revParse(fixture.worktree)
    const session = createLocalCommitBatchingGitSession(fixture.repository, {
      dependencies: {
        pushExact: async () => {
          throw new Error('synthetic pre-network failure')
        },
      },
    })
    const preparation = await session.prepare(() => 'replacement batch', 5)

    await assert.rejects(
      handleLocalCommitPushBatching(
        preparation.inspection,
        session.operations,
        preparation.rewritePlan,
        5
      ),
      error =>
        error instanceof LocalCommitBatchingError &&
        error.code === 'push-failed' &&
        error.restoredOriginalTip
    )
    assert.equal(await revParse(fixture.worktree), originalHead)
    assert.equal(
      await revParse(fixture.bare, 'refs/heads/main'),
      fixture.baseSha
    )
    assert.equal(
      (await runGit(fixture.worktree, ['status', '--porcelain'])).stdout,
      ''
    )
  })
})
