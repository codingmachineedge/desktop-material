import { TranslationKey } from '../i18n-resources'

/**
 * Pure, side-effect-free classifier for recognized Git operation failures.
 *
 * {@link classifyGitOperationError} inspects the raw error text of a failed Git
 * operation (plus a few cheap runtime facts the caller already knows) and, when
 * it recognizes a known-fixable signature, returns a {@link IProposedFix} that
 * names the remediation, its safety class, and a confidence level. It NEVER
 * mutates state, NEVER spawns anything, and NEVER rewrites the operator's error
 * text — the store owns execution and surfacing.
 *
 * The safety model has three classes:
 *
 *   - `auto`    side-effect-free or provably safe; may be applied automatically
 *              once. A destructive fix is NEVER `auto` (enforced by
 *              {@link AUTO_FIX_DEFINITIONS} and asserted in tests).
 *   - `confirm` needs an explicit user click before it runs.
 *   - `manual`  explanation only; Desktop performs nothing on the user's behalf.
 *
 * Force-pushing is never proposed by any fix (also asserted in tests).
 */

/** How much side effect a fix may have and whether it can run unattended. */
export type AutoFixSafetyClass = 'auto' | 'confirm' | 'manual'

/** How sure the classifier is that the matched signature is the real cause. */
export type AutoFixConfidence = 'high' | 'medium' | 'low'

/** The recognized failure families plus the unknown-error passthrough. */
export type AutoFixKind =
  | 'stale-index-lock'
  | 'auto-gc-retry'
  | 'push-non-fast-forward'
  | 'push-forbidden-github-cli'
  | 'detached-head-rescue-branch'
  | 'unknown'

/** Every recognized kind (i.e. everything except the passthrough). */
export type RecognizedAutoFixKind = Exclude<AutoFixKind, 'unknown'>

/** A single proposed remediation for a classified failure. */
export interface IProposedFix {
  readonly kind: AutoFixKind
  readonly safety: AutoFixSafetyClass
  readonly confidence: AutoFixConfidence
  /**
   * True when applying the fix removes or rewrites user-visible repository
   * state (for example a rebase that rewrites local commits). A destructive fix
   * is never classified `auto`.
   */
  readonly destructive: boolean
  /**
   * True when Desktop can apply the fix from the error-notice context alone
   * (which only carries the repository) with a single click. Fixes that require
   * re-running the original captured operation are not one-click.
   */
  readonly oneClick: boolean
  /** Localized plain title for the recognized situation. */
  readonly titleKey: TranslationKey
  /** Localized plain summary of the recommended remediation. */
  readonly summaryKey: TranslationKey
  /** Localized label for the affordance that applies (or explains) the fix. */
  readonly actionLabelKey: TranslationKey
  /**
   * Extra `git -c key=value` arguments that make the SAME failed command retry
   * safely (used for pure-config retries such as disabling auto maintenance).
   * Empty when the fix is not a config-only retry.
   */
  readonly retryConfigArgs: ReadonlyArray<string>
  /**
   * Concrete git command argument vectors the remediation proposes running, in
   * order. Empty when the remediation is a bespoke Desktop action or a
   * config-only retry. NEVER contains a force-push.
   */
  readonly commands: ReadonlyArray<ReadonlyArray<string>>
}

/** The cheap facts a caller may already know that refine text-only matching. */
export interface IGitOperationErrorContext {
  /** Raw combined stderr/stdout of the failed operation. */
  readonly errorText: string
  /** The GitHub CLI is installed and authenticated for the remote host. */
  readonly gitHubCLIAvailable?: boolean
  /**
   * The push targets a GitHub/GHES remote that is organization-owned or owned
   * by a login other than the signed-in account (the only remotes the gh
   * credential fallback can help). See `shouldAttemptGitHubCLIPushFallback`.
   */
  readonly remoteEligibleForGitHubCLIFallback?: boolean
  /** HEAD is currently detached (no branch checked out). */
  readonly detachedHead?: boolean
}

/** The classifier's verdict for one failed operation. */
export interface IAutoFixDiagnosis {
  /** True when a known-fixable signature matched (kind !== 'unknown'). */
  readonly recognized: boolean
  /** The operator's original error text, passed through verbatim. */
  readonly plainError: string
  /** The proposed remediation (or the unknown-error passthrough). */
  readonly fix: IProposedFix
}

/** The fixed, per-kind facts. Kept as data so tests can assert invariants. */
export const AUTO_FIX_DEFINITIONS: Readonly<
  Record<AutoFixKind, Omit<IProposedFix, 'kind'>>
> = {
  'stale-index-lock': {
    safety: 'confirm',
    confidence: 'high',
    destructive: false,
    oneClick: true,
    titleKey: 'gitAutoFix.staleIndexLock.title',
    summaryKey: 'gitAutoFix.staleIndexLock.summary',
    actionLabelKey: 'gitAutoFix.staleIndexLock.action',
    retryConfigArgs: [],
    commands: [],
  },
  'auto-gc-retry': {
    safety: 'auto',
    confidence: 'medium',
    destructive: false,
    oneClick: false,
    titleKey: 'gitAutoFix.autoGcRetry.title',
    summaryKey: 'gitAutoFix.autoGcRetry.summary',
    actionLabelKey: 'gitAutoFix.fixIt',
    retryConfigArgs: ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false'],
    commands: [],
  },
  'push-non-fast-forward': {
    safety: 'confirm',
    confidence: 'high',
    // A rebase onto the upstream rewrites local commit identities.
    destructive: true,
    oneClick: false,
    titleKey: 'gitAutoFix.pushNonFastForward.title',
    summaryKey: 'gitAutoFix.pushNonFastForward.summary',
    actionLabelKey: 'gitAutoFix.fixIt',
    retryConfigArgs: [],
    // Integrate the remote changes, then the user pushes again. Never a
    // force-push.
    commands: [['pull', '--rebase']],
  },
  'push-forbidden-github-cli': {
    safety: 'auto',
    confidence: 'medium',
    destructive: false,
    oneClick: false,
    titleKey: 'gitAutoFix.pushForbiddenGithubCli.title',
    summaryKey: 'gitAutoFix.pushForbiddenGithubCli.summary',
    actionLabelKey: 'gitAutoFix.fixIt',
    retryConfigArgs: [],
    commands: [],
  },
  'detached-head-rescue-branch': {
    safety: 'confirm',
    confidence: 'high',
    // Creating a branch only adds a ref; it removes and rewrites nothing.
    destructive: false,
    oneClick: true,
    titleKey: 'gitAutoFix.detachedHeadRescueBranch.title',
    summaryKey: 'gitAutoFix.detachedHeadRescueBranch.summary',
    actionLabelKey: 'gitAutoFix.detachedHeadRescueBranch.action',
    retryConfigArgs: [],
    commands: [],
  },
  unknown: {
    safety: 'manual',
    confidence: 'low',
    destructive: false,
    oneClick: false,
    titleKey: 'gitAutoFix.unknown.title',
    summaryKey: 'gitAutoFix.unknown.summary',
    actionLabelKey: 'gitAutoFix.unknown.action',
    retryConfigArgs: [],
    commands: [],
  },
}

/** All recognized kinds, in classification-precedence order. */
export const RECOGNIZED_AUTO_FIX_KINDS: ReadonlyArray<RecognizedAutoFixKind> = [
  'stale-index-lock',
  'detached-head-rescue-branch',
  'push-non-fast-forward',
  'push-forbidden-github-cli',
  'auto-gc-retry',
]

const STALE_INDEX_LOCK_SIGNATURES: ReadonlyArray<RegExp> = [
  /unable to create '[^'\n]*index\.lock': File exists/i,
  /Another git process seems to be running in this repository/i,
  /remove the file manually to continue/i,
]

const DETACHED_HEAD_SIGNATURES: ReadonlyArray<RegExp> = [
  /detached HEAD/i,
  /HEAD detached at/i,
  /you are not currently on a branch/i,
]

const NON_FAST_FORWARD_SIGNATURES: ReadonlyArray<RegExp> = [
  /\(non-fast-forward\)/i,
  /tip of your current branch is behind/i,
  /Updates were rejected because the remote contains work/i,
]

const FORBIDDEN_SIGNATURES: ReadonlyArray<RegExp> = [
  /The requested URL returned error:\s*403/i,
  /Permission to .+ denied to/i,
  /\b403\b\s*Forbidden/i,
  /remote:\s*Write access to repository not granted/i,
]

const AUTO_GC_SIGNATURES: ReadonlyArray<RegExp> = [
  /Auto packing the repository/i,
  /\bgc\.log\b/i,
  /The last gc run reported the following/i,
  /too many unreachable loose objects/i,
  /run 'git maintenance run'/i,
  /background maintenance/i,
]

function anyMatch(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  return patterns.some(pattern => pattern.test(text))
}

/**
 * Decide which recognized kind (if any) a failed operation matches. Checks run
 * in a fixed precedence so an error that trips two signatures resolves
 * deterministically: a blocking lock first, then a detached HEAD, then the two
 * push families, then background maintenance.
 */
function detectKind(context: IGitOperationErrorContext): AutoFixKind {
  const text = context.errorText ?? ''

  if (anyMatch(text, STALE_INDEX_LOCK_SIGNATURES)) {
    return 'stale-index-lock'
  }

  if (
    context.detachedHead === true ||
    anyMatch(text, DETACHED_HEAD_SIGNATURES)
  ) {
    return 'detached-head-rescue-branch'
  }

  if (anyMatch(text, NON_FAST_FORWARD_SIGNATURES)) {
    return 'push-non-fast-forward'
  }

  // A 403 is only auto-fixable when the gh credential fallback can actually
  // help: the CLI must be available AND the remote must be eligible. Without
  // both facts the forbidden push is left as a manual, unrecognized failure.
  if (
    anyMatch(text, FORBIDDEN_SIGNATURES) &&
    context.gitHubCLIAvailable === true &&
    context.remoteEligibleForGitHubCLIFallback === true
  ) {
    return 'push-forbidden-github-cli'
  }

  if (anyMatch(text, AUTO_GC_SIGNATURES)) {
    return 'auto-gc-retry'
  }

  return 'unknown'
}

/**
 * Classify a failed Git operation's error text into a known fixable case with a
 * proposed fix, a confidence, and a safety class — or an unknown-error
 * passthrough. Pure and deterministic.
 */
export function classifyGitOperationError(
  context: IGitOperationErrorContext
): IAutoFixDiagnosis {
  const kind = detectKind(context)
  return {
    recognized: kind !== 'unknown',
    plainError: context.errorText ?? '',
    fix: { kind, ...AUTO_FIX_DEFINITIONS[kind] },
  }
}

/**
 * True when a proposed fix removes or rewrites user-visible repository state.
 * Exposed so both the store and the contract tests share one definition.
 */
export function isDestructiveFix(fix: IProposedFix): boolean {
  return fix.destructive
}

/**
 * True when any proposed command is a force-push. Used by the contract test to
 * prove no fix ever force-pushes; also usable as a defensive guard before
 * running a proposed command.
 */
export function containsForcePush(
  commands: ReadonlyArray<ReadonlyArray<string>>
): boolean {
  return commands.some(command => {
    const pushesRefs = command.includes('push')
    if (!pushesRefs) {
      return false
    }
    return command.some(
      argument =>
        argument === '--force' ||
        argument === '-f' ||
        argument === '--force-with-lease' ||
        argument.startsWith('--force-with-lease=') ||
        argument === '+HEAD' ||
        /^\+.+:/.test(argument)
    )
  })
}
