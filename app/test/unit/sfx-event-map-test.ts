import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  AudioCueCategories,
  AudioCueCategory,
} from '../../src/lib/audio/audio-settings'
import type { BuildRunPhase } from '../../src/lib/build-run/types'
import {
  categoryForBuildRunPhase,
  categoryForSfxEvent,
  CategoryMotifs,
  GitAudioOperation,
  IMotifStep,
  MotifFamily,
  motifFamilyForCategory,
  motifForCategory,
} from '../../src/lib/audio/sfx-event-map'

/** Every Build & Run lifecycle phase, so the mapping is proven exhaustively. */
const ALL_BUILD_RUN_PHASES: ReadonlyArray<BuildRunPhase> = [
  'detecting',
  'gitignore',
  'installing',
  'building',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]

const ALL_GIT_OPERATIONS: ReadonlyArray<GitAudioOperation> = [
  'push',
  'pull',
  'fetch',
  'commit',
]

function stepsKey(steps: ReadonlyArray<IMotifStep>): string {
  return steps
    .map(s => `${s.freq}@${s.at}+${s.dur}/${s.type ?? 'sine'}`)
    .join(',')
}

describe('categoryForSfxEvent (git operations)', () => {
  it('maps each git operation to its own distinct category', () => {
    assert.strictEqual(
      categoryForSfxEvent({ kind: 'git', operation: 'push' }),
      'push'
    )
    assert.strictEqual(
      categoryForSfxEvent({ kind: 'git', operation: 'pull' }),
      'pull'
    )
    assert.strictEqual(
      categoryForSfxEvent({ kind: 'git', operation: 'fetch' }),
      'fetch'
    )
    assert.strictEqual(
      categoryForSfxEvent({ kind: 'git', operation: 'commit' }),
      'commit'
    )
  })

  it('gives push, pull and fetch three different categories', () => {
    const categories = ALL_GIT_OPERATIONS.map(operation =>
      categoryForSfxEvent({ kind: 'git', operation })
    )
    assert.strictEqual(new Set(categories).size, ALL_GIT_OPERATIONS.length)
  })
})

describe('categoryForBuildRunPhase', () => {
  it('maps every build-run phase to a category (exhaustive)', () => {
    const expected: Record<BuildRunPhase, AudioCueCategory> = {
      detecting: 'detecting',
      // The renderer-owned prep phase shares the probing progress cue.
      gitignore: 'detecting',
      installing: 'installing',
      building: 'building',
      running: 'running',
      succeeded: 'succeeded',
      failed: 'failed',
      cancelled: 'cancelled',
    }
    for (const phase of ALL_BUILD_RUN_PHASES) {
      assert.strictEqual(
        categoryForBuildRunPhase(phase),
        expected[phase],
        `phase ${phase}`
      )
      assert.strictEqual(
        categoryForSfxEvent({ kind: 'build-run', phase }),
        expected[phase],
        `event for phase ${phase}`
      )
    }
  })

  it('keeps the four active build phases distinct from each other', () => {
    const active: ReadonlyArray<BuildRunPhase> = [
      'detecting',
      'installing',
      'building',
      'running',
    ]
    const categories = active.map(categoryForBuildRunPhase)
    assert.strictEqual(new Set(categories).size, active.length)
  })

  it('keeps terminal phases distinct (succeeded / failed / cancelled)', () => {
    const terminal: ReadonlyArray<BuildRunPhase> = [
      'succeeded',
      'failed',
      'cancelled',
    ]
    const categories = terminal.map(categoryForBuildRunPhase)
    assert.strictEqual(new Set(categories).size, terminal.length)
  })
})

describe('motifFamilyForCategory', () => {
  it('classifies every category into a family (exhaustive over the union)', () => {
    const expected: Record<AudioCueCategory, MotifFamily> = {
      commit: 'success',
      push: 'success',
      pull: 'success',
      fetch: 'success',
      succeeded: 'success',
      success: 'success',
      detecting: 'progress',
      installing: 'progress',
      building: 'progress',
      running: 'progress',
      cancelled: 'warning',
      failed: 'error',
      error: 'error',
      info: 'neutral',
    }
    for (const category of AudioCueCategories) {
      assert.strictEqual(
        motifFamilyForCategory(category),
        expected[category],
        `category ${category}`
      )
    }
  })
})

describe('motifForCategory', () => {
  it('has a non-empty motif for every category', () => {
    for (const category of AudioCueCategories) {
      const motif = motifForCategory(category)
      assert.ok(motif.length > 0, `category ${category} has a motif`)
      for (const step of motif) {
        assert.ok(step.freq > 0, `${category} step frequency is positive`)
        assert.ok(step.dur > 0, `${category} step duration is positive`)
        assert.ok(step.at >= 0, `${category} step offset is non-negative`)
      }
    }
  })

  it('gives every category an audibly distinct motif', () => {
    const keys = AudioCueCategories.map(category =>
      stepsKey(motifForCategory(category))
    )
    assert.strictEqual(
      new Set(keys).size,
      AudioCueCategories.length,
      'no two categories share the exact same motif'
    )
  })

  it('covers exactly the category union — no missing or stray motifs', () => {
    const tableKeys = Object.keys(CategoryMotifs).sort()
    const unionKeys = [...AudioCueCategories].sort()
    assert.deepStrictEqual(tableKeys, unionKeys)
  })

  it('keeps progress cues on the soft triangle timbre', () => {
    for (const category of [
      'detecting',
      'installing',
      'building',
      'running',
    ] as const) {
      for (const step of motifForCategory(category)) {
        assert.strictEqual(
          step.type,
          'triangle',
          `${category} uses the progress timbre`
        )
      }
    }
  })

  it('keeps error-family cues on the heavy sawtooth timbre', () => {
    for (const category of ['error', 'failed'] as const) {
      for (const step of motifForCategory(category)) {
        assert.strictEqual(
          step.type,
          'sawtooth',
          `${category} uses the error timbre`
        )
      }
    }
    // …and the failed build sits lower than the generic error so they differ.
    assert.notStrictEqual(
      stepsKey(motifForCategory('failed')),
      stepsKey(motifForCategory('error'))
    )
  })

  it('gives a completed build a different cue from the generic success', () => {
    assert.notStrictEqual(
      stepsKey(motifForCategory('succeeded')),
      stepsKey(motifForCategory('success'))
    )
  })
})
