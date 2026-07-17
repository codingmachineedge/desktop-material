import { constants } from 'fs'
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'

import {
  CrashSafeFilePersistence,
  ICrashSafeFileHandle,
  ICrashSafeFileSystem,
  MaxCrashSafeArtifactCleanup,
} from '../../src/lib/crash-safe-file'

const nativeFileSystem: ICrashSafeFileSystem = {
  lstat,
  open: (path, flags, mode) => open(path, flags, mode),
  readdir,
  rename,
  unlink,
}

async function temporaryTarget(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-material-atomic-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return join(directory, 'state.json')
}

function artifactPath(
  target: string,
  kind: 'temp' | 'recovery' | 'stale',
  createdAt: number = Date.now()
): string {
  return join(
    join(target, '..'),
    `.${basename(target)}.desktop-material-persistence-${kind}-${createdAt}-${
      process.pid
    }-${randomUUID()}`
  )
}

function backupPath(target: string): string {
  return join(
    join(target, '..'),
    `.${basename(target)}.desktop-material-persistence-backup`
  )
}

function isValidJson(contents: string): boolean {
  try {
    JSON.parse(contents)
    return true
  } catch {
    return false
  }
}

describe('CrashSafeFilePersistence', () => {
  it('keeps the previous primary when a temporary write is partial', async t => {
    const target = await temporaryTarget(t)
    await new CrashSafeFilePersistence().writeText(target, '{"old":true}')

    let injected = false
    const persistence = new CrashSafeFilePersistence({
      ...nativeFileSystem,
      open: async (path, flags, mode) => {
        const handle = await open(path, flags, mode)
        if (
          !injected &&
          (flags & constants.O_WRONLY) !== 0 &&
          path.includes('.desktop-material-persistence-temp-')
        ) {
          injected = true
          return partialWriteHandle(handle)
        }
        return handle
      },
    })

    await assert.rejects(
      persistence.writeText(target, '{"new":true}'),
      /injected partial write/
    )
    assert.equal(await readFile(target, 'utf8'), '{"old":true}')
    assert.deepEqual(await transientArtifacts(target), [])
  })

  it('rolls the previous primary back when installation rename fails', async t => {
    const target = await temporaryTarget(t)
    await new CrashSafeFilePersistence().writeText(target, '{"old":true}')

    let injected = false
    const persistence = new CrashSafeFilePersistence({
      ...nativeFileSystem,
      rename: async (source, destination) => {
        if (
          !injected &&
          destination === target &&
          source.includes('.desktop-material-persistence-temp-')
        ) {
          injected = true
          throw Object.assign(new Error('injected rename failure'), {
            code: 'EIO',
          })
        }
        await rename(source, destination)
      },
    })

    await assert.rejects(
      persistence.writeText(target, '{"new":true}'),
      /injected rename failure/
    )
    assert.equal(await readFile(target, 'utf8'), '{"old":true}')
    assert.deepEqual(await transientArtifacts(target), [])
  })

  it('finalizes a stale recovery and removes abandoned temporary files', async t => {
    const target = await temporaryTarget(t)
    const recovery = artifactPath(target, 'recovery')
    await Promise.all([
      writeFile(target, '{"current":true}'),
      writeFile(backupPath(target), '{"older":true}'),
      writeFile(recovery, '{"previous":true}'),
      writeFile(artifactPath(target, 'temp'), '{'),
      writeFile(artifactPath(target, 'stale'), '{"stale":true}'),
    ])

    const result = await new CrashSafeFilePersistence().readText(target, {
      validate: isValidJson,
    })

    assert.deepEqual(result, {
      contents: '{"current":true}',
      source: 'primary',
    })
    assert.equal(
      await readFile(backupPath(target), 'utf8'),
      '{"previous":true}'
    )
    assert.deepEqual(await transientArtifacts(target), [])
  })

  it('repairs a corrupt primary from a valid backup', async t => {
    const target = await temporaryTarget(t)
    await Promise.all([
      writeFile(target, '{"partial":'),
      writeFile(backupPath(target), '{"restored":true}'),
    ])

    const result = await new CrashSafeFilePersistence().readText(target, {
      validate: isValidJson,
    })

    assert.deepEqual(result, {
      contents: '{"restored":true}',
      source: 'backup',
    })
    assert.equal(await readFile(target, 'utf8'), '{"restored":true}')
    assert.equal(
      await readFile(backupPath(target), 'utf8'),
      '{"restored":true}'
    )
    assert.deepEqual(await transientArtifacts(target), [])
  })

  it('does not replace a valid backup with a corrupt previous primary', async t => {
    const target = await temporaryTarget(t)
    await Promise.all([
      writeFile(target, '{"partial":'),
      writeFile(backupPath(target), '{"knownGood":true}'),
    ])

    await new CrashSafeFilePersistence().writeText(
      target,
      '{"replacement":true}',
      { validatePrevious: isValidJson }
    )

    assert.equal(await readFile(target, 'utf8'), '{"replacement":true}')
    assert.equal(
      await readFile(backupPath(target), 'utf8'),
      '{"knownGood":true}'
    )
    assert.deepEqual(await transientArtifacts(target), [])
  })

  it('bounds cleanup work and finishes it on a subsequent read', async t => {
    const target = await temporaryTarget(t)
    await writeFile(target, '{"valid":true}')
    const artifactCount = MaxCrashSafeArtifactCleanup + 7
    await Promise.all(
      Array.from({ length: artifactCount }, (_, index) =>
        writeFile(artifactPath(target, 'temp', Date.now() - index), 'partial')
      )
    )

    const persistence = new CrashSafeFilePersistence()
    await persistence.readText(target, { validate: isValidJson })
    assert.equal(
      (await transientArtifacts(target)).length,
      artifactCount - MaxCrashSafeArtifactCleanup
    )

    await persistence.readText(target, { validate: isValidJson })
    assert.deepEqual(await transientArtifacts(target), [])
  })

  it('refuses relative targets and does not follow a target symlink', async t => {
    const target = await temporaryTarget(t)
    await assert.rejects(
      new CrashSafeFilePersistence().writeText('relative.json', '{}'),
      /normalized absolute path/
    )

    const outside = join(join(target, '..'), 'outside.json')
    await writeFile(outside, '{"outside":true}')
    try {
      await symlink(outside, target, 'file')
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['EPERM', 'EACCES'].includes(String(error.code))
      ) {
        t.skip('This environment cannot create file symlinks')
        return
      }
      throw error
    }

    await assert.rejects(
      new CrashSafeFilePersistence().writeText(target, '{"changed":true}'),
      /refuses a symbolic link/
    )
    assert.equal(await readFile(outside, 'utf8'), '{"outside":true}')
  })
})

function partialWriteHandle(
  handle: ICrashSafeFileHandle
): ICrashSafeFileHandle {
  return {
    readFile: encoding => handle.readFile(encoding),
    stat: () => handle.stat(),
    sync: () => handle.sync(),
    close: () => handle.close(),
    writeFile: async (data, encoding) => {
      await handle.writeFile(data.slice(0, 4), encoding)
      throw new Error('injected partial write')
    },
  }
}

async function transientArtifacts(
  target: string
): Promise<ReadonlyArray<string>> {
  const prefix = `.${basename(target)}.desktop-material-persistence-`
  return (await readdir(join(target, '..')))
    .filter(
      name =>
        name.startsWith(prefix) &&
        !name.endsWith('.desktop-material-persistence-backup')
    )
    .sort()
}
