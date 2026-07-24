import * as YAML from 'yaml'
import {
  ActionsWorkflowInputType,
  IActionsWorkflow,
  IActionsWorkflowInput,
  IActionsWorkflowJob,
} from './types'

/**
 * Pure GitHub Actions workflow parsing.
 *
 * Everything here takes a file name plus its raw YAML text and returns the
 * structured {@link IActionsWorkflow} the runner and UI consume. It touches no
 * disk and no Node APIs beyond the bundled `yaml` parser, so it is fully
 * unit-testable. Parsing is deliberately forgiving: a malformed file is still
 * returned (with `parseError` set) rather than dropped, and unknown shapes
 * degrade to empty lists instead of throwing.
 */

/**
 * Substrings that mark a workflow step as one that would upload a GitHub
 * Release asset. Matched case-insensitively against a step's `uses:` and
 * `run:` text. Kept intentionally broad — a false positive only means the user
 * is offered the guarded "upload to the real release" affordance they can
 * decline; a false negative would silently hide it.
 */
export const ReleaseUploadStepMarkers: ReadonlyArray<string> = [
  'softprops/action-gh-release',
  'actions/upload-release-asset',
  'ncipollo/release-action',
  'svenstaro/upload-release-action',
  'xresloader/upload-to-github-release',
  'gh release upload',
  'gh release create',
  'hub release',
]

const KnownInputTypes: ReadonlyArray<ActionsWorkflowInputType> = [
  'string',
  'boolean',
  'choice',
  'number',
  'environment',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

/**
 * Normalise the many legal shapes of the `on:` field into a flat, de-duplicated
 * event list. Handles `on: push` (string), `on: [push, pull_request]` (array)
 * and `on: { push: …, workflow_dispatch: … }` (map).
 */
export function parseEvents(on: unknown): ReadonlyArray<string> {
  const events: string[] = []
  const push = (name: string | null) => {
    if (name !== null && name.length > 0 && !events.includes(name)) {
      events.push(name)
    }
  }

  if (typeof on === 'string') {
    push(on)
  } else if (Array.isArray(on)) {
    for (const item of on) {
      // Only genuine event names count; a stray non-string entry is ignored
      // rather than coerced (an event list is always strings).
      push(typeof item === 'string' ? item : null)
    }
  } else {
    const map = asRecord(on)
    if (map !== null) {
      for (const key of Object.keys(map)) {
        push(key)
      }
    }
  }
  return events
}

function parseInputType(value: unknown): ActionsWorkflowInputType | null {
  const text = asString(value)
  if (text === null) {
    return null
  }
  const lower = text.toLowerCase() as ActionsWorkflowInputType
  return KnownInputTypes.includes(lower) ? lower : null
}

/** Extract the `workflow_dispatch.inputs` declarations, if any. */
export function parseDispatchInputs(
  on: unknown
): ReadonlyArray<IActionsWorkflowInput> {
  const map = asRecord(on)
  if (map === null) {
    return []
  }
  const dispatch = asRecord(map['workflow_dispatch'])
  if (dispatch === null) {
    return []
  }
  const inputs = asRecord(dispatch['inputs'])
  if (inputs === null) {
    return []
  }

  const result: IActionsWorkflowInput[] = []
  for (const name of Object.keys(inputs)) {
    const spec = asRecord(inputs[name])
    if (spec === null) {
      // A bare `inputs: { name: }` with no spec is still a usable string input.
      result.push({
        name,
        description: null,
        required: false,
        defaultValue: null,
        type: null,
        options: [],
      })
      continue
    }
    const rawOptions = spec['options']
    const options = Array.isArray(rawOptions)
      ? rawOptions.map(asString).filter((o): o is string => o !== null)
      : []
    result.push({
      name,
      description: asString(spec['description']),
      required: spec['required'] === true || spec['required'] === 'true',
      defaultValue: asString(spec['default']),
      type: parseInputType(spec['type']),
      options,
    })
  }
  return result
}

/** Extract the declared jobs (map keys under `jobs:`) with optional names. */
export function parseJobs(jobs: unknown): ReadonlyArray<IActionsWorkflowJob> {
  const map = asRecord(jobs)
  if (map === null) {
    return []
  }
  const result: IActionsWorkflowJob[] = []
  for (const id of Object.keys(map)) {
    const spec = asRecord(map[id])
    result.push({ id, name: spec !== null ? asString(spec['name']) : null })
  }
  return result
}

/**
 * Scan a workflow's jobs/steps for steps that would upload a release asset and
 * return a short human description of each match.
 */
export function findReleaseUploadSteps(jobs: unknown): ReadonlyArray<string> {
  const map = asRecord(jobs)
  if (map === null) {
    return []
  }
  const matches: string[] = []
  const consider = (jobId: string, label: string, haystack: string) => {
    const lower = haystack.toLowerCase()
    const marker = ReleaseUploadStepMarkers.find(m =>
      lower.includes(m.toLowerCase())
    )
    if (marker !== undefined) {
      matches.push(`${jobId}: ${label}`)
    }
  }

  for (const jobId of Object.keys(map)) {
    const job = asRecord(map[jobId])
    if (job === null) {
      continue
    }
    const steps = job['steps']
    if (!Array.isArray(steps)) {
      continue
    }
    for (const rawStep of steps) {
      const step = asRecord(rawStep)
      if (step === null) {
        continue
      }
      const uses = asString(step['uses'])
      const run = asString(step['run'])
      const stepName = asString(step['name'])
      if (uses !== null) {
        consider(jobId, stepName ?? uses, uses)
      }
      if (run !== null) {
        consider(jobId, stepName ?? 'run step', run)
      }
    }
  }
  return matches
}

/**
 * Parse a single workflow file. `relativePath` is the repo-relative,
 * forward-slash path used purely for display and to derive the file name; only
 * `text` is interpreted. Never throws — a parse failure yields a workflow entry
 * with `parseError` set and empty structured fields.
 */
export function parseWorkflow(
  relativePath: string,
  text: string
): IActionsWorkflow {
  const fileName = relativePath.split('/').pop() ?? relativePath

  let doc: unknown
  try {
    doc = YAML.parse(text)
  } catch (error) {
    return {
      relativePath,
      fileName,
      name: null,
      events: [],
      jobs: [],
      dispatchInputs: [],
      releaseUploadSteps: [],
      parseError:
        error instanceof Error
          ? error.message
          : 'Could not parse this workflow.',
    }
  }

  const root = asRecord(doc)
  if (root === null) {
    return {
      relativePath,
      fileName,
      name: null,
      events: [],
      jobs: [],
      dispatchInputs: [],
      releaseUploadSteps: [],
      parseError:
        'This file is not a valid workflow (expected a YAML mapping).',
    }
  }

  // YAML 1.1 (which Actions uses) reads a bare `on:` key as the boolean `true`.
  // `yaml` follows the 1.2 core schema and keeps `on` as a string, but tolerate
  // both so a `true` key is not mistaken for the trigger set.
  const on = 'on' in root ? root['on'] : root[true as unknown as string]

  return {
    relativePath,
    fileName,
    name: asString(root['name']),
    events: parseEvents(on),
    jobs: parseJobs(root['jobs']),
    dispatchInputs: parseDispatchInputs(on),
    releaseUploadSteps: findReleaseUploadSteps(root['jobs']),
    parseError: null,
  }
}
