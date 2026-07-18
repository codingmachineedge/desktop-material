import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  CommandPaletteCatalog,
  filterPaletteCommands,
} from '../../src/lib/command-palette-catalog'

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
})
