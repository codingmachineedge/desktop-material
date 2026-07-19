import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  CustomGitCommandStorageKey,
  loadCustomGitCommandPresets,
  parseCustomGitCommand,
  saveCustomGitCommandPresets,
} from '../../src/lib/custom-git-command'

class MemoryStorage {
  public value: string | null = null
  public getItem(key: string) {
    assert.equal(key, CustomGitCommandStorageKey)
    return this.value
  }
  public setItem(key: string, value: string) {
    assert.equal(key, CustomGitCommandStorageKey)
    this.value = value
  }
}

describe('custom Git command presets', () => {
  it('parses quoted positional arguments into a semantic operation', () => {
    assert.deepEqual(
      parseCustomGitCommand('log', '--oneline --author "Octo Cat" -25'),
      {
        id: 'custom-git-command',
        command: 'log',
        args: ['--oneline', '--author', 'Octo Cat', '-25'],
      }
    )
  })

  it('round-trips validated local presets', () => {
    const storage = new MemoryStorage()
    const presets = [
      {
        id: 'recent-history',
        name: 'Recent history',
        command: 'log',
        arguments: '--oneline -25',
      },
      {
        id: 'review-status',
        name: 'Review status',
        command: 'status',
        arguments: '--short --branch',
      },
    ]

    saveCustomGitCommandPresets(presets, storage)
    assert.deepEqual(loadCustomGitCommandPresets(storage), presets)
  })

  it('drops malformed stored entries and rejects unsafe command boundaries', () => {
    const storage = new MemoryStorage()
    storage.value = JSON.stringify([
      {
        id: 'valid',
        name: 'Valid',
        command: 'status',
        arguments: '--short',
      },
      {
        id: 'unsafe',
        name: 'Unsafe',
        command: 'alias',
        arguments: 'payload',
      },
    ])
    assert.deepEqual(loadCustomGitCommandPresets(storage), [
      {
        id: 'valid',
        name: 'Valid',
        command: 'status',
        arguments: '--short',
      },
    ])
    assert.throws(() => parseCustomGitCommand('alias', 'payload'))
    assert.throws(() => parseCustomGitCommand('log', '--git-dir=../outside'))
    assert.throws(() =>
      parseCustomGitCommand('show', 'https://token@example.test/repo')
    )
    assert.throws(() => parseCustomGitCommand('diff', '../../outside'))
    assert.throws(() => parseCustomGitCommand('status', 'line\nbreak'))
  })
})
