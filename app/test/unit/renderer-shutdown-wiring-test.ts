import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const readSource = (path: string) =>
  readFile(join(process.cwd(), 'app', 'src', ...path.split('/')), 'utf8')

describe('renderer shutdown wiring', () => {
  it('registers every renderer-owned durable store with the coordinator', async () => {
    const source = await readSource('ui/index.tsx')

    assert.match(
      source,
      /name: 'profile settings',[\s\S]*?await profileStoreInitialization[\s\S]*?await profileStore\.flush\(\)/
    )
    assert.match(
      source,
      /name: 'notification centre',[\s\S]*?await notificationCentreStoreInitialization[\s\S]*?await notificationCentreStore\.flush\(\)/
    )
    assert.match(
      source,
      /name: 'clone recovery journal',[\s\S]*?appStore\.flushForShutdown\(\)/
    )
    assert.match(
      source,
      /beforeunload'[\s\S]*?void prepareRendererShutdown\(\)/
    )
  })

  it('awaits the coordinator before normal and update-install quit actions', async () => {
    const [appStore, updateStore] = await Promise.all([
      readSource('lib/stores/app-store.ts'),
      readSource('ui/lib/update-store.ts'),
    ])

    assert.match(
      appStore,
      /async _quitApp[\s\S]*?await runAfterRendererShutdown\(\(\) => \{[\s\S]*?quitApp\(\)/
    )
    assert.match(
      appStore,
      /_cancelQuittingApp[\s\S]*?resetRendererShutdown\(\)[\s\S]*?autoCloneStore\.start\(\)/
    )
    assert.match(
      appStore,
      /flushForShutdown[\s\S]*?autoCloneStore\.stop\(\)[\s\S]*?await this\.batchCloneStore\.requestPause\(\)[\s\S]*?await this\.batchCloneStore\.flush\(\)/
    )
    assert.match(
      updateStore,
      /async quitAndInstallUpdate[\s\S]*?await runAfterRendererShutdown\(\(\) => \{[\s\S]*?sendWillQuitSync\(\)[\s\S]*?quitAndInstallUpdate\(\)/
    )
  })

  it('does not cancel an accepted update quit when its dialog unmounts', async () => {
    const [dialog, dispatcher] = await Promise.all([
      readSource('ui/installing-update/installing-update.tsx'),
      readSource('ui/dispatcher/dispatcher.ts'),
    ])

    assert.match(
      dialog,
      /requestQuit[\s\S]*?this\.quitRequested = true[\s\S]*?await this\.props\.dispatcher\.quitApp\(evenIfUpdating\)/
    )
    assert.match(
      dialog,
      /componentWillUnmount[\s\S]*?if \(!this\.quitRequested\) \{[\s\S]*?cancelQuittingApp\(\)/
    )
    assert.match(
      dialog,
      /onQuitAnywayButtonClicked[\s\S]*?this\.requestQuit\(true\)/
    )
    assert.match(
      dispatcher,
      /quitApp\(evenIfUpdating: boolean\): Promise<void> \{[\s\S]*?return this\.appStore\._quitApp\(evenIfUpdating\)/
    )
  })
})
