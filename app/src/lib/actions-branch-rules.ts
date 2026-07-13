export const ActionsBranchRulePageSize = 100
export const ActionsBranchRuleMaximumPages = 5

export interface IActionsBranchRule {
  readonly rulesetId: number
  readonly type: string
  readonly label: string
  readonly description: string
  readonly sourceType: string | null
  readonly source: string | null
}

export interface IActionsBranchRuleList {
  readonly branch: string
  readonly rules: ReadonlyArray<IActionsBranchRule>
  readonly capped: boolean
}

const controlCharacters = /[\u0000-\u001f\u007f]/
const ruleType = /^[a-z][a-z0-9_]{0,63}$/

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function optionalText(
  value: unknown,
  label: string,
  maximumLength: number
): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    controlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function optionalInteger(
  value: unknown,
  label: string,
  maximum: number
): number | null {
  if (value === undefined || value === null) {
    return null
  }
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function boundedArray(
  value: unknown,
  label: string,
  maximumLength: number
): ReadonlyArray<unknown> | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

const labels: Readonly<Record<string, string>> = {
  creation: 'Restrict branch creation',
  update: 'Restrict branch updates',
  deletion: 'Restrict branch deletion',
  non_fast_forward: 'Block force pushes',
  required_linear_history: 'Require linear history',
  required_signatures: 'Require signed commits',
  required_status_checks: 'Require status checks',
  required_deployments: 'Require deployments',
  pull_request: 'Require a pull request',
  required_code_scanning: 'Require code scanning results',
  commit_message_pattern: 'Restrict commit messages',
  commit_author_email_pattern: 'Restrict commit author emails',
  committer_email_pattern: 'Restrict committer emails',
  branch_name_pattern: 'Restrict branch names',
  file_path_restriction: 'Restrict file paths',
  max_file_path_length: 'Limit file path length',
  file_extension_restriction: 'Restrict file extensions',
  max_file_size: 'Limit file size',
  workflows: 'Require workflows',
}

function titleFromType(type: string): string {
  return (
    labels[type] ??
    type
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

function patternDescription(
  parameters: Record<string, unknown>
): string | null {
  const pattern = optionalText(parameters.pattern, 'rule pattern', 512)
  const operator = optionalText(parameters.operator, 'rule operator', 32)
  if (pattern === null || operator === null) {
    return null
  }
  const verbs: Readonly<Record<string, string>> = {
    starts_with: 'start with',
    ends_with: 'end with',
    contains: 'contain',
    regex: 'match regular expression',
  }
  const verb = verbs[operator] ?? operator.replace(/_/g, ' ')
  const negated = parameters.negate === true ? 'not ' : ''
  return `Values must ${negated}${verb} “${pattern}”.`
}

function describeParameters(type: string, value: unknown): string {
  if (value === undefined || value === null) {
    return 'Active for this branch.'
  }
  const parameters = record(value, 'branch rule parameters')

  if (type.endsWith('_pattern')) {
    return patternDescription(parameters) ?? 'A provider pattern applies.'
  }
  if (type === 'required_status_checks') {
    const checks = boundedArray(
      parameters.required_status_checks,
      'required status checks',
      100
    )
    return checks === null
      ? 'Required checks apply.'
      : `${checks.length} required status ${
          checks.length === 1 ? 'check' : 'checks'
        }.`
  }
  if (type === 'pull_request') {
    const approvals = optionalInteger(
      parameters.required_approving_review_count,
      'required approval count',
      100
    )
    const details = new Array<string>()
    if (approvals !== null) {
      details.push(
        `${approvals} approving ${approvals === 1 ? 'review' : 'reviews'}`
      )
    }
    if (parameters.require_code_owner_review === true) {
      details.push('code-owner review')
    }
    if (parameters.dismiss_stale_reviews_on_push === true) {
      details.push('stale-review dismissal')
    }
    return details.length === 0
      ? 'Changes must arrive through a pull request.'
      : `Requires ${details.join(', ')}.`
  }
  if (type === 'required_deployments') {
    const environments = boundedArray(
      parameters.required_deployment_environments,
      'required deployment environments',
      100
    )
    return environments === null
      ? 'Required deployments apply.'
      : `${environments.length} required deployment ${
          environments.length === 1 ? 'environment' : 'environments'
        }.`
  }
  if (type === 'required_code_scanning') {
    const tools = boundedArray(
      parameters.required_code_scanning_tools,
      'required code scanning tools',
      100
    )
    return tools === null
      ? 'Required code scanning results apply.'
      : `${tools.length} required code scanning ${
          tools.length === 1 ? 'tool' : 'tools'
        }.`
  }
  if (type === 'workflows') {
    const workflows = boundedArray(
      parameters.workflows,
      'required workflows',
      100
    )
    return workflows === null
      ? 'Required workflows apply.'
      : `${workflows.length} required ${
          workflows.length === 1 ? 'workflow' : 'workflows'
        }.`
  }
  if (type === 'max_file_path_length') {
    const maximum = optionalInteger(
      parameters.max_file_path_length,
      'maximum file path length',
      1_000_000
    )
    return maximum === null
      ? 'A file path length limit applies.'
      : `File paths are limited to ${maximum} characters.`
  }
  if (type === 'max_file_size') {
    const maximum = optionalInteger(
      parameters.max_file_size,
      'maximum file size',
      Number.MAX_SAFE_INTEGER
    )
    return maximum === null
      ? 'A file size limit applies.'
      : `Files are limited to ${maximum} bytes.`
  }

  return 'Active for this branch.'
}

/** Validate a local branch before including it in the provider API path. */
export function validateActionsBranchName(branch: string): string {
  if (
    branch.length === 0 ||
    branch.length > 1024 ||
    controlCharacters.test(branch) ||
    /[*?\[\]]/.test(branch)
  ) {
    throw new Error('The current branch name is not valid for rules lookup.')
  }
  return branch
}

/** Parse one bounded page returned by GitHub's effective branch rules API. */
export function parseActionsBranchRulePage(
  value: unknown
): ReadonlyArray<IActionsBranchRule> {
  if (!Array.isArray(value) || value.length > ActionsBranchRulePageSize) {
    throw new Error('GitHub returned an invalid branch rule page.')
  }

  return value.map((entry, index) => {
    const input = record(entry, `branch rule at position ${index + 1}`)
    const type = optionalText(input.type, 'branch rule type', 64)
    if (type === null || !ruleType.test(type)) {
      throw new Error('GitHub returned an invalid branch rule type.')
    }
    return {
      rulesetId: positiveInteger(input.ruleset_id, 'branch rule ruleset id'),
      type,
      label: titleFromType(type),
      description: describeParameters(type, input.parameters),
      sourceType: optionalText(
        input.ruleset_source_type,
        'branch rule source type',
        128
      ),
      source: optionalText(input.ruleset_source, 'branch rule source', 512),
    }
  })
}
