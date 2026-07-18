import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import * as React from 'react'

import { IMenuItem } from '../../../src/lib/menu-item'
import { INotificationEntry } from '../../../src/models/notification-centre'
import { fireEvent, render } from '../../helpers/ui/render'

// Capture the items handed to the contextual menu instead of invoking the real
// (main-process-backed) implementation.
let captured: ReadonlyArray<IMenuItem> | null = null
mock.module('../../../src/lib/menu-item', {
  namedExports: {
    showContextualMenu: (items: ReadonlyArray<IMenuItem>) => {
      captured = items
      return Promise.resolve()
    },
  },
})

const entry: INotificationEntry = {
  id: 'entry-1',
  kind: 'pr-checks-failed',
  title: 'Checks failed on main',
  body: 'The build is red',
  createdAt: '2026-07-17T12:00:00.000Z',
  read: false,
  repositoryId: 42,
}

const baseProps = {
  entry,
  selected: false,
  onToggleSelected: () => {},
  onActivate: () => {},
  onToggleRead: () => {},
  onDelete: () => {},
}

describe('NotificationListItem context menu', () => {
  it('surfaces exactly the Automations entry and invokes onOpenAutomations with the entry', async () => {
    captured = null
    const opened = new Array<INotificationEntry>()
    const { NotificationListItem } = await import(
      '../../../src/ui/notifications/notification-list-item'
    )

    const { container } = render(
      <NotificationListItem
        {...baseProps}
        onOpenAutomations={openedEntry => opened.push(openedEntry)}
      />
    )

    const row = container.querySelector('.notification-item')
    assert.ok(row)
    fireEvent.contextMenu(row as Element)

    assert.ok(captured, 'the context menu should have been requested')
    // `captured` is only reassigned inside the mocked showContextualMenu
    // callback, which the control-flow analysis can't see, so read it through
    // a widened local rather than a non-null assertion on the narrowed type.
    const items = captured as ReadonlyArray<IMenuItem>
    assert.equal(items.length, 1)
    assert.equal(items[0].label, 'Automations…')

    items[0].action?.()
    assert.deepEqual(opened, [entry])
  })

  it('exposes no context menu when the automation entry point is absent', async () => {
    captured = null
    const { NotificationListItem } = await import(
      '../../../src/ui/notifications/notification-list-item'
    )

    const { container } = render(<NotificationListItem {...baseProps} />)
    const row = container.querySelector('.notification-item')
    assert.ok(row)
    fireEvent.contextMenu(row as Element)

    assert.equal(captured, null)
  })
})
