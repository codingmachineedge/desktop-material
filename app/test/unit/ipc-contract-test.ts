import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  RequestChannels,
  RequestResponseChannels,
} from '../../src/lib/ipc-shared'

/**
 * These tests verify the IPC channel contract — the set of channels that
 * the renderer and main processes use to communicate. The curated runtime
 * lists below are compile-time checked to ensure they enumerate every
 * channel in the corresponding type exactly once.
 */
describe('IPC channel contract', () => {
  type AssertExactUnion<TExpected, TActual> = [
    Exclude<TExpected, TActual>,
    Exclude<TActual, TExpected>
  ] extends [never, never]
    ? true
    : never

  const expectedRequestChannels = [
    'cancel-actions-artifact-provenance',
    'release-actions-artifact-provenance-credential-lease',
    'invalidate-actions-artifact-provenance-credential-lease-generation',
    'cancel-actions-artifact-subject-operation',
    'release-actions-artifact-download',
    'cancel-actions-transfer',
    'actions-transfer-progress',
    'cancel-github-release-transfer',
    'github-release-transfer-progress',
    'agent-command',
    'agent-command-result',
    'agent-server-status',
    'select-all-window-contents',
    'dialog-did-open',
    'update-menu-state',
    'renderer-ready',
    'execute-menu-item-by-id',
    'show-certificate-trust-dialog',
    'get-app-menu',
    'update-preferred-app-menu-item-labels',
    'uncaught-exception',
    'send-error-report',
    'unsafe-open-directory',
    'menu-event',
    'log',
    'set-verbose-logging',
    'will-quit',
    'will-quit-even-if-updating',
    'cancel-quitting',
    'crash-ready',
    'crash-quit',
    'window-state-changed',
    'error',
    'zoom-factor-changed',
    'window-content-size-changed',
    'app-menu',
    'launch-timing-stats',
    'url-action',
    'cli-action',
    'certificate-error',
    'focus',
    'blur',
    'update-accounts',
    'accounts-changed',
    'quit-and-install-updates',
    'quit-app',
    'open-repository-in-new-window',
    'set-window-title',
    'set-window-repository-state',
    'minimize-window',
    'maximize-window',
    'unmaximize-window',
    'close-window',
    'auto-updater-error',
    'auto-updater-checking-for-update',
    'auto-updater-update-available',
    'auto-updater-update-not-available',
    'auto-updater-update-downloaded',
    'native-theme-updated',
    'set-native-theme-source',
    'update-window-background-color',
    'focus-window',
    'notification-event',
    'set-window-zoom-factor',
    'show-installing-update',
    'install-windows-cli',
    'uninstall-windows-cli',
    'build-run-log',
    'build-run-state',
    'opencode-log',
    'cli-command-output',
    'cli-command-state',
  ] as const

  const expectedResponseChannels = [
    'register-actions-artifact-provenance-credential-lease',
    'verify-actions-artifact-provenance',
    'inspect-actions-artifact-subjects',
    'prepare-actions-artifact-subject',
    'download-actions-artifact',
    'fetch-actions-job-log',
    'download-release-asset',
    'upload-release-asset',
    'get-agent-server-status',
    'set-agent-server-enabled',
    'initialize-agent-server',
    'regenerate-agent-server-token',
    'configure-agent-server',
    'regenerate-agent-server-pairing',
    'revoke-agent-server-device',
    'set-agent-server-gateway-url',
    'set-agent-server-remote-site-url',
    'get-path',
    'get-app-architecture',
    'get-app-path',
    'get-exec-path',
    'is-running-under-arm64-translation',
    'move-to-trash',
    'force-delete-directory',
    'show-item-in-folder',
    'show-contextual-menu',
    'is-window-focused',
    'open-external',
    'is-in-application-folder',
    'move-to-applications-folder',
    'check-for-updates',
    'get-current-window-state',
    'get-current-window-zoom-factor',
    'resolve-proxy',
    'show-save-dialog',
    'show-open-dialog',
    'show-open-dialog-multiple',
    'is-window-maximized',
    'get-apple-action-on-double-click',
    'should-use-dark-colors',
    'save-guid',
    'get-guid',
    'show-notification',
    'get-notifications-permission',
    'request-notifications-permission',
    'start-build-run',
    'cancel-build-run',
    'notification-automation-run-webhook',
    'notification-automation-run-command',
    'opencode-detect',
    'opencode-install',
    'opencode-run-fix',
    'opencode-run-prompt',
    'opencode-cancel',
    'get-cli-workbench-runtime',
    'start-cli-command',
    'cancel-cli-command',
  ] as const

  describe('RequestChannels', () => {
    it('lists every request channel exactly once', () => {
      const isValid: ReadonlyArray<keyof RequestChannels> =
        expectedRequestChannels
      const isExhaustive: AssertExactUnion<
        keyof RequestChannels,
        typeof expectedRequestChannels[number]
      > = true

      assert.equal(isValid.length, expectedRequestChannels.length)
      assert.equal(isExhaustive, true)
    })

    it('includes critical lifecycle channels', () => {
      const critical: ReadonlyArray<keyof RequestChannels> = [
        'renderer-ready',
        'uncaught-exception',
        'will-quit',
        'log',
        'error',
      ]
      for (const channel of critical) {
        assert.ok(
          expectedRequestChannels.includes(channel),
          `Missing critical channel: ${channel}`
        )
      }
    })
  })

  describe('RequestResponseChannels', () => {
    it('lists every request-response channel exactly once', () => {
      const isValid: ReadonlyArray<keyof RequestResponseChannels> =
        expectedResponseChannels
      const isExhaustive: AssertExactUnion<
        keyof RequestResponseChannels,
        typeof expectedResponseChannels[number]
      > = true

      assert.equal(isValid.length, expectedResponseChannels.length)
      assert.equal(isExhaustive, true)
    })

    it('includes critical request-response channels', () => {
      const critical: ReadonlyArray<keyof RequestResponseChannels> = [
        'get-path',
        'open-external',
        'show-save-dialog',
        'show-open-dialog',
        'show-open-dialog-multiple',
        'should-use-dark-colors',
      ]
      for (const channel of critical) {
        assert.ok(
          expectedResponseChannels.includes(channel),
          `Missing critical channel: ${channel}`
        )
      }
    })

    it('keeps raw executables and argv out of the CLI operation request', () => {
      type StartRequest = Parameters<
        RequestResponseChannels['start-cli-command']
      >[0]
      type RawFields = Extract<keyof StartRequest, 'tool' | 'args' | 'cwd'>
      const hasNoRawFields: RawFields extends never ? true : never = true

      assert.equal(hasNoRawFields, true)
    })
  })
})
