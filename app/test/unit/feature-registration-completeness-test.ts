import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function enumMembers(source: string, name: string): Array<string> {
  const body = source.match(
    new RegExp(`export enum ${name}\\s*\\{([\\s\\S]*?)\\n\\}`)
  )?.[1]
  assert.ok(body, `Could not find enum ${name}`)

  return [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:=.*)?,$/gm)].map(
    match => match[1]
  )
}

function uniqueMatches(source: string, expression: RegExp): Array<string> {
  return [...new Set([...source.matchAll(expression)].map(match => match[1]))]
}

describe('public feature registration completeness', () => {
  it('renders every registered popup type', () => {
    const registered = enumMembers(
      read('app/src/models/popup.ts'),
      'PopupType'
    ).sort()
    const rendered = uniqueMatches(
      read('app/src/ui/app.tsx'),
      /case PopupType\.([A-Za-z][A-Za-z0-9_]*):/g
    ).sort()

    assert.deepEqual(rendered, registered)
  })

  it('exposes and renders every Preferences tab', () => {
    const registered = enumMembers(
      read('app/src/models/preferences.ts'),
      'PreferencesTab'
    )
    const preferences = read('app/src/ui/preferences/preferences.tsx')

    for (const tab of registered) {
      assert.match(
        preferences,
        new RegExp(`getTabId\\(PreferencesTab\\.${tab}\\)`),
        `${tab} is missing its tab control`
      )
      const cases = preferences.match(
        new RegExp(`case PreferencesTab\\.${tab}:`, 'g')
      )
      assert.ok(
        cases !== null && cases.length >= 2,
        `${tab} is missing its title or content renderer`
      )
    }
  })

  it('registers and renders every repository section', () => {
    const registered = enumMembers(
      read('app/src/lib/app-state.ts'),
      'RepositorySectionTab'
    )
    const navigation = read('app/src/ui/repository-sections.ts')
    const repository = read('app/src/ui/repository.tsx')

    for (const section of registered) {
      const expression = new RegExp(`RepositorySectionTab\\.${section}\\b`)
      assert.match(
        navigation,
        expression,
        `${section} is missing from the rail`
      )
      assert.match(
        repository,
        expression,
        `${section} is missing from the repository renderer`
      )
    }
  })

  it('defines and executes every public agent command', () => {
    const contract = read('app/src/lib/agent-commands.ts')
    const executor = read('app/src/lib/agent-command-executor.ts')
    const typeBody = contract.match(
      /export type AgentCommandName\s*=([\s\S]*?)\r?\n\r?\nexport interface/
    )?.[1]
    assert.ok(typeBody, 'Could not find AgentCommandName')

    const registered = uniqueMatches(typeBody, /'([^']+)'/g).sort()
    const tools = uniqueMatches(contract, /\n\s*name: '([^']+)'/g).sort()
    const implemented = uniqueMatches(executor, /case '([^']+)':/g).sort()

    assert.deepEqual(tools, registered)
    assert.deepEqual(implemented, registered)
  })

  it('keeps all M0-M19 implementation paths present in the checkout', () => {
    const plan = read('PLAN.md')
    const milestoneRows = plan
      .split(/\r?\n/)
      .filter(line => /^\| \*\*M(?:[0-9]|1[0-9])\b/.test(line))

    assert.equal(milestoneRows.length, 20)
    for (const [index, row] of milestoneRows.entries()) {
      assert.match(row, /\| \*\*COMPLETE\*\* \|/)
      const cells = row.split('|')
      const implementationCell = cells[cells.length - 2]
      const paths = [...implementationCell.matchAll(/`([^`]+)`/g)].map(
        match => match[1]
      )
      assert.ok(paths.length > 0, `M${index} has no implementation paths`)
      for (const path of paths) {
        assert.ok(existsSync(join(root, path)), `${path} does not exist`)
      }
    }
  })
})
