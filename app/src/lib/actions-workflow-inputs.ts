import { parse } from 'yaml'

export type WorkflowDispatchInputType =
  | 'string'
  | 'boolean'
  | 'choice'
  | 'environment'

export interface IWorkflowDispatchInput {
  readonly name: string
  readonly description: string
  readonly required: boolean
  readonly type: WorkflowDispatchInputType
  readonly defaultValue: string
  readonly options: ReadonlyArray<string>
}

export interface IWorkflowDispatchDefinition {
  readonly available: boolean
  readonly inputs: ReadonlyArray<IWorkflowDispatchInput>
  readonly error: Error | null
}

const EmptyDefinition: IWorkflowDispatchDefinition = {
  available: false,
  inputs: [],
  error: null,
}

/** Parse workflow_dispatch inputs from a GitHub Actions YAML workflow. */
export function parseWorkflowDispatchInputs(
  source: string
): IWorkflowDispatchDefinition {
  try {
    const workflow = parse(source) as Record<string, unknown> | null
    if (workflow === null || typeof workflow !== 'object') {
      return EmptyDefinition
    }
    const events = workflow.on
    if (
      events === null ||
      typeof events !== 'object' ||
      Array.isArray(events)
    ) {
      return EmptyDefinition
    }
    const dispatch = (events as Record<string, unknown>).workflow_dispatch
    if (dispatch === undefined) {
      return EmptyDefinition
    }
    if (dispatch === null) {
      return { available: true, inputs: [], error: null }
    }
    if (typeof dispatch !== 'object' || Array.isArray(dispatch)) {
      return EmptyDefinition
    }
    const rawInputs = (dispatch as Record<string, unknown>).inputs
    if (rawInputs === undefined || rawInputs === null) {
      return { available: true, inputs: [], error: null }
    }
    if (typeof rawInputs !== 'object' || Array.isArray(rawInputs)) {
      return EmptyDefinition
    }

    const inputs = Object.entries(rawInputs as Record<string, unknown>).map(
      ([name, value]): IWorkflowDispatchInput => {
        const input =
          value !== null && typeof value === 'object' && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {}
        const requestedType = String(input.type ?? 'string')
        const type: WorkflowDispatchInputType = [
          'boolean',
          'choice',
          'environment',
        ].includes(requestedType)
          ? (requestedType as WorkflowDispatchInputType)
          : 'string'
        return {
          name,
          description: String(input.description ?? ''),
          required: input.required === true,
          type,
          defaultValue:
            input.default === undefined ? '' : String(input.default),
          options: Array.isArray(input.options)
            ? input.options.map(option => String(option))
            : [],
        }
      }
    )

    return { available: true, inputs, error: null }
  } catch (error) {
    return {
      available: false,
      inputs: [],
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/** Parse fallback `name=value` lines used when workflow YAML is unavailable. */
export function parseFreeformWorkflowInputs(
  source: string
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      throw new Error(`Expected name=value but received "${trimmed}".`)
    }
    result[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
  }
  return result
}
