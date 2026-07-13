import { lstat, readFile, readdir } from 'fs/promises'
import { basename } from 'path'

import { Repository } from '../models/repository'
import { resolveSafeRepositoryPath } from './git/worktree-path-guard'
import { GitHubPullRequestBodyMaximumLength } from './github-pull-request'

export const GitHubPullRequestTemplateMaximumCount = 20

export interface IGitHubPullRequestTemplate {
  readonly name: string
  readonly path: string
  readonly body: string
}

const DirectTemplatePaths = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
] as const
const TemplateDirectory = '.github/PULL_REQUEST_TEMPLATE'

function getTemplateName(path: string): string {
  const name = basename(path)
    .replace(/\.(?:md|markdown)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return name.toLowerCase() === 'pull request template' ? 'Default' : name
}

async function readTemplate(
  repositoryPath: string,
  relativePath: string,
  signal?: AbortSignal
): Promise<IGitHubPullRequestTemplate | null> {
  signal?.throwIfAborted()
  try {
    const resolved = await resolveSafeRepositoryPath(
      repositoryPath,
      relativePath,
      signal
    )
    if (!resolved.exists) {
      return null
    }
    const stat = await lstat(resolved.path)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > GitHubPullRequestBodyMaximumLength
    ) {
      return null
    }
    const body = await readFile(resolved.path, 'utf8')
    if (body.length > GitHubPullRequestBodyMaximumLength) {
      return null
    }
    return { name: getTemplateName(relativePath), path: relativePath, body }
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return null
  }
}

/**
 * Read only the conventional local PR-template locations. Every path is
 * physically confined to the worktree and the total count and body size are
 * bounded before any content reaches the renderer.
 */
export async function loadGitHubPullRequestTemplates(
  repository: Repository,
  signal?: AbortSignal
): Promise<ReadonlyArray<IGitHubPullRequestTemplate>> {
  const candidates = new Array<string>(...DirectTemplatePaths)
  try {
    const directory = await resolveSafeRepositoryPath(
      repository.path,
      TemplateDirectory,
      signal
    )
    if (directory.exists) {
      const stat = await lstat(directory.path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        const entries = await readdir(directory.path, { withFileTypes: true })
        for (const entry of entries
          .filter(
            candidate =>
              candidate.isFile() && /\.(?:md|markdown)$/i.test(candidate.name)
          )
          .sort((left, right) => left.name.localeCompare(right.name))
          .slice(0, GitHubPullRequestTemplateMaximumCount)) {
          candidates.push(`${TemplateDirectory}/${entry.name}`)
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
  }

  const templates = new Array<IGitHubPullRequestTemplate>()
  for (const path of candidates.slice(
    0,
    GitHubPullRequestTemplateMaximumCount
  )) {
    const template = await readTemplate(repository.path, path, signal)
    if (template !== null) {
      templates.push(template)
    }
  }
  return templates
}
