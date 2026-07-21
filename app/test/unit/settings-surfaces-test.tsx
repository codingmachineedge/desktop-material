import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { AutomationPreferences } from '../../src/ui/preferences/automation'
import { Advanced } from '../../src/ui/preferences/advanced'
import { Integrations } from '../../src/ui/preferences/integrations'
import {
  DefaultAutomationSettings,
  IAutomationSettings,
  IAutomationSettingsState,
} from '../../src/lib/automation/automation-settings'
import { Default as DefaultShell } from '../../src/lib/shells'
import {
  cantoneseTranslations,
  englishTranslations,
  TranslationKey,
} from '../../src/lib/i18n-resources'
import { translate } from '../../src/lib/i18n'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'

// Keep every assertion in the default English mode; other suites may leave a
// persisted language behind.
beforeEach(() => {
  localStorage.removeItem('language-mode-v1')
  localStorage.removeItem('appearance-customization-v1')
})

function automationState(
  overrides: Partial<IAutomationSettings>
): IAutomationSettingsState {
  return {
    global: { ...DefaultAutomationSettings, ...overrides },
    accounts: {},
  }
}

const advancedProps = {
  useWindowsOpenSSH: false,
  verboseLogging: false,
  optOutOfUsageTracking: false,
  useExternalCredentialHelper: false,
  repositoryIndicatorsEnabled: true,
  autoSwitchAccountToRepositoryOwner: false,
  onUseWindowsOpenSSHChanged: () => undefined,
  onVerboseLoggingChanged: () => undefined,
  onOptOutofReportingChanged: () => undefined,
  onUseExternalCredentialHelperChanged: () => undefined,
  onRepositoryIndicatorsEnabledChanged: () => undefined,
  onAutoSwitchAccountToRepositoryOwnerChanged: () => undefined,
}

describe('Automation preferences switch + interval chips', () => {
  it('drives the master toggle through the shared MaterialSwitch', () => {
    const changes: IAutomationSettingsState[] = []
    const view = render(
      <AutomationPreferences
        accounts={[]}
        settings={automationState({
          autoCommitPushEnabled: false,
          autoPullEnabled: false,
        })}
        onSettingsChanged={next => changes.push(next)}
      />
    )

    const toggle = view.getByRole('switch', {
      name: 'Automatically commit and push',
    })
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    fireEvent.click(toggle)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].global.autoCommitPushEnabled, true)
  })

  it('reveals segmented interval chips only for enabled toggles', () => {
    const view = render(
      <AutomationPreferences
        accounts={[]}
        settings={automationState({
          autoCommitPushEnabled: true,
          autoCommitPushInterval: 30,
          autoPullEnabled: false,
        })}
        onSettingsChanged={() => undefined}
      />
    )

    // Only the enabled commit toggle exposes an interval group.
    assert.equal(view.getAllByRole('radiogroup').length, 1)
    assert.equal(view.getAllByRole('radio').length, 4)
    assert.equal(
      view.getByRole('radio', { name: '30 min' }).getAttribute('aria-checked'),
      'true'
    )
    assert.equal(
      view.getByRole('radio', { name: '15 min' }).getAttribute('aria-checked'),
      'false'
    )
  })

  it('keeps persisted interval values working when a chip is picked', () => {
    const changes: IAutomationSettingsState[] = []
    const view = render(
      <AutomationPreferences
        accounts={[]}
        settings={automationState({
          autoCommitPushEnabled: true,
          autoCommitPushInterval: 30,
          autoPullEnabled: false,
        })}
        onSettingsChanged={next => changes.push(next)}
      />
    )

    fireEvent.click(view.getByRole('radio', { name: '15 min' }))
    assert.equal(changes.length, 1)
    assert.equal(changes[0].global.autoCommitPushInterval, 15)
  })
})

describe('Advanced preferences disclosure rows', () => {
  it('always renders the usage-stats and credential-storage disclosures', () => {
    const view = render(<Advanced {...advancedProps} />)

    assert.ok(view.getByText('Usage stats'))
    assert.ok(
      view.getByText(
        'Submit anonymized usage data to help improve Desktop Material.'
      )
    )
    assert.ok(view.getByText('Credential storage'))
    assert.ok(
      view.getByText(
        'Tokens are kept in the operating-system credential store and are never written to repository configuration.'
      )
    )

    // The informational tiles use the bundled Material Symbols.
    const glyphs = Array.from(
      view.container.querySelectorAll(
        '.preference-disclosure-icon .material-symbol'
      )
    ).map(node => node.textContent)
    assert.ok(glyphs.includes('monitoring'))
    assert.ok(glyphs.includes('key'))
  })
})

describe('Integrations application cards', () => {
  const integrationProps = {
    availableEditors: ['Visual Studio Code', 'Atom'],
    selectedExternalEditor: 'Visual Studio Code' as string | null,
    availableShells: [DefaultShell],
    selectedShell: DefaultShell,
    useCustomEditor: false,
    customEditor: { path: '', arguments: '' },
    useCustomShell: false,
    customShell: { path: '', arguments: '' },
    branchPresetScript: { path: '', arguments: '' },
    onSelectedShellChanged: () => undefined,
    onUseCustomEditorChanged: () => undefined,
    onCustomEditorChanged: () => undefined,
    onUseCustomShellChanged: () => undefined,
    onCustomShellChanged: () => undefined,
    onBranchPresetScriptChanged: () => undefined,
  }

  it('renders icon-badged editor and shell cards instead of bare selects', () => {
    const view = render(
      <Integrations
        {...integrationProps}
        onSelectedEditorChanged={() => undefined}
      />
    )

    assert.ok(view.getByText('External editor'))
    assert.ok(
      view.getByText('Used when opening files or repositories in your editor')
    )
    assert.ok(view.getByText('Shell'))
    assert.ok(
      view.getByText('Used when opening a repository in the command line')
    )

    // The trailing tonal menu button carries the current selection and chevron.
    const editorButton = view.getByRole('button', {
      name: /Choose external editor/,
    })
    assert.match(editorButton.textContent ?? '', /Visual Studio Code/)
    assert.match(editorButton.textContent ?? '', /unfold_more/)
    // No native <select> remains in the applications cards section.
    const cards = view.container.querySelector('.integration-application-cards')
    assert.ok(cards !== null)
    assert.equal(cards.querySelector('select'), null)
  })

  it('still dispatches the selection through the existing plumbing', async () => {
    const dispatched: string[] = []
    const view = render(
      <Integrations
        {...integrationProps}
        onSelectedEditorChanged={editor => dispatched.push(editor)}
      />
    )

    fireEvent.click(
      view.getByRole('button', { name: /Choose external editor/ })
    )

    const atom = await waitFor(() =>
      screen.getByRole('menuitem', { name: 'Atom' })
    )
    fireEvent.click(atom)

    await waitFor(() => assert.deepEqual(dispatched, ['Atom']))
  })
})

describe('Settings surfaces i18n', () => {
  const newKeys: ReadonlyArray<TranslationKey> = [
    'settings.notificationsEnableTitle',
    'settings.notificationsEnableDescription',
    'settings.automationAutoCommitPushTitle',
    'settings.automationAutoCommitPushDescription',
    'settings.automationAutoPullTitle',
    'settings.automationAutoPullDescription',
    'settings.automationIntervalEvery',
    'settings.automationIntervalMinutes',
    'settings.automationIntervalGroupLabel',
    'settings.advancedUsageStatsTitle',
    'settings.advancedUsageStatsDescription',
    'settings.advancedCredentialStorageTitle',
    'settings.advancedCredentialStorageDescription',
    'settings.integrationsExternalEditorTitle',
    'settings.integrationsExternalEditorSubtitle',
    'settings.integrationsShellTitle',
    'settings.integrationsShellSubtitle',
    'settings.integrationsChooseEditor',
    'settings.integrationsChooseShell',
    'settings.integrationsCustomEditorChoice',
    'settings.integrationsCustomShellChoice',
    'settings.integrationsCustomEditorLabel',
    'settings.integrationsCustomShellLabel',
    'settings.integrationsSelectEditor',
  ]

  it('provides English and Cantonese copy for every new string', () => {
    for (const key of newKeys) {
      assert.ok(
        englishTranslations[key] !== undefined &&
          englishTranslations[key].length > 0,
        `missing English for ${key}`
      )
      assert.ok(
        cantoneseTranslations[key] !== undefined &&
          (cantoneseTranslations[key] ?? '').length > 0,
        `missing Cantonese for ${key}`
      )
    }
  })

  it('composes bilingual output from both catalogs', () => {
    const bilingual = translate(
      'settings.advancedCredentialStorageTitle',
      'bilingual'
    )
    assert.match(bilingual, / · /)
    assert.match(bilingual, /Credential storage/)
    assert.match(bilingual, /憑證儲存/)
  })

  it('interpolates the localized interval minutes', () => {
    assert.equal(
      translate('settings.automationIntervalMinutes', 'english', {
        minutes: '15',
      }),
      '15 min'
    )
    assert.equal(
      translate('settings.automationIntervalMinutes', 'cantonese', {
        minutes: '15',
      }),
      '15 分鐘'
    )
  })
})
