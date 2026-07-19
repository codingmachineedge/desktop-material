import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import {
  ICreateTagLifecycleOptions,
  IRemoteTagDeletionReview,
  ITagLifecycleInventory,
  ITagRefReview,
  ITagPushReview,
} from '../../../src/lib/git'
import { Repository } from '../../../src/models/repository'
import {
  ITagLifecycleDispatcher,
  TagLifecycleManager,
} from '../../../src/ui/tag/tag-lifecycle-manager'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'

const repository = new Repository('C:\tag-lifecycle-fixture', 17, null, false)

const localOnlyInventory: ITagLifecycleInventory = {
  local: [
    {
      name: 'release',
      refObject: 'a'.repeat(40),
      target: 'b'.repeat(40),
      kind: 'annotated',
      message: 'Reviewed release',
      tagger: 'Mona',
      taggedAt: '2026-07-19T12:00:00Z',
      signed: true,
    },
  ],
  remote: null,
  remoteName: null,
  localTruncated: false,
  remoteTruncated: false,
  signingConfigured: true,
  signingFormat: 'ssh',
}

const remoteInventory: ITagLifecycleInventory = {
  ...localOnlyInventory,
  remoteName: 'origin',
  remote: [
    {
      name: 'release',
      refObject: 'a'.repeat(40),
      target: 'b'.repeat(40),
    },
    {
      name: 'remote-only',
      refObject: 'c'.repeat(40),
      target: 'c'.repeat(40),
    },
  ],
}

class FakeTagLifecycleDispatcher implements ITagLifecycleDispatcher {
  public readonly inventoryRequests: boolean[] = []
  public readonly creates: ICreateTagLifecycleOptions[] = []
  public readonly moves: Array<
    ICreateTagLifecycleOptions & { readonly expectedRefObject: string }
  > = []
  public readonly localDeletes: ITagRefReview[] = []
  public readonly pushes: ReadonlyArray<ITagPushReview>[] = []
  public readonly fetches: Array<{
    readonly prune: boolean
    readonly reviewed: ReadonlyArray<ITagRefReview>
  }> = []
  public readonly remoteDeletes: IRemoteTagDeletionReview[] = []
  private includeRemote = false

  public getTagLifecycleInventory = async (
    _repository: Repository,
    includeRemote: boolean
  ) => {
    this.inventoryRequests.push(includeRemote)
    this.includeRemote ||= includeRemote
    return this.includeRemote ? remoteInventory : localOnlyInventory
  }

  public createLifecycleTag = async (
    _repository: Repository,
    options: ICreateTagLifecycleOptions
  ) => {
    this.creates.push(options)
    return true
  }

  public moveLifecycleTag = async (
    _repository: Repository,
    options: ICreateTagLifecycleOptions & {
      readonly expectedRefObject: string
    }
  ) => {
    this.moves.push(options)
    return true
  }

  public deleteReviewedLifecycleTag = async (
    _repository: Repository,
    review: ITagRefReview
  ) => {
    this.localDeletes.push(review)
    return true
  }

  public pushLifecycleTags = async (
    _repository: Repository,
    reviews: ReadonlyArray<ITagPushReview>
  ) => {
    this.pushes.push(reviews)
    return true
  }

  public fetchLifecycleTags = async (
    _repository: Repository,
    prune: boolean,
    reviewed: ReadonlyArray<ITagRefReview>
  ) => {
    this.fetches.push({ prune, reviewed })
    return true
  }

  public deleteRemoteLifecycleTag = async (
    _repository: Repository,
    review: IRemoteTagDeletionReview
  ) => {
    this.remoteDeletes.push(review)
    return true
  }
}

function renderManager(
  dispatcher = new FakeTagLifecycleDispatcher(),
  readOnly = false
) {
  let refreshes = 0
  const view = render(
    <TagLifecycleManager
      repository={repository}
      dispatcher={dispatcher}
      readOnly={readOnly}
      onRefreshRepository={async () => {
        refreshes++
      }}
    />
  )
  return { dispatcher, view, getRefreshes: () => refreshes }
}

describe('Tag lifecycle manager', () => {
  it('loads local tags first and remote tags only on request', async () => {
    const { dispatcher } = renderManager()
    await screen.findByText('release')
    assert.deepEqual(dispatcher.inventoryRequests, [false])
    assert.ok(screen.getByText(/Remote not loaded/))
    assert.equal(screen.queryByText('remote-only'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Load remote' }))
    await screen.findByText('remote-only')
    assert.deepEqual(dispatcher.inventoryRequests, [false, true])
    assert.ok(screen.getByText(/Pushed/))
  })

  it('creates a signed annotated tag through a typed dispatcher operation', async () => {
    const { dispatcher, getRefreshes } = renderManager()
    await screen.findByText('release')
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'v2.0.0' },
    })
    fireEvent.change(screen.getByLabelText('Target'), {
      target: { value: 'main' },
    })
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Release two' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Sign using Git's configured ssh signer/,
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create local tag' }))

    await waitFor(() => assert.equal(dispatcher.creates.length, 1))
    assert.deepEqual(dispatcher.creates[0], {
      name: 'v2.0.0',
      target: 'main',
      kind: 'annotated',
      message: 'Release two',
      sign: true,
    })
    assert.equal(getRefreshes(), 1)
  })

  it('requires a stale-safe typed confirmation before moving a tag', async () => {
    const { dispatcher } = renderManager()
    await screen.findByText('release')
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    fireEvent.change(screen.getByLabelText('New target'), {
      target: { value: 'main~1' },
    })
    fireEvent.change(screen.getByLabelText('Recreated type'), {
      target: { value: 'lightweight' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review move' }))

    const dialog = await screen.findByRole('alertdialog')
    assert.match(dialog.textContent ?? '', /Recreate release at main~1/)
    const confirmation = screen.getByLabelText(/Type release to confirm/)
    fireEvent.change(confirmation, { target: { value: 'release' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => assert.equal(dispatcher.moves.length, 1))
    assert.deepEqual(dispatcher.moves[0], {
      name: 'release',
      target: 'main~1',
      kind: 'lightweight',
      message: undefined,
      sign: false,
      expectedRefObject: 'a'.repeat(40),
    })
  })

  it('reviews push-all, prune, and exact remote deletion separately', async () => {
    const { dispatcher } = renderManager()
    await screen.findByText('release')
    fireEvent.click(screen.getByRole('button', { name: 'Load remote' }))
    await screen.findByText('remote-only')

    fireEvent.click(screen.getByRole('button', { name: 'Push all' }))
    fireEvent.change(screen.getByLabelText(/Type PUSH ALL to confirm/), {
      target: { value: 'PUSH ALL' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => assert.equal(dispatcher.pushes.length, 1))
    assert.deepEqual(dispatcher.pushes[0], [
      {
        name: 'release',
        expectedRefObject: 'a'.repeat(40),
        expectedRemoteRefObject: 'a'.repeat(40),
      },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fetch and prune' }))
    fireEvent.change(screen.getByLabelText(/Type PRUNE to confirm/), {
      target: { value: 'PRUNE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => assert.equal(dispatcher.fetches.length, 1))
    assert.deepEqual(dispatcher.fetches[0], {
      prune: true,
      reviewed: [{ name: 'release', expectedRefObject: 'a'.repeat(40) }],
    })

    const remoteOnlyRow = screen.getByText('remote-only').closest('li')
    assert.ok(remoteOnlyRow)
    fireEvent.click(
      remoteOnlyRow.querySelector<HTMLButtonElement>(
        'button'
      ) as HTMLButtonElement
    )
    fireEvent.change(screen.getByLabelText(/Type remote-only to confirm/), {
      target: { value: 'remote-only' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => assert.equal(dispatcher.remoteDeletes.length, 1))
    assert.deepEqual(dispatcher.remoteDeletes[0], {
      name: 'remote-only',
      expectedRefObject: 'c'.repeat(40),
    })
  })

  it('disables every mutation in a temporary read-only workspace', async () => {
    renderManager(new FakeTagLifecycleDispatcher(), true)
    await screen.findByText('release')
    assert.ok(screen.getByText(/Temporary submodule workspaces are read-only/))
    assert.equal(
      screen
        .getByRole('button', { name: 'Create local tag' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Move' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Delete local' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })

  it('live-switches controls and an existing success status', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const { view } = renderManager()

    try {
      await screen.findByText('release')
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'localized-tag' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create local tag' }))
      await screen.findByText('Created local tag localized-tag.')

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('heading', { name: '標籤生命週期' }))
      )
      assert.ok(screen.getByRole('button', { name: '建立本機標籤' }))
      assert.ok(screen.getByText('已建立本機標籤 localized-tag。'))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.match(
          view.container.textContent ?? '',
          /Tag lifecycle · 標籤生命週期/
        )
      )
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
