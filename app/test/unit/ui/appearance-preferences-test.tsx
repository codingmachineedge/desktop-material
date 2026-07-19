import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { BranchSortOrder } from '../../../src/models/branch-sort-order'
import {
  DefaultAppearanceCustomization,
  IAppearanceCustomization,
} from '../../../src/models/appearance-customization'
import {
  dateFormats,
  numberFormats,
  timeFormats,
} from '../../../src/models/formatting-preferences'
import { ShowBranchNameInRepoListSetting } from '../../../src/models/show-branch-name-in-repo-list'
import { Appearance } from '../../../src/ui/preferences/appearance'
import { ApplicationTheme } from '../../../src/ui/lib/application-theme'
import { fireEvent, render, screen } from '../../helpers/ui/render'

describe('Appearance feature highlighting preference', () => {
  it('is default-off, explained, and preserves the appearance object when toggled', () => {
    const changes = new Array<IAppearanceCustomization>()
    const commonProps = {
      selectedTheme: ApplicationTheme.Light,
      onSelectedThemeChanged: () => {},
      onAppearanceCustomizationChanged: (value: IAppearanceCustomization) =>
        changes.push(value),
      zoomBaseFactor: 1,
      onZoomBaseFactorChanged: () => {},
      autoFitZoomEnabled: false,
      onAutoFitZoomEnabledChanged: () => {},
      windowZoomFactor: 1,
      selectedTabSize: 4,
      onSelectedTabSizeChanged: () => {},
      selectedDateFormat: dateFormats[0].pattern,
      onSelectedDateFormatChanged: () => {},
      selectedTimeFormat: timeFormats[0].pattern,
      onSelectedTimeFormatChanged: () => {},
      selectedNumberFormat: numberFormats[0],
      onSelectedNumberFormatChanged: () => {},
      preferAbsoluteDates: false,
      onPreferAbsoluteDatesChanged: () => {},
      showRecentRepositories: true,
      onShowRecentRepositoriesChanged: () => {},
      showBranchNameInRepoList: ShowBranchNameInRepoListSetting.Never,
      onShowBranchNameInRepoListChanged: () => {},
      branchSortOrder: BranchSortOrder.LastModified,
      onBranchSortOrderChanged: () => {},
    }

    const view = render(
      <Appearance
        {...commonProps}
        appearanceCustomization={DefaultAppearanceCustomization}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Highlight Desktop Material features',
    }) as HTMLInputElement
    assert.equal(checkbox.checked, false)
    assert.ok(screen.getByText(/aren't available in stock GitHub Desktop/))

    fireEvent.click(checkbox)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].highlightDesktopMaterialFeatures, true)
    assert.equal(
      changes[0].accentPalette,
      DefaultAppearanceCustomization.accentPalette
    )
    assert.equal(
      changes[0].repositoryLogo,
      DefaultAppearanceCustomization.repositoryLogo
    )

    view.rerender(
      <Appearance
        {...commonProps}
        appearanceCustomization={{
          ...DefaultAppearanceCustomization,
          highlightDesktopMaterialFeatures: true,
        }}
      />
    )
    assert.equal(
      (
        screen.getByRole('checkbox', {
          name: 'Highlight Desktop Material features',
        }) as HTMLInputElement
      ).checked,
      true
    )
  })
})
