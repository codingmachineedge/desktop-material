import { Commit } from '../models/commit'

/**
 * Search keys for History's shared filter pipeline. The first two entries are
 * deliberately comprehensive because fuzzy mode scores its title/subtitle
 * pair, while substring and regex modes inspect every key.
 */
export function getCommitSearchKeys(commit: Commit): ReadonlyArray<string> {
  return [
    `${commit.summary}\n${commit.body}`,
    `${commit.tags.join(' ')} ${commit.sha} ${commit.shortSha}`,
    `${commit.author.name} ${commit.author.email}`,
  ]
}
