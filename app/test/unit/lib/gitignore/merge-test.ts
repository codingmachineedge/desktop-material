import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IGitIgnoreTemplate } from '../../../../src/lib/gitignore/catalog'
import {
  applyTemplate,
  getAppliedTemplates,
  removeTemplateSection,
} from '../../../../src/lib/gitignore/merge'

const mkTemplate = (
  id: string,
  label: string,
  body: string
): IGitIgnoreTemplate => ({
  id,
  label,
  category: 'language',
  octicon: 'code',
  body,
})

const node = mkTemplate('node', 'Node', 'node_modules\n*.log')
const python = mkTemplate('python', 'Python', '__pycache__/\n*.pyc')

const trimNl = (s: string) => s.replace(/\n+$/, '')

describe('gitignore merge engine', () => {
  describe('applyTemplate', () => {
    it('seeds a fresh file from null', () => {
      const result = applyTemplate(null, node)
      assert.ok(result.includes('(dm-template:node)'))
      assert.ok(result.includes('node_modules'))
      assert.deepEqual(
        getAppliedTemplates(result).map(a => a.templateId),
        ['node']
      )
    })

    it('preserves hand-written content outside the block', () => {
      const result = applyTemplate('# my rules\nsecret.txt', node)
      assert.ok(result.includes('# my rules'))
      assert.ok(result.includes('secret.txt'))
    })

    it('is idempotent when applied twice (replace, not duplicate)', () => {
      const once = applyTemplate('keep-me', node)
      const twice = applyTemplate(once, node)
      assert.equal(once, twice)
      const beginCount = twice
        .split('\n')
        .filter(l => l.includes('(dm-template:node)')).length
      // one begin marker + one end marker
      assert.equal(beginCount, 2)
    })

    it('replaces the block body when the template changes', () => {
      const first = applyTemplate('keep', node)
      const changed = mkTemplate('node', 'Node', 'dist/\ncoverage/')
      const second = applyTemplate(first, changed)
      assert.ok(second.includes('dist/'))
      assert.ok(!second.includes('node_modules'))
      assert.equal(getAppliedTemplates(second).length, 1)
    })

    it('appends multiple templates in order', () => {
      const result = applyTemplate(applyTemplate('base', node), python)
      assert.deepEqual(
        getAppliedTemplates(result).map(a => a.templateId),
        ['node', 'python']
      )
    })

    it('dedupes hand-written lines already covered by the block', () => {
      const result = applyTemplate('node_modules\nmy-secret', node)
      const dupes = result
        .split('\n')
        .filter(l => l.trim() === 'node_modules').length
      assert.equal(dupes, 1)
      assert.ok(result.includes('my-secret'))
    })

    it('emits LF-only output even from CRLF input', () => {
      const result = applyTemplate('a\r\nb', node)
      assert.ok(!result.includes('\r'))
    })
  })

  describe('removeTemplateSection', () => {
    it('round-trips with applyTemplate (modulo trailing newline)', () => {
      const original = '# my rules\ncustom-secret.txt\ncoverage'
      const applied = applyTemplate(original, node)
      assert.equal(
        trimNl(removeTemplateSection(applied, 'node')),
        trimNl(original)
      )
    })

    it('round-trips from an empty original', () => {
      const applied = applyTemplate('', node)
      assert.equal(removeTemplateSection(applied, 'node'), '')
    })

    it('yields empty string when the last block is removed', () => {
      const applied = applyTemplate(null, node)
      assert.equal(removeTemplateSection(applied, 'node'), '')
    })

    it('removes only the targeted block', () => {
      const both = applyTemplate(applyTemplate('base', node), python)
      const result = removeTemplateSection(both, 'node')
      assert.deepEqual(
        getAppliedTemplates(result).map(a => a.templateId),
        ['python']
      )
      assert.ok(result.includes('base'))
    })

    it('is a no-op for an unknown id', () => {
      const applied = applyTemplate('base', node)
      assert.equal(
        removeTemplateSection(applied, 'unknown'),
        applyTemplate('base', node)
      )
    })
  })

  describe('getAppliedTemplates', () => {
    it('returns an empty list for null', () => {
      assert.deepEqual(getAppliedTemplates(null), [])
    })

    it('returns an empty list for content without blocks', () => {
      assert.deepEqual(getAppliedTemplates('just\nsome\nrules'), [])
    })

    it('parses id and label from the block markers', () => {
      const applied = applyTemplate('base', node)
      assert.deepEqual(getAppliedTemplates(applied), [
        { templateId: 'node', label: 'Node' },
      ])
    })

    it('is CRLF-tolerant', () => {
      const applied = applyTemplate('base', node).replace(/\n/g, '\r\n')
      assert.deepEqual(
        getAppliedTemplates(applied).map(a => a.templateId),
        ['node']
      )
    })
  })
})
