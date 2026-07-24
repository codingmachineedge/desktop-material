import { readdir, readFile } from 'fs/promises'
import * as path from 'path'
import { IActionsWorkflow } from '../../lib/actions-local-run/types'
import { parseWorkflow } from '../../lib/actions-local-run/parse-workflows'

/**
 * Discover and parse the workflow files under a repository's
 * `.github/workflows` directory. The disk read lives in the main process; the
 * actual parsing is delegated to the pure `parse-workflows` engine so it stays
 * unit-testable without a filesystem.
 */

/** Cap on a single workflow file we will read (workflows are tiny in practice). */
const MaxWorkflowBytes = 512 * 1024
/** Cap on how many workflow files we enumerate, guarding against odd repos. */
const MaxWorkflowFiles = 200

function isWorkflowFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.yml') || lower.endsWith('.yaml')
}

/**
 * List and parse every workflow in `<repositoryPath>/.github/workflows`. A
 * repository with no workflows directory returns an empty list rather than
 * throwing. Individual unreadable/oversized files are surfaced as entries with
 * a `parseError` instead of failing the whole discovery.
 */
export async function discoverWorkflows(
  repositoryPath: string
): Promise<ReadonlyArray<IActionsWorkflow>> {
  const workflowsDir = path.join(repositoryPath, '.github', 'workflows')

  let entries: string[]
  try {
    entries = await readdir(workflowsDir)
  } catch {
    // No `.github/workflows` directory (or unreadable) — no workflows.
    return []
  }

  const fileNames = entries
    .filter(isWorkflowFile)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MaxWorkflowFiles)

  const workflows: IActionsWorkflow[] = []
  for (const fileName of fileNames) {
    const relativePath = `.github/workflows/${fileName}`
    const absolute = path.join(workflowsDir, fileName)
    try {
      const buffer = await readFile(absolute)
      if (buffer.byteLength > MaxWorkflowBytes) {
        workflows.push({
          relativePath,
          fileName,
          name: null,
          events: [],
          jobs: [],
          dispatchInputs: [],
          releaseUploadSteps: [],
          parseError: 'This workflow file is too large to parse.',
        })
        continue
      }
      workflows.push(parseWorkflow(relativePath, buffer.toString('utf8')))
    } catch (error) {
      workflows.push({
        relativePath,
        fileName,
        name: null,
        events: [],
        jobs: [],
        dispatchInputs: [],
        releaseUploadSteps: [],
        parseError:
          error instanceof Error ? error.message : 'Could not read this file.',
      })
    }
  }

  return workflows
}
