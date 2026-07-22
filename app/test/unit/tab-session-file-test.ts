import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  MaxTabSessionFileLength,
  parseTabSession,
  serializeTabSession,
  TabSessionFormat,
  TabSessionVersion,
} from '../../src/lib/tab-session-file'
import { IProfileTabsState } from '../../src/models/repository-tab'

describe('tab session files', () => {
  it('round-trips current tab state without leaking runtime ids', () => {
    const state: IProfileTabsState = {
      activeTabId: 'runtime-two',
      tabs: [
        {
          id: 'runtime-one',
          repositoryId: 41,
          repositoryPath: 'C:\\work\\alpha',
          customLabel: 'Alpha workspace',
          titleStyle: { bold: true, futureTextEffect: 'rainbow' },
          groupId: 'profile-local-group',
          isPinned: true,
          openedAt: 100,
          futureTabField: 'preserved',
        },
        {
          id: 'runtime-two',
          repositoryId: 42,
          repositoryPath: 'C:\\work\\beta',
          customLabel: null,
          titleStyle: null,
          isFavorite: true,
          openedAt: 200,
        },
      ],
    }

    const serialized = serializeTabSession(
      state,
      new Date('2026-07-16T12:00:00.000Z')
    )
    assert.doesNotMatch(
      serialized,
      /runtime-one|runtime-two|repositoryId|profile-local-group|groupId/
    )
    const parsed = parseTabSession(serialized)

    assert.ok(parsed)
    assert.equal(parsed.format, TabSessionFormat)
    assert.equal(parsed.version, TabSessionVersion)
    assert.equal(parsed.activeRepositoryPath, 'C:\\work\\beta')
    assert.equal(parsed.tabs[0].isPinned, true)
    assert.equal(parsed.tabs[1].isFavorite, true)
    assert.equal(parsed.tabs[0].futureTabField, 'preserved')
    assert.equal(parsed.tabs[0].titleStyle?.futureTextEffect, 'rainbow')
    assert.equal(parsed.tabs[0].groupId, undefined)
  })

  it('sanitizes unsafe known fields while preserving future data', () => {
    const parsed = parseTabSession(
      JSON.stringify({
        format: TabSessionFormat,
        version: TabSessionVersion,
        exportedAt: 'not-a-date',
        activeRepositoryPath: 'C:\\WORK\\ALPHA\\',
        futureFileField: 3,
        tabs: [
          {
            id: 'untrusted-runtime-id',
            repositoryId: 999,
            repositoryPath: 'C:\\work\\alpha',
            customLabel: '  Safe alias  ',
            isPinned: 'yes',
            isFavorite: true,
            groupId: 'missing-group-definition',
            openedAt: -5,
            futureTabField: { mode: 'newer' },
            titleStyle: {
              color: 'url(javascript:bad)',
              fontSize: 999,
              fontFamily: 'Bad; font',
              futureStyleField: 'kept',
            },
          },
          {
            repositoryPath: 'c:\\work\\alpha\\',
            customLabel: 'Duplicate',
          },
        ],
      })
    )

    assert.ok(parsed)
    assert.equal(parsed.tabs.length, 1)
    assert.equal(parsed.tabs[0].customLabel, 'Safe alias')
    assert.equal(parsed.tabs[0].isPinned, undefined)
    assert.equal(parsed.tabs[0].isFavorite, true)
    assert.equal(parsed.tabs[0].groupId, undefined)
    assert.equal(parsed.tabs[0].openedAt, undefined)
    assert.equal(parsed.tabs[0].id, undefined)
    assert.equal(parsed.tabs[0].repositoryId, undefined)
    assert.equal(parsed.tabs[0].titleStyle?.fontSize, 32)
    assert.equal(parsed.tabs[0].titleStyle?.color, undefined)
    assert.equal(parsed.tabs[0].titleStyle?.fontFamily, undefined)
    assert.equal(parsed.tabs[0].titleStyle?.futureStyleField, 'kept')
    assert.equal(parsed.futureFileField, 3)
    assert.equal(parsed.exportedAt, new Date(0).toISOString())
    assert.equal(parsed.activeRepositoryPath, 'C:\\WORK\\ALPHA\\')
  })

  it('deduplicates canonical Windows path spellings before import', () => {
    const activeRepositoryPath = 'C:\\work\\other\\..\\desktop-material\\.'
    const parsed = parseTabSession(
      JSON.stringify({
        format: TabSessionFormat,
        version: TabSessionVersion,
        activeRepositoryPath,
        tabs: [
          {
            repositoryPath: 'C:\\work\\desktop-material',
            customLabel: 'Keep first',
          },
          {
            repositoryPath: 'c:/work//scratch/../desktop-material/.',
            customLabel: 'Duplicate using forward slashes',
          },
          {
            repositoryPath: 'C:\\work\\.\\desktop-material\\nested\\..\\',
            customLabel: 'Duplicate using dot segments',
          },
        ],
      })
    )

    assert.ok(parsed)
    assert.equal(parsed.tabs.length, 1)
    assert.equal(parsed.tabs[0].repositoryPath, 'C:\\work\\desktop-material')
    assert.equal(parsed.tabs[0].customLabel, 'Keep first')
    assert.equal(parsed.activeRepositoryPath, activeRepositoryPath)
  })

  it('deduplicates canonical UNC repository path spellings', () => {
    const parsed = parseTabSession(
      JSON.stringify({
        format: TabSessionFormat,
        version: TabSessionVersion,
        tabs: [
          { repositoryPath: '\\\\Server\\Team\\desktop-material' },
          {
            repositoryPath:
              '\\\\server\\team\\scratch\\..\\desktop-material\\.',
          },
        ],
      })
    )

    assert.ok(parsed)
    assert.equal(parsed.tabs.length, 1)
    assert.equal(
      parsed.tabs[0].repositoryPath,
      '\\\\Server\\Team\\desktop-material'
    )
  })

  it('keeps POSIX paths case-sensitive and preserves backslashes as characters', () => {
    const parsed = parseTabSession(
      JSON.stringify({
        format: TabSessionFormat,
        version: TabSessionVersion,
        tabs: [
          { repositoryPath: '/Work/desktop-material' },
          { repositoryPath: '/work/desktop-material' },
          { repositoryPath: '/Work/team\\repository' },
          { repositoryPath: '/Work/team/repository' },
          { repositoryPath: '/Work/tmp/../desktop-material/.' },
        ],
      })
    )

    assert.ok(parsed)
    assert.deepEqual(
      parsed.tabs.map(tab => tab.repositoryPath),
      [
        '/Work/desktop-material',
        '/work/desktop-material',
        '/Work/team\\repository',
        '/Work/team/repository',
      ]
    )
  })

  it('rejects malformed, empty, relative-only, and oversized sessions', () => {
    assert.equal(parseTabSession('{'), null)
    assert.equal(
      parseTabSession(
        JSON.stringify({
          format: TabSessionFormat,
          version: TabSessionVersion,
          tabs: [],
        })
      ),
      null
    )
    assert.equal(
      parseTabSession(
        JSON.stringify({
          format: TabSessionFormat,
          version: TabSessionVersion,
          tabs: [{ repositoryPath: 'relative/repository' }],
        })
      ),
      null
    )
    assert.equal(parseTabSession('x'.repeat(MaxTabSessionFileLength + 1)), null)
  })
})
