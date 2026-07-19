import { Buffer } from 'buffer'

import {
  GitHubIssueMetadataMaximumPages,
  GitHubIssueMetadataPageSize,
  IGitHubIssueLabel,
  IGitHubIssueMetadata,
  IGitHubIssueMilestone,
} from './github-issues'
import {
  GitHubPullRequestBodyMaximumLength,
  GitHubPullRequestTitleMaximumLength,
  IGitHubPullRequestMetadata,
  normalizeGitHubPullRequestMetadata,
} from './github-pull-request'

export const GitHubPullRequestTemplateMaximumBytes = 128 * 1024
export const GitHubPullRequestTemplateMaximumCount = 20
export const GitHubPullRequestTemplateDirectoryMaximumEntries = 100
export const GitHubPullRequestCreationMetadataPageSize =
  GitHubIssueMetadataPageSize
export const GitHubPullRequestCreationMetadataMaximumPages =
  GitHubIssueMetadataMaximumPages

export type GitHubPullRequestCreationCapability =
  | 'templates'
  | 'reviewers'
  | 'labels'
  | 'assignees'
  | 'milestones'

export interface IGitHubPullRequestCreationMetadata
  extends IGitHubPullRequestMetadata {
  /** Omitted means that creation should leave the repository default alone. */
  readonly milestone?: number | null
}

export interface IGitHubPullRequestTemplate {
  readonly path: string
  readonly name: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly metadata: IGitHubPullRequestCreationMetadata
  /** Safe, provider-payload-free notices about ignored frontmatter defaults. */
  readonly warnings: ReadonlyArray<string>
}

export interface IGitHubPullRequestCreationContext {
  readonly templates: ReadonlyArray<IGitHubPullRequestTemplate>
  readonly reviewers: ReadonlyArray<string>
  readonly labels: ReadonlyArray<IGitHubIssueLabel>
  readonly assignees: ReadonlyArray<string>
  readonly milestones: ReadonlyArray<IGitHubIssueMilestone>
  readonly capped: ReadonlyArray<
    'reviewers' | 'labels' | 'assignees' | 'milestones'
  >
  readonly unavailable: ReadonlyArray<GitHubPullRequestCreationCapability>
  readonly warnings: ReadonlyArray<string>
}

export interface IGitHubPullRequestTemplateFile {
  readonly path: string
  readonly content: string
}

const templatePath =
  /^(?:\.github\/|docs\/)?(?:PULL_REQUEST_TEMPLATE\/[^/]+\.md|pull_request_template\.md)$/i
const safeTemplateName = /^[^\u0000-\u001f\u007f/\\]{1,100}$/
const unsafeMultilineText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

/** Humanize a branch ref without exposing the remote-qualified ref as prose. */
export function getDefaultGitHubPullRequestTitle(branchName: string): string {
  const leaf = branchName.split('/').filter(Boolean).at(-1) ?? branchName
  const words = leaf.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const title = words.length === 0 ? branchName.trim() : words
  const normalized =
    title.length === 0
      ? 'Pull request'
      : title[0].toUpperCase() + title.slice(1)
  return normalized.slice(0, GitHubPullRequestTitleMaximumLength)
}

function normalizeTemplatePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    value.trim() !== value ||
    !templatePath.test(value) ||
    value.includes('..')
  ) {
    throw new Error('GitHub returned an invalid pull request template path.')
  }
  return value.replace(/\\/g, '/')
}

function templateNameFromPath(path: string): string {
  const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  const name = filename
    .replace(/^pull_request_template$/i, 'Default')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name.length === 0 ? 'Template' : name
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function frontmatterList(value: string): ReadonlyArray<string> {
  const trimmed = value.trim()
  if (trimmed === '') {
    return []
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(trimmed.replace(/'/g, '"'))
      if (
        Array.isArray(parsed) &&
        parsed.every(item => typeof item === 'string')
      ) {
        return parsed
      }
    } catch {
      // Fall through to the intentionally small comma-separated format.
    }
  }
  return trimmed.split(',').map(unquote)
}

interface IParsedFrontmatter {
  readonly values: ReadonlyMap<string, string>
  readonly body: string
  readonly malformed: boolean
}

/**
 * Parse only single-line, allowlisted frontmatter. This is deliberately not a
 * YAML evaluator: tags, anchors, aliases, nested objects, and multiline values
 * are never interpreted.
 */
function parseFrontmatter(content: string): IParsedFrontmatter {
  const normalized = content.replace(/^\uFEFF/, '')
  const firstBreak = normalized.indexOf('\n')
  if (firstBreak === -1 || normalized.slice(0, firstBreak).trim() !== '---') {
    return { values: new Map(), body: normalized, malformed: false }
  }
  const boundaryPattern = /^---\r?$/gm
  boundaryPattern.lastIndex = firstBreak + 1
  const boundaryMatch = boundaryPattern.exec(normalized)
  if (boundaryMatch === null || boundaryMatch.index > 8192) {
    return { values: new Map(), body: normalized, malformed: true }
  }
  const boundary = boundaryMatch.index
  const body = normalized
    .slice(boundary + boundaryMatch[0].length)
    .replace(/^\n/, '')
  const values = new Map<string, string>()
  let malformed = false
  const allowed = new Set([
    'name',
    'title',
    'labels',
    'assignees',
    'reviewers',
    'milestone',
    'draft',
  ])
  for (const line of normalized.slice(firstBreak + 1, boundary).split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)\r?$/.exec(line)
    if (match === null || /^[>|&*!{]/.test(match?.[2]?.trim() ?? '')) {
      malformed = true
      continue
    }
    const key = match[1].toLowerCase()
    if (allowed.has(key) && !values.has(key)) {
      values.set(key, match[2])
    }
  }
  return { values, body, malformed }
}

function safeTemplateMetadata(
  values: ReadonlyMap<string, string>,
  warnings: string[]
): IGitHubPullRequestCreationMetadata {
  const parse = (key: 'reviewers' | 'assignees' | 'labels') =>
    frontmatterList(values.get(key) ?? '')
  let metadata: IGitHubPullRequestMetadata
  try {
    metadata = normalizeGitHubPullRequestMetadata(
      parse('reviewers'),
      parse('assignees'),
      parse('labels')
    )
  } catch {
    warnings.push(
      'Some template metadata defaults were ignored because they were invalid.'
    )
    metadata = { reviewers: [], assignees: [], labels: [] }
  }

  const rawMilestone = values.get('milestone')?.trim()
  if (rawMilestone === undefined || rawMilestone === '') {
    return metadata
  }
  if (
    !/^[1-9][0-9]*$/.test(rawMilestone) ||
    !Number.isSafeInteger(Number(rawMilestone))
  ) {
    warnings.push(
      'The template milestone default was ignored because it was invalid.'
    )
    return metadata
  }
  return { ...metadata, milestone: Number(rawMilestone) }
}

/** Parse one decoded repository template using only bounded safe defaults. */
export function parseGitHubPullRequestTemplate(
  file: IGitHubPullRequestTemplateFile
): IGitHubPullRequestTemplate {
  const path = normalizeTemplatePath(file.path)
  if (
    typeof file.content !== 'string' ||
    Buffer.byteLength(file.content, 'utf8') >
      GitHubPullRequestTemplateMaximumBytes ||
    unsafeMultilineText.test(file.content)
  ) {
    throw new Error('GitHub returned an invalid pull request template body.')
  }
  const parsed = parseFrontmatter(file.content.replace(/\r\n/g, '\n'))
  if (parsed.body.length > GitHubPullRequestBodyMaximumLength) {
    throw new Error(
      'The pull request template body exceeds the app safety limit.'
    )
  }
  const warnings = new Array<string>()
  if (parsed.malformed) {
    warnings.push(
      'Some template frontmatter was ignored because it was not supported.'
    )
  }
  const rawName = unquote(parsed.values.get('name') ?? '')
  const name = safeTemplateName.test(rawName)
    ? rawName
    : templateNameFromPath(path)
  if (rawName !== '' && name !== rawName) {
    warnings.push('The template name was ignored because it was invalid.')
  }
  const rawTitle = unquote(parsed.values.get('title') ?? '').trim()
  const title =
    rawTitle.length <= GitHubPullRequestTitleMaximumLength &&
    !/[\u0000-\u001f\u007f]/.test(rawTitle)
      ? rawTitle
      : ''
  if (rawTitle !== '' && title === '') {
    warnings.push(
      'The template title default was ignored because it was invalid.'
    )
  }
  const rawDraft = parsed.values.get('draft')?.trim().toLowerCase()
  const draft = rawDraft === 'true'
  if (
    rawDraft !== undefined &&
    rawDraft !== '' &&
    !['true', 'false'].includes(rawDraft)
  ) {
    warnings.push(
      'The template draft default was ignored because it was invalid.'
    )
  }
  return {
    path,
    name,
    title,
    body: parsed.body,
    draft,
    metadata: safeTemplateMetadata(parsed.values, warnings),
    warnings,
  }
}

/** Validate one Contents API directory and return only bounded Markdown files. */
export function parseGitHubPullRequestTemplateDirectory(
  value: unknown,
  directory: string
): ReadonlyArray<string> {
  if (
    ![
      '.github/PULL_REQUEST_TEMPLATE',
      'PULL_REQUEST_TEMPLATE',
      'docs/PULL_REQUEST_TEMPLATE',
    ].includes(directory)
  ) {
    throw new Error('The pull request template directory is not supported.')
  }
  if (
    !Array.isArray(value) ||
    value.length > GitHubPullRequestTemplateDirectoryMaximumEntries
  ) {
    throw new Error(
      'GitHub returned an invalid pull request template directory.'
    )
  }
  const prefix = `${directory.replace(/\/$/, '')}/`
  const paths = new Array<string>()
  for (const item of value) {
    const entry = record(item, 'pull request template directory entry')
    if (entry.type !== 'file' || typeof entry.path !== 'string') {
      continue
    }
    if (
      !entry.path.startsWith(prefix) ||
      entry.path.slice(prefix.length).includes('/')
    ) {
      throw new Error(
        'GitHub returned an invalid pull request template directory entry.'
      )
    }
    if (/\.md$/i.test(entry.path)) {
      paths.push(normalizeTemplatePath(entry.path))
    }
  }
  return [...new Set(paths)].slice(0, GitHubPullRequestTemplateMaximumCount)
}

/** Decode one strict Contents API file without following provider URLs. */
export function parseGitHubPullRequestTemplateFile(
  value: unknown,
  expectedPath: string
): IGitHubPullRequestTemplateFile {
  const expected = normalizeTemplatePath(expectedPath)
  const file = record(value, 'pull request template file')
  if (
    file.type !== 'file' ||
    file.path !== expected ||
    file.encoding !== 'base64' ||
    typeof file.content !== 'string' ||
    typeof file.size !== 'number' ||
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > GitHubPullRequestTemplateMaximumBytes ||
    file.content.length > GitHubPullRequestTemplateMaximumBytes * 2 ||
    !/^[A-Za-z0-9+/=\r\n]*$/.test(file.content)
  ) {
    throw new Error('GitHub returned an invalid pull request template file.')
  }
  const encoded = file.content.replace(/[\r\n]/g, '')
  if (encoded.length % 4 !== 0) {
    throw new Error('GitHub returned invalid pull request template encoding.')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) {
    throw new Error('GitHub returned invalid pull request template encoding.')
  }
  if (bytes.byteLength !== file.size) {
    throw new Error('GitHub returned an invalid pull request template size.')
  }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return { path: expected, content }
}

export function emptyGitHubPullRequestCreationContext(
  unavailable: ReadonlyArray<GitHubPullRequestCreationCapability> = []
): IGitHubPullRequestCreationContext {
  return {
    templates: [],
    reviewers: [],
    labels: [],
    assignees: [],
    milestones: [],
    capped: [],
    unavailable,
    warnings: [],
  }
}

export function creationContextFromIssueMetadata(
  issue: IGitHubIssueMetadata,
  templates: ReadonlyArray<IGitHubPullRequestTemplate>,
  reviewers: ReadonlyArray<string>,
  reviewerCapped: boolean,
  unavailable: ReadonlyArray<GitHubPullRequestCreationCapability>,
  warnings: ReadonlyArray<string>
): IGitHubPullRequestCreationContext {
  const capped = new Array<
    'reviewers' | 'labels' | 'assignees' | 'milestones'
  >()
  if (reviewerCapped) {
    capped.push('reviewers')
  }
  if (issue.labelsCapped) {
    capped.push('labels')
  }
  if (issue.assigneesCapped) {
    capped.push('assignees')
  }
  if (issue.milestonesCapped) {
    capped.push('milestones')
  }
  return {
    templates,
    reviewers,
    labels: issue.labels,
    assignees: issue.assignees,
    milestones: issue.milestones.filter(
      milestone => milestone.state === 'open'
    ),
    capped,
    unavailable: [...new Set([...unavailable, ...issue.unavailable])],
    warnings: [...warnings].slice(0, 10),
  }
}
