import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { CrashProofBoundary } from '../../../src/ui/crash-proof-boundary'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const FailingSurface = ({ fail }: { readonly fail: boolean }) => {
  if (fail) {
    throw new Error('internal failure detail that must not render')
  }
  return <div>Healthy surface</div>
}

describe('CrashProofBoundary', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    // React 16 deliberately logs the contained test exception in development.
    console.error = () => {}
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  it('contains a render failure without exposing its message', () => {
    render(
      <CrashProofBoundary name="Repository workspace">
        <FailingSurface fail={true} />
      </CrashProofBoundary>
    )

    assert.match(
      screen.getByRole('alert').textContent ?? '',
      /Repository workspace encountered a problem/
    )
    assert.doesNotMatch(
      document.body.textContent ?? '',
      /internal failure detail/
    )
    assert.ok(screen.getByRole('button', { name: 'Try this surface again' }))
  })

  it('dismisses a failed isolated surface', () => {
    let dismissals = 0
    render(
      <CrashProofBoundary
        name="Preferences dialog"
        onDismiss={() => dismissals++}
      >
        <FailingSurface fail={true} />
      </CrashProofBoundary>
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss this surface' })
    )
    assert.equal(dismissals, 1)
  })

  it('reloads instead of remounting a failed application root', () => {
    render(
      <CrashProofBoundary name="Desktop Material" root={true}>
        <FailingSurface fail={true} />
      </CrashProofBoundary>
    )

    assert.equal(
      screen.queryByRole('button', { name: 'Try this surface again' }),
      null
    )
    assert.ok(screen.getByRole('button', { name: 'Reload app window' }))
  })

  it('clears a contained failure when the owning selection changes', async () => {
    const view = render(
      <CrashProofBoundary name="Repository workspace" resetKey="first">
        <FailingSurface fail={true} />
      </CrashProofBoundary>
    )
    assert.ok(screen.getByRole('alert'))

    view.rerender(
      <CrashProofBoundary name="Repository workspace" resetKey="second">
        <FailingSurface fail={false} />
      </CrashProofBoundary>
    )

    await waitFor(() => assert.ok(screen.getByText('Healthy surface')))
  })
})
