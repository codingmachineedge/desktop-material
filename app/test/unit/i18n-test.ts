import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getPersistedLanguageMode,
  normalizeLocale,
  translate,
  translatedVariable,
  TranslationKey,
} from '../../src/lib/i18n'

describe('recent UI internationalization', () => {
  it('maps Chinese locale hints to Cantonese without adding another UI mode', () => {
    assert.equal(normalizeLocale('zh-HK'), 'zh-HK')
    assert.equal(normalizeLocale('zh_TW'), 'zh-HK')
    assert.equal(normalizeLocale('zh-CN'), 'zh-HK')
    assert.equal(normalizeLocale('zh-SG'), 'zh-HK')
    assert.equal(normalizeLocale('fr-CA'), 'en')
  })

  it('translates and interpolates CI status text in Cantonese', () => {
    assert.equal(
      translate('ci.status', 'cantonese', {
        status: translate('ci.successful', 'cantonese'),
      }),
      'CI 檢查：成功，掂晒'
    )
  })

  it('renders compact bilingual text without duplicating nested variables', () => {
    assert.equal(
      translate('ci.status', 'bilingual', {
        status: translatedVariable('ci.failed'),
      }),
      'CI checks: failed · CI 檢查：失敗'
    )
  })

  it('localizes network notices and WSL recovery without mixing variable locales', () => {
    assert.equal(
      translate('networkRepository.detected', 'bilingual', {
        location: translatedVariable('networkRepository.wslShare'),
      }),
      'Detected a WSL share. Desktop Material keeps its exact path; reconnect it before Git operations if the location goes offline. · 偵測到以下位置：WSL 共享。Desktop Material 會保留精確路徑；如果位置離線，做 Git 操作前請先重新連接。'
    )
    assert.equal(
      translate('editor.wslDistributionMismatch', 'cantonese', {
        distribution: 'Ubuntu',
      }),
      '呢個路徑屬於 WSL 發行版「Ubuntu」。請揀返配對嘅 WSL 編輯器項目。'
    )
  })

  it('preserves user-controlled separators instead of parsing them as locale data', () => {
    assert.equal(
      translate('submodule.backToParent', 'bilingual', { parent: 'A · B' }),
      'Back to A · B · 返去 A · B'
    )
    assert.equal(
      translate('submodule.openFailed', 'bilingual', {
        child: 'A · B',
        error: 'folder · moved',
      }),
      'Could not open A · B as a repository: folder · moved · 未能將 A · B 當 repo 打開：folder · moved'
    )
  })

  it('translates the updater and appearance controls with English fallback', () => {
    assert.equal(
      translate('update.downloadingLabel', 'zh-TW'),
      '下載緊應用程式更新'
    )
    assert.equal(
      translate('appearance.useAccentColor', 'fr-CA'),
      'Use accent color'
    )
    assert.equal(
      translate('update.comingSoon', 'bilingual'),
      'New update coming soon · 新版本就快焗好出爐'
    )
  })

  it('localizes stalled release-upload recovery in all three modes', () => {
    for (const key of [
      'githubReleaseTransfer.stalled',
      'githubReleaseTransfer.cliUnavailable',
      'githubReleaseTransfer.cliFailed',
      'githubReleaseTransfer.incompleteAsset',
    ] as const) {
      const english = translate(key, 'english')
      const cantonese = translate(key, 'cantonese')
      const bilingual = translate(key, 'bilingual')
      assert.notEqual(english, cantonese)
      assert.equal(bilingual, `${english} · ${cantonese}`)
    }
  })

  it('localizes the new compact Releases feedback and Open file action', () => {
    const variables = {
      visible: '1',
      selected: '2',
      total: '3',
      detail: 'missing app',
    }
    for (const key of [
      'githubReleases.compactTools',
      'githubReleases.compactSummary',
      'githubReleases.filterSummary',
      'githubReleases.openFile',
      'githubReleases.showInFolder',
      'githubReleases.openFileError',
    ] as const) {
      const english = translate(key, 'english', variables)
      const cantonese = translate(key, 'cantonese', variables)
      assert.notEqual(english, cantonese)
      assert.equal(
        translate(key, 'bilingual', variables),
        `${english} · ${cantonese}`
      )
    }
  })

  it('localizes the direct Cheap LFS manager in all three modes', () => {
    for (const key of [
      'cheapLfs.managerRail',
      'cheapLfs.managerTitle',
      'cheapLfs.managerIntro',
      'cheapLfs.settings.location',
      'cheapLfs.settings.open',
    ] as const) {
      const english = translate(key, 'english')
      const cantonese = translate(key, 'cantonese')
      assert.notEqual(english, cantonese)
      assert.equal(translate(key, 'bilingual'), `${english} · ${cantonese}`)
    }
  })

  it('explains Cheap LFS failure isolation and the next-commit retry in every mode', () => {
    const variables = { count: '2', names: 'one.bin, two.bin', omitted: '0' }
    const english = translate('cheapLfs.pinFailures.many', 'english', variables)
    const cantonese = translate(
      'cheapLfs.pinFailures.many',
      'cantonese',
      variables
    )
    const bilingual = translate(
      'cheapLfs.pinFailures.many',
      'bilingual',
      variables
    )

    assert.match(english, /remain in Changes/)
    assert.match(english, /Other selected safe changes can continue now/)
    assert.match(english, /commit again to retry/)
    assert.match(cantonese, /會留喺 Changes/)
    assert.match(cantonese, /其他揀咗嘅安全變更會照行/)
    assert.match(cantonese, /再 commit 一次就會重試/)
    assert.equal(bilingual, `${english} · ${cantonese}`)
  })

  it('explains an uninitialized submodule in all three modes', () => {
    assert.equal(
      translate('submodule.openUnavailable', 'english'),
      'Clone this submodule before opening it'
    )
    assert.equal(
      translate('submodule.openUnavailable', 'cantonese'),
      '要先複製呢個子模組先開得'
    )
    assert.equal(
      translate('submodule.openUnavailable', 'bilingual'),
      'Clone this submodule before opening it · 要先複製呢個子模組先開得'
    )
  })

  it('localizes every Submodule Manager operation failure', () => {
    const failures: ReadonlyArray<{
      readonly key: TranslationKey
      readonly variables: Readonly<Record<string, string>>
      readonly english: RegExp
      readonly cantonese: RegExp
    }> = [
      {
        key: 'submodule.listFailed',
        variables: { error: 'offline' },
        english: /Could not list submodules: offline/,
        cantonese: /未能列出子模組：offline/,
      },
      {
        key: 'submodule.updateAllFailed',
        variables: { error: 'offline' },
        english: /Failed updating submodules: offline/,
        cantonese: /未能更新子模組：offline/,
      },
      {
        key: 'submodule.updateFailed',
        variables: { path: 'A · B', error: 'offline' },
        english: /Failed updating A · B: offline/,
        cantonese: /未能更新 A · B：offline/,
      },
      {
        key: 'submodule.syncFailed',
        variables: { path: 'A · B', error: 'offline' },
        english: /Failed syncing A · B: offline/,
        cantonese: /未能同步 A · B：offline/,
      },
      {
        key: 'submodule.removeFailed',
        variables: { path: 'A · B', error: 'offline' },
        english: /Failed removing A · B: offline/,
        cantonese: /未能移除 A · B：offline/,
      },
    ]

    for (const failure of failures) {
      assert.match(
        translate(failure.key, 'english', failure.variables),
        failure.english
      )
      assert.match(
        translate(failure.key, 'cantonese', failure.variables),
        failure.cantonese
      )
      const bilingual = translate(failure.key, 'bilingual', failure.variables)
      assert.match(bilingual, failure.english)
      assert.match(bilingual, failure.cantonese)
    }
  })

  it('keeps temporary tool guidance read-only and parent-specific', () => {
    const text = translate('submodule.temporaryToolsReadOnly', 'bilingual', {
      parent: 'A · B',
    })
    assert.match(text, /read-only repository tools only/)
    assert.match(text, /只可以用唯讀 repo 工具/)
    assert.equal(text.match(/A · B/g)?.length, 2)
  })

  it('keeps temporary settings guidance clear in all three modes', () => {
    const variables = { parent: 'main' }
    assert.match(
      translate('submodule.temporarySettingsUnavailable', 'english', variables),
      /Return to main/
    )
    assert.match(
      translate(
        'submodule.temporarySettingsUnavailable',
        'cantonese',
        variables
      ),
      /返去 main/
    )
    assert.match(
      translate(
        'submodule.temporarySettingsUnavailable',
        'bilingual',
        variables
      ),
      / · /
    )
  })

  it('keeps unsafe temporary-workspace errors explicit in all three modes', () => {
    const variables = { parent: 'fixture', error: 'path changed' }
    assert.match(
      translate('submodule.workspaceUnsafe', 'english', variables),
      /no longer safe to use.*Returned to fixture.*path changed/
    )
    assert.match(
      translate('submodule.workspaceUnsafe', 'cantonese', variables),
      /唔再安全使用.*返去 fixture.*path changed/
    )
    assert.match(
      translate('submodule.workspaceUnsafe', 'bilingual', variables),
      /Returned to fixture.* · .*返去 fixture/
    )
  })

  it('uses only an explicit persisted language mode', () => {
    localStorage.removeItem('appearance-customization-v1')
    localStorage.removeItem('language-mode-v1')
    assert.equal(getPersistedLanguageMode(), 'english')

    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'cantonese' })
    )
    assert.equal(getPersistedLanguageMode(), 'cantonese')
    assert.equal(localStorage.getItem('language-mode-v1'), 'cantonese')

    localStorage.setItem('language-mode-v1', 'zh-CN')
    assert.equal(getPersistedLanguageMode(), 'english')
    localStorage.removeItem('appearance-customization-v1')
    localStorage.removeItem('language-mode-v1')
  })
})
