import assert from 'node:assert'
import { describe, it } from 'node:test'
import { normalizeLocale, translate } from '../../src/lib/i18n'

describe('recent UI internationalization', () => {
  it('normalizes Traditional and Simplified Chinese locale variants', () => {
    assert.equal(normalizeLocale('zh-HK'), 'zh-HK')
    assert.equal(normalizeLocale('zh_TW'), 'zh-HK')
    assert.equal(normalizeLocale('zh-CN'), 'zh-CN')
    assert.equal(normalizeLocale('zh-SG'), 'zh-CN')
    assert.equal(normalizeLocale('fr-CA'), 'en')
  })

  it('translates and interpolates CI status text', () => {
    assert.equal(
      translate('ci.status', 'zh-HK', {
        status: translate('ci.successful', 'zh-HK'),
      }),
      'CI 檢查：成功'
    )
    assert.equal(
      translate('ci.status', 'zh-CN', {
        status: translate('ci.failed', 'zh-CN'),
      }),
      'CI 检查：失败'
    )
  })

  it('translates the updater and appearance controls with English fallback', () => {
    assert.equal(
      translate('update.downloadingLabel', 'zh-TW'),
      '正在下載應用程式更新'
    )
    assert.equal(
      translate('appearance.updateProgressColor', 'zh-CN'),
      '更新进度条颜色'
    )
    assert.equal(
      translate('appearance.useAccentColor', 'fr-CA'),
      'Use accent color'
    )
  })
})
