import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

const readSource = (path: string) =>
  readFileSync(resolve(__dirname, '../../..', path), 'utf8')

describe('error presentation shell integration', () => {
  it('loads the error notice styles from the root UI stylesheet', () => {
    const uiStyles = readSource('app/styles/_ui.scss')

    assert.ok(uiStyles.includes("@import 'ui/error-notice-stack';"))
  })

  it('mounts the notice stack once in the application chrome', () => {
    const appSource = readSource('app/src/ui/app.tsx')

    assert.ok(
      appSource.includes(
        "import { ErrorNoticeStack } from './error-notice-stack'"
      )
    )
    assert.match(
      appSource,
      /<ErrorNoticeStack\s+notices=\{this\.state\.errorNotices\}\s+onDismiss=\{this\.onErrorNoticeDismissed\}/
    )
    assert.match(appSource, /onAction=\{this\.onErrorNoticeAction\}/)
    assert.match(
      appSource,
      /onErrorNoticeDismissed = \(id: string\) => \{\s*this\.props\.dispatcher\.dismissErrorNotice\(id\)/
    )
    assert.match(
      appSource,
      /removeRepositoryLock\(\s*action\.repositoryId,\s*notice\.id/
    )
    assert.equal(
      appSource.match(/\{this\.renderErrorNotices\(\)\}/g)?.length,
      1
    )
  })
})
