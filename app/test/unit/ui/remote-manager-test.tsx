import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { within } from '@testing-library/react'

import { IRemoteManagementPlan } from '../../../src/models/remote'
import { Remote } from '../../../src/ui/repository-settings/remote'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const snapshot = {
  token: 'a'.repeat(64),
  remotes: [
    {
      name: 'origin',
      fetchUrl: 'https://example.test/team/project.git',
      fetchUrlHasCredentials: false,
      pushUrl: null,
      pushUrlHasCredentials: false,
      prune: 'inherit' as const,
      defaultBranch: 'main',
    },
  ],
}

interface IReviewState {
  readonly dirty: boolean
  readonly plan: IRemoteManagementPlan | null
}

function renderRemoteManager(customSnapshot = snapshot) {
  const states = new Array<IReviewState>()
  let publishes = 0
  const view = render(
    <Remote
      snapshot={customSnapshot}
      preferredRemoteName={customSnapshot.remotes[0]?.name ?? null}
      disabled={false}
      onReviewStateChanged={(dirty, plan) => states.push({ dirty, plan })}
      onPublish={() => publishes++}
    />
  )
  return { ...view, states, getPublishes: () => publishes }
}

describe('Remote Manager', () => {
  it('reviews rename, URL, push, prune, and default tracking without rendering plan URLs', () => {
    const { states } = renderRemoteManager()
    fireEvent.change(screen.getByLabelText('origin remote name'), {
      target: { value: 'primary' },
    })
    fireEvent.change(screen.getByLabelText('primary fetch URL'), {
      target: { value: 'https://example.test/team/project-v2.git' },
    })
    fireEvent.click(
      screen.getByLabelText('Use a separate push URL for primary')
    )
    fireEvent.change(screen.getByLabelText('primary push URL'), {
      target: { value: 'ssh://git@example.test/team/project.git' },
    })
    fireEvent.change(screen.getByLabelText('primary stale branch pruning'), {
      target: { value: 'enabled' },
    })
    fireEvent.change(screen.getByLabelText('primary tracked default branch'), {
      target: { value: 'stable' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review remote changes' })
    )

    const review = screen.getByRole('alertdialog')
    const reviewText = review.textContent ?? ''
    assert.match(reviewText, /Rename the origin remote to primary/)
    assert.match(reviewText, /Replace the fetch URL/)
    assert.match(reviewText, /Replace the explicit push URL/)
    assert.doesNotMatch(reviewText, /https?:\/\//)
    assert.doesNotMatch(reviewText, /ssh:\/\//)
    const confirm = within(review).getByRole('button', {
      name: 'Confirm remote changes',
    })
    assert.equal(document.activeElement, confirm)
    fireEvent.click(confirm)

    const confirmed = states.at(-1)
    assert.equal(confirmed?.dirty, true)
    assert.ok(confirmed?.plan !== null)
    assert.equal(confirmed?.plan?.updates[0].name, 'primary')
    assert.equal(confirmed?.plan?.updates[0].prune, 'enabled')
    assert.ok(screen.getByText('Confirmed for Save'))

    fireEvent.change(screen.getByLabelText('primary remote name'), {
      target: { value: 'primary-v2' },
    })
    assert.equal(states.at(-1)?.plan, null)
    assert.equal(screen.queryByText('Confirmed for Save'), null)
  })

  it('requires explicit destructive confirmation before staging removal', () => {
    const { states } = renderRemoteManager()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Stage origin remote for removal',
      })
    )
    assert.ok(screen.getByText(/staged for removal/i))
    fireEvent.click(
      screen.getByRole('button', { name: 'Review remote changes' })
    )
    const review = screen.getByRole('alertdialog')
    assert.match(
      review.textContent ?? '',
      /Remove this remote and its remote-tracking references/
    )
    assert.match(
      review.textContent ?? '',
      /removes the current hosted\/account-bound remote/
    )
    assert.match(review.textContent ?? '', /hosted actions will refresh/)
    fireEvent.click(
      within(review).getByRole('button', { name: 'Confirm remote changes' })
    )
    assert.deepEqual(states.at(-1)?.plan?.removed, ['origin'])
  })

  it('adds remotes to empty repositories and rejects embedded credentials', () => {
    const empty = { token: 'b'.repeat(64), remotes: [] }
    const { states, getPublishes } = renderRemoteManager(empty)
    assert.ok(screen.getByText('No named remotes.'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish repository instead' })
    )
    assert.equal(getPublishes(), 1)

    fireEvent.change(screen.getByLabelText(/new remote name/i), {
      target: { value: 'upstream' },
    })
    fireEvent.change(screen.getByLabelText(/new fetch URL/i), {
      target: { value: 'https://user:secret@example.test/team/project.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add remote/i }))
    assert.ok(screen.getByRole('alert').textContent?.includes('credentials'))
    assert.equal(states.length, 0)

    fireEvent.change(screen.getByLabelText(/new fetch URL/i), {
      target: { value: 'https://example.test/team/project.git' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add remote/i }))
    assert.ok(screen.getByLabelText('upstream remote name'))
    assert.equal(states.at(-1)?.dirty, true)
  })

  it('never renders stored HTTP credentials and preserves a masked URL in metadata-only plans', () => {
    const masked = {
      token: 'c'.repeat(64),
      remotes: [
        {
          ...snapshot.remotes[0],
          fetchUrlHasCredentials: true,
        },
      ],
    }
    const { states } = renderRemoteManager(masked)
    assert.doesNotMatch(document.body.textContent ?? '', /credential-value/)
    assert.ok(screen.getByText(/credentials were masked/i))
    fireEvent.click(screen.getByLabelText('Use a separate push URL for origin'))
    assert.equal(
      (screen.getByLabelText('origin push URL') as HTMLInputElement).value,
      ''
    )
    fireEvent.click(screen.getByLabelText('Use a separate push URL for origin'))
    fireEvent.change(screen.getByLabelText('origin stale branch pruning'), {
      target: { value: 'enabled' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review remote changes' })
    )
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm remote changes',
      })
    )
    assert.equal(states.at(-1)?.plan?.updates[0].fetchUrl, undefined)
  })
})
