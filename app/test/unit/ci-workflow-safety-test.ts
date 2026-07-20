import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'
import { getMockUpdateEndpoint } from '../e2e/mock-update-server'

const root = process.cwd()
const ciWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'ci.yml'),
  'utf8'
)
const installerWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'build-installers.yml'),
  'utf8'
)
const codeQLWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'codeql.yml'),
  'utf8'
)
const releasePRWorkflow = readFileSync(
  join(root, '.github', 'workflows', 'release-pr.yml'),
  'utf8'
)

describe('CI workflow safety', () => {
  it('uses one configurable loopback endpoint for the E2E build and server', () => {
    assert.deepEqual(getMockUpdateEndpoint('http://127.0.0.1:43123/update'), {
      host: '127.0.0.1',
      port: 43123,
      origin: 'http://127.0.0.1:43123',
      updateURL: 'http://127.0.0.1:43123/update',
      controlURL: 'http://127.0.0.1:43123/_control',
    })
    assert.match(
      ciWorkflow,
      /uses: \.\/\.github\/actions\/setup-e2e-update-port/
    )
    assert.doesNotMatch(ciWorkflow, /127\.0\.0\.1:51789/)
  })

  it('rejects unsafe or ambiguous E2E update endpoints', () => {
    for (const value of [
      'https://127.0.0.1:43123/update',
      'http://localhost:43123/update',
      'http://127.0.0.1/update',
      'http://user:secret@127.0.0.1:43123/update',
      'http://127.0.0.1:43123/other',
    ]) {
      assert.throws(() => getMockUpdateEndpoint(value))
    }
  })

  it('publishes once only after automatic or manual CI succeeds', () => {
    assert.match(installerWorkflow, /workflow_run:/)
    assert.match(installerWorkflow, /workflows:\s*\n\s*- CI/)
    assert.doesNotMatch(installerWorkflow, /^  push:/m)
    assert.match(installerWorkflow, /conclusion == 'success'/)
    assert.match(
      installerWorkflow,
      /needs\.verify-dispatch\.result == 'success'/
    )
    assert.match(installerWorkflow, /github\.ref == 'refs\/heads\/main'/)
    assert.equal(
      installerWorkflow.match(/git ls-remote origin refs\/heads\/main/g)
        ?.length,
      2
    )
    assert.match(
      installerWorkflow,
      /Release target \$RELEASE_TARGET_SHA became stale while building/
    )
    assert.match(installerWorkflow, /draft: false/)
    assert.match(installerWorkflow, /fail_on_unmatched_files: true/)
    assert.equal(
      installerWorkflow.match(/softprops\/action-gh-release@v2/g)?.length,
      1
    )
  })

  it('runs CI on every branch push', () => {
    assert.match(ciWorkflow, /on:\s*\n\s*push:\s*\n/)
    const pushTrigger = ciWorkflow.match(
      /on:\s*\n\s*push:\s*\n([\s\S]*?)\s+pull_request:/
    )
    assert.notEqual(pushTrigger, null)
    assert.doesNotMatch(pushTrigger?.[1] ?? '', /branches:/)
    assert.doesNotMatch(pushTrigger?.[1] ?? '', /^\s*(?:paths|paths-ignore):/m)
  })

  it('builds, packages, and exercises the Windows application only', () => {
    assert.match(ciWorkflow, /os: \[windows-2022\]/)
    assert.match(ciWorkflow, /arch: \[x64, arm64\]/)
    assert.match(ciWorkflow, /friendlyName: Windows/)
    assert.match(ciWorkflow, /Install app on Windows/)
    assert.doesNotMatch(ciWorkflow, /macos|APPLE_/i)
  })

  it('scans the real default branch and supports manual dispatch', () => {
    assert.match(codeQLWorkflow, /push:\s*\n\s*branches: \['main'\]/)
    assert.match(codeQLWorkflow, /pull_request:\s*\n\s*branches: \['main'\]/)
    assert.match(codeQLWorkflow, /workflow_dispatch:/)
    assert.doesNotMatch(codeQLWorkflow, /development/)
  })

  it('uses the supported GitHub App token input for release pull requests', () => {
    assert.match(releasePRWorkflow, /uses: actions\/create-github-app-token@v3/)
    assert.match(
      releasePRWorkflow,
      /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: write/
    )
    assert.match(
      releasePRWorkflow,
      /app-id: \$\{\{ secrets\.DESKTOP_RELEASES_APP_ID \}\}/
    )
    assert.doesNotMatch(releasePRWorkflow, /client-id:/)
  })

  it('fails closed unless the immutable tag query proves no match', () => {
    assert.equal(
      installerWorkflow.match(/status=\$\?/g)?.length,
      2,
      'tag absence must be checked before the build and again before publish'
    )
    assert.equal(
      installerWorkflow.match(
        /Unable to prove release tag \$tag is absent \(git ls-remote exited \$status\)/g
      )?.length,
      2
    )
    assert.match(installerWorkflow, /Release tag \$tag appeared while building/)
    assert.match(
      installerWorkflow,
      /Revalidate immutable release tag before publishing[\s\S]*?Publish GitHub release/
    )
  })
})
