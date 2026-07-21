import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('temporary submodule viewer UI contract', () => {
  it('routes diff actions to temporary navigation rather than repository import', () => {
    const repository = read('app/src/ui/repository.tsx')
    const handler = repository.match(
      /private onOpenSubmodule =[\s\S]*?private onChangeImageDiffType/
    )?.[0]

    assert.ok(handler !== undefined)
    assert.match(handler, /openSubmodulePathAsRepository/)
    assert.doesNotMatch(handler, /openOrAddRepository/)
  })

  it('keeps a visible localized Close action on the temporary viewer banner', () => {
    const app = read('app/src/ui/app.tsx')
    const styles = read('app/styles/ui/_app.scss')

    assert.match(
      app,
      /className="submodule-context-close"[\s\S]*?onClick=\{this\.onReturnToParentRepository\}[\s\S]*?submodule\.closeTemporaryViewer/
    )
    assert.match(
      styles,
      /\.submodule-context-close\.button-component\s*\{[\s\S]*?min-height: 34px;[\s\S]*?border-radius: 999px;/
    )
    assert.match(
      styles,
      /@media \(max-width: 600px\)[\s\S]*?submodule-context-close/
    )
  })
})
