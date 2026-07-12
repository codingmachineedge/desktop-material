import { WorkingDirectoryFileChange } from '../../models/status'
import { ICommitContext } from '../../models/commit'

const MaximumListedFiles = 10

export function buildFallbackCommitMessage(
  files: ReadonlyArray<Pick<WorkingDirectoryFileChange, 'path'>>,
  now: Date
): ICommitContext {
  const timestamp = now.toISOString().replace('T', ' ').replace('.000Z', 'Z')
  const listed = files
    .slice(0, MaximumListedFiles)
    .map(file => `- ${file.path}`)
  const remaining = files.length - listed.length
  if (remaining > 0) {
    listed.push(`- …and ${remaining} more`)
  }

  return {
    summary: `Auto commit ${timestamp}`,
    description: `${files.length} file${files.length === 1 ? '' : 's'} changed${
      listed.length > 0 ? `\n\n${listed.join('\n')}` : ''
    }`,
    messageGeneratedByCopilot: false,
  }
}
