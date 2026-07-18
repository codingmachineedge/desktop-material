import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  WorkflowTemplates,
  WorkflowTemplateCategories,
  getWorkflowFileName,
  getWorkflowGlyph,
} from '../../src/ui/actions/workflow-templates'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_actions-view.scss'),
  'utf8'
)

const readSource = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'src', 'ui', 'actions', name), 'utf8')

describe('Actions v2 style contracts', () => {
  it('uses design tokens only — no literal colors in the Actions styles', () => {
    assert.doesNotMatch(styles, /#[\da-f]{3,8}\b|rgba?\(/i)
    assert.match(styles, /var\(--md-sys-color-surface\)/)
    assert.match(styles, /var\(--spring\)/)
    assert.match(styles, /var\(--emph\)/)
    assert.match(styles, /dmUp/)
    assert.match(styles, /dmPop/)
  })

  it('renders Actions runs as flat list rows, not grid cards', () => {
    assert.match(
      styles,
      /\.actions-run-card\s*\{[\s\S]*?display: flex;[\s\S]*?border-radius: 14px;[\s\S]*?background: transparent;[\s\S]*?&:hover\s*\{[\s\S]*?border-radius: 18px;[\s\S]*?background: var\(--md-sys-color-surface-container-high\);/
    )
    assert.match(
      styles,
      /\.actions-run-status-icon\s*\{[\s\S]*?&\.success\s*\{[\s\S]*?color: var\(--dm-green\);[\s\S]*?&\.failure\s*\{[\s\S]*?color: var\(--md-sys-color-error\);[\s\S]*?dmSpin/
    )
    assert.match(
      styles,
      /\.actions-run-wf-chip\s*\{[\s\S]*?border-radius: 999px;[\s\S]*?font-family: var\(--font-family-monospace\);[\s\S]*?background: var\(--md-sys-color-surface-container-highest\);/
    )
    const runList = readSource('run-list.tsx')
    assert.match(runList, /actions-run-status-icon/)
    assert.match(runList, /actions-run-wf-chip/)
    assert.match(runList, /getRunStatusGlyph/)
  })

  it('styles the workflow manager as a filled inset card with switch rows', () => {
    assert.match(
      styles,
      /\.actions-workflow-management\s*\{[\s\S]*?min-width: 0;[\s\S]*?flex-direction: column;[\s\S]*?border: 0;[\s\S]*?border-radius: 18px;[\s\S]*?background: var\(--md-sys-color-surface-container-low\);[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      styles,
      /\.actions-workflow-row\s*\{[\s\S]*?border-radius: 12px;[\s\S]*?background: var\(--md-sys-color-surface\);/
    )
    assert.match(
      styles,
      /\.actions-workflow-switch\s*\{[\s\S]*?width: 46px;[\s\S]*?height: 28px;[\s\S]*?&\[aria-checked='true'\]\s*\{[\s\S]*?background: var\(--md-sys-color-primary\);[\s\S]*?translateX\(14px\);/
    )
    const manager = readSource('workflow-manager.tsx')
    assert.match(manager, /role="switch"/)
    assert.match(manager, /aria-checked=\{enabled\}/)
    assert.match(manager, /New workflow/)
  })

  it('restyles the dispatch dialog as the compact chip popover', () => {
    assert.match(
      styles,
      /\.workflow-dispatch-dialog\.workflow-dispatch-popover\s*\{[\s\S]*?width: min\(360px, 100%\);[\s\S]*?border-radius: 24px;[\s\S]*?background: var\(--md-sys-color-surface-container-low\);/
    )
    assert.match(
      styles,
      /\.workflow-dispatch-chip\s*\{[\s\S]*?height: 34px;[\s\S]*?border-radius: 999px;[\s\S]*?font-family: var\(--font-family-monospace\);[\s\S]*?&\.on\s*\{[\s\S]*?color: var\(--md-sys-color-on-primary\);[\s\S]*?background: var\(--md-sys-color-primary\);/
    )
    assert.match(
      styles,
      /\.workflow-dispatch-run-button\s*\{[\s\S]*?height: 42px;[\s\S]*?border-radius: 999px;[\s\S]*?color: var\(--md-sys-color-on-primary\);[\s\S]*?background: var\(--md-sys-color-primary\);/
    )
    const dialog = readSource('workflow-dispatch-dialog.tsx')
    assert.match(dialog, /workflow-dispatch-popover/)
    assert.match(dialog, /workflow-dispatch-chip/)
    assert.match(dialog, /octicons\.play/)
    assert.match(dialog, /Run on ref/)
    assert.match(dialog, /renderInput/)
  })

  it('ships the 830x640 workflow catalog dialog with search and filter chips', () => {
    assert.match(
      styles,
      /\.workflow-catalog-dialog\s*\{[\s\S]*?width: min\(830px, calc\(100vw - 50px\)\);[\s\S]*?height: min\(640px, calc\(100vh - 50px\)\);[\s\S]*?border-radius: 28px;[\s\S]*?box-shadow: var\(--md-sys-elevation-level3\);[\s\S]*?dmDialog/
    )
    assert.match(
      styles,
      /\.workflow-catalog-search\s*\{[\s\S]*?\.actions-search-pill\s*\{[\s\S]*?height: 48px;/
    )
    assert.match(
      styles,
      /\.workflow-catalog-grid\s*\{[\s\S]*?grid-template-columns: 1fr 1fr;/
    )
    assert.match(
      styles,
      /\.workflow-template-card\s*\{[\s\S]*?border-radius: 18px;[\s\S]*?background: var\(--md-sys-color-surface\);/
    )
    assert.match(
      styles,
      /\.workflow-template-added\s*\{[\s\S]*?color: var\(--dm-green\);[\s\S]*?background: var\(--dm-green-container\);/
    )
    const catalog = readSource('workflow-catalog-dialog.tsx')
    assert.match(catalog, /role="dialog"/)
    assert.match(catalog, /aria-modal="true"/)
    assert.match(catalog, /mkdir\(directory, \{ recursive: true \}\)/)
    assert.match(catalog, /writeFile\(filePath, template\.yaml\)/)
    assert.match(catalog, /Use workflow/)
    assert.match(catalog, /Added/)
  })

  it('curates at least eight complete starter workflow templates', () => {
    assert.ok(WorkflowTemplates.length >= 8)
    const ids = new Set(WorkflowTemplates.map(x => x.id))
    assert.equal(ids.size, WorkflowTemplates.length)
    for (const template of WorkflowTemplates) {
      assert.ok(template.name.length > 0)
      assert.match(template.path, /^\.github\/workflows\/[\w.-]+\.yml$/)
      assert.ok(WorkflowTemplateCategories.includes(template.category))
      assert.ok(template.trigger.length > 0)
      assert.ok(template.description.length > 0)
      assert.match(template.yaml, /^name: /)
      assert.match(template.yaml, /\non:/)
      assert.match(template.yaml, /jobs:/)
      assert.ok(template.yaml.endsWith('\n'))
    }
    const names = WorkflowTemplates.map(x => x.name.toLowerCase()).join(' ')
    for (const expected of [
      'node',
      'docker',
      'pages',
      'codeql',
      'stale',
      'release',
      'lint',
      'tests',
    ]) {
      assert.ok(names.includes(expected), `catalog covers ${expected}`)
    }
  })

  it('filters templates through the shared filter-mode control', () => {
    const catalog = readSource('workflow-catalog-dialog.tsx')
    assert.match(catalog, /<FilterModeControl/)
    assert.match(catalog, /matchWithMode/)
    assert.match(catalog, /persistFilterMode\(WorkflowCatalogFilterListId/)
    assert.match(catalog, /regexError !== null/)
    assert.doesNotMatch(catalog, /aria-label="Use regular expression"/)
  })

  it('keeps manager helpers aligned with workflow file paths', () => {
    assert.equal(getWorkflowFileName('.github/workflows/ci.yml'), 'ci.yml')
    assert.equal(getWorkflowFileName('ci.yml'), 'ci.yml')
    assert.ok(getWorkflowGlyph('Docker publish'))
    assert.ok(getWorkflowGlyph('.github/workflows/codeql.yml'))
  })

  it('opens the catalog from the Actions panel workflow manager', () => {
    const view = readSource('actions-view.tsx')
    assert.match(view, /WorkflowCatalogDialog/)
    assert.match(view, /onNewWorkflow=\{this\.openCatalog\}/)
    assert.match(view, /aria-label="Manage workflows"/)
    assert.match(view, /actions-search-pill/)
    assert.match(view, /<FilterModeControl/)
    assert.match(view, /matchWithMode/)
    assert.match(view, /aria-label="Refresh"/)
  })
})
