import assert from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it } from 'node:test'
import { parseBatchCloneJournal } from '../../src/lib/stores/batch-clone-journal'

interface IFixtureOptions {
  readonly runRoot: string
  readonly userDataPath: string
  readonly destinationRoot: string
}

interface IFixtureSeeder {
  readonly FixtureItemCount: number
  readonly parseArguments: (argv: ReadonlyArray<string>) => IFixtureOptions
  readonly seedBatchCloneRecoveryFixture: (options: IFixtureOptions) => {
    readonly journalPath: string
    readonly itemCount: number
    readonly paused: boolean
    readonly statuses: ReadonlyArray<string>
    readonly sha256: string
  }
}

const fixtureSeeder =
  require('../../../.codex/verification/seed_batch_clone_recovery_fixture.js') as IFixtureSeeder

function makeFixtureRoot() {
  const runRoot = mkdtempSync(
    join(tmpdir(), 'desktop-material-p0-ui-fixture-test-')
  )
  const userDataPath = join(runRoot, 'profile')
  const destinationRoot = join(runRoot, 'batch-clone-destinations')
  mkdirSync(userDataPath)
  mkdirSync(destinationRoot)
  return { runRoot, userDataPath, destinationRoot }
}

describe('responsive batch-clone recovery fixture', () => {
  it('writes one valid, credential-free v2 paused/interrupted journal', () => {
    const fixture = makeFixtureRoot()
    try {
      const options = fixtureSeeder.parseArguments([
        '--run-root',
        fixture.runRoot,
        '--user-data-path',
        fixture.userDataPath,
        '--destination-root',
        fixture.destinationRoot,
      ])
      const receipt = fixtureSeeder.seedBatchCloneRecoveryFixture(options)
      assert.equal(receipt.itemCount, fixtureSeeder.FixtureItemCount)
      assert.equal(receipt.paused, true)
      assert.deepEqual(receipt.statuses, ['interrupted'])
      assert.match(receipt.sha256, /^[a-f\d]{64}$/)

      const raw = readFileSync(receipt.journalPath, 'utf8')
      assert.doesNotMatch(
        raw,
        /"(?:accountKey|token|password|authorization|credential)"\s*:/i
      )
      assert.doesNotMatch(raw, /https?:\/\/[^/\s@]+@/i)
      const parsed = parseBatchCloneJournal(raw)
      assert.notEqual(parsed, null)
      assert.equal(parsed?.version, 2)
      assert.equal(parsed?.paused, true)
      assert.equal(parsed?.source, 'manual')
      assert.equal(parsed?.items.length, fixtureSeeder.FixtureItemCount)
      assert.ok(
        parsed?.items.every(
          item =>
            /^[a-f\d]{48}$/.test(item.recoveryId ?? '') &&
            dirname(item.path) === options.destinationRoot
        )
      )
      assert.ok(
        parsed?.statuses.every(([, status]) => status.kind === 'interrupted')
      )
      assert.throws(
        () => fixtureSeeder.seedBatchCloneRecoveryFixture(options),
        /empty|overwrite/
      )
    } finally {
      rmSync(fixture.runRoot, { recursive: true, force: true })
    }
  })

  it('rejects userData paths outside the owned run root', () => {
    const fixture = makeFixtureRoot()
    const outside = mkdtempSync(join(tmpdir(), 'desktop-material-outside-'))
    try {
      assert.throws(
        () =>
          fixtureSeeder.seedBatchCloneRecoveryFixture({
            runRoot: fixture.runRoot,
            userDataPath: outside,
            destinationRoot: fixture.destinationRoot,
          }),
        /inside run-root/
      )
    } finally {
      rmSync(outside, { recursive: true, force: true })
      rmSync(fixture.runRoot, { recursive: true, force: true })
    }
  })
})
