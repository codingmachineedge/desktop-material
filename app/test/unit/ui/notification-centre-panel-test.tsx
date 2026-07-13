import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Dispatcher } from '../../../src/ui/dispatcher'
import { NotificationCentrePanel } from '../../../src/ui/notifications/notification-centre-panel'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const dispatcher = {
  setNotificationCentreOpen: () => {},
  markAllNotificationsRead: () => {},
  clearAllNotifications: () => {},
  showPopup: () => {},
} as unknown as Dispatcher

describe('NotificationCentrePanel', () => {
  it('connects its tabs to the panel and supports arrow-key selection', () => {
    render(
      <NotificationCentrePanel
        dispatcher={dispatcher}
        entries={[]}
        unreadCount={0}
        repositories={[]}
      />
    )

    const all = screen.getByRole('tab', { name: 'All' })
    const unread = screen.getByRole('tab', { name: 'Unread' })
    const panel = screen.getByRole('tabpanel')

    assert.equal(all.getAttribute('aria-controls'), panel.id)
    assert.equal(unread.getAttribute('aria-controls'), panel.id)
    assert.equal(panel.getAttribute('aria-labelledby'), all.id)
    assert.equal(all.getAttribute('aria-selected'), 'true')
    assert.equal(all.tabIndex, 0)
    assert.equal(unread.tabIndex, -1)

    all.focus()
    fireEvent.keyDown(all, { key: 'ArrowRight' })

    assert.equal(unread.getAttribute('aria-selected'), 'true')
    assert.equal(unread.tabIndex, 0)
    assert.equal(all.tabIndex, -1)
    assert.equal(panel.getAttribute('aria-labelledby'), unread.id)
    assert.equal(document.activeElement, unread)
  })
})
