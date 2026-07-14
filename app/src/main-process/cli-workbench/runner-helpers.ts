import { stat } from 'fs/promises'
import { isAbsolute, resolve } from 'path'
import { StringDecoder } from 'string_decoder'
import {
  assessCLICommand,
  CLIWorkbenchTool,
  getCLICommandBlockReason,
  ICLICommandRequest,
} from '../../lib/cli-workbench'

export const CLICommandOutputCap = 4 * 1024 * 1024
export const CLICommandInputChunkCap = 64 * 1024
export const CLICommandArgvByteCap = 30 * 1024
export const CLICommandArgCountCap = 512
export const CLICommandConcurrencyCap = 4

const RunIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTool(value: unknown): value is CLIWorkbenchTool {
  return value === 'git' || value === 'gh'
}

/**
 * Validate the untrusted IPC payload before it reaches child_process.spawn.
 * The returned request is a fresh, normalized object with no extra fields.
 */
export async function validateCLICommandRequest(
  value: unknown
): Promise<ICLICommandRequest> {
  if (!isRecord(value)) {
    throw new Error('Invalid CLI command request.')
  }

  const { id, tool, args, cwd, confirmed } = value
  if (typeof id !== 'string' || !RunIdPattern.test(id)) {
    throw new Error('CLI command id is invalid.')
  }
  if (!isTool(tool)) {
    throw new Error('CLI command tool is invalid.')
  }
  if (!Array.isArray(args) || args.length > CLICommandArgCountCap) {
    throw new Error('CLI command arguments are invalid.')
  }

  let argvBytes = 0
  const normalizedArgs = args.map(arg => {
    if (typeof arg !== 'string' || arg.includes('\0')) {
      throw new Error('CLI command arguments are invalid.')
    }
    argvBytes += Buffer.byteLength(arg, 'utf8') + 1
    return arg
  })
  if (argvBytes > CLICommandArgvByteCap) {
    throw new Error('CLI command arguments are too large.')
  }

  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) {
    throw new Error('CLI command working directory is invalid.')
  }
  const normalizedCwd = resolve(cwd)
  const cwdStat = await stat(normalizedCwd).catch(() => null)
  if (cwdStat === null || !cwdStat.isDirectory()) {
    throw new Error('CLI command working directory does not exist.')
  }

  if (confirmed !== undefined && typeof confirmed !== 'boolean') {
    throw new Error('CLI command confirmation is invalid.')
  }
  const blockReason = getCLICommandBlockReason(tool, normalizedArgs)
  if (blockReason !== null) {
    throw new Error(blockReason)
  }
  const assessment = assessCLICommand(tool, normalizedArgs)
  if (assessment.requiresConfirmation && confirmed !== true) {
    throw new Error('This destructive CLI command requires confirmation.')
  }

  return {
    id,
    tool,
    args: normalizedArgs,
    cwd: normalizedCwd,
    confirmed: confirmed === true,
  }
}

export interface ILimitedCLIOutput {
  readonly data: string
  readonly didTruncate: boolean
}

/**
 * Byte-bound UTF-8 decoder for streamed stdout/stderr. It retains only the few
 * bytes StringDecoder needs to complete a code point, never command history.
 */
export class CLICommandOutputLimiter {
  private remaining: number
  private announcedTruncation = false
  private readonly decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8'),
  }

  public constructor(cap: number = CLICommandOutputCap) {
    if (!Number.isInteger(cap) || cap < 0) {
      throw new Error('CLI command output cap is invalid.')
    }
    this.remaining = cap
  }

  public write(stream: 'stdout' | 'stderr', chunk: Buffer): ILimitedCLIOutput {
    const accepted = chunk.subarray(0, this.remaining)
    this.remaining -= accepted.length
    const wasTruncated = accepted.length < chunk.length
    const didTruncate = wasTruncated && !this.announcedTruncation
    this.announcedTruncation ||= wasTruncated
    return {
      data: this.decoders[stream].write(accepted),
      didTruncate,
    }
  }

  public end(stream: 'stdout' | 'stderr'): string {
    return this.announcedTruncation ? '' : this.decoders[stream].end()
  }
}
