import assert from 'node:assert'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import { mkdir, realpath, rm, symlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

import {
  assertSafeWorktreeMutation,
  resolveSafeRepositoryPath,
  WorktreePathSafetyError,
} from '../../../src/lib/git/worktree-path-guard'
import { createTempDirectory } from '../../helpers/temp'

async function setupNestedRepository(t: import('node:test').TestContext) {
  const base = await realpath(await createTempDirectory(t))
  const repositoryPath = join(base, 'repository')
  const outsidePath = join(base, 'outside')
  await mkdir(join(repositoryPath, 'nested'), { recursive: true })
  await mkdir(outsidePath)
  assert.equal((await exec(['init'], repositoryPath)).exitCode, 0)
  await exec(['config', 'user.name', 'Safety Fixture'], repositoryPath)
  await exec(['config', 'user.email', 'safety@example.invalid'], repositoryPath)
  await writeFile(join(repositoryPath, 'root.txt'), 'root')
  await writeFile(join(repositoryPath, 'nested', 'item.txt'), 'committed')
  await exec(['add', '--', 'root.txt', 'nested/item.txt'], repositoryPath)
  assert.equal(
    (await exec(['commit', '-m', 'safety fixture'], repositoryPath)).exitCode,
    0
  )
  return { base, repositoryPath, outsidePath }
}

describe('physical worktree path guard', () => {
  it('resolves normal nested and missing targets beneath the physical root', async t => {
    const { repositoryPath } = await setupNestedRepository(t)
    const existing = await resolveSafeRepositoryPath(
      repositoryPath,
      'nested/item.txt'
    )
    const missing = await resolveSafeRepositoryPath(
      repositoryPath,
      'nested/missing.txt'
    )

    assert.equal(existing.exists, true)
    assert.equal(existing.path, resolve(repositoryPath, 'nested/item.txt'))
    assert.equal(missing.exists, false)
    assert.equal(missing.path, resolve(repositoryPath, 'nested/missing.txt'))
  })

  it('allows a repository-root alias and a linked worktree', async t => {
    const { base, repositoryPath } = await setupNestedRepository(t)
    const aliasPath = join(base, 'repository-alias')
    await symlink(repositoryPath, aliasPath, 'junction')

    const throughAlias = await resolveSafeRepositoryPath(
      aliasPath,
      'nested/item.txt'
    )
    assert.equal(throughAlias.exists, true)
    assert.equal(throughAlias.root, resolve(repositoryPath))
    await assertSafeWorktreeMutation(aliasPath)

    const linkedPath = join(base, 'linked-worktree')
    assert.equal(
      (
        await exec(
          ['worktree', 'add', '-b', 'safety-linked-worktree', linkedPath],
          repositoryPath
        )
      ).exitCode,
      0
    )
    await assertSafeWorktreeMutation(linkedPath)
  })

  it('rejects a junction introduced after an earlier safe check', async t => {
    const { repositoryPath, outsidePath } = await setupNestedRepository(t)
    const first = await resolveSafeRepositoryPath(
      repositoryPath,
      'nested/item.txt'
    )
    assert.equal(first.exists, true)

    await rm(join(repositoryPath, 'nested'), { recursive: true })
    await writeFile(join(outsidePath, 'item.txt'), 'outside sentinel')
    await symlink(outsidePath, join(repositoryPath, 'nested'), 'junction')

    await assert.rejects(
      resolveSafeRepositoryPath(repositoryPath, 'nested/item.txt'),
      (error: unknown) =>
        error instanceof WorktreePathSafetyError &&
        error.kind === 'reparse-point'
    )
    await assert.rejects(
      assertSafeWorktreeMutation(repositoryPath),
      (error: unknown) =>
        error instanceof WorktreePathSafetyError &&
        error.kind === 'reparse-point'
    )
  })

  it('does not descend into a populated gitlink worktree', async t => {
    const { base, repositoryPath, outsidePath } = await setupNestedRepository(t)
    const sourcePath = join(base, 'submodule-source')
    await mkdir(sourcePath)
    assert.equal((await exec(['init'], sourcePath)).exitCode, 0)
    await exec(['config', 'user.name', 'Submodule Fixture'], sourcePath)
    await exec(
      ['config', 'user.email', 'submodule@example.invalid'],
      sourcePath
    )
    await writeFile(join(sourcePath, 'module.txt'), 'module')
    await exec(['add', '--', 'module.txt'], sourcePath)
    assert.equal(
      (await exec(['commit', '-m', 'submodule fixture'], sourcePath)).exitCode,
      0
    )
    assert.equal(
      (
        await exec(
          [
            '-c',
            'protocol.file.allow=always',
            'submodule',
            'add',
            '--',
            sourcePath,
            'vendor/module',
          ],
          repositoryPath
        )
      ).exitCode,
      0
    )

    await symlink(
      outsidePath,
      join(repositoryPath, 'vendor', 'module', 'outside-link'),
      'junction'
    )
    await assertSafeWorktreeMutation(repositoryPath)
  })

  it('fails closed for bounds, cancellation, and invalid repository context', async t => {
    const { base, repositoryPath } = await setupNestedRepository(t)
    await assert.rejects(
      assertSafeWorktreeMutation(repositoryPath, undefined, {
        maximumEntries: 1,
      }),
      (error: unknown) =>
        error instanceof WorktreePathSafetyError &&
        error.kind === 'scan-too-large'
    )
    await mkdir(join(repositoryPath, 'nested', 'deeper'))
    await assert.rejects(
      assertSafeWorktreeMutation(repositoryPath, undefined, {
        maximumDepth: 1,
      }),
      (error: unknown) =>
        error instanceof WorktreePathSafetyError &&
        error.kind === 'scan-too-large'
    )

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      assertSafeWorktreeMutation(repositoryPath, controller.signal),
      (error: unknown) =>
        error instanceof WorktreePathSafetyError && error.kind === 'aborted'
    )

    await assert.rejects(
      assertSafeWorktreeMutation(join(base, 'not-a-repository')),
      (error: unknown) => error instanceof Error
    )
  })
})
