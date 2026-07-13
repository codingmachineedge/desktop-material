import { describe, it } from 'node:test'
import assert from 'node:assert'
import { ICLICommandRequest } from '../../src/lib/cli-workbench'

describe('guided CLI command contract', () => {
  it('exposes a named structured recipe instead of renderer argv', () => {
    const request: ICLICommandRequest = {
      id: 'repository-tool-1',
      repositoryPath: 'C:\\work\\repository',
      recipe: {
        kind: 'repository-tool',
        operation: 'status-summary',
      },
      confirmed: false,
    }

    assert.deepStrictEqual(Object.keys(request).sort(), [
      'confirmed',
      'id',
      'recipe',
      'repositoryPath',
    ])
    assert.equal('args' in request, false)
    assert.equal('cwd' in request, false)
    assert.equal('tool' in request, false)
  })
})
