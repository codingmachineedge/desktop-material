import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), ...relativePath.split('/')), 'utf8')
}

describe('command-scoped commit auto-GC suppression', () => {
  it('covers direct commit commands without writing Git configuration', () => {
    const commit = source('app/src/lib/git/commit.ts')
    const batching = source('app/src/lib/git/local-commit-batching-git.ts')
    const merge = source('app/src/lib/git/merge.ts')
    const cherryPick = source('app/src/lib/git/cherry-pick.ts')
    const tutorial = source(
      'app/src/lib/stores/helpers/create-tutorial-repository.ts'
    )

    assert.match(
      commit,
      /\[\s*'-c',\s*'gc\.auto=0',[\s\S]*?'commit',\s*\.\.\.args,?\s*\]/
    )
    assert.match(
      batching,
      /buildLocalCommitArgv[\s\S]*?AutomaticCommitPushBatchGitMaintenanceArgs[\s\S]*?'commit'[\s\S]*?'-F'[\s\S]*?'-'/
    )
    assert.match(
      source('app/src/lib/commit-push-batching.ts'),
      /AutomaticCommitPushBatchGitMaintenanceArgs[\s\S]*?'-c',\s*'gc\.auto=0',\s*'-c',\s*'maintenance\.auto=false'/
    )
    assert.match(merge, /\['-c', 'gc\.auto=0', 'commit', '--no-edit'\]/)
    assert.match(
      cherryPick,
      /\['-c', 'gc\.auto=0', 'commit', '--allow-empty'\]/
    )
    assert.match(
      tutorial,
      /\['-c', 'gc\.auto=0', 'commit', '-m', 'Initial commit'\]/
    )

    for (const text of [commit, batching, merge, cherryPick, tutorial]) {
      assert.doesNotMatch(
        text,
        /config[^\n]*(?:--global|--local)[^\n]*gc\.auto/
      )
    }
  })

  it('covers commit-producing merge, cherry-pick, revert, and rebase commands', () => {
    assert.match(
      source('app/src/lib/git/merge.ts'),
      /const args = \['-c', 'gc\.auto=0', 'merge'\]/
    )
    assert.match(source('app/src/lib/git/cherry-pick.ts'), /'gc\.auto=0'/)
    assert.match(
      source('app/src/lib/git/revert.ts'),
      /const args = \['-c', 'gc\.auto=0', 'revert'\]/
    )
    assert.match(
      source('app/src/lib/git/core.ts'),
      /gitRebaseArguments[\s\S]*?\['-c', 'gc\.auto=0'\]/
    )
  })

  it('extends suppression to status/add/checkout/fetch for large repositories', () => {
    // The large-repository module holds the single literal suppression shape,
    // covering BOTH the classic gc --auto and the newer maintenance --auto.
    assert.match(
      source('app/src/lib/large-repository/large-repository-mode.ts'),
      /LargeRepositoryGitMaintenanceArgs[\s\S]*?'-c',\s*'gc\.auto=0',\s*'-c',\s*'maintenance\.auto=false'/
    )

    // Each large-repo-scoped command inherits the flags through the same seam
    // rather than hard-coding them, so ordinary repositories are unaffected.
    for (const file of [
      'app/src/lib/git/status.ts',
      'app/src/lib/git/add.ts',
      'app/src/lib/git/checkout.ts',
      'app/src/lib/git/fetch.ts',
    ]) {
      assert.match(
        source(file),
        /largeRepositoryGitArgsForPath\(\s*repository\.path\s*\)/,
        `expected ${file} to carry large-repository maintenance suppression`
      )
    }

    // The one explicit repack the app runs for a large repository also carries
    // the suppression so it is the ONLY packing that runs.
    assert.match(
      source('app/src/lib/large-repository/large-repository-probe.ts'),
      /LargeRepositoryGitMaintenanceArgs,\s*'repack',\s*'-d'/
    )
  })
})
