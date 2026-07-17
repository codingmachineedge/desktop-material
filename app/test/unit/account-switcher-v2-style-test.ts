import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

const styles = read('app', 'styles', 'ui', '_account-switcher.scss')
const manifest = read('app', 'styles', '_ui.scss')
const component = read(
  'app',
  'src',
  'ui',
  'account-switcher',
  'account-switcher.tsx'
)
const repository = read('app', 'src', 'ui', 'repository.tsx')

describe('Account switcher v2 styles', () => {
  it('registers the partial in the ui manifest', () => {
    assert.match(manifest, /@import 'ui\/account-switcher';/)
  })

  it('floats bottom-left as a fixed 334px card', () => {
    assert.match(
      styles,
      /\.account-switcher\s*\{[\s\S]*?position: fixed;\s*left: 14px;\s*bottom: 18px;[\s\S]*?width: 334px;/
    )
  })

  it('wears the surface-container-low card treatment at 24px radius with level3 elevation', () => {
    assert.match(
      styles,
      /\.account-switcher\s*\{[\s\S]*?padding: 12px;[\s\S]*?border-radius: 24px;\s*background: var\(--md-sys-color-surface-container-low\);\s*box-shadow: var\(--md-sys-elevation-level3\);/
    )
  })

  it('enters with the dmGrow spring scaled by the motion multiplier', () => {
    assert.match(
      styles,
      /\.account-switcher\s*\{[\s\S]*?animation: dmGrow calc\(420ms \* var\(--mdur\)\) var\(--spring\);/
    )
  })

  it('sets the uppercase micro-label header', () => {
    assert.match(
      styles,
      /\.account-switcher-header\s*\{\s*padding: 6px 10px 8px 10px;\s*color: var\(--md-sys-color-on-surface-variant\);\s*font-size: 11\.5px;\s*font-weight: 700;\s*letter-spacing: 0\.08em;\s*text-transform: uppercase;/
    )
  })

  it('shapes account rows as 16px-radius pills with the prototype inset', () => {
    assert.match(
      styles,
      /\.account-switcher-row\s*\{[\s\S]*?padding: 10px 12px;[\s\S]*?border-radius: 16px;/
    )
  })

  it('staggers account rows in with dmUp', () => {
    assert.match(
      styles,
      /\.account-switcher-row\s*\{[\s\S]*?animation: dmUp calc\(400ms \* var\(--mdur\)\) var\(--spring\) backwards;/
    )
    assert.match(
      styles,
      /@for \$i from 1 through 8\s*\{\s*\.account-switcher-row:nth-child\(#\{\$i \+ 1\}\)\s*\{\s*animation-delay: #\{40 \+ \(\$i - 1\) \* 60\}ms;/
    )
  })

  it('fills the active row with primary-container', () => {
    assert.match(
      styles,
      /&\.active,\s*&\.active:hover\s*\{\s*background: var\(--md-sys-color-primary-container\);/
    )
  })

  it('renders 38px circular initials avatars with a primary-container variant', () => {
    assert.match(
      styles,
      /\.account-switcher-avatar\s*\{[\s\S]*?width: 38px;\s*height: 38px;\s*border-radius: 999px;\s*background: var\(--md-sys-color-secondary-container\);/
    )
    assert.match(
      styles,
      /\.account-switcher-avatar\s*\{[\s\S]*?&\.primary\s*\{\s*background: var\(--md-sys-color-primary-container\);\s*color: var\(--md-sys-color-on-primary-container\);/
    )
  })

  it('pops the active check in primary with dmPop', () => {
    assert.match(
      styles,
      /\.account-switcher-check\s*\{[\s\S]*?color: var\(--md-sys-color-primary\);\s*animation: dmPop 380ms var\(--spring-fast\);/
    )
  })

  it('draws a hairline outline-variant divider before the add action', () => {
    assert.match(
      styles,
      /\.account-switcher-divider\s*\{[\s\S]*?height: 1px;\s*margin: 6px 8px;\s*background: var\(--md-sys-color-outline-variant\);/
    )
  })

  it('styles the add-account action as a 42px primary text row', () => {
    assert.match(
      styles,
      /\.account-switcher-add\s*\{[\s\S]*?height: 42px;[\s\S]*?padding: 0 14px;[\s\S]*?border-radius: 14px;[\s\S]*?color: var\(--md-sys-color-primary\);[\s\S]*?font-weight: 700;/
    )
    assert.match(
      styles,
      /\.account-switcher-add\s*\{[\s\S]*?&:hover\s*\{\s*background: var\(--md-sys-color-surface-container-high\);/
    )
  })

  it('keeps every colour a token reference', () => {
    const declarations = styles
      .split('\n')
      .filter(line =>
        /^\s*(background|color|outline|box-shadow|fill):/.test(line)
      )

    for (const line of declarations) {
      assert.match(
        line,
        /var\(--|transparent|inherit|currentColor|color-mix\(in srgb, var\(--/,
        `expected a token-based colour: ${line.trim()}`
      )
    }
  })
})

describe('Account switcher v2 component contract', () => {
  it('presents as a dialog labelled by its Accounts header', () => {
    assert.match(component, /role="dialog"/)
    assert.match(component, /aria-labelledby="account-switcher-header"/)
    assert.match(component, /Accounts · \{host\}/)
  })

  it('focuses the first row when it opens', () => {
    assert.match(
      component,
      /public componentDidMount\(\)\s*\{[\s\S]*?this\.firstItemRef\.current\?\.focus\(\)/
    )
    assert.match(
      component,
      /ref=\{index === 0 \? this\.firstItemRef : undefined\}/
    )
  })

  it('closes on Escape and on outside mousedown', () => {
    assert.match(
      component,
      /document\.addEventListener\('keydown', this\.onDocumentKeyDown\)/
    )
    assert.match(
      component,
      /document\.addEventListener\('mousedown', this\.onDocumentMouseDown\)/
    )
    assert.match(
      component,
      /event\.key === 'Escape'[\s\S]*?this\.props\.onClose\(\)/
    )
  })

  it('marks the active row and pops a check-circle octicon on it', () => {
    assert.match(component, /aria-current=\{active \? 'true' : undefined\}/)
    assert.match(
      component,
      /\{active && \([\s\S]*?className="account-switcher-check"[\s\S]*?octicons\.checkCircle/
    )
  })

  it('offers the person-add action row', () => {
    assert.match(
      component,
      /className="account-switcher-add"[\s\S]*?octicons\.personAdd[\s\S]*?Add another account/
    )
  })
})

describe('Account switcher v2 rail wiring', () => {
  it('toggles from the rail avatar button with popup semantics', () => {
    assert.match(
      repository,
      /className="rail-icon-button rail-avatar"\s*onClick=\{this\.onToggleAccountSwitcher\}[\s\S]*?aria-haspopup="dialog"\s*aria-expanded=\{this\.state\.isAccountSwitcherOpen\}/
    )
  })

  it('renders the switcher with the sign-in and accounts-tab fallbacks wired', () => {
    assert.match(
      repository,
      /<AccountSwitcher\s*accounts=\{this\.props\.accounts\}[\s\S]*?onClose=\{this\.onCloseAccountSwitcher\}\s*onSelectAccount=\{this\.onShowAccounts\}\s*onAddAccount=\{this\.onAddAccount\}/
    )
    assert.match(
      repository,
      /private onAddAccount = \(\) => \{\s*this\.props\.dispatcher\.showDotComSignInDialog\(\)/
    )
  })

  it('returns focus to the rail avatar when the switcher closes', () => {
    assert.match(
      repository,
      /private onCloseAccountSwitcher = \(\) => \{\s*this\.setState\(\{ isAccountSwitcherOpen: false \}\)\s*this\.railAvatarButtonRef\.current\?\.focus\(\)/
    )
  })
})
