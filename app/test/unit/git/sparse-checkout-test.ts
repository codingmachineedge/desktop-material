import assert from 'node:assert'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import { mkdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  disableSparseCheckout,
  reapplySparseCheckout,
  setSparseCheckoutDirectories,
  SparseCheckoutUnavailableError,
} from '../../../src/lib/git/sparse-checkout'
import { createTempDirectory } from '../../helpers/temp'

async function setupSparseRepository(t: import('node:test').TestContext) {
  const base = await createTempDirectory(t)
  const repositoryPath = join(base, 'repository')
  const outsidePath = join(base, 'outside')
  await mkdir(join(repositoryPath, 'keep'), { recursive: true })
  await mkdir(join(repositoryPath, 'drop'))
  await mkdir(outsidePath)
  assert.equal((await exec(['init'], repositoryPath)).exitCode, 0)
  await exec(['config', 'user.name', 'Sparse Fixture'], repositoryPath)
  await exec(['config', 'user.email', 'sparse@example.invalid'], repositoryPath)
  await writeFile(join(repositoryPath, 'keep', 'item.txt'), 'keep')
  await writeFile(join(repositoryPath, 'drop', 'item.txt'), 'committed')
  await exec(['add', '--', 'keep/item.txt', 'drop/item.txt'], repositoryPath)
  assert.equal(
    (await exec(['commit', '-m', 'sparse fixture'], repositoryPath)).exitCode,
    0
  )
  return { repositoryPath, outsidePath }
}

async function installOutsideJunction(
  repositoryPath: string,
  outsidePath: string
) {
  await rm(join(repositoryPath, 'drop'), { recursive: true, force: true })
  await writeFile(join(outsidePath, 'item.txt'), 'committed')
  await symlink(outsidePath, join(repositoryPath, 'drop'), 'junction')
}

async function assertUnsafeMutation(
  mutation: () => Promise<unknown>,
  outsidePath: string
) {
  await assert.rejects(
    mutation(),
    (error: unknown) =>
      error instanceof SparseCheckoutUnavailableError &&
      error.kind === 'unsafe-state'
  )
  assert.equal(
    await readFile(join(outsidePath, 'item.txt'), 'utf8'),
    'committed'
  )
}

describe('git/sparse-checkout physical worktree safety', () => {
  it('keeps normal set, reapply, and disable mutations working', async t => {
    const { repositoryPath } = await setupSparseRepository(t)
    assert.deepEqual(
      await setSparseCheckoutDirectories(repositoryPath, 'keep'),
      ['keep']
    )
    await reapplySparseCheckout(repositoryPath)
    await disableSparseCheckout(repositoryPath)
    assert.equal(
      await readFile(join(repositoryPath, 'drop', 'item.txt'), 'utf8'),
      'committed'
    )
  })

  it('blocks set before Git can delete through a directory junction', async t => {
    const { repositoryPath, outsidePath } = await setupSparseRepository(t)
    await installOutsideJunction(repositoryPath, outsidePath)
    await assertUnsafeMutation(
      () => setSparseCheckoutDirectories(repositoryPath, 'keep'),
      outsidePath
    )
  })

  it('blocks reapply before Git can delete through a directory junction', async t => {
    const { repositoryPath, outsidePath } = await setupSparseRepository(t)
    await setSparseCheckoutDirectories(repositoryPath, 'keep')
    await installOutsideJunction(repositoryPath, outsidePath)
    await assertUnsafeMutation(
      () => reapplySparseCheckout(repositoryPath),
      outsidePath
    )
  })

  it('blocks disable before Git can write through a directory junction', async t => {
    const { repositoryPath, outsidePath } = await setupSparseRepository(t)
    await setSparseCheckoutDirectories(repositoryPath, 'keep')
    await installOutsideJunction(repositoryPath, outsidePath)
    await assertUnsafeMutation(
      () => disableSparseCheckout(repositoryPath),
      outsidePath
    )
  })

  it('honors cancellation before scanning or mutating the worktree', async t => {
    const { repositoryPath } = await setupSparseRepository(t)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      setSparseCheckoutDirectories(repositoryPath, 'keep', controller.signal),
      (error: unknown) =>
        error instanceof SparseCheckoutUnavailableError &&
        error.kind === 'aborted'
    )
    assert.equal(
      await readFile(join(repositoryPath, 'drop', 'item.txt'), 'utf8'),
      'committed'
    )
  })
})
