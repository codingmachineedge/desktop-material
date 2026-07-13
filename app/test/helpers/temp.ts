import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { TestContext } from 'node:test'
import { sleep } from '../../src/lib/promise'
import { isErrnoException } from '../../src/lib/errno-exception'

const isRetryableCleanupError = (e: unknown) =>
  isErrnoException(e) &&
  (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'ENOTEMPTY')

// Reimplementation of retry logic in rimraf:
// https://github.com/isaacs/rimraf/blob/8733d4c30078a1ae5f18bb6affe83c1eea0259b4/src/retry-busy.ts#L10
const clean = async (path: string, n = 1): Promise<void> =>
  rm(path, { recursive: true, force: true }).catch((e: unknown) =>
    n <= 8 && isRetryableCleanupError(e)
      ? sleep(Math.min(500, Math.ceil(25 * Math.pow(n, 1.5)))).then(() =>
          clean(path, n + 1)
        )
      : Promise.reject(e)
  )

export const createTempDirectory = (t: TestContext) =>
  mkdtemp(join(tmpdir(), 'desktop-test-')).then(path => {
    t.after(() => clean(path))
    return path
  })
