import assert from 'node:assert'
import { describe, it } from 'node:test'
import { SemVer } from 'semver'
import {
  compareReleaseVersions,
  createReleaseVersion,
  selectHighestReleaseTag,
} from './release-version'

describe('release version ordering', () => {
  it('moves every legacy release lane onto one newer Squirrel namespace', () => {
    const candidate = createReleaseVersion('3.6.3-beta3', '29974280506')

    assert.equal(candidate, '3.6.3-beta3-z029974280506')
    for (const legacy of [
      '3.6.3-beta3-b0000000270',
      '3.6.3-beta3-b0000040887',
      '3.6.3-beta3-s000000000201',
      '3.6.3-beta3-s000000000301',
    ]) {
      assert.equal(compareReleaseVersions(candidate, legacy), 1)
      assert.ok(new SemVer(candidate).compare(new SemVer(legacy)) > 0)
    }
  })

  it('pads a positive run ID without changing rerun identity', () => {
    assert.equal(
      createReleaseVersion('3.6.3-beta3', '1'),
      '3.6.3-beta3-z000000000001'
    )
    assert.equal(
      createReleaseVersion('3.6.3-beta3', '29974280506'),
      createReleaseVersion('3.6.3-beta3', '29974280506')
    )
    assert.equal(
      compareReleaseVersions(
        createReleaseVersion('3.6.3-beta3', '999999999999'),
        createReleaseVersion('3.6.3-beta3', '29974280506')
      ),
      1
    )
  })

  it('fails closed on unsafe IDs and package bases', () => {
    for (const runId of ['', '0', '01', '-1', '1.5', 'abc', '1000000000000']) {
      assert.throws(() => createReleaseVersion('3.6.3-beta3', runId))
    }

    assert.throws(() => createReleaseVersion('3.6.3', '1'))
    assert.throws(() => createReleaseVersion('3.6.3-extra-long-channel', '1'))
  })

  it('selects the greatest valid same-source release regardless of finish order', () => {
    assert.equal(
      selectHighestReleaseTag([
        'v3.6.3-beta3-z029974280508',
        'v3.6.3-beta3-s000000000301',
        'v3.6.3-beta3-z029974280506',
        'v3.6.3-beta3-z029974280507',
      ]),
      'v3.6.3-beta3-z029974280508'
    )
    assert.throws(() => selectHighestReleaseTag([]))
    assert.throws(() => selectHighestReleaseTag(['not-a-release']))
  })
})
