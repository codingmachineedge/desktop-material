import assert from 'node:assert'
import { describe, it } from 'node:test'
import { translate, TranslationKey } from '../../src/lib/i18n'
import {
  cantoneseTranslations,
  englishTranslations,
} from '../../src/lib/i18n-resources'

const ollamaManagerTranslationKeys: ReadonlyArray<TranslationKey> = [
  'ollama.manager.openAction',
  'ollama.manager.backAction',
  'ollama.manager.title',
  'ollama.manager.subtitle',
  'ollama.manager.endpoint',
  'ollama.manager.configuredEndpoint',
  'ollama.manager.connected',
  'ollama.manager.unavailable',
  'ollama.manager.checking',
  'ollama.manager.partial',
  'ollama.manager.version',
  'ollama.manager.installed',
  'ollama.manager.running',
  'ollama.manager.refresh',
  'ollama.manager.refreshing',
  'ollama.manager.searchLabel',
  'ollama.manager.searchPlaceholder',
  'ollama.manager.scopeLabel',
  'ollama.manager.allModels',
  'ollama.manager.runningModels',
  'ollama.manager.inventoryLabel',
  'ollama.manager.loadingInventory',
  'ollama.manager.unavailableInventory',
  'ollama.manager.emptyInventory',
  'ollama.manager.emptyFilter',
  'ollama.manager.modelDetails',
  'ollama.manager.selectModel',
  'ollama.manager.loadingDetails',
  'ollama.manager.runningBadge',
  'ollama.manager.size',
  'ollama.manager.modified',
  'ollama.manager.digest',
  'ollama.manager.family',
  'ollama.manager.format',
  'ollama.manager.parameters',
  'ollama.manager.quantization',
  'ollama.manager.capabilities',
  'ollama.manager.license',
  'ollama.manager.noneReported',
  'ollama.manager.runtime',
  'ollama.manager.vram',
  'ollama.manager.context',
  'ollama.manager.expires',
  'ollama.manager.notRunning',
  'ollama.manager.pullTitle',
  'ollama.manager.pullHint',
  'ollama.manager.modelName',
  'ollama.manager.pullPlaceholder',
  'ollama.manager.pull',
  'ollama.manager.pulling',
  'ollama.manager.cancel',
  'ollama.manager.receiving',
  'ollama.manager.copyTitle',
  'ollama.manager.copyHint',
  'ollama.manager.copyDestination',
  'ollama.manager.copy',
  'ollama.manager.renameTitle',
  'ollama.manager.renameHint',
  'ollama.manager.renameDestination',
  'ollama.manager.rename',
  'ollama.manager.load',
  'ollama.manager.unload',
  'ollama.manager.delete',
  'ollama.manager.deleteTitle',
  'ollama.manager.deleteConfirm',
  'ollama.manager.invalidName',
  'ollama.manager.duplicateName',
  'ollama.manager.operationError',
  'ollama.manager.refreshError',
  'ollama.manager.detailsError',
  'ollama.manager.configurationPartial',
  'ollama.manager.renamePartial',
  'ollama.manager.pullCancelled',
  'ollama.manager.chatTitle',
  'ollama.manager.chatHint',
  'ollama.manager.chatModelLabel',
  'ollama.manager.chatPlaceholder',
  'ollama.manager.chatSend',
  'ollama.manager.chatStop',
  'ollama.manager.chatClear',
  'ollama.manager.chatStreaming',
  'ollama.manager.chatEmpty',
  'ollama.manager.chatNoModel',
  'ollama.manager.chatUnsupported',
  'ollama.manager.chatError',
  'ollama.manager.chatYou',
  'ollama.manager.chatAssistant',
  'ollama.manager.chatMessageLabel',
  'ollama.manager.unknown',
  'ollama.manager.never',
  'ollama.manager.showing',
  'ollama.manager.selectedModel',
  'ollama.manager.moreCapabilities',
  'ollama.manager.pullProgress',
  'ollama.manager.pullSucceeded',
  'ollama.manager.copySucceeded',
  'ollama.manager.renameSucceeded',
  'ollama.manager.loadSucceeded',
  'ollama.manager.unloadSucceeded',
  'ollama.manager.deleteSucceeded',
  'ollama.manager.confirmDelete',
]

describe('Ollama model manager internationalization', () => {
  it('keeps the complete manager contract in both catalogs', () => {
    const actualKeys = Object.keys(englishTranslations)
      .filter(key => key.startsWith('ollama.manager.'))
      .sort()
    const expectedKeys = [...ollamaManagerTranslationKeys].sort()

    assert.deepEqual(actualKeys, expectedKeys)
    assert.equal(ollamaManagerTranslationKeys.length, 101)

    for (const key of ollamaManagerTranslationKeys) {
      assert.equal(typeof englishTranslations[key], 'string', key)
      assert.equal(typeof cantoneseTranslations[key], 'string', key)
      assert.notEqual(englishTranslations[key], '', key)
      assert.notEqual(cantoneseTranslations[key], '', key)
    }
  })

  it('renders polished English manager and preference actions', () => {
    assert.equal(
      translate('ollama.manager.title', 'english'),
      'Ollama model manager'
    )
    assert.equal(
      translate('ollama.manager.subtitle', 'english'),
      'Install, inspect, and control models on this Ollama provider.'
    )
    assert.equal(
      translate('ollama.manager.configuredEndpoint', 'english'),
      'Configured endpoint'
    )
    assert.equal(
      translate('ollama.manager.openAction', 'english'),
      'Manage models'
    )
    assert.equal(
      translate('ollama.manager.backAction', 'english'),
      'Back to providers'
    )
  })

  it('renders playful and clear Hong Kong Cantonese', () => {
    assert.equal(
      translate('ollama.manager.title', 'cantonese'),
      'Ollama 模型管理員'
    )
    assert.equal(
      translate('ollama.manager.subtitle', 'cantonese'),
      '安裝、睇資料，同控制呢個 Ollama 供應商上面嘅模型。'
    )
    assert.equal(
      translate('ollama.manager.configuredEndpoint', 'cantonese'),
      '已設定嘅端點'
    )
    assert.equal(
      translate('ollama.manager.unavailableInventory', 'cantonese'),
      '暫時攞唔到模型清單。'
    )
  })

  it('renders compact bilingual manager navigation', () => {
    assert.equal(
      translate('ollama.manager.title', 'bilingual'),
      'Ollama model manager · Ollama 模型管理員'
    )
    assert.equal(
      translate('ollama.manager.backAction', 'bilingual'),
      'Back to providers · 返去供應商'
    )
  })

  it('interpolates counts, names, destinations, and progress', () => {
    assert.equal(
      translate('ollama.manager.showing', 'english', {
        visible: '3',
        total: '8',
      }),
      'Showing 3 of 8 models'
    )
    assert.equal(
      translate('ollama.manager.moreCapabilities', 'cantonese', {
        count: '4',
      }),
      '仲有 4 項'
    )
    assert.equal(
      translate('ollama.manager.pullProgress', 'bilingual', {
        percent: '73',
      }),
      '73% complete · 已完成 73%'
    )
    assert.equal(
      translate('ollama.manager.copySucceeded', 'cantonese', {
        source: 'llama3.2:latest',
        destination: 'demo:copy',
      }),
      '已由 llama3.2:latest 複製去 demo:copy。'
    )
    assert.equal(
      translate('ollama.manager.renameSucceeded', 'english', {
        source: 'demo:old',
        destination: 'demo:new',
      }),
      'Renamed demo:old to demo:new.'
    )
  })

  it('resolves the chat panel strings in all three modes', () => {
    assert.equal(translate('ollama.manager.chatTitle', 'english'), 'Chat')
    assert.equal(translate('ollama.manager.chatSend', 'english'), 'Send')
    assert.equal(translate('ollama.manager.chatStop', 'english'), 'Stop')

    assert.equal(translate('ollama.manager.chatTitle', 'cantonese'), '傾偈')
    assert.equal(translate('ollama.manager.chatSend', 'cantonese'), '傳送')
    assert.equal(
      translate('ollama.manager.chatError', 'cantonese'),
      '未能完成傾偈要求。'
    )

    assert.equal(
      translate('ollama.manager.chatTitle', 'bilingual'),
      'Chat · 傾偈'
    )
    assert.equal(
      translate('ollama.manager.chatModelLabel', 'bilingual'),
      'Chat model · 傾偈模型'
    )
  })

  it('keeps destructive confirmation explicit in all three modes', () => {
    const variables = { name: 'demo · private' }

    assert.equal(
      translate('ollama.manager.confirmDelete', 'english', variables),
      'Delete demo · private from this Ollama endpoint? This cannot be undone.'
    )
    assert.equal(
      translate('ollama.manager.confirmDelete', 'cantonese', variables),
      '要由呢個 Ollama 端點刪除 demo · private 嗎？刪咗冇得返轉頭。'
    )
    assert.equal(
      translate('ollama.manager.confirmDelete', 'bilingual', variables),
      'Delete demo · private from this Ollama endpoint? This cannot be undone. · 要由呢個 Ollama 端點刪除 demo · private 嗎？刪咗冇得返轉頭。'
    )
  })
})
