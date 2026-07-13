import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  parseCLIWorkbenchVersion,
  parseGitHelpCatalog,
  parseGitHubHelpCatalog,
  parseGitHubReferenceCatalog,
} from '../../src/lib/cli-workbench-catalog'

describe('CLI workbench catalog parsing', () => {
  it('parses Git categories, summaries, and summary-less external commands', () => {
    const entries = parseGitHelpCatalog(`See 'git help <command>' for help

Main Porcelain Commands
   add                     Add file contents to the index
   status                  Show the working tree status

External commands
   lfs
`)

    assert.deepEqual(entries, [
      {
        tool: 'git',
        command: 'add',
        summary: 'Add file contents to the index',
        category: 'Main Porcelain Commands',
      },
      {
        tool: 'git',
        command: 'status',
        summary: 'Show the working tree status',
        category: 'Main Porcelain Commands',
      },
      {
        tool: 'git',
        command: 'lfs',
        summary: '',
        category: 'External commands',
      },
    ])
  })

  it('parses the complete GitHub CLI reference command paths', () => {
    const entries = parseGitHubReferenceCatalog(`# gh reference

## gh issue <command>

Manage issues

### gh issue list [flags]

List issues in a GitHub repository.

### gh issue view {<number> | <url>} [flags]

View an issue.
`)

    assert.deepEqual(entries, [
      {
        tool: 'gh',
        command: 'issue',
        summary: 'Manage issues',
        category: 'Issue',
      },
      {
        tool: 'gh',
        command: 'issue list',
        summary: 'List issues in a GitHub repository.',
        category: 'Issue',
      },
      {
        tool: 'gh',
        command: 'issue view',
        summary: 'View an issue.',
        category: 'Issue',
      },
    ])
  })

  it('falls back to top-level GitHub CLI help tables', () => {
    const entries = parseGitHubHelpCatalog(`CORE COMMANDS
  auth:          Authenticate gh and git with GitHub
  pr:            Manage pull requests

GITHUB ACTIONS COMMANDS
  workflow:      View details about Actions workflows
`)

    assert.deepEqual(entries.map(x => [x.command, x.category]), [
      ['auth', 'Core'],
      ['pr', 'Core'],
      ['workflow', 'Github actions'],
    ])
  })

  it('extracts tool versions without retaining extra output', () => {
    assert.equal(
      parseCLIWorkbenchVersion('git', 'git version 2.55.0.windows.2\n'),
      '2.55.0.windows.2'
    )
    assert.equal(
      parseCLIWorkbenchVersion(
        'gh',
        'gh version 2.96.0 (2026-07-02)\nhttps://example.invalid\n'
      ),
      '2.96.0'
    )
    assert.equal(parseCLIWorkbenchVersion('git', '\r\n'), null)
  })
})
