import assert from 'node:assert'
import { Stats } from 'node:fs'
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  gitErrorReferencesRepositoryIndexLock,
  IRepositoryLockFileSystem,
  MinimumStaleRepositoryLockAgeMs,
  removeStaleRepositoryLock,
} from '../../../src/lib/git/remove-lock'
import { Repository } from '../../../src/models/repository'

async function withRepository(
  run: (repository: Repository, lockPath: string) => Promise<void>
) {
  const path = await mkdtemp(join(tmpdir(), 'desktop-lock-'))
  try {
    const gitDir = join(path, '.git')
    const lockPath = join(gitDir, 'index.lock')
    await mkdir(gitDir)
    await writeFile(lockPath, 'stale lock')
    await run(
      new Repository(path, 1, null, false, null, {}, false, gitDir),
      lockPath
    )
  } finally {
    await rm(path, { recursive: true, force: true })
  }
}

describe('removeStaleRepositoryLock', () => {
  it('atomically removes an old regular index lock', async () => {
    await withRepository(async (repository, lockPath) => {
      const now = Date.now()
      const old = new Date(now - MinimumStaleRepositoryLockAgeMs - 1_000)
      await utimes(lockPath, old, old)

      assert.equal(await removeStaleRepositoryLock(repository, now), lockPath)
      await assert.rejects(stat(lockPath), /ENOENT/)
    })
  })

  it('refuses to remove a recent lock that may still be active', async () => {
    await withRepository(async (repository, lockPath) => {
      const now = Date.now()
      await utimes(lockPath, new Date(now), new Date(now))

      await assert.rejects(
        removeStaleRepositoryLock(repository, now),
        /still recent/
      )
      assert.equal((await stat(lockPath)).isFile(), true)
    })
  })

  it('is idempotent when another process already removed the lock', async () => {
    await withRepository(async (repository, lockPath) => {
      await unlink(lockPath)
      assert.equal(await removeStaleRepositoryLock(repository), null)
    })
  })

  it('refuses symbolic links without touching them', async () => {
    const symbolicLink = {
      isFile: () => true,
      isSymbolicLink: () => true,
      mtimeMs: 0,
    } as Stats
    const unexpected = async () => {
      throw new Error('unexpected file mutation')
    }
    const fs: IRepositoryLockFileSystem = {
      lstat: async () => symbolicLink,
      rename: unexpected,
      unlink: unexpected,
      link: unexpected,
    }
    const repository = new Repository('C:\\repo', 1, null, false)

    await assert.rejects(
      removeStaleRepositoryLock(repository, Date.now(), fs),
      /not a regular file/
    )
  })

  it('restores rather than deletes a lock that changes during quarantine', async () => {
    await withRepository(async (repository, lockPath) => {
      const now = Date.now()
      const old = new Date(now - MinimumStaleRepositoryLockAgeMs - 1_000)
      await utimes(lockPath, old, old)
      let lstatCalls = 0
      const fs: IRepositoryLockFileSystem = {
        lstat: async path => {
          lstatCalls++
          if (lstatCalls === 2) {
            await utimes(path, new Date(now), new Date(now))
          }
          return await lstat(path)
        },
        rename,
        unlink,
        link,
      }

      await assert.rejects(
        removeStaleRepositoryLock(repository, now, fs),
        /still recent/
      )
      assert.equal((await stat(lockPath)).isFile(), true)
    })
  })

  it('restores without overwriting when quarantine deletion fails', async () => {
    await withRepository(async (repository, lockPath) => {
      const now = Date.now()
      const old = new Date(now - MinimumStaleRepositoryLockAgeMs - 1_000)
      await utimes(lockPath, old, old)
      let shouldFailUnlink = true
      const fs: IRepositoryLockFileSystem = {
        lstat,
        rename,
        link,
        unlink: async path => {
          if (shouldFailUnlink) {
            shouldFailUnlink = false
            throw new Error('simulated unlink failure')
          }
          await unlink(path)
        },
      }

      await assert.rejects(
        removeStaleRepositoryLock(repository, now, fs),
        /simulated unlink failure/
      )
      assert.equal((await stat(lockPath)).isFile(), true)
    })
  })

  it('never overwrites a new lock created during failed deletion', async () => {
    await withRepository(async (repository, lockPath) => {
      const now = Date.now()
      const old = new Date(now - MinimumStaleRepositoryLockAgeMs - 1_000)
      await utimes(lockPath, old, old)
      const fs: IRepositoryLockFileSystem = {
        lstat,
        rename,
        link,
        unlink: async () => {
          await writeFile(lockPath, 'new active lock')
          throw new Error('simulated unlink failure')
        },
      }

      await assert.rejects(
        removeStaleRepositoryLock(repository, now, fs),
        /quarantined file was preserved/
      )
      assert.equal(await readFile(lockPath, 'utf8'), 'new active lock')
      const gitEntries = await readdir(repository.resolvedGitDir)
      assert.equal(
        gitEntries.some(name => name.endsWith('.remove')),
        true
      )
    })
  })

  it('accepts only an error naming this repository index lock', () => {
    const repositoryPath = join(tmpdir(), 'expected-repository')
    const repository = new Repository(repositoryPath, 1, null, false)
    const makeError = (lockPath: string) => ({
      result: {
        stdout: '',
        stderr: `fatal: Unable to create '${lockPath}': File exists.`,
      },
    })

    assert.equal(
      gitErrorReferencesRepositoryIndexLock(
        makeError(join(repository.resolvedGitDir, 'index.lock')),
        repository
      ),
      true
    )
    assert.equal(
      gitErrorReferencesRepositoryIndexLock(
        makeError(join(repository.resolvedGitDir, 'HEAD.lock')),
        repository
      ),
      false
    )
    assert.equal(
      gitErrorReferencesRepositoryIndexLock(
        makeError(join(tmpdir(), 'other', '.git', 'index.lock')),
        repository
      ),
      false
    )
  })
})
