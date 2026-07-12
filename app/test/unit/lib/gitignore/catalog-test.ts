import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as octicons from '../../../../src/ui/octicons/octicons.generated'
import {
  getTemplateById,
  getTemplateCatalog,
} from '../../../../src/lib/gitignore/catalog'

describe('gitignore catalog', () => {
  const catalog = getTemplateCatalog()

  it('is non-empty', () => {
    assert.ok(catalog.length > 0)
  })

  it('has unique ids', () => {
    const ids = catalog.map(t => t.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('resolves every id via getTemplateById', () => {
    for (const template of catalog) {
      assert.strictEqual(getTemplateById(template.id), template)
    }
  })

  it('returns undefined for unknown ids', () => {
    assert.strictEqual(getTemplateById('does-not-exist'), undefined)
  })

  it('carries a non-empty body for every template', () => {
    for (const template of catalog) {
      assert.ok(
        template.body.trim().length > 0,
        `template ${template.id} has an empty body`
      )
    }
  })

  it('produces LF-only bodies (no CRLF)', () => {
    for (const template of catalog) {
      assert.ok(
        !template.body.includes('\r'),
        `template ${template.id} contains CR`
      )
    }
  })

  it('has a non-empty label for every template', () => {
    for (const template of catalog) {
      assert.ok(template.label.trim().length > 0)
    }
  })

  it('references valid octicons', () => {
    for (const template of catalog) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(octicons, template.octicon),
        `template ${template.id} references unknown octicon ${String(
          template.octicon
        )}`
      )
    }
  })

  it('gives every OS-category template a platform', () => {
    for (const template of catalog) {
      if (template.category === 'os') {
        assert.ok(
          template.platform !== undefined,
          `OS template ${template.id} is missing a platform`
        )
      }
    }
  })

  it('only assigns platforms to OS-category templates', () => {
    for (const template of catalog) {
      if (template.platform !== undefined) {
        assert.equal(
          template.category,
          'os',
          `non-OS template ${template.id} has a platform`
        )
      }
    }
  })

  it('uses only known categories', () => {
    const known = new Set(['language', 'framework', 'editor', 'os', 'build'])
    for (const template of catalog) {
      assert.ok(known.has(template.category))
    }
  })
})
