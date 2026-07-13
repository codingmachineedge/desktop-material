import assert from 'node:assert'
import { existsSync } from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import {
  applyReviewedRepositoryHookAction,
  inspectRepositoryHooks,
  KnownRepositoryClientHooks,
  RepositoryHooksManagerError,
  revealRepositoryHooks,
} from '../../src/lib/hooks/repository-hooks-manager'
import { getRepoHooks } from '../../src/lib/hooks/get-repo-hooks'
import { setupEmptyRepository } from '../helpers/repositories'
import { createTempDirectory } from '../helpers/temp'

const hookBody = '#!/bin/sh\nexit 0\n'

async function setupHooks(t: Parameters<typeof setupEmptyRepository>[0]) {
  const repository = await setupEmptyRepository(t)
  const hooksPath = join(repository.path, '.git', 'hooks')
  await mkdir(hooksPath)
  return { repository, hooksPath }
}

function findHook(
  snapshot: Awaited<ReturnType<typeof inspectRepositoryHooks>>,
  name: 'pre-commit' | 'pre-push' | 'commit-msg'
) {
  const hook = snapshot.hooks.find(candidate => candidate.name === name)
  assert.ok(hook)
  return hook
}

function findAction(
  hook: ReturnType<typeof findHook>,
  action:
    | 'enable-disabled'
    | 'disable-active'
    | 'install-sample'
    | 'remove-disabled'
) {
  const review = hook.actions.find(candidate => candidate.action === action)
  assert.ok(review)
  return review
}

describe('repository hooks manager', () => {
  it('inspects every known client hook with neutral location and bounded metadata', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const active = join(hooksPath, 'pre-commit')
    await writeFile(active, hookBody)
    await chmod(active, 0o755)
    assert.deepEqual(await Array.fromAsync(getRepoHooks(repository.path)), [
      'pre-commit',
    ])

    const snapshot = await inspectRepositoryHooks(repository.path)
    assert.equal(snapshot.locationKind, 'default')
    assert.equal(snapshot.locationLabel, '.git/hooks')
    assert.equal(snapshot.directoryAvailable, true)
    assert.equal(snapshot.hooks.length, KnownRepositoryClientHooks.length)
    assert.deepEqual(
      snapshot.hooks.map(hook => hook.name),
      [...KnownRepositoryClientHooks]
    )
    const hook = findHook(snapshot, 'pre-commit')
    assert.equal(hook.active.state, 'present')
    assert.equal(hook.active.metadata?.size, Buffer.byteLength(hookBody))
    assert.match(hook.active.metadata?.modifiedAt ?? '', /^\d{4}-/)
    assert.equal(hook.active.metadata?.fileKind, 'script')
    assert.equal(hook.disabled.state, 'missing')
    assert.ok(findAction(hook, 'disable-active').token.match(/^[0-9a-f]{64}$/))
    assert.equal(JSON.stringify(snapshot).includes(repository.path), false)
    assert.equal(JSON.stringify(snapshot).includes(hooksPath), false)
    assert.equal(JSON.stringify(snapshot).includes(hookBody), false)
  })

  it('disables and re-enables only the exact reviewed hook without replacing files', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const active = join(hooksPath, 'pre-commit')
    const disabled = join(hooksPath, 'pre-commit.disabled')
    await writeFile(active, hookBody)
    await chmod(active, 0o755)

    const disable = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-commit'),
      'disable-active'
    )
    const disabledSnapshot = await applyReviewedRepositoryHookAction(
      repository.path,
      { hookName: 'pre-commit', action: disable.action, token: disable.token }
    )
    assert.equal(existsSync(active), false)
    assert.equal(await readFile(disabled, 'utf8'), hookBody)
    assert.deepEqual(await Array.fromAsync(getRepoHooks(repository.path)), [])
    assert.equal(
      findHook(disabledSnapshot, 'pre-commit').disabled.state,
      'present'
    )

    const enable = findAction(
      findHook(disabledSnapshot, 'pre-commit'),
      'enable-disabled'
    )
    const enabledSnapshot = await applyReviewedRepositoryHookAction(
      repository.path,
      { hookName: 'pre-commit', action: enable.action, token: enable.token }
    )
    assert.equal(await readFile(active, 'utf8'), hookBody)
    assert.equal(existsSync(disabled), false)
    assert.deepEqual(await Array.fromAsync(getRepoHooks(repository.path)), [
      'pre-commit',
    ])
    assert.equal(
      findHook(enabledSnapshot, 'pre-commit').active.state,
      'present'
    )
    assert.deepEqual(
      (await readdir(hooksPath)).filter(name =>
        name.startsWith('.desktop-material-hook-')
      ),
      []
    )
  })

  it('installs a reviewed sample as a create-new active hook and keeps the sample', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const sample = join(hooksPath, 'commit-msg.sample')
    const active = join(hooksPath, 'commit-msg')
    await writeFile(sample, hookBody)

    const install = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'commit-msg'),
      'install-sample'
    )
    const result = await applyReviewedRepositoryHookAction(repository.path, {
      hookName: 'commit-msg',
      action: install.action,
      token: install.token,
    })

    assert.equal(await readFile(sample, 'utf8'), hookBody)
    assert.equal(await readFile(active, 'utf8'), hookBody)
    assert.equal(findHook(result, 'commit-msg').active.state, 'present')
    assert.equal(findHook(result, 'commit-msg').sample.state, 'present')
  })

  it('permanently removes only an exact reviewed disabled hook', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const disabled = join(hooksPath, 'pre-push.disabled')
    await writeFile(disabled, hookBody)
    const remove = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-push'),
      'remove-disabled'
    )

    const result = await applyReviewedRepositoryHookAction(repository.path, {
      hookName: 'pre-push',
      action: remove.action,
      token: remove.token,
    })
    assert.equal(existsSync(disabled), false)
    assert.equal(findHook(result, 'pre-push').disabled.state, 'missing')
  })

  it('rejects stale content, destination races, and core.hooksPath drift', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const active = join(hooksPath, 'pre-commit')
    const disabled = join(hooksPath, 'pre-commit.disabled')
    await writeFile(active, hookBody)
    const first = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-commit'),
      'disable-active'
    )
    await writeFile(active, `${hookBody}# changed\n`)
    await assert.rejects(
      applyReviewedRepositoryHookAction(repository.path, {
        hookName: 'pre-commit',
        action: first.action,
        token: first.token,
      }),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'stale-review'
    )

    const second = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-commit'),
      'disable-active'
    )
    await writeFile(disabled, 'existing destination')
    await assert.rejects(
      applyReviewedRepositoryHookAction(repository.path, {
        hookName: 'pre-commit',
        action: second.action,
        token: second.token,
      }),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'stale-review'
    )
    assert.equal(await readFile(disabled, 'utf8'), 'existing destination')
    await writeFile(disabled, hookBody)

    const thirdSnapshot = await inspectRepositoryHooks(repository.path)
    const third = findAction(
      findHook(thirdSnapshot, 'pre-commit'),
      'remove-disabled'
    )
    const alternate = await createTempDirectory(t)
    await exec(['config', 'core.hooksPath', alternate], repository.path)
    await assert.rejects(
      applyReviewedRepositoryHookAction(repository.path, {
        hookName: 'pre-commit',
        action: third.action,
        token: third.token,
      }),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'stale-review'
    )
    assert.equal(existsSync(disabled), true)
  })

  it('rejects a same-content file identity swap before the unlink boundary', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const active = join(hooksPath, 'pre-commit')
    const displaced = join(hooksPath, 'displaced-hook')
    await writeFile(active, hookBody)
    const review = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-commit'),
      'disable-active'
    )
    await rename(active, displaced)
    await writeFile(active, hookBody)

    await assert.rejects(
      applyReviewedRepositoryHookAction(repository.path, {
        hookName: 'pre-commit',
        action: review.action,
        token: review.token,
      }),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'stale-review'
    )
    assert.equal(await readFile(active, 'utf8'), hookBody)
    assert.equal(await readFile(displaced, 'utf8'), hookBody)
    assert.equal(existsSync(join(hooksPath, 'pre-commit.disabled')), false)
  })

  it('rolls back a newly published destination when cancellation wins before source removal', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const active = join(hooksPath, 'pre-commit')
    const disabled = join(hooksPath, 'pre-commit.disabled')
    await writeFile(active, hookBody)
    const review = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-commit'),
      'disable-active'
    )
    const signal = {
      get aborted() {
        return existsSync(disabled)
      },
    } as AbortSignal

    await assert.rejects(
      applyReviewedRepositoryHookAction(
        repository.path,
        {
          hookName: 'pre-commit',
          action: review.action,
          token: review.token,
        },
        signal
      ),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError && error.kind === 'aborted'
    )
    assert.equal(await readFile(active, 'utf8'), hookBody)
    assert.equal(existsSync(disabled), false)
  })

  it('returns the changed state instead of a clean cancellation after unlink', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const disabled = join(hooksPath, 'pre-push.disabled')
    await writeFile(disabled, hookBody)
    const review = findAction(
      findHook(await inspectRepositoryHooks(repository.path), 'pre-push'),
      'remove-disabled'
    )
    const signal = {
      get aborted() {
        return !existsSync(disabled)
      },
    } as AbortSignal

    const result = await applyReviewedRepositoryHookAction(
      repository.path,
      {
        hookName: 'pre-push',
        action: review.action,
        token: review.token,
      },
      signal
    )
    assert.equal(findHook(result, 'pre-push').disabled.state, 'missing')
  })

  it('blocks traversal, unknown hook names, symlinks, and hard-link aliases', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    await exec(
      ['config', 'core.hooksPath', '../outside-hooks'],
      repository.path
    )
    await assert.rejects(
      inspectRepositoryHooks(repository.path),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'unsafe-location'
    )
    await exec(['config', '--unset', 'core.hooksPath'], repository.path)

    await assert.rejects(
      applyReviewedRepositoryHookAction(repository.path, {
        hookName: '../pre-commit' as 'pre-commit',
        action: 'disable-active',
        token: 'a'.repeat(64),
      }),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'invalid-input'
    )

    const linked = join(hooksPath, 'pre-commit')
    const alias = join(hooksPath, 'alias')
    await writeFile(linked, hookBody)
    await link(linked, alias)
    let snapshot = await inspectRepositoryHooks(repository.path)
    assert.equal(findHook(snapshot, 'pre-commit').active.state, 'unsafe')
    assert.equal(findHook(snapshot, 'pre-commit').actions.length, 0)

    await Promise.all([
      writeFile(join(hooksPath, 'commit-msg-target'), hookBody),
      symlink(
        join(hooksPath, 'commit-msg-target'),
        join(hooksPath, 'commit-msg')
      ).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
          throw error
        }
      }),
    ])
    snapshot = await inspectRepositoryHooks(repository.path)
    if (existsSync(join(hooksPath, 'commit-msg'))) {
      assert.equal(findHook(snapshot, 'commit-msg').active.state, 'unsafe')
    }
  })

  it('uses a neutral configured label and reveals only through the reviewed proxy', async t => {
    const repository = await setupEmptyRepository(t)
    const configuredHooks = await createTempDirectory(t)
    await exec(['config', 'core.hooksPath', configuredHooks], repository.path)

    const snapshot = await inspectRepositoryHooks(repository.path)
    assert.equal(snapshot.locationLabel, 'Configured hooks folder')
    assert.equal(JSON.stringify(snapshot).includes(configuredHooks), false)
    let revealed: string | null = null
    await revealRepositoryHooks(repository.path, async path => {
      revealed = path
    })
    assert.equal(revealed, configuredHooks)
  })

  it('honors cancellation before inspection without touching the repository', async t => {
    const { repository, hooksPath } = await setupHooks(t)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      inspectRepositoryHooks(repository.path, controller.signal),
      (error: unknown) =>
        error instanceof RepositoryHooksManagerError && error.kind === 'aborted'
    )
    assert.deepEqual(await readdir(hooksPath), [])
  })
})
