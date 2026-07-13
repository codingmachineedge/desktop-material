import { describe, it } from 'node:test'
import assert from 'node:assert'
import { resolveGitBinary } from 'dugite'
import { resolve } from 'path'
import { resolveCLIWorkbenchTool } from '../../src/main-process/cli-workbench/tool-resolver'

describe('CLI workbench tool resolver', () => {
  it('resolves staged Git beside the bundled main process', () => {
    const runtimeDirectory = resolve('staged-app')
    const gitDirectory = resolve(runtimeDirectory, 'git')
    const resolved = resolveCLIWorkbenchTool(
      'git',
      { PATH: 'C:\\system-bin' },
      runtimeDirectory
    )

    assert.equal(resolved.executable, resolveGitBinary(gitDirectory))
    assert.equal(resolved.env.LOCAL_GIT_DIRECTORY, gitDirectory)
    assert.match(resolved.env.GIT_EXEC_PATH ?? '', /git-core$/)
    if (process.platform === 'win32') {
      assert.ok((resolved.env.PATH ?? '').includes(gitDirectory))
    } else {
      assert.equal(resolved.env.PATH, 'C:\\system-bin')
    }
  })

  it('preserves an explicit local Git directory override', () => {
    const gitDirectory = resolve('custom-git')
    const resolved = resolveCLIWorkbenchTool(
      'git',
      { LOCAL_GIT_DIRECTORY: gitDirectory },
      resolve('ignored-runtime')
    )

    assert.equal(resolved.executable, resolveGitBinary(gitDirectory))
    assert.equal(resolved.env.LOCAL_GIT_DIRECTORY, gitDirectory)
  })

  it('keeps GitHub CLI feature detection on the supplied PATH', () => {
    const environment = { PATH: 'C:\\gh-bin' }
    const resolved = resolveCLIWorkbenchTool(
      'gh',
      environment,
      resolve('ignored-runtime')
    )

    assert.equal(resolved.executable, 'gh')
    assert.strictEqual(resolved.env, environment)
  })
})
