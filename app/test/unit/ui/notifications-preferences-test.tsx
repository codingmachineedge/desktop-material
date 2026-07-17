import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { ErrorPresentationStyle } from '../../../src/models/error-presentation'
import { Notifications } from '../../../src/ui/preferences/notifications'
import { fireEvent, render, screen, within } from '../../helpers/ui/render'

let restoreIpcInvoke: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousInvoke = electron.ipcRenderer.invoke
  electron.ipcRenderer.invoke = async () => 'denied'
  restoreIpcInvoke = () => {
    electron.ipcRenderer.invoke = previousInvoke
    restoreIpcInvoke = null
  }
})

afterEach(() => restoreIpcInvoke?.())

describe('Notifications preferences', () => {
  it('offers both error styles and reports the selected radio value', () => {
    const changed = new Array<ErrorPresentationStyle>()
    const view = render(
      <Notifications
        notificationsEnabled={false}
        onNotificationsEnabledChanged={() => {}}
        errorPresentationStyle={ErrorPresentationStyle.Notice}
        onErrorPresentationStyleChanged={style => changed.push(style)}
      />
    )

    const group = screen.getByRole('radiogroup', {
      name: 'Application errors',
    })
    const notice = within(group).getByRole('radio', {
      name: /Bottom-right notice/,
    }) as HTMLInputElement
    const dialog = within(group).getByRole('radio', {
      name: /Blocking dialog/,
    }) as HTMLInputElement
    const preview = screen.getByLabelText('Error presentation preview')

    assert.equal(notice.getAttribute('value'), ErrorPresentationStyle.Notice)
    assert.equal(dialog.getAttribute('value'), ErrorPresentationStyle.Dialog)
    assert.equal(notice.checked, true)
    assert.equal(dialog.checked, false)
    assert.ok(preview.classList.contains('notice'))
    assert.ok(screen.getByText(/Errors that only need acknowledgement/))
    assert.ok(screen.getByText(/always remain dialogs/))

    fireEvent.click(dialog)
    assert.deepEqual(changed, [ErrorPresentationStyle.Dialog])

    view.rerender(
      <Notifications
        notificationsEnabled={false}
        onNotificationsEnabledChanged={() => {}}
        errorPresentationStyle={ErrorPresentationStyle.Dialog}
        onErrorPresentationStyleChanged={style => changed.push(style)}
      />
    )
    assert.equal(
      (
        within(group).getByRole('radio', {
          name: /Blocking dialog/,
        }) as HTMLInputElement
      ).checked,
      true
    )
    assert.ok(
      screen
        .getByLabelText('Error presentation preview')
        .classList.contains('dialog')
    )
  })
})
