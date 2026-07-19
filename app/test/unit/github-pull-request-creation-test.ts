import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  getDefaultGitHubPullRequestTitle,
  parseGitHubPullRequestTemplate,
  parseGitHubPullRequestTemplateDirectory,
  parseGitHubPullRequestTemplateFile,
} from '../../src/lib/github-pull-request-creation'

describe('GitHub pull request creation models', () => {
  it('parses only bounded allowlisted frontmatter and preserves the Markdown body', () => {
    const template = parseGitHubPullRequestTemplate({
      path: '.github/PULL_REQUEST_TEMPLATE/feature.md',
      content: [
        '---',
        'name: Feature review',
        'title: Add reviewed feature',
        'reviewers: octocat, reviewer',
        "assignees: ['owner']",
        'labels: ready, ui',
        'milestone: 4',
        'draft: true',
        'unknown: never-interpreted',
        '---',
        '## Summary',
        '',
        'Keep this body.',
      ].join('\n'),
    })

    assert.equal(template.name, 'Feature review')
    assert.equal(template.title, 'Add reviewed feature')
    assert.equal(template.body, '## Summary\n\nKeep this body.')
    assert.equal(template.draft, true)
    assert.deepEqual(template.metadata, {
      reviewers: ['octocat', 'reviewer'],
      assignees: ['owner'],
      labels: ['ready', 'ui'],
      milestone: 4,
    })
    assert.deepEqual(template.warnings, [])
  })

  it('does not evaluate YAML tags, anchors, aliases, or multiline values', () => {
    const template = parseGitHubPullRequestTemplate({
      path: 'pull_request_template.md',
      content: [
        '---',
        'title: !!js/function dangerous()',
        'labels: &labels ready',
        'reviewers: *labels',
        'name: >',
        '---',
        'Safe body',
      ].join('\n'),
    })

    assert.equal(template.name, 'Default')
    assert.equal(template.title, '')
    assert.equal(template.body, 'Safe body')
    assert.deepEqual(template.metadata, {
      reviewers: [],
      assignees: [],
      labels: [],
    })
    assert.ok(template.warnings.length > 0)
  })

  it('requires an exact closing delimiter instead of consuming a body prefix', () => {
    const template = parseGitHubPullRequestTemplate({
      path: 'pull_request_template.md',
      content: [
        '---',
        'title: Hidden',
        '---not-a-boundary',
        'Visible body',
      ].join('\n'),
    })
    assert.equal(template.title, '')
    assert.match(template.body, /title: Hidden/)
    assert.ok(template.warnings.length > 0)
  })

  it('validates directory ownership and exact decoded file sizes', () => {
    assert.deepEqual(
      parseGitHubPullRequestTemplateDirectory(
        [
          {
            type: 'file',
            path: '.github/PULL_REQUEST_TEMPLATE/fix.md',
          },
          {
            type: 'dir',
            path: '.github/PULL_REQUEST_TEMPLATE/nested',
          },
        ],
        '.github/PULL_REQUEST_TEMPLATE'
      ),
      ['.github/PULL_REQUEST_TEMPLATE/fix.md']
    )
    assert.throws(() =>
      parseGitHubPullRequestTemplateDirectory(
        [{ type: 'file', path: 'docs/PULL_REQUEST_TEMPLATE/foreign.md' }],
        '.github/PULL_REQUEST_TEMPLATE'
      )
    )

    const content = 'Template body'
    assert.deepEqual(
      parseGitHubPullRequestTemplateFile(
        {
          type: 'file',
          path: 'pull_request_template.md',
          encoding: 'base64',
          size: Buffer.byteLength(content),
          content: Buffer.from(content).toString('base64'),
        },
        'pull_request_template.md'
      ),
      { path: 'pull_request_template.md', content }
    )
    assert.throws(() =>
      parseGitHubPullRequestTemplateFile(
        {
          type: 'file',
          path: 'pull_request_template.md',
          encoding: 'base64',
          size: 0,
          content: 'A===',
        },
        'pull_request_template.md'
      )
    )
  })

  it('uses a concise branch-derived title default', () => {
    assert.equal(
      getDefaultGitHubPullRequestTitle('feature/add-native-pr'),
      'Add native pr'
    )
  })
})
