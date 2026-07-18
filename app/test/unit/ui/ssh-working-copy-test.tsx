import assert from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  ISSHWorkingCopyDefinition,
  ISSHWorkingCopyStorage,
  SSHWorkingCopyAction,
} from '../../../src/lib/ssh/ssh-working-copy'
import { SSHWorkingCopyManager } from '../../../src/ui/repository-settings/ssh-working-copy'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class MemoryStorage implements ISSHWorkingCopyStorage {
  public readonly values = new Map<string, string>()

  public getItem(key: string) {
    return this.values.get(key) ?? null
  }

  public setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  public removeItem(key: string) {
    this.values.delete(key)
  }
}

const sourceRemotes = [
  {
    name: 'origin',
    fetchUrl: 'ssh://git@example.test/team/project.git',
    fetchUrlHasCredentials: false,
    pushUrl: null,
    pushUrlHasCredentials: false,
    prune: 'inherit' as const,
    defaultBranch: 'main',
  },
]

describe('SSH Working Copy manager', () => {
  it('saves non-secret metadata and runs the selected source URL transiently', async () => {
    const storage = new MemoryStorage()
    const calls = new Array<{
      readonly definition: ISSHWorkingCopyDefinition
      readonly action: SSHWorkingCopyAction
      readonly sourceUrl?: string
      readonly signal?: AbortSignal
    }>()
    render(
      <SSHWorkingCopyManager
        repositoryPath={resolve('repositories', 'project')}
        sourceRemotes={sourceRemotes}
        disabled={false}
        storage={storage}
        runAction={async (_, definition, action, sourceUrl, signal) => {
          calls.push({ definition, action, sourceUrl, signal })
          return { stdout: '## main...origin/main\n', stderr: '' }
        }}
      />
    )

    fireEvent.change(screen.getByLabelText('SSH host label'), {
      target: { value: 'Build host' },
    })
    fireEvent.change(screen.getByLabelText('SSH host or config alias'), {
      target: { value: 'build.example.test' },
    })
    fireEvent.change(screen.getByLabelText('SSH user'), {
      target: { value: 'deploy' },
    })
    fireEvent.change(screen.getByLabelText('SSH port'), {
      target: { value: '2222' },
    })
    fireEvent.change(
      screen.getByLabelText('Authentication reference (identity-file path)'),
      { target: { value: resolve('fixtures', 'id_ed25519') } }
    )
    fireEvent.change(screen.getByLabelText('Remote destination path'), {
      target: { value: '/srv/work/project' },
    })
    fireEvent.click(
      screen.getByLabelText(
        'Deploy Docker Compose after pushes to this source remote'
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save host metadata' }))
    assert.ok(screen.getByText(/metadata saved/i))
    const serialized = [...storage.values.values()].join('')
    assert.doesNotMatch(serialized, /ssh:\/\/git@example\.test/)
    assert.doesNotMatch(serialized, /password|passphrase|sourceUrl/i)
    assert.match(serialized, /"deployOnPush":true/)

    fireEvent.click(screen.getByRole('button', { name: /Clone/ }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.equal(calls[0].action, 'clone')
    assert.equal(calls[0].sourceUrl, sourceRemotes[0].fetchUrl)
    assert.equal(calls[0].definition.destinationPath, '/srv/work/project')
    assert.equal(calls[0].signal?.aborted, false)
    assert.ok(await screen.findByLabelText('SSH command output'))

    fireEvent.click(screen.getByRole('button', { name: /Deploy Docker now/ }))
    await waitFor(() => assert.equal(calls.length, 2))
    assert.equal(calls[1].action, 'deploy')
    assert.equal(calls[1].sourceUrl, undefined)
  })

  it('never offers credential-bearing local remotes as clone sources', () => {
    render(
      <SSHWorkingCopyManager
        repositoryPath={resolve('repositories', 'masked')}
        sourceRemotes={[
          {
            ...sourceRemotes[0],
            fetchUrlHasCredentials: true,
          },
        ]}
        disabled={false}
        storage={new MemoryStorage()}
      />
    )
    assert.ok(screen.getByText('No credential-free remotes available'))
    assert.equal(
      screen
        .getByRole('button', { name: /Clone/ })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.doesNotMatch(document.body.textContent ?? '', /git@example\.test/)
  })
})
