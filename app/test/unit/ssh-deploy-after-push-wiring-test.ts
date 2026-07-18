import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'

describe('SSH Docker deployment after push wiring', () => {
  it('starts only after a successful push refresh and keeps deployment failures separate', async () => {
    const source = await readFile(
      join(process.cwd(), 'app', 'src', 'lib', 'stores', 'app-store.ts'),
      'utf8'
    )
    const performPush = source.indexOf('private async performPush')
    const abortedGuard = source.indexOf('if (aborted) {', performPush)
    const refresh = source.indexOf(
      'await this._refreshRepository(repository)',
      abortedGuard
    )
    const deploy = source.indexOf('await this.deployDockerAfterPush(', refresh)

    assert.ok(performPush >= 0)
    assert.ok(abortedGuard > performPush)
    assert.ok(refresh > abortedGuard)
    assert.ok(deploy > refresh)
    assert.match(
      source.slice(deploy, deploy + 180),
      /repository,[\s\S]*?remoteName,[\s\S]*?pushedBranchName/
    )
    assert.match(
      source.slice(performPush, abortedGuard),
      /const pushedBranchName =\s*branch\.upstreamWithoutRemote \?\? branch\.name/
    )

    const deployMethod = source.indexOf(
      'private async deployDockerAfterPush',
      deploy
    )
    const nextMethod = source.indexOf('\n  private async ', deployMethod + 1)
    const implementation = source.slice(deployMethod, nextMethod)
    assert.match(implementation, /loadSSHDockerDeploymentsForPush/)
    assert.match(implementation, /getRemotePushURL\(repository, remoteName\)/)
    assert.match(
      implementation,
      /runSSHWorkingCopyAction\([\s\S]*?'deploy'[\s\S]*?pushedRemoteUrl[\s\S]*?branchName/
    )
    assert.match(implementation, /catch \(error\)/)
    assert.match(implementation, /title: 'Docker deployment failed'/)

    const scheduledPush = source.indexOf('private async performScheduledPush')
    const scheduledPushCall = source.indexOf('await pushRepo(', scheduledPush)
    const scheduledRefresh = source.indexOf(
      'await this._refreshRepository(repository)',
      scheduledPushCall
    )
    const scheduledDeploy = source.indexOf(
      'await this.deployDockerAfterPush(',
      scheduledRefresh
    )
    const scheduledEnd = source.indexOf('\n  private async ', scheduledPush + 1)

    assert.ok(scheduledPush >= 0)
    assert.ok(scheduledPushCall > scheduledPush)
    assert.ok(scheduledRefresh > scheduledPushCall)
    assert.ok(scheduledDeploy > scheduledRefresh)
    assert.ok(scheduledDeploy < scheduledEnd)
    assert.match(
      source.slice(scheduledDeploy, scheduledDeploy + 180),
      /repository,[\s\S]*?remoteName,[\s\S]*?pushedBranchName/
    )
  })
})
