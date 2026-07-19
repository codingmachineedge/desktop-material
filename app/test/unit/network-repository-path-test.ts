import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  classifyNetworkRepositoryPath,
  resolveRepositoryInputPath,
} from '../../src/lib/network-repository-path'

describe('network repository paths', () => {
  it('preserves UNC roots and identifies UNC and WSL shares', async () => {
    assert.equal(
      resolveRepositoryInputPath('\\\\server\\team share\\repo'),
      '\\\\server\\team share\\repo'
    )
    assert.equal(
      await classifyNetworkRepositoryPath(
        '\\\\server\\team share\\repo',
        async () => false
      ),
      'unc'
    )
    assert.equal(
      await classifyNetworkRepositoryPath(
        '\\\\wsl.localhost\\Ubuntu\\home\\octo\\repo',
        async () => false
      ),
      'wsl'
    )
  })

  it('probes only a syntactically valid Windows drive root', async () => {
    const probes: string[] = []
    assert.equal(
      await classifyNetworkRepositoryPath('Z:\\team\\repo', async drive => {
        probes.push(drive)
        return drive === 'Z:'
      }),
      'mapped-drive'
    )
    assert.deepEqual(probes, ['Z:'])

    assert.equal(
      await classifyNetworkRepositoryPath('C:\\local\\repo', async () => false),
      null
    )
  })

  it('rejects Windows device paths and controls', () => {
    assert.throws(() => resolveRepositoryInputPath('\\\\?\\C:\\repo'))
    assert.throws(() => resolveRepositoryInputPath('\\\\.\\PIPE\\repo'))
    assert.throws(() => resolveRepositoryInputPath('C:\\bad\0repo'))
  })
})
