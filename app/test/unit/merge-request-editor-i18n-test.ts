import assert from 'node:assert'
import { describe, it } from 'node:test'
import { translate, type TranslationKey } from '../../src/lib/i18n'
import {
  cantoneseTranslations,
  englishTranslations,
} from '../../src/lib/i18n-resources'

const prefixes = ['mrEditor.', 'mrLifecycle.'] as const

function contractKeys(catalog: Readonly<Record<string, string>>): string[] {
  return Object.keys(catalog)
    .filter(key => prefixes.some(prefix => key.startsWith(prefix)))
    .sort()
}

describe('merge request workspace internationalization', () => {
  it('keeps every editor and lifecycle key complete in English and Cantonese', () => {
    const englishKeys = contractKeys(englishTranslations)
    const cantoneseKeys = contractKeys(cantoneseTranslations)
    assert.deepStrictEqual(cantoneseKeys, englishKeys)
    assert.ok(englishKeys.length >= 140)

    for (const key of englishKeys) {
      const typed = key as TranslationKey
      assert.notStrictEqual(englishTranslations[typed], '', key)
      assert.notStrictEqual(cantoneseTranslations[typed], '', key)
    }
    assert.ok(
      englishKeys.filter(key => {
        const typed = key as TranslationKey
        return englishTranslations[typed] !== cantoneseTranslations[typed]
      }).length >= 130
    )
  })

  it('renders representative English, Hong Kong Cantonese, and bilingual text', () => {
    assert.strictEqual(
      translate('mrEditor.sourceEditLocked', 'english'),
      'GitLab does not support changing the source branch after creation.'
    )
    assert.strictEqual(
      translate('mrLifecycle.approve', 'cantonese'),
      '批准目前 HEAD'
    )
    assert.strictEqual(
      translate('mrLifecycle.title', 'bilingual'),
      'Merge request lifecycle · Merge request 生命週期'
    )
    assert.strictEqual(
      translate('mrLifecycle.approvalProgress', 'cantonese', {
        approved: '1',
        required: '2',
      }),
      '必要批准已完成 1/2'
    )
  })
})
