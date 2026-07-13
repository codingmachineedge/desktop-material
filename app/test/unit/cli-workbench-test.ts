import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  assessCLICommand,
  CLIWorkbenchQuickActions,
  formatCLICommand,
  parseCLIArguments,
} from '../../src/lib/cli-workbench'

describe('CLI workbench command contract', () => {
  it('parses quoted arguments into an explicit argv', () => {
    assert.deepEqual(parseCLIArguments('log --author "Mona Lisa" --all'), [
      'log',
      '--author',
      'Mona Lisa',
      '--all',
    ])
    assert.deepEqual(parseCLIArguments('  '), [])
  })

  it('renders a copyable preview without credential values', () => {
    assert.equal(
      formatCLICommand('gh', [
        'auth',
        'login',
        '--token=secret',
        '--client-secret',
        'also-secret',
      ]),
      'gh auth login --token=[redacted] --client-secret "[redacted]"'
    )
    assert.equal(
      formatCLICommand('git', ['log', '--author', 'Mona Lisa']),
      'git log --author "Mona Lisa"'
    )
  })

  it('requires confirmation for destructive Git operations', () => {
    assert.equal(assessCLICommand('git', ['status']).risk, 'read')
    assert.equal(assessCLICommand('git', ['commit', '-m', 'ok']).risk, 'write')
    assert.equal(
      assessCLICommand('git', ['push', '--force-with-lease']).requiresConfirmation,
      true
    )
    assert.equal(
      assessCLICommand('git', ['-C', 'somewhere', 'clean', '-fd']).risk,
      'destructive'
    )
    assert.equal(
      assessCLICommand('git', ['stash', 'drop', 'stash@{0}']).risk,
      'destructive'
    )
    assert.equal(
      assessCLICommand('git', ['remote', 'prune', 'origin']).risk,
      'destructive'
    )
    assert.equal(
      assessCLICommand('git', ['branch', '--force', 'main', 'HEAD~']).risk,
      'destructive'
    )
    assert.equal(
      assessCLICommand('git', ['tag', '-f', 'v1', 'HEAD~']).risk,
      'destructive'
    )
  })

  it('requires confirmation for destructive GitHub operations', () => {
    assert.equal(assessCLICommand('gh', ['pr', 'list']).risk, 'read')
    assert.equal(assessCLICommand('gh', ['pr', 'create']).risk, 'write')
    assert.equal(
      assessCLICommand('gh', ['repo', 'delete', 'owner/name']).risk,
      'destructive'
    )
    assert.equal(
      assessCLICommand('gh', ['workflow', 'disable', 'ci.yml'])
        .requiresConfirmation,
      true
    )
    assert.equal(
      assessCLICommand('gh', ['api', '-X', 'PATCH', 'repos/o/r']).risk,
      'write'
    )
  })

  it('ships unique, valid quick actions without limiting custom commands', () => {
    const ids = CLIWorkbenchQuickActions.map(action => action.id)
    assert.equal(ids.length, new Set(ids).size)
    assert.ok(
      CLIWorkbenchQuickActions.every(
        action => action.args.length > 0 && action.description.length > 0
      )
    )
  })
})
