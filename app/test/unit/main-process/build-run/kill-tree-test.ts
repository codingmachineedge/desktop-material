import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  ITaskkillPathDependencies,
  resolveTrustedTaskkillPath,
} from '../../../../src/main-process/build-run/kill-tree'

function trustedFixture(systemRoot = 'D:\\WinNT'): ITaskkillPathDependencies {
  const system32 = `${systemRoot}\\System32`
  const taskkill = `${system32}\\taskkill.exe`
  return {
    realpath: path => {
      if (path.toLowerCase() === systemRoot.toLowerCase()) {
        return systemRoot
      }
      if (path.toLowerCase() === system32.toLowerCase()) {
        return system32
      }
      if (path.toLowerCase() === taskkill.toLowerCase()) {
        return taskkill
      }
      throw new Error(`Unexpected path: ${path}`)
    },
    isFile: path => path.toLowerCase() === taskkill.toLowerCase(),
  }
}

describe('trusted taskkill resolution', () => {
  it('accepts a validated drive-rooted Windows installation outside C:', () => {
    assert.equal(
      resolveTrustedTaskkillPath('D:\\WinNT', trustedFixture()),
      'D:\\WinNT\\System32\\taskkill.exe'
    )
  })

  it('rejects relative, UNC, device, traversal, and alternate-stream roots', () => {
    for (const systemRoot of [
      'Windows',
      '\\\\server\\Windows',
      '\\\\?\\C:\\Windows',
      'C:\\safe\\..\\Windows',
      'C:\\Windows:alternate',
      'C:\\Windows\\\\nested',
    ]) {
      assert.throws(() =>
        resolveTrustedTaskkillPath(systemRoot, trustedFixture())
      )
    }
  })

  it('rejects a System32 junction which escapes the resolved system root', () => {
    const dependencies = trustedFixture()
    assert.throws(() =>
      resolveTrustedTaskkillPath('D:\\WinNT', {
        ...dependencies,
        realpath: path =>
          path.toLowerCase().endsWith('\\system32')
            ? 'E:\\Redirected\\System32'
            : dependencies.realpath(path),
      })
    )
  })

  it('rejects a taskkill path which escapes System32 or is not a file', () => {
    const dependencies = trustedFixture()
    assert.throws(() =>
      resolveTrustedTaskkillPath('D:\\WinNT', {
        ...dependencies,
        realpath: path =>
          path.toLowerCase().endsWith('taskkill.exe')
            ? 'D:\\WinNT\\taskkill.exe'
            : dependencies.realpath(path),
      })
    )
    assert.throws(() =>
      resolveTrustedTaskkillPath('D:\\WinNT', {
        ...dependencies,
        isFile: () => false,
      })
    )
  })
})
