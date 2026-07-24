import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getNarrationEvent,
  narrationEventIdForKind,
  narrationLocalesForMode,
  RuntimeNarrationEventIds,
} from '../../src/lib/audio/narration-assets'
import { NotificationCentreKind } from '../../src/models/notification-centre'

const root = process.cwd()
const audioDir = join(root, 'app', 'static', 'audio')

interface IRawVoice {
  readonly file?: unknown
}
interface IRawEvent {
  readonly id?: unknown
  readonly category?: unknown
  readonly en?: IRawVoice
  readonly yue?: IRawVoice
  readonly melody?: unknown
}
interface IRawManifest {
  readonly events?: ReadonlyArray<IRawEvent>
}

const manifest = JSON.parse(
  readFileSync(join(audioDir, 'manifest.json'), 'utf8')
) as IRawManifest

const events = manifest.events ?? []

function assetExists(file: unknown): boolean {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    existsSync(join(audioDir, file))
  )
}

describe('narration asset manifest completeness', () => {
  it('lists a non-empty set of events', () => {
    assert.ok(Array.isArray(events) && events.length > 0)
  })

  it('has all three files on disk for every event id', () => {
    for (const event of events) {
      const id = event.id
      assert.ok(typeof id === 'string' && id.length > 0, 'event missing id')

      assert.ok(
        assetExists(event.en?.file),
        `English clip missing on disk for ${String(id)} (${String(
          event.en?.file
        )})`
      )
      assert.ok(
        assetExists(event.yue?.file),
        `Cantonese clip missing on disk for ${String(id)} (${String(
          event.yue?.file
        )})`
      )
      assert.ok(
        assetExists(event.melody),
        `Melody missing on disk for ${String(id)} (${String(event.melody)})`
      )
    }
  })

  it('uses unique event ids', () => {
    const ids = events.map(event => event.id)
    assert.strictEqual(new Set(ids).size, ids.length)
  })

  it('exposes every runtime-narrated event id in the manifest with assets', () => {
    const ids = new Set(events.map(event => event.id))
    assert.ok(RuntimeNarrationEventIds.length > 0)
    for (const id of RuntimeNarrationEventIds) {
      assert.ok(ids.has(id), `runtime event id "${id}" is absent from manifest`)

      // The parsed module view must agree with the on-disk manifest and files.
      const event = getNarrationEvent(id)
      assert.ok(event !== null, `getNarrationEvent("${id}") returned null`)
      assert.ok(assetExists(event!.en.file), `${id}: en clip missing`)
      assert.ok(assetExists(event!.yue.file), `${id}: yue clip missing`)
      assert.ok(
        event!.melody !== null && assetExists(event!.melody),
        `${id}: melody missing`
      )
    }
  })

  it('maps notification kinds to manifest event ids that exist', () => {
    const ids = new Set(events.map(event => event.id))
    const narratedKinds: ReadonlyArray<NotificationCentreKind> = [
      'auto-commit',
      'auto-pull',
      'merge-all',
      'clone-batch',
      'cheap-lfs',
    ]
    for (const kind of narratedKinds) {
      const id = narrationEventIdForKind(kind)
      assert.ok(id !== null, `${kind} should narrate a recorded event`)
      assert.ok(ids.has(id!), `${kind} -> "${id}" is absent from manifest`)
    }

    // Generic app errors have no specific recording, so they fall back to the
    // category-based live narrator rather than a misleading canned line.
    assert.strictEqual(narrationEventIdForKind('app-error'), null)
    assert.strictEqual(narrationEventIdForKind('info'), null)
  })
})

describe('narration language selection', () => {
  it('resolves the active narration locales per language mode', () => {
    assert.deepStrictEqual(narrationLocalesForMode('english'), ['en'])
    assert.deepStrictEqual(narrationLocalesForMode('cantonese'), ['yue'])
    // Bilingual speaks English first, then Cantonese, strictly serialized.
    assert.deepStrictEqual(narrationLocalesForMode('bilingual'), ['en', 'yue'])
  })
})
