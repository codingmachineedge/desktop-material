import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  describeRepositorySignatureGrade,
  getEffectiveRepositorySigningConfig,
  getRepositorySigningConfigToken,
  normalizeRepositorySigningKey,
  parseRepositorySignatureVerification,
  parseRepositorySigningConfig,
  parseRepositorySigningKeyPresence,
  parseRepositorySigningTags,
} from '../../src/lib/repository-signing'

describe('repository signing administration models', () => {
  it('parses only allowlisted local and global settings with local precedence', () => {
    const global = parseRepositorySigningConfig(
      [
        'gpg.format\nopenpgp',
        'commit.gpgsign\nyes',
        'tag.gpgsign\nfalse',
        '',
      ].join('\0'),
      'global',
      true
    )
    const local = parseRepositorySigningConfig(
      ['gpg.format\nssh', 'commit.gpgsign\n0', ''].join('\0'),
      'local'
    )
    const effective = getEffectiveRepositorySigningConfig(local, global)

    assert.equal(effective.format, 'ssh')
    assert.equal(effective.hasSigningKey, true)
    assert.equal(effective.signingKeyScope, 'global')
    assert.equal(effective.commitSigning, false)
    assert.equal(effective.commitSigningScope, 'local')
    assert.equal(effective.tagSigning, false)
    assert.equal(effective.tagSigningScope, 'global')
    assert.equal(
      effective.signingKeyDescription,
      'Configured public signing key (value hidden)'
    )
    assert.equal(
      getRepositorySigningConfigToken(local),
      JSON.stringify(['local', 'ssh', false, null, false, null])
    )
  })

  it('accepts only name-only signing-key presence output', () => {
    assert.equal(parseRepositorySigningKeyPresence(''), false)
    assert.equal(parseRepositorySigningKeyPresence('user.signingkey\0'), true)
    assert.throws(
      () =>
        parseRepositorySigningKeyPresence(
          'user.signingkey\nC:/private/id_ed25519\0'
        ),
      /invalid signing-key presence data/
    )
  })

  it('fails closed for unknown, duplicate-shape, oversized, and invalid values', () => {
    assert.throws(
      () => parseRepositorySigningConfig('core.editor\nsecret\0', 'local'),
      /unexpected signing configuration key/
    )
    assert.throws(
      () => parseRepositorySigningConfig('gpg.format\ncustom\0', 'local'),
      /unsupported signing format/
    )
    assert.throws(
      () => parseRepositorySigningConfig('commit.gpgsign\nperhaps\0', 'local'),
      /invalid commit signing value/
    )
    assert.throws(
      () =>
        parseRepositorySigningConfig(
          'gpg.format\nssh\0gpg.format\nopenpgp\0',
          'local'
        ),
      /duplicate signing configuration values/
    )
    assert.throws(
      () => parseRepositorySigningKeyPresence('a'.repeat(17_000)),
      /invalid signing-key presence data/
    )
    assert.throws(
      () =>
        parseRepositorySigningConfig(
          'gpg.format\nopenpgp\0'.repeat(4_000),
          'local'
        ),
      /too much signing configuration/
    )
  })

  it('normalizes public fingerprints and accepts only inline SSH public keys', () => {
    assert.equal(
      normalizeRepositorySigningKey('openpgp', ' 0x0123456789abcdef '),
      '0123456789ABCDEF'
    )
    assert.equal(
      normalizeRepositorySigningKey('x509', 'abcdef0123456789'),
      'ABCDEF0123456789'
    )
    const ssh = `key::ssh-ed25519 ${Buffer.alloc(32, 7).toString('base64')}`
    assert.equal(normalizeRepositorySigningKey('ssh', ssh), ssh)
    for (const unsafe of [
      'C:/Users/person/.ssh/id_ed25519',
      '../private-key',
      `${ssh} comment@example.com`,
      '-----BEGIN OPENSSH PRIVATE KEY-----',
    ]) {
      assert.throws(
        () => normalizeRepositorySigningKey('ssh', unsafe),
        /inline SSH public key/
      )
    }
    assert.throws(
      () => normalizeRepositorySigningKey('openpgp', 'not-a-fingerprint'),
      /hexadecimal fingerprint/
    )
  })

  it('parses bounded annotated tags and rejects unsafe ref output', () => {
    const oid = 'a'.repeat(40)
    assert.deepStrictEqual(
      parseRepositorySigningTags(`v2.0.0\0tag\0${oid}\n`),
      [{ name: 'v2.0.0', object: oid }]
    )
    assert.throws(
      () => parseRepositorySigningTags(`--upload-pack=x\0tag\0${oid}\n`),
      /invalid annotated tag list/
    )
    assert.throws(
      () => parseRepositorySigningTags(`lightweight\0commit\0${oid}\n`),
      /invalid annotated tag list/
    )
    assert.throws(
      () =>
        parseRepositorySigningTags(
          Array.from(
            { length: 101 },
            (_, index) => `tag-${index}\0tag\0${oid}\n`
          ).join('')
        ),
      /too many tags/
    )
    assert.throws(
      () => parseRepositorySigningTags(`bad@{tag\0tag\0${oid}\n`),
      /invalid annotated tag list/
    )
  })

  it('maps every safe verification state without exposing raw verifier output', () => {
    const oid = 'b'.repeat(40)
    const expected = new Map([
      ['G', 'good'],
      ['B', 'bad'],
      ['U', 'good-unknown-validity'],
      ['X', 'expired-signature'],
      ['Y', 'expired-key'],
      ['R', 'revoked-key'],
      ['E', 'cannot-verify'],
      ['N', 'unsigned'],
      ['?', 'unknown'],
    ])
    for (const [grade, parsedGrade] of expected) {
      const parsed = parseRepositorySignatureVerification(
        `${oid}\0${grade}\0ABCDEF0123456789\0ABCDEF01\n`
      )
      assert.equal(parsed.grade, parsedGrade)
      assert.ok(describeRepositorySignatureGrade(parsed.grade).length > 0)
    }
    assert.throws(
      () =>
        parseRepositorySignatureVerification(
          `${oid}\0G\0unsafe value with spaces\0ABCDEF01`
        ),
      /unsafe signature identifier/
    )
  })
})
