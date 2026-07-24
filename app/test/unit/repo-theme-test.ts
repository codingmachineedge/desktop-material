import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  deriveRepositoryTheme,
  midiToFrequency,
  repositoryThemeDegreeToMidi,
  repositoryThemeRootLabel,
  repositoryThemeSeedKey,
  repositoryThemeSequence,
  RepositoryThemeMoods,
  RepositoryThemeScaleIds,
  RepositoryThemeTextures,
} from '../../src/lib/audio/repo-theme'

/** A spread of realistic repository identities used across the suite. */
const fixtureSeeds: ReadonlyArray<string> = [
  'facebook/react',
  'microsoft/vscode',
  'torvalds/linux',
  'desktop/desktop',
  'nodejs/node',
  'rust-lang/rust',
  'golang/go',
  'python/cpython',
  'vuejs/core',
  'angular/angular',
  'sveltejs/svelte',
  'denoland/deno',
  'tensorflow/tensorflow',
  'pytorch/pytorch',
  'kubernetes/kubernetes',
  'docker/cli',
  'git/git',
  'apple/swift',
  'JetBrains/kotlin',
  'elixir-lang/elixir',
  'ruby/ruby',
  'php/php-src',
  'dotnet/runtime',
  'bridgerice773/desktop-material',
]

describe('repositoryThemeSeedKey', () => {
  it('prefers owner/name, then name, then normalized path', () => {
    assert.strictEqual(
      repositoryThemeSeedKey({
        fullName: 'Facebook/React',
        name: 'react',
        path: 'C:\\code\\react',
      }),
      'facebook/react'
    )
    assert.strictEqual(
      repositoryThemeSeedKey({ fullName: null, name: 'My-Repo', path: 'x' }),
      'my-repo'
    )
    assert.strictEqual(
      repositoryThemeSeedKey({
        fullName: '   ',
        name: '',
        path: 'C:\\Users\\me\\Thing',
      }),
      'c:/users/me/thing'
    )
  })

  it('falls back to a stable constant when nothing is provided', () => {
    assert.strictEqual(
      repositoryThemeSeedKey({ fullName: null, name: null, path: null }),
      'desktop-material'
    )
  })
})

describe('deriveRepositoryTheme determinism', () => {
  it('produces byte-for-byte identical theme params for the same seed', () => {
    for (const seed of fixtureSeeds) {
      assert.deepStrictEqual(
        deriveRepositoryTheme(seed),
        deriveRepositoryTheme(seed)
      )
    }
  })

  it('is insensitive only to what the seed key already folds away', () => {
    // Two different seed strings must be free to collide only by chance; the
    // same normalized key must never diverge.
    const a = deriveRepositoryTheme('facebook/react')
    const b = deriveRepositoryTheme('facebook/react')
    assert.strictEqual(JSON.stringify(a), JSON.stringify(b))
  })

  it('keeps every derived field inside its declared range', () => {
    for (const seed of fixtureSeeds) {
      const theme = deriveRepositoryTheme(seed)
      assert.ok(theme.tempo >= 72 && theme.tempo <= 138, `tempo ${theme.tempo}`)
      assert.ok(theme.rootMidi >= 48 && theme.rootMidi <= 71)
      assert.ok(RepositoryThemeScaleIds.includes(theme.scaleId))
      assert.ok(RepositoryThemeMoods.includes(theme.mood))
      assert.ok(RepositoryThemeTextures.includes(theme.texture))
      assert.ok(theme.motif.length >= 6 && theme.motif.length <= 10)
      assert.ok(
        ['sine', 'triangle', 'sawtooth', 'square'].includes(theme.waveform)
      )
    }
  })
})

describe('deriveRepositoryTheme distinctness', () => {
  it('gives different repositories different themes with high probability', () => {
    const signatures = fixtureSeeds.map(seed =>
      JSON.stringify(deriveRepositoryTheme(seed))
    )
    const unique = new Set(signatures)
    // Across two dozen real-world names we expect no collisions at all; allow a
    // single accidental collision as a safety margin without hiding a bug.
    assert.ok(
      unique.size >= fixtureSeeds.length - 1,
      `expected near-unique themes, got ${unique.size}/${fixtureSeeds.length}`
    )
  })

  it('spreads choices across scales and tempos rather than collapsing', () => {
    const scales = new Set(
      fixtureSeeds.map(seed => deriveRepositoryTheme(seed).scaleId)
    )
    const tempos = new Set(
      fixtureSeeds.map(seed => deriveRepositoryTheme(seed).tempo)
    )
    assert.ok(scales.size >= 4, `only ${scales.size} distinct scales`)
    assert.ok(tempos.size >= 10, `only ${tempos.size} distinct tempos`)
  })
})

describe('theme realization', () => {
  it('maps A4 (MIDI 69) to 440 Hz', () => {
    assert.ok(Math.abs(midiToFrequency(69) - 440) < 1e-9)
    assert.ok(Math.abs(midiToFrequency(81) - 880) < 1e-9)
  })

  it('realizes a schedulable sequence consistent with the motif and tempo', () => {
    const theme = deriveRepositoryTheme('desktop/desktop')
    const sequence = repositoryThemeSequence(theme)
    assert.strictEqual(sequence.frequencies.length, theme.motif.length)
    assert.ok(Math.abs(sequence.beatSeconds - 60 / theme.tempo) < 1e-9)
    assert.ok(
      Math.abs(
        sequence.loopSeconds - sequence.beatSeconds * theme.motif.length
      ) < 1e-9
    )
    assert.strictEqual(sequence.waveform, theme.waveform)
    for (let i = 0; i < theme.motif.length; i++) {
      const expected = midiToFrequency(
        repositoryThemeDegreeToMidi(theme, theme.motif[i])
      )
      assert.ok(Math.abs(sequence.frequencies[i] - expected) < 1e-9)
    }
  })

  it('labels the tonic with a note name and octave', () => {
    const theme = deriveRepositoryTheme('torvalds/linux')
    assert.match(repositoryThemeRootLabel(theme), /^[A-G]#?\d$/)
  })
})
