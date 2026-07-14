import assert from 'node:assert'
import { EventEmitter } from 'events'
import { describe, it } from 'node:test'
import { IActionsArtifactDownloadSender } from '../../../src/main-process/actions-artifact-download-registry'
import {
  ActionsArtifactProvenanceCredentialLeaseLifetimeMilliseconds,
  ActionsArtifactProvenanceCredentialLeaseMaximumGlobal,
  ActionsArtifactProvenanceCredentialLeaseMaximumPerSender,
  ActionsArtifactProvenanceCredentialLeaseRegistry,
  normalizeActionsArtifactProvenanceCredentialRegistration,
} from '../../../src/main-process/actions-artifact-provenance-credential-lease'

class TestSender
  extends EventEmitter
  implements IActionsArtifactDownloadSender
{
  private destroyed = false

  public constructor(public readonly id: number) {
    super()
  }

  public isDestroyed(): boolean {
    return this.destroyed
  }

  public navigate(): void {
    this.emit('did-start-navigation')
  }

  public destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

const endpoint = 'https://api.octocorp.ghe.com/'

function registration(
  generation: number = 1,
  login: string = 'octocat',
  id: number = 42
) {
  return {
    accountKey: `${endpoint}#${id}`,
    endpoint,
    login,
    accountsGeneration: generation,
  }
}

function registryWithClock() {
  let now = 1_000
  let nextTimer = 0
  const timers = new Map<number, () => void>()
  const registry = new ActionsArtifactProvenanceCredentialLeaseRegistry({
    now: () => now,
    schedule: callback => {
      const timer = ++nextTimer
      timers.set(timer, callback)
      return timer as unknown as ReturnType<typeof setTimeout>
    },
    cancelSchedule: timer => {
      timers.delete(timer as unknown as number)
    },
  })
  return {
    registry,
    advance(milliseconds: number) {
      now += milliseconds
    },
    fireNextTimer() {
      const next = timers.values().next()
      assert.equal(next.done, false)
      next.value!()
    },
  }
}

describe('Actions artifact provenance credential lease registry', () => {
  it('accepts only the exact current GHE.com Account key shape and safe identity fields', () => {
    assert.deepEqual(
      normalizeActionsArtifactProvenanceCredentialRegistration(registration()),
      registration()
    )
    for (const candidate of [
      { ...registration(), accountKey: `${endpoint}#042` },
      { ...registration(), accountKey: 'https://api.other.ghe.com/#42' },
      { ...registration(), endpoint: 'https://octocorp.ghe.com/' },
      { ...registration(), endpoint: 'https://api.github.com/' },
      { ...registration(), login: 'octo\ncat' },
      { ...registration(), accountsGeneration: -1 },
      { ...registration(), extra: true },
    ]) {
      assert.throws(() =>
        normalizeActionsArtifactProvenanceCredentialRegistration(candidate)
      )
    }
  })

  it('makes a random opaque handle sender-bound and one-use', () => {
    const registry = new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const owner = new TestSender(901)
    const other = new TestSender(902)
    const handle = registry.register(owner, registration())
    assert.match(handle ?? '', /^[a-f0-9]{32}$/)
    assert.equal(registry.claim(other.id, handle, 'a'.repeat(32)), null)
    const claim = registry.claim(owner.id, handle, 'a'.repeat(32))
    assert.ok(claim)
    assert.equal(claim!.endpoint, endpoint)
    assert.equal(claim!.webHost, 'octocorp.ghe.com')
    assert.equal(claim!.isLive(), true)
    assert.equal(registry.claim(owner.id, handle, 'b'.repeat(32)), null)
    assert.equal(registry.complete(owner.id, handle), true)
    assert.equal(claim!.isLive(), false)
    assert.equal(registry.complete(owner.id, handle), false)
    registry.releaseAll()
  })

  it('enforces per-sender and global caps without evicting another sender', () => {
    const registry = new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const first = new TestSender(903)
    for (
      let index = 0;
      index < ActionsArtifactProvenanceCredentialLeaseMaximumPerSender;
      index++
    ) {
      assert.ok(registry.register(first, registration(1, 'octocat', 42)))
    }
    assert.equal(registry.register(first, registration()), null)

    let senderId = 904
    while (
      registry.size < ActionsArtifactProvenanceCredentialLeaseMaximumGlobal
    ) {
      const sender = new TestSender(senderId++)
      assert.ok(registry.register(sender, registration()))
    }
    assert.equal(
      registry.register(new TestSender(senderId), registration()),
      null
    )
    registry.releaseAll()
  })

  it('expires, releases, navigates, and destroys only the matching active operation', () => {
    const { registry, advance, fireNextTimer } = registryWithClock()
    const owner = new TestSender(905)
    const other = new TestSender(906)
    const revoked = new Array<readonly [number, string]>()
    const unsubscribe = registry.onRevoked((senderId, operationId) =>
      revoked.push([senderId, operationId])
    )
    try {
      const first = registry.register(owner, registration())
      const claim = registry.claim(owner.id, first, 'c'.repeat(32))
      assert.ok(claim)
      advance(ActionsArtifactProvenanceCredentialLeaseLifetimeMilliseconds)
      fireNextTimer()
      assert.equal(claim!.signal.aborted, true)
      assert.deepEqual(revoked, [[owner.id, 'c'.repeat(32)]])
      const second = registry.register(other, registration())
      assert.equal(
        registry.claim(other.id, second, 'd'.repeat(32))?.isLive(),
        true
      )

      const navigating = registry.register(owner, registration(2))
      const navigationClaim = registry.claim(
        owner.id,
        navigating,
        'e'.repeat(32)
      )
      assert.ok(navigationClaim)
      owner.navigate()
      assert.equal(navigationClaim!.signal.aborted, true)

      const destroyed = registry.register(other, registration(2))
      const destroyClaim = registry.claim(other.id, destroyed, 'f'.repeat(32))
      assert.ok(destroyClaim)
      other.destroy()
      assert.equal(destroyClaim!.signal.aborted, true)
    } finally {
      unsubscribe()
      registry.releaseAll()
    }
  })

  it('invalidates stale generations and login changes, then cancels the exact claim', () => {
    const registry = new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const sender = new TestSender(907)
    const canceled = new Array<readonly [number, string]>()
    const unsubscribe = registry.onRevoked((senderId, operationId) =>
      canceled.push([senderId, operationId])
    )
    try {
      const first = registry.register(sender, registration(1, 'octocat'))
      const claim = registry.claim(sender.id, first, '1'.repeat(32))
      assert.ok(claim)
      assert.equal(registry.invalidateGeneration(sender, 2), true)
      assert.equal(claim!.signal.aborted, true)
      assert.deepEqual(canceled, [[sender.id, '1'.repeat(32)]])
      assert.equal(registry.register(sender, registration(1)), null)

      const second = registry.register(sender, registration(2, 'octocat'))
      const secondClaim = registry.claim(sender.id, second, '2'.repeat(32))
      assert.ok(secondClaim)
      const replacement = registry.register(sender, registration(2, 'renamed'))
      assert.ok(replacement)
      assert.equal(secondClaim!.signal.aborted, true)
      assert.equal(registry.cancelOperation(sender.id, '2'.repeat(32)), false)
      assert.equal(registry.release(sender.id, replacement), true)
      assert.equal(registry.release(sender.id, replacement), false)
    } finally {
      unsubscribe()
      registry.releaseAll()
    }
  })
})
