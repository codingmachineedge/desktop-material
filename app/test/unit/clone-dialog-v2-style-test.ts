import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (...path: string[]) =>
  readFileSync(join(process.cwd(), ...path), 'utf8')

const addRepositoryStyles = read('app', 'styles', 'ui', '_add-repository.scss')
const orgChipStyles = read('app', 'styles', 'ui', '_org-filter-chips.scss')
const cloneDialog = read(
  'app',
  'src',
  'ui',
  'clone-repository',
  'clone-repository.tsx'
)
const orgChips = read(
  'app',
  'src',
  'ui',
  'clone-repository',
  'org-filter-chips.tsx'
)

describe('clone dialog v2 header', () => {
  it('renders a leading icon chip, title and subtitle inside the dialog title', () => {
    assert.match(
      cloneDialog,
      /<span className="clone-dialog-icon-chip" aria-hidden="true">\s*<Octicon symbol=\{octicons\.desktopDownload\} \/>/
    )
    assert.match(cloneDialog, /className="clone-dialog-title-block"/)
    assert.match(cloneDialog, /className="clone-dialog-subtitle"/)
    assert.match(cloneDialog, /title=\{this\.renderDialogTitle\(\)\}/)
  })

  it('scopes the subtitle to the resolved account host and login', () => {
    assert.match(
      cloneDialog,
      /Select any number of repositories from \$\{host\}\/\$\{account\.login\}, then clone them in parallel or one by one/
    )
    assert.match(cloneDialog, /account\.friendlyEndpoint/)
  })

  it('styles the icon chip as a 40x40 radius-14 primary-container tile', () => {
    assert.match(
      addRepositoryStyles,
      /\.clone-dialog-icon-chip\s*\{[\s\S]*?width: 40px;[\s\S]*?height: 40px;[\s\S]*?border-radius: 14px;[\s\S]*?background: var\(--md-sys-color-primary-container\);[\s\S]*?color: var\(--md-sys-color-on-primary-container\);/
    )
  })

  it('renders the subtitle as an 11.5px on-surface-variant line', () => {
    assert.match(
      addRepositoryStyles,
      /\.clone-dialog-subtitle\s*\{[\s\S]*?color: var\(--md-sys-color-on-surface-variant\);[\s\S]*?font-size: 11\.5px;/
    )
  })

  it('lets the header title block lay out as a flex stack', () => {
    assert.match(
      addRepositoryStyles,
      /\.clone-dialog-title-block\s*\{[\s\S]*?flex-direction: column;[\s\S]*?gap: 1px;/
    )
    assert.match(
      addRepositoryStyles,
      /\.dialog-header\s*\{[\s\S]*?h1\s*\{[\s\S]*?display: flex;[\s\S]*?gap: 12px;/
    )
  })
})

describe('clone dialog v2 owner chip row', () => {
  it('precedes the chips with an uppercase Owner eyebrow', () => {
    assert.match(orgChips, /<span className="org-filter-eyebrow">Owner<\/span>/)
    assert.match(
      orgChipStyles,
      /\.org-filter-eyebrow\s*\{[\s\S]*?font-size: 11\.5px;[\s\S]*?font-weight: 700;[\s\S]*?letter-spacing: 0\.06em;[\s\S]*?text-transform: uppercase;/
    )
  })

  it('wraps chips with a 6px gap instead of scrolling sideways', () => {
    assert.match(
      orgChipStyles,
      /\.org-filter-chips\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 6px;/
    )
    assert.doesNotMatch(orgChipStyles, /overflow-x: auto/)
    assert.doesNotMatch(orgChipStyles, /scrollbar-width/)
  })

  it('fills unselected chips with a borderless surface-container-high tone', () => {
    assert.match(
      orgChipStyles,
      /\.org-filter-chip\s*\{[\s\S]*?border: 0;[\s\S]*?background: var\(--md-sys-color-surface-container-high\);/
    )
    assert.doesNotMatch(
      orgChipStyles,
      /\.org-filter-chip\s*\{[\s\S]*?border: 1px solid/
    )
  })

  it('keeps the selected chip on the secondary-container tone', () => {
    assert.match(
      orgChipStyles,
      /&\.selected\s*\{[\s\S]*?color: var\(--md-sys-color-on-secondary-container\);[\s\S]*?background: var\(--md-sys-color-secondary-container\);/
    )
  })
})
