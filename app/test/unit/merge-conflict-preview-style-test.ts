import { readFile } from 'fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { join } from 'path'

describe('merge conflict preview responsive styles', () => {
  it('bounds long conflict paths without widening either review surface', async () => {
    const styles = await readFile(
      join(process.cwd(), 'app/styles/ui/_merge-status.scss'),
      'utf8'
    )
    assert.match(
      styles,
      /\.merge-conflict-path-preview\s*\{[^}]*max-width:\s*100%/s
    )
    assert.match(
      styles,
      /\.merge-conflict-path-preview[\s\S]*?ol\s*\{[^}]*overflow-y:\s*auto/s
    )
    assert.match(
      styles,
      /\.merge-conflict-path-preview[\s\S]*?li\s*\{[^}]*overflow-wrap:\s*anywhere/s
    )
  })
})
