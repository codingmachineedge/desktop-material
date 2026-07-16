import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  captureSettingsSnapshot,
  applySettingsSnapshot,
  describeSettingsChange,
} from '../../src/lib/profiles/profile-settings-registry'

/** Minimal in-memory Storage stand-in for the parts the registry uses. */
function createStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

describe('captureSettingsSnapshot', () => {
  it('captures registered keys and ignores unregistered ones', () => {
    const storage = createStorage({
      'tab-size': '2',
      theme: 'dark',
      'underline-links': '1',
      'appearance-customization-v1': '{"version":1}',
      'zoom-factor': '1.25',
      'last-selected-repository-id': '42',
      users: '[secret]',
    })

    const snapshot = captureSettingsSnapshot(storage)

    assert.equal(snapshot['tab-size'], '2')
    assert.equal(snapshot['theme'], 'dark')
    assert.equal(snapshot['underline-links'], '1')
    assert.equal(snapshot['appearance-customization-v1'], '{"version":1}')
    assert.equal(snapshot['zoom-factor'], '1.25')
    assert.equal(snapshot['last-selected-repository-id'], undefined)
    assert.equal(snapshot['users'], undefined)
  })
})

describe('applySettingsSnapshot', () => {
  it('writes registered keys and removes registered keys absent from the snapshot', () => {
    const storage = createStorage({ 'tab-size': '2', 'underline-links': '1' })

    applySettingsSnapshot({ 'tab-size': '8' }, storage)

    assert.equal(storage.getItem('tab-size'), '8')
    assert.equal(storage.getItem('underline-links'), null)
  })

  it('never touches unregistered keys', () => {
    const storage = createStorage({ users: '[secret]' })

    applySettingsSnapshot({ 'tab-size': '4' }, storage)

    assert.equal(storage.getItem('users'), '[secret]')
  })
})

describe('describeSettingsChange', () => {
  it('reports a newly set value', () => {
    assert.deepEqual(describeSettingsChange({}, { 'tab-size': '2' }), [
      'Set tab size',
    ])
  })

  it('reports a changed value', () => {
    assert.deepEqual(
      describeSettingsChange({ 'tab-size': '2' }, { 'tab-size': '8' }),
      ['Change tab size']
    )
  })

  it('reports a reset value', () => {
    assert.deepEqual(describeSettingsChange({ 'tab-size': '2' }, {}), [
      'Reset tab size',
    ])
  })

  it('reports nothing when the snapshots match', () => {
    assert.deepEqual(
      describeSettingsChange({ 'tab-size': '2' }, { 'tab-size': '2' }),
      []
    )
  })
})
