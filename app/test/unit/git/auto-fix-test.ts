import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AUTO_FIX_DEFINITIONS,
  AutoFixKind,
  IProposedFix,
  RECOGNIZED_AUTO_FIX_KINDS,
  classifyGitOperationError,
  containsForcePush,
  isDestructiveFix,
} from '../../../src/lib/git/auto-fix'

/**
 * Real (lightly trimmed) stderr/stdout captured from failing Git operations.
 * Each fixture must classify to exactly one recognized kind so the classifier
 * is exercised against text a user would actually see, not synthetic strings.
 */
const STALE_INDEX_LOCK = `fatal: Unable to create '/Users/dev/acme/.git/index.lock': File exists.

Another git process seems to be running in this repository, e.g.
an editor opened by 'git commit'. Please make sure all processes
are terminated then try again. If it still fails, a git process
may have crashed in this repository earlier:
remove the file manually to continue.`

const DETACHED_HEAD_CHECKOUT = `Note: switching to 'a1b2c3d4'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

HEAD is now at a1b2c3d4 Fix the thing`

const DETACHED_HEAD_PUSH = `fatal: You are not currently on a branch.
To push the history leading to the current (detached HEAD)
state now, use

    git push origin HEAD:<name-of-remote-branch>`

const NON_FAST_FORWARD = `To https://github.com/owner/repo.git
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'https://github.com/owner/repo.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. Integrate the remote changes (e.g.
hint: 'git pull ...') before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.`

const FORBIDDEN_403 = `remote: Permission to acme-org/service.git denied to alice.
fatal: unable to access 'https://github.com/acme-org/service.git/': The requested URL returned error: 403`

const AUTO_GC_HANG = `Auto packing the repository in background for optimum performance.
See "git help gc" for manual housekeeping.
error: The last gc run reported the following. Please correct the root cause
and remove .git/gc.log.
Automatic cleanup will not be performed until the file is removed.

warning: There are too many unreachable loose objects; run 'git prune' to remove them.`

const UNKNOWN_ERROR = `error: pathspec 'does-not-exist' did not match any file(s) known to git`

describe('classifyGitOperationError', () => {
  it('recognizes a stale index.lock with no live git process', () => {
    const { recognized, fix, plainError } = classifyGitOperationError({
      errorText: STALE_INDEX_LOCK,
    })
    assert.equal(recognized, true)
    assert.equal(fix.kind, 'stale-index-lock')
    assert.equal(fix.safety, 'confirm')
    assert.equal(fix.destructive, false)
    assert.equal(fix.oneClick, true)
    assert.equal(plainError, STALE_INDEX_LOCK)
  })

  it('recognizes a detached HEAD from a checkout advisory', () => {
    const { recognized, fix } = classifyGitOperationError({
      errorText: DETACHED_HEAD_CHECKOUT,
    })
    assert.equal(recognized, true)
    assert.equal(fix.kind, 'detached-head-rescue-branch')
    assert.equal(fix.safety, 'confirm')
    assert.equal(fix.destructive, false)
    assert.equal(fix.oneClick, true)
  })

  it('recognizes a detached HEAD from a failed push', () => {
    const { fix } = classifyGitOperationError({ errorText: DETACHED_HEAD_PUSH })
    assert.equal(fix.kind, 'detached-head-rescue-branch')
  })

  it('recognizes a detached HEAD from the context flag alone', () => {
    const { fix } = classifyGitOperationError({
      errorText: 'nothing recognizable here',
      detachedHead: true,
    })
    assert.equal(fix.kind, 'detached-head-rescue-branch')
  })

  it('recognizes a non-fast-forward push and never proposes a force-push', () => {
    const { recognized, fix } = classifyGitOperationError({
      errorText: NON_FAST_FORWARD,
    })
    assert.equal(recognized, true)
    assert.equal(fix.kind, 'push-non-fast-forward')
    assert.equal(fix.safety, 'confirm')
    // Integrating the remote rewrites local commits, so it is destructive and
    // therefore never auto.
    assert.equal(fix.destructive, true)
    assert.equal(fix.oneClick, false)
    assert.equal(containsForcePush(fix.commands), false)
    assert.equal(
      fix.commands.some(command => command.includes('push')),
      false
    )
  })

  it('recognizes a 403 push only when the gh fallback can help', () => {
    const withGh = classifyGitOperationError({
      errorText: FORBIDDEN_403,
      gitHubCLIAvailable: true,
      remoteEligibleForGitHubCLIFallback: true,
    })
    assert.equal(withGh.fix.kind, 'push-forbidden-github-cli')
    assert.equal(withGh.fix.safety, 'auto')
    assert.equal(withGh.fix.destructive, false)

    // Missing either fact means the fallback cannot help; do not claim a fix.
    assert.equal(
      classifyGitOperationError({ errorText: FORBIDDEN_403 }).fix.kind,
      'unknown'
    )
    assert.equal(
      classifyGitOperationError({
        errorText: FORBIDDEN_403,
        gitHubCLIAvailable: true,
      }).fix.kind,
      'unknown'
    )
    assert.equal(
      classifyGitOperationError({
        errorText: FORBIDDEN_403,
        remoteEligibleForGitHubCLIFallback: true,
      }).fix.kind,
      'unknown'
    )
  })

  it('recognizes an auto-gc/maintenance hang and retries with maintenance off', () => {
    const { recognized, fix } = classifyGitOperationError({
      errorText: AUTO_GC_HANG,
    })
    assert.equal(recognized, true)
    assert.equal(fix.kind, 'auto-gc-retry')
    assert.equal(fix.safety, 'auto')
    assert.equal(fix.destructive, false)
    assert.deepEqual(fix.retryConfigArgs, [
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
    ])
  })

  it('passes an unknown error through as a manual, unrecognized diagnosis', () => {
    const { recognized, fix, plainError } = classifyGitOperationError({
      errorText: UNKNOWN_ERROR,
    })
    assert.equal(recognized, false)
    assert.equal(fix.kind, 'unknown')
    assert.equal(fix.safety, 'manual')
    assert.equal(fix.oneClick, false)
    assert.equal(plainError, UNKNOWN_ERROR)
  })

  it('treats empty and whitespace error text as unknown', () => {
    assert.equal(
      classifyGitOperationError({ errorText: '' }).fix.kind,
      'unknown'
    )
    assert.equal(
      classifyGitOperationError({ errorText: '   \n\t ' }).fix.kind,
      'unknown'
    )
    assert.equal(classifyGitOperationError({ errorText: '' }).plainError, '')
  })

  it('resolves a fixed precedence when several signatures appear at once', () => {
    // A blocking lock always wins over a detached-HEAD advisory in the same
    // output so the user is told to clear the lock first.
    const combined = `${STALE_INDEX_LOCK}\n${DETACHED_HEAD_CHECKOUT}`
    assert.equal(
      classifyGitOperationError({ errorText: combined }).fix.kind,
      'stale-index-lock'
    )
  })

  it('reaches every recognized kind from a real fixture', () => {
    const reached = new Set<AutoFixKind>([
      classifyGitOperationError({ errorText: STALE_INDEX_LOCK }).fix.kind,
      classifyGitOperationError({ errorText: DETACHED_HEAD_CHECKOUT }).fix.kind,
      classifyGitOperationError({ errorText: NON_FAST_FORWARD }).fix.kind,
      classifyGitOperationError({
        errorText: FORBIDDEN_403,
        gitHubCLIAvailable: true,
        remoteEligibleForGitHubCLIFallback: true,
      }).fix.kind,
      classifyGitOperationError({ errorText: AUTO_GC_HANG }).fix.kind,
    ])
    for (const kind of RECOGNIZED_AUTO_FIX_KINDS) {
      assert.ok(reached.has(kind), `no fixture classified as ${kind}`)
    }
  })
})

describe('auto-fix safety contract', () => {
  it('never marks a destructive fix as auto', () => {
    for (const [kind, definition] of Object.entries(AUTO_FIX_DEFINITIONS)) {
      if (definition.safety === 'auto') {
        assert.equal(
          definition.destructive,
          false,
          `${kind} is auto but destructive`
        )
      }
    }
  })

  it('never proposes a force-push in any fix', () => {
    for (const [kind, definition] of Object.entries(AUTO_FIX_DEFINITIONS)) {
      assert.equal(
        containsForcePush(definition.commands),
        false,
        `${kind} proposes a force-push`
      )
      for (const arg of definition.retryConfigArgs) {
        assert.doesNotMatch(
          arg,
          /force/i,
          `${kind} retry args contain a force flag`
        )
      }
    }
  })

  it('keeps a destructive fix behind an explicit confirm or manual class', () => {
    for (const [kind, definition] of Object.entries(AUTO_FIX_DEFINITIONS)) {
      if (definition.destructive) {
        assert.notEqual(
          definition.safety,
          'auto',
          `${kind} is destructive but auto`
        )
      }
    }
  })

  it('exposes isDestructiveFix consistent with the definition table', () => {
    for (const kind of Object.keys(AUTO_FIX_DEFINITIONS) as AutoFixKind[]) {
      const fix: IProposedFix = { kind, ...AUTO_FIX_DEFINITIONS[kind] }
      assert.equal(
        isDestructiveFix(fix),
        AUTO_FIX_DEFINITIONS[kind].destructive
      )
    }
  })
})

describe('auto-fix notification-centre wiring', () => {
  const source = (relativePath: string): string =>
    readFileSync(join(process.cwd(), ...relativePath.split('/')), 'utf8')

  it('registers the apply-git-auto-fix action across every surface it needs', () => {
    // Model action variant.
    assert.match(
      source('app/src/models/error-notice.ts'),
      /kind: 'apply-git-auto-fix'/
    )
    // Store: classification -> action, executor, and rescue-branch outcome.
    const store = source('app/src/lib/stores/app-store.ts')
    assert.match(store, /classifyGitOperationError/)
    assert.match(store, /buildGitAutoFixAction/)
    assert.match(store, /public async _applyGitAutoFix/)
    assert.match(store, /'apply-git-auto-fix'/)
    assert.match(store, /gitAutoFix\.rescueBranch\.successTitle/)
    // Dispatcher passthrough.
    assert.match(
      source('app/src/ui/dispatcher/dispatcher.ts'),
      /public applyGitAutoFix\(/
    )
    // Renderer: action handled and the Fix-it button rendered.
    assert.match(
      source('app/src/ui/app.tsx'),
      /action\.kind === 'apply-git-auto-fix'/
    )
    assert.match(
      source('app/src/ui/error-notice-stack.tsx'),
      /notice\.action\?\.kind === 'apply-git-auto-fix'/
    )
  })

  it('localizes every gitAutoFix key in English and Cantonese', () => {
    const i18n = source('app/src/lib/i18n-resources.ts')
    for (const key of [
      'gitAutoFix.fixIt',
      'gitAutoFix.staleIndexLock.summary',
      'gitAutoFix.autoGcRetry.summary',
      'gitAutoFix.pushNonFastForward.summary',
      'gitAutoFix.pushForbiddenGithubCli.summary',
      'gitAutoFix.detachedHeadRescueBranch.action',
      'gitAutoFix.rescueBranch.successBody',
    ]) {
      const occurrences = i18n.split(`'${key}'`).length - 1
      // One in the union, one in English, one in Cantonese.
      assert.ok(
        occurrences >= 3,
        `${key} is not registered in the union + both catalogs (${occurrences})`
      )
    }
  })
})

describe('containsForcePush', () => {
  it('detects force-push variants and ignores safe commands', () => {
    assert.equal(containsForcePush([['push', '--force']]), true)
    assert.equal(containsForcePush([['push', '-f']]), true)
    assert.equal(containsForcePush([['push', '--force-with-lease']]), true)
    assert.equal(containsForcePush([['push', 'origin', '+main:main']]), true)
    assert.equal(containsForcePush([['pull', '--rebase']]), false)
    assert.equal(containsForcePush([['push', 'origin', 'main']]), false)
    assert.equal(containsForcePush([['fetch', '--all']]), false)
    assert.equal(containsForcePush([]), false)
  })
})
