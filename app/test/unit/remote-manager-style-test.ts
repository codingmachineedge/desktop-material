import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(
    process.cwd(),
    'app',
    'styles',
    'ui',
    'dialogs',
    '_repository-settings.scss'
  ),
  'utf8'
)
const settings = readFileSync(
  join(
    process.cwd(),
    'app',
    'src',
    'ui',
    'repository-settings',
    'repository-settings.tsx'
  ),
  'utf8'
)

describe('Remote Manager integration styles', () => {
  it('bounds horizontal layout and collapses controls at compact widths', () => {
    assert.match(styles, /\.remotes-manager[\s\S]*overflow-x: hidden/)
    assert.match(
      styles,
      /\.remote-fields[\s\S]*grid-template-columns: repeat\([\s\S]*minmax\(min\(100%, 180px\), 1fr\)/
    )
    assert.match(
      styles,
      /\.remote-name-input,[\s\S]*\.remote-default-help[\s\S]*grid-column: 1/
    )
    assert.match(
      styles,
      /@container repository-settings-pane \(max-width: 620px\)[\s\S]*\.remote-row[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*\.remote-fields[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /\.remote-name-input,[\s\S]*\.remote-fetch-url,[\s\S]*\.remote-push-url[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: normal;/
    )
    assert.doesNotMatch(
      styles,
      /\.remote-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) 40px/
    )
  })

  it('gates Save on confirmation and uses the coordinated guarded plan', () => {
    assert.match(
      settings,
      /remoteManagementDirty[\s\S]*remoteManagementPlan === null/
    )
    assert.match(settings, /dispatcher\.applyRemoteManagementPlan/)
    assert.doesNotMatch(settings, /diffRemotes\(/)
  })
})
