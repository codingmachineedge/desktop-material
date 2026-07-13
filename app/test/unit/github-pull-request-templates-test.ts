import assert from 'node:assert'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import {
  GitHubPullRequestTemplateMaximumCount,
  loadGitHubPullRequestTemplates,
} from '../../src/lib/github-pull-request-templates'
import { GitHubPullRequestBodyMaximumLength } from '../../src/lib/github-pull-request'
import { Repository } from '../../src/models/repository'
import { createTempDirectory } from '../helpers/temp'

describe('GitHub pull request templates', () => {
  it('loads only bounded conventional Markdown templates in stable order', async t => {
    const path = await createTempDirectory(t)
    assert.equal((await exec(['init'], path)).exitCode, 0)
    await mkdir(join(path, '.github', 'PULL_REQUEST_TEMPLATE'), {
      recursive: true,
    })
    await writeFile(
      join(path, '.github', 'PULL_REQUEST_TEMPLATE.md'),
      'Default body'
    )
    await writeFile(
      join(path, '.github', 'PULL_REQUEST_TEMPLATE', 'bug_fix.md'),
      'Bug body'
    )
    await writeFile(
      join(path, '.github', 'PULL_REQUEST_TEMPLATE', 'feature.markdown'),
      'Feature body'
    )
    await writeFile(
      join(path, '.github', 'PULL_REQUEST_TEMPLATE', 'ignored.txt'),
      'Ignored'
    )

    const templates = await loadGitHubPullRequestTemplates(
      new Repository(path, 1, null, false)
    )
    assert.deepEqual(
      templates.map(template => [template.name, template.body]),
      [
        ['Default', 'Default body'],
        ['bug fix', 'Bug body'],
        ['feature', 'Feature body'],
      ]
    )
    assert.ok(templates.length <= GitHubPullRequestTemplateMaximumCount)
  })

  it('skips oversized template bodies', async t => {
    const path = await createTempDirectory(t)
    assert.equal((await exec(['init'], path)).exitCode, 0)
    await mkdir(join(path, '.github'), { recursive: true })
    await writeFile(
      join(path, '.github', 'PULL_REQUEST_TEMPLATE.md'),
      'x'.repeat(GitHubPullRequestBodyMaximumLength + 1)
    )
    assert.deepEqual(
      await loadGitHubPullRequestTemplates(
        new Repository(path, 1, null, false)
      ),
      []
    )
  })
})
