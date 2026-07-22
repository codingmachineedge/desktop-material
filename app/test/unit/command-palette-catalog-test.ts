import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  CommandPaletteCatalog,
  IPaletteCommandContext,
  filterPaletteCommands,
} from '../../src/lib/command-palette-catalog'
import { translate } from '../../src/lib/i18n'
import { languageModes } from '../../src/models/language-mode'

/** A selection with nothing usefully selected. */
const emptyContext: IPaletteCommandContext = {
  platform: 'win32',
  hasRepository: false,
  hasRemote: false,
  hasBranch: false,
  isGitHubRepository: false,
}

/** A repository selected and checked out on a valid branch with a remote. */
const branchContext: IPaletteCommandContext = {
  platform: 'win32',
  hasRepository: true,
  hasRemote: true,
  hasBranch: true,
  isGitHubRepository: true,
}

/** A repository selected but not on a named branch (detached / unborn). */
const repositoryContext: IPaletteCommandContext = {
  platform: 'win32',
  hasRepository: true,
  hasRemote: false,
  hasBranch: false,
  isGitHubRepository: false,
}

/** Newly added palette commands the expansion must keep registered. */
const NewCommandEvents = [
  'select-all',
  'palette:toggle-theme',
  'palette:preferences-accounts',
  'palette:preferences-appearance',
  'palette:preferences-integrations',
  'palette:preferences-automation',
  'palette:preferences-advanced',
  'palette:preferences-notifications',
  'palette:preferences-git',
  'palette:preferences-accessibility',
  'palette:ollama-model-manager',
  'palette:preferences-copilot',
  'palette:background-queue',
  'palette:notification-history',
  'palette:notification-automations',
  'palette:copy-repo-path',
  'palette:copy-branch-name',
  'palette:copy-commit-sha',
]

const CommandPaletteUiKeys = [
  'commandPalette.title',
  'commandPalette.searchPlaceholder',
  'commandPalette.searchLabel',
  'commandPalette.commands',
  'commandPalette.noMatches',
  'commandPalette.searchTerms',
  'commandPalette.customizeAppearance',
  'commandPalette.appearanceDialog',
  'commandPalette.appearanceHeading',
  'commandPalette.rowDensity',
  'commandPalette.comfortable',
  'commandPalette.comfortableDescription',
  'commandPalette.compact',
  'commandPalette.compactDescription',
  'commandPalette.showInEachRow',
  'commandPalette.icons',
  'commandPalette.groupChips',
  'commandPalette.keywordLine',
  'commandPalette.resetDefaults',
  'commandPalette.groupApp',
  'commandPalette.groupBranch',
  'commandPalette.groupChanges',
  'commandPalette.groupEdit',
  'commandPalette.groupNavigate',
  'commandPalette.groupRepository',
] as const

describe('command palette catalog', () => {
  it('assigns every command a unique event and a titled group', () => {
    const events = CommandPaletteCatalog.map(command => command.event)
    assert.equal(new Set(events).size, events.length)
    for (const command of CommandPaletteCatalog) {
      assert.ok(command.title.length > 0, command.event)
      assert.ok(command.group.length > 0, command.event)
    }
  })

  it('covers the flagship app functions', () => {
    const events = new Set(CommandPaletteCatalog.map(c => c.event))
    for (const required of [
      'push',
      'pull',
      'fetch',
      'clone-repository',
      'create-branch',
      'create-worktree',
      'show-preferences',
      'show-repository-tools',
      'view-log-history',
      'palette:find-in-view',
    ]) {
      assert.ok(events.has(required), required)
    }
  })

  it('ranks title prefixes above substrings above keyword matches', () => {
    const matches = filterPaletteCommands(CommandPaletteCatalog, 'pu')
    assert.equal(matches[0]?.event, 'push')
    assert.equal(matches[1]?.event, 'pull')

    const worktree = filterPaletteCommands(CommandPaletteCatalog, 'worktree')
    assert.ok(worktree.length >= 2)
    assert.ok(
      worktree.findIndex(c => c.event === 'create-worktree') < worktree.length
    )

    const keyword = filterPaletteCommands(CommandPaletteCatalog, 'docker')
    assert.equal(keyword[0]?.event, 'build-and-run')
  })

  it('filters platform-restricted commands', () => {
    const win = filterPaletteCommands(
      CommandPaletteCatalog,
      'command line',
      'win32'
    )
    assert.ok(win.some(c => c.event === 'install-windows-cli'))
    assert.ok(!win.some(c => c.event === 'install-darwin-cli'))

    const mac = filterPaletteCommands(
      CommandPaletteCatalog,
      'command line',
      'darwin'
    )
    assert.ok(mac.some(c => c.event === 'install-darwin-cli'))
    assert.ok(!mac.some(c => c.event === 'install-windows-cli'))
  })

  it('returns the full platform-eligible catalog for an empty query', () => {
    const all = filterPaletteCommands(CommandPaletteCatalog, '', 'win32')
    assert.ok(all.length >= 55)
    assert.ok(!all.some(c => c.platform === 'darwin'))
  })

  it('registers every newly added command exactly once', () => {
    const events = CommandPaletteCatalog.map(c => c.event)
    const set = new Set(events)
    assert.equal(set.size, events.length)
    for (const event of NewCommandEvents) {
      assert.ok(set.has(event), event)
    }
  })

  it('localizes new command titles in all three language modes', () => {
    for (const command of CommandPaletteCatalog) {
      if (command.titleKey === undefined) {
        continue
      }
      for (const mode of languageModes) {
        const title = translate(command.titleKey, mode)
        assert.ok(
          title.trim().length > 0,
          `${command.event} has an empty ${mode} title`
        )
      }
      // The bilingual view must surface both languages, not one repeated.
      const english = translate(command.titleKey, 'english')
      const cantonese = translate(command.titleKey, 'cantonese')
      const bilingual = translate(command.titleKey, 'bilingual')
      assert.ok(bilingual.includes(english), command.event)
      assert.ok(bilingual.includes(cantonese), command.event)
    }
  })

  it('localizes the visible row and appearance controls in all modes', () => {
    for (const key of CommandPaletteUiKeys) {
      const english = translate(key, 'english', { terms: 'push clone' })
      const cantonese = translate(key, 'cantonese', { terms: 'push clone' })
      const bilingual = translate(key, 'bilingual', { terms: 'push clone' })
      assert.ok(english.trim().length > 0, `${key} has no English copy`)
      assert.ok(cantonese.trim().length > 0, `${key} has no Cantonese copy`)
      assert.ok(bilingual.includes(english), key)
      assert.ok(bilingual.includes(cantonese), key)
    }
  })

  it('gives every new command a non-empty group and keywords', () => {
    const byEvent = new Map(CommandPaletteCatalog.map(c => [c.event, c]))
    for (const event of NewCommandEvents) {
      const command = byEvent.get(event)
      assert.ok(command, event)
      assert.ok(command!.group.length > 0, event)
      assert.ok((command!.keywords ?? '').length > 0, event)
    }
  })

  it('hides repository/branch commands when nothing is selected', () => {
    const idle = new Set(
      filterPaletteCommands(
        CommandPaletteCatalog,
        '',
        'win32',
        emptyContext
      ).map(c => c.event)
    )
    for (const gated of [
      'palette:copy-repo-path',
      'palette:copy-branch-name',
      'palette:copy-commit-sha',
    ]) {
      assert.ok(!idle.has(gated), gated)
    }
    // Commands with no predicate remain available with nothing selected.
    assert.ok(idle.has('palette:toggle-theme'))
    assert.ok(idle.has('palette:preferences-appearance'))
  })

  it('reveals repository commands only once a repository is selected', () => {
    const repoOnly = new Set(
      filterPaletteCommands(
        CommandPaletteCatalog,
        '',
        'win32',
        repositoryContext
      ).map(c => c.event)
    )
    assert.ok(repoOnly.has('palette:copy-repo-path'))
    // Branch-scoped commands stay hidden without a valid branch.
    assert.ok(!repoOnly.has('palette:copy-branch-name'))
    assert.ok(!repoOnly.has('palette:copy-commit-sha'))

    const onBranch = new Set(
      filterPaletteCommands(
        CommandPaletteCatalog,
        '',
        'win32',
        branchContext
      ).map(c => c.event)
    )
    assert.ok(onBranch.has('palette:copy-branch-name'))
    assert.ok(onBranch.has('palette:copy-commit-sha'))
  })

  it('dispatches the exact event id for each match via a fake executor', () => {
    const executed: string[] = []
    const onExecute = (event: string) => executed.push(event)

    const matches = filterPaletteCommands(
      CommandPaletteCatalog,
      'preferences',
      'win32',
      branchContext
    )
    assert.ok(matches.length > 0)
    for (const command of matches) {
      onExecute(command.event)
    }

    assert.deepEqual(
      executed,
      matches.map(c => c.event)
    )
    assert.ok(executed.includes('palette:preferences-accounts'))
  })
})
