import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

const appState = read('app', 'src', 'lib', 'app-state.ts')
const gitStore = read('app', 'src', 'lib', 'stores', 'git-store.ts')
const appStore = read('app', 'src', 'lib', 'stores', 'app-store.ts')
const compare = read('app', 'src', 'ui', 'history', 'compare.tsx')
const styles = read('app', 'styles', 'ui', 'history', '_history.scss')

describe('advanced history scope', () => {
  it('defines a default current-branch scope and an explicit all-refs scope', () => {
    assert.match(appState, /CurrentBranch = 'current-branch'/)
    assert.match(appState, /AllRefs = 'all-refs'/)
  })

  it('loads all-ref pages from branches, remotes, and tags only', () => {
    assert.match(
      gitStore,
      /getCommits\(this\.repository, undefined, CommitBatchSize, skip, \[[\s\S]*?'--branches'[\s\S]*?'--remotes'[\s\S]*?'--tags'[\s\S]*?'--topo-order'/
    )
  })

  it('stale-checks a scope request before replacing visible history', () => {
    assert.match(
      appStore,
      /latest\.formState\.kind !== HistoryTabMode\.History \|\|[\s\S]*?latest\.historyScope !== historyScope/
    )
  })

  it('keeps history-rewriting controls disabled outside the current branch', () => {
    assert.match(
      compare,
      /allowHistoryOps =[\s\S]*?historyScope === HistoryScope\.CurrentBranch[\s\S]*?!isCommitFilterActive/
    )
  })

  it('renders an accessible store-backed scope selector', () => {
    assert.match(
      compare,
      /role="group"[\s\S]*?translateForAccessibleName\([\s\S]*?'history\.scope'/
    )
    assert.match(compare, /translationKey="history\.scope\.currentBranch"/)
    assert.match(compare, /translationKey="history\.scope\.allRefs"/)
    assert.match(
      styles,
      /\.history-scope-control[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?\[aria-pressed='true'\]/
    )
  })
})
