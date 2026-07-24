import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const source = readFileSync(
  join(process.cwd(), 'app', 'src', 'lib', 'stores', 'app-store.ts'),
  'utf8'
)

function methodBody(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing ${start}`)
  assert.notEqual(endIndex, -1, `missing boundary ${end}`)
  return source.slice(startIndex, endIndex)
}

describe('cheap LFS commit entry points', () => {
  it('measures the post-pin safe selection and sequences every split push', () => {
    const body = methodBody(
      'public async _commitIncludedChanges(',
      'private async _refreshRepositoryAfterCommit('
    )

    const measure = body.indexOf('measureWorkingTreeBatchFiles(')
    const split = body.indexOf('splitCommitPushBatchesWithFirstBatchFiles(')
    const execute = body.indexOf('executeCommitPushBatches(')
    const requiresPush = body.indexOf('const requiresPush =')
    const legacyFlush = body.indexOf(
      'this.handleLegacyLocalCommitPushBatching(',
      requiresPush
    )
    assert.ok(measure >= 0)
    assert.ok(split > measure)
    assert.ok(execute > split)
    assert.ok(legacyFlush > requiresPush)
    assert.ok(execute > legacyFlush)
    assert.match(
      body.slice(legacyFlush, execute),
      /onHookFailure: async \(\) => 'abort' \},\s*true/
    )
    assert.match(
      body,
      /const requiresPush = pushAfterCommit \|\| batches\.length > 1/
    )
    const readPending = body.indexOf('readPendingCommitPushBatchState(')
    const push = body.indexOf(
      'this.performScheduledPush(repository, null)',
      readPending
    )
    const proveAndClear = body.indexOf(
      'this.proveAndClearPendingCommitPushBatch(',
      push
    )
    assert.ok(readPending > execute)
    assert.ok(push > readPending)
    assert.ok(proveAndClear > push)
    assert.match(
      body,
      /onRecoveredPostCommitFailure:\s*\(\) =>\s*this\.postCommitMaintenanceWarning\(repository\)/
    )
    assert.match(
      body,
      /cheapLfsCommitKeyRequirement\?\.changesTree === true[\s\S]*measureWorkingTreeBatchFiles\(repository\.path,[\s\S]*splitCommitPushBatchesWithFirstBatchFiles/
    )
    assert.doesNotMatch(
      body,
      /paths:\s*\[[\s\S]*cheapLfsCommitKeyRequirement\.relativePath/
    )
  })

  it('commits any uncommitted enabled compression caller with successful Release pointers', () => {
    const body = methodBody(
      'public async _commitIncludedChanges(',
      'private async _refreshRepositoryAfterCommit('
    )
    const pin = body.indexOf('autoPinLargeFilesBeforeCommit(')
    const ensureWorkflow = body.indexOf(
      'ensureCheapLfsCloudCompressionWorkflow('
    )
    const refreshStatus = body.indexOf('await this._loadStatus(repository)')

    assert.ok(pin >= 0)
    assert.ok(ensureWorkflow > pin)
    assert.ok(refreshStatus > ensureWorkflow)
    assert.match(
      body,
      /autoIncludedCheapLfsWorkflowPath\s*=\s*CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH/
    )
    assert.match(body, /isCheapLfsCloudCompressionEnabled\(workflow\.policy\)/)
    assert.doesNotMatch(body, /if \(workflow\.changed\)/)
    assert.match(
      body,
      /originalSelectedPaths\.add\(autoIncludedCheapLfsWorkflowPath\)/
    )
  })

  it('refreshes selected deletions before private pointer key proof', () => {
    const body = methodBody(
      'public async _commitIncludedChanges(',
      'private async _refreshRepositoryAfterCommit('
    )
    const deletionRefresh = body.indexOf(
      'selectedFiles.some(file => file.isDeleted())'
    )
    const keyProof = body.indexOf('resolveCheapLfsCommitKeyRequirement(')

    assert.ok(deletionRefresh >= 0)
    assert.ok(keyProof > deletionRefresh)
    assert.match(
      body.slice(deletionRefresh, keyProof),
      /await this\._loadStatus\(repository\)[\s\S]*file\.selection\.getSelectionType\(\) !== DiffSelectionType\.None/
    )
    assert.match(
      body.slice(keyProof),
      /relativePath: file\.path,\s*deleted: file\.isDeleted\(\)/
    )
  })

  it('waits for verified materialization when opening or completing a clone', () => {
    assert.match(
      source,
      /await this\.maybeAutoMaterializeCheapLfs\(repository, \{\s*requireSelected: true/
    )
    assert.match(
      source,
      /for \(const registered of addedRepositories\) \{\s*await this\.maybeAutoMaterializeCheapLfs\(registered\)/
    )
  })

  it('routes scheduled commits through the auto-pin-aware commit flow', () => {
    const body = methodBody(
      'private async performScheduledCommitPush(',
      'private async performScheduledPush('
    )

    assert.match(
      body,
      /this\._commitIncludedChanges\(\s*repository,\s*context,\s*false,\s*true,\s*\(\) => this\.isScheduledAutomationFenceCurrent\(fence\)\s*\)/
    )
    assert.doesNotMatch(body, /performScheduledPush\(repository, null\)/)
    assert.doesNotMatch(body, /createCommit\(/)
  })

  it('routes commit-and-push-all through the auto-pin-aware commit flow', () => {
    const body = methodBody(
      'private async commitAllChangesForCommitPushAll(',
      'private async pushForCommitPushAll('
    )

    assert.match(body, /this\._commitIncludedChanges\(repository, context\)/)
    assert.doesNotMatch(body, /createCommit\(/)
  })
})
