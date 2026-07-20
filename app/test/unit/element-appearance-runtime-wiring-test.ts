import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const readSource = (path: string) =>
  readFile(join(process.cwd(), 'app', 'src', ...path.split('/')), 'utf8')

describe('element appearance runtime wiring', () => {
  it('initializes and flushes element repositories in profile order', async () => {
    const source = await readSource('ui/index.tsx')

    assert.match(
      source,
      /new ElementAppearanceCoordinator\([\s\S]*?profileStore[\s\S]*?\)/
    )
    assert.match(
      source,
      /profileStoreInitialization\.then\(\(\) =>[\s\S]*?elementAppearanceCoordinator\.initialize\(\)[\s\S]*?elementAppearanceCoordinatorInitialization[\s\S]*?repositoryTabsStore\.initialize\(\)/
    )
    assert.match(
      source,
      /name: 'element appearance settings',[\s\S]*?await elementAppearanceCoordinatorInitialization[\s\S]*?await elementAppearanceCoordinator\.flush\(\)/
    )
  })

  it('treats coordinator updates as canonical and rolls failed edits back', async () => {
    const source = await readSource('lib/stores/app-store.ts')

    assert.match(
      source,
      /elementAppearanceCoordinator\?\.onDidUpdate\(state => \{[\s\S]*?appearanceCustomization = state\.appearance[\s\S]*?emitUpdate\(\)/
    )
    assert.match(
      source,
      /_setAppearanceCustomization[\s\S]*?normalizeAppearanceCustomization[\s\S]*?setAppearanceProjection[\s\S]*?catch \(error\)[\s\S]*?getState\(\)[\s\S]*?appearanceCustomization = state\.appearance[\s\S]*?throw appearanceError/
    )
  })
})
