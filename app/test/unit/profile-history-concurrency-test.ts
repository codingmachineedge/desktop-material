import './profile-history-test-env'
import assert from 'node:assert'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, TestContext } from 'node:test'

import { git } from '../../src/lib/git/core'
import {
  commitAllChanges,
  ensureProfileRepository,
  getProfileHistoryWithBatchObserverForTesting,
} from '../../src/lib/profiles/profile-git'
import { Repository } from '../../src/models/repository'
import { createTempDirectory } from '../helpers/temp'

const TabId = 'batched-tab-id'
const InitialCommitCount = 101

function fastImportHistory(commitCount: number): string {
  const commands = new Array<string>()
  let previousCommitMark: number | null = null

  for (let index = 0; index < commitCount; index++) {
    const blobMark = index * 2 + 1
    const commitMark = blobMark + 1
    const contents = `${JSON.stringify({
      version: 1,
      tabs: [{ id: TabId, titleStyle: { revision: index } }],
      activeTabId: null,
    })}\n`
    const message = `Tab revision ${index}`
    const timestamp = 1_700_000_000 + index

    commands.push(
      'blob',
      `mark :${blobMark}`,
      `data ${Buffer.byteLength(contents)}`,
      contents,
      'commit refs/heads/main',
      `mark :${commitMark}`,
      `author Desktop Material <desktop-material@localhost> ${timestamp} +0000`,
      `committer Desktop Material <desktop-material@localhost> ${timestamp} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message
    )
    if (previousCommitMark !== null) {
      commands.push(`from :${previousCommitMark}`)
    }
    commands.push(`M 100644 :${blobMark} tabs.json`, '')
    previousCommitMark = commitMark
  }

  commands.push('done', '')
  return commands.join('\n')
}

async function createLongProfileHistory(
  t: TestContext,
  ensureProfileRepository: (path: string) => Promise<Repository>
): Promise<Repository> {
  const repository = await ensureProfileRepository(await createTempDirectory(t))
  await git(
    ['symbolic-ref', 'HEAD', 'refs/heads/main'],
    repository.path,
    'profileHistoryTestBranch'
  )
  await git(
    ['fast-import', '--quiet'],
    repository.path,
    'profileHistoryImport',
    {
      stdin: fastImportHistory(InitialCommitCount),
    }
  )
  await git(['reset', '--hard', 'HEAD'], repository.path, 'profileHistoryReset')
  return repository
}

describe('profile tab history concurrency', () => {
  it('keeps every batch pinned when another window commits mid-traversal', async t => {
    const repository = await createLongProfileHistory(
      t,
      ensureProfileRepository
    )
    let concurrentCommits = 0
    const history = await getProfileHistoryWithBatchObserverForTesting(
      repository,
      0,
      50,
      {
        tabId: TabId,
      },
      async batchIndex => {
        if (batchIndex !== 0) {
          return
        }
        concurrentCommits++
        await writeFile(
          join(repository.path, 'tabs.json'),
          `${JSON.stringify({
            version: 1,
            tabs: [{ id: TabId, titleStyle: { revision: 'concurrent' } }],
            activeTabId: null,
          })}\n`,
          'utf8'
        )
        await commitAllChanges(repository, 'Concurrent tab update')
      }
    )

    assert.equal(concurrentCommits, 1)
    assert.equal(history.total, InitialCommitCount)
    assert.equal(history.entries[0].summary, 'Tab revision 100')
    assert.equal(history.hasMore, true)
    assert.equal(
      (
        await git(
          ['log', '-1', '--format=%s', 'HEAD'],
          repository.path,
          'profileHistoryCurrentSummary'
        )
      ).stdout.trim(),
      'Concurrent tab update'
    )
  })
})
