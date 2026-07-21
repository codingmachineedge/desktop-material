import assert from 'node:assert'
import { describe, it } from 'node:test'
import { translate, TranslationKey } from '../../src/lib/i18n'
import {
  cantoneseTranslations,
  englishTranslations,
} from '../../src/lib/i18n-resources'

const keys: ReadonlyArray<TranslationKey> = [
  'buildRun.providerLabel',
  'buildRun.fixingWithProvider',
  'buildRun.fixWithProvider',
  'buildRun.sendToProvider',
  'buildRun.fixIntroProvider',
  'buildRun.sendIntroProvider',
  'buildRun.checkingCli',
  'buildRun.detectFailedProvider',
  'buildRun.notInstalledCli',
  'buildRun.installingCli',
  'buildRun.authMissingProvider',
  'buildRun.authCommandGuidance',
  'buildRun.promptLabelProvider',
  'buildRun.promptPlaceholderProvider',
  'buildRun.autoApproveProvider',
  'buildRun.autoApproveWarningProvider',
  'buildRun.approvalOnRequestProvider',
  'buildRun.diagnosingProvider',
  'buildRun.verifyingProvider',
  'buildRun.workingProvider',
  'buildRun.preferredProvider',
  'buildRun.offerAgents',
  'buildRun.autoApproveRepositoryProvider',
  'buildRun.installCliAction',
  'buildRun.runCliAction',
  'buildRun.runCliAgainAction',
  'buildRun.offerAgentsHelp',
  'buildRun.autoApproveRepositoryHelp',
  'buildRun.codexInstallSafety',
  'buildRun.opencodeInstallSafety',
]

describe('Codex/OpenCode build-fix internationalization', () => {
  it('defines every new surface in English and Hong Kong Cantonese', () => {
    for (const key of keys) {
      const english = englishTranslations[key]
      const cantonese = cantoneseTranslations[key]
      assert.ok(english.length > 0, key)
      assert.ok(cantonese !== undefined && cantonese.length > 0, key)
      assert.notEqual(english, cantonese, key)
    }
  })

  it('renders compact provider-aware bilingual actions', () => {
    assert.equal(
      translate('buildRun.fixWithProvider', 'bilingual', {
        provider: 'Codex',
      }),
      'Fix with Codex · 用 Codex 修正'
    )
    assert.equal(
      translate('buildRun.sendToProvider', 'bilingual', {
        provider: 'OpenCode',
      }),
      'Send to OpenCode · 傳去 OpenCode'
    )
  })

  it('keeps authentication guidance secret-safe in every mode', () => {
    for (const mode of ['english', 'cantonese', 'bilingual'] as const) {
      const text = translate('buildRun.authCommandGuidance', mode, {
        command: 'codex login',
      })
      assert.match(text, /codex login/)
      assert.ok(!/paste (your )?(api )?key/i.test(text))
    }
  })
})
