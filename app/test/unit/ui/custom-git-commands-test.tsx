import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
  ICLIWorkbenchOperationRequest,
} from '../../../src/lib/cli-workbench'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'
import { CustomGitCommands } from '../../../src/ui/repository-tools/custom-git-commands'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class MemoryStorage {
  public value: string | null = null
  public getItem = () => this.value
  public setItem = (_key: string, value: string) => {
    this.value = value
  }
}

class FakeClient {
  public readonly requests: ICLIWorkbenchOperationRequest[] = []
  private outputHandler: (event: ICLICommandOutputEvent) => void = () => {}
  private stateHandler: (event: ICLICommandStateEvent) => void = () => {}

  public start = async (request: ICLIWorkbenchOperationRequest) => {
    this.requests.push(request)
  }
  public cancel = async () => true
  public onOutput = (handler: (event: ICLICommandOutputEvent) => void) => {
    this.outputHandler = handler
    return () => {}
  }
  public onState = (handler: (event: ICLICommandStateEvent) => void) => {
    this.stateHandler = handler
    return () => {}
  }
  public output(event: ICLICommandOutputEvent) {
    this.outputHandler(event)
  }
  public state(event: ICLICommandStateEvent) {
    this.stateHandler(event)
  }
}

function renderCommands() {
  const client = new FakeClient()
  const storage = new MemoryStorage()
  let refreshes = 0
  const busy: boolean[] = []
  const view = render(
    <CustomGitCommands
      repositoryPath="C:\repo"
      disabled={false}
      client={client}
      storage={storage}
      onRefreshRepository={async () => {
        refreshes++
      }}
      onBusyChanged={value => busy.push(value)}
    />
  )
  return { client, storage, busy, view, getRefreshes: () => refreshes }
}

describe('custom Git commands', () => {
  it('saves locally, reviews exact argv, runs, streams output, and refreshes', async () => {
    const fixture = renderCommands()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Recent decorated history' },
    })
    fireEvent.change(screen.getByLabelText('Git subcommand'), {
      target: { value: 'log' },
    })
    fireEvent.change(screen.getByLabelText('Arguments'), {
      target: { value: '--oneline --author "Octo Cat" -25' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    assert.match(fixture.storage.value ?? '', /Recent decorated history/)

    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    assert(screen.getByText('git log "--oneline" "--author" "Octo Cat" "-25"'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Run reviewed command' })
    )
    await waitFor(() => assert.equal(fixture.client.requests.length, 1))
    const request = fixture.client.requests[0]
    assert.deepEqual(request.operation, {
      id: 'custom-git-command',
      command: 'log',
      args: ['--oneline', '--author', 'Octo Cat', '-25'],
    })
    assert.equal(request.confirmed, true)
    fixture.client.output({
      id: request.id,
      stream: 'stdout',
      data: 'abc123 Recent commit\n',
    })
    assert(screen.getByText(/abc123 Recent commit/))
    fixture.client.state({
      id: request.id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(fixture.getRefreshes(), 1))
    assert.deepEqual(fixture.busy, [true, false])
  })

  it('blocks unsafe boundaries before review and confirms local deletion', () => {
    const fixture = renderCommands()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Unsafe' },
    })
    fireEvent.change(screen.getByLabelText('Git subcommand'), {
      target: { value: 'log' },
    })
    fireEvent.change(screen.getByLabelText('Arguments'), {
      target: { value: '--git-dir=../outside' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review run' }))
    assert(screen.getByRole('alert'))
    assert(
      screen.queryByRole('button', { name: 'Run reviewed command' }) === null
    )

    fireEvent.change(screen.getByLabelText('Arguments'), {
      target: { value: '--oneline' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save preset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }))
    assert(screen.getByText('Delete this local preset?'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete preset' })[1])
    assert.equal(fixture.storage.value, '[]')
  })

  it('switches labels, status, and accessible names live', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const fixture = renderCommands()

    try {
      assert.ok(
        screen.getByRole('heading', { name: 'Custom Git command presets' })
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('heading', { name: '自訂 Git 指令預設' }))
      )
      assert.ok(screen.getByLabelText('名稱'))
      assert.ok(screen.getByRole('button', { name: '覆核執行' }))
      assert.match(
        screen.getByRole('status').textContent ?? '',
        /建立或者揀一個本機指令預設/
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.match(
          document.body.textContent ?? '',
          /Custom Git command presets · 自訂 Git 指令預設/
        )
      )
      assert.ok(screen.getByLabelText('Name'))
      assert.ok(screen.getByRole('button', { name: 'Review run' }))
    } finally {
      fixture.view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
