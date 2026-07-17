import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { IErrorNotice } from '../../../src/models/error-notice'
import { ErrorNoticeStack } from '../../../src/ui/error-notice-stack'
import { fireEvent, render, screen } from '../../helpers/ui/render'

function notice(
  id: string,
  overrides: Partial<IErrorNotice> = {}
): IErrorNotice {
  return {
    id,
    title: `Error ${id}`,
    message: `Message ${id}`,
    details: null,
    dedupeKey: id,
    occurrences: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('ErrorNoticeStack', () => {
  it('renders each bounded notice as an atomic alert', () => {
    render(
      <ErrorNoticeStack
        notices={[
          notice('one'),
          notice('two', { occurrences: 3, message: 'Repeated failure' }),
        ]}
        onDismiss={() => undefined}
      />
    )

    assert.ok(screen.getByRole('region', { name: 'Error notifications' }))
    const alerts = screen.getAllByRole('alert')
    assert.equal(alerts.length, 2)
    assert.ok(
      alerts.every(alert => alert.getAttribute('aria-atomic') === 'true')
    )
    assert.ok(screen.getByText('Reported 3 times'))
    assert.equal(screen.queryByRole('button', { name: 'Details' }), null)
  })

  it('dismisses by stable id and opens details only when available', () => {
    const dismissed: string[] = []
    const detailed: IErrorNotice[] = []
    const detailedNotice = notice('detail', {
      title: 'Clone failed',
      details: 'Raw bounded diagnostic',
    })

    render(
      <ErrorNoticeStack
        notices={[detailedNotice, notice('plain')]}
        onDismiss={id => dismissed.push(id)}
        onShowDetails={item => detailed.push(item)}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss Clone failed' })
    )

    assert.deepEqual(dismissed, ['detail'])
    assert.deepEqual(detailed, [detailedNotice])
    assert.equal(screen.getAllByRole('button', { name: 'Details' }).length, 1)
  })

  it('expands bounded diagnostics inline when no details handler is supplied', () => {
    render(
      <ErrorNoticeStack
        notices={[
          notice('inline', {
            details: 'Raw bounded diagnostic',
          }),
        ]}
        onDismiss={() => undefined}
      />
    )

    const details = screen.getByRole('button', { name: 'Details' })
    assert.equal(details.getAttribute('aria-expanded'), 'false')

    fireEvent.click(details)
    assert.ok(screen.getByText('Raw bounded diagnostic'))
    assert.equal(
      screen
        .getByRole('button', { name: 'Hide details' })
        .getAttribute('aria-expanded'),
      'true'
    )
  })

  it('renders no landmark when there are no errors', () => {
    const view = render(
      <ErrorNoticeStack notices={[]} onDismiss={() => undefined} />
    )

    assert.equal(view.container.firstChild, null)
    assert.equal(screen.queryByRole('region'), null)
  })
})
