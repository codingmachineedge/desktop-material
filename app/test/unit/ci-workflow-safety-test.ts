import assert from 'node:assert'
import { readdirSync, readFileSync } from 'fs'
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
const releasePromotionScript = readFileSync(
  join(root, '.github', 'scripts', 'promote-current-release.sh'),
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
const workflowDirectory = join(root, '.github', 'workflows')
const workflowSources = readdirSync(workflowDirectory)
  .filter(file => /\.ya?ml$/.test(file))
  .map(file => ({
    file,
    source: readFileSync(join(workflowDirectory, file), 'utf8'),
  }))

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

  it('publishes once after automatic CI or parallel express gates succeed', () => {
    assert.match(installerWorkflow, /workflow_run:/)
    assert.match(installerWorkflow, /workflows:\s*\n\s*- CI/)
    assert.doesNotMatch(installerWorkflow, /^  push:/m)
    assert.match(installerWorkflow, /CI_CONCLUSION.*workflow_run\.conclusion/)
    assert.match(installerWorkflow, /CI_CONCLUSION" = "success"/)
    assert.match(
      installerWorkflow,
      /packaging an artifact but blocking Release publication/
    )
    assert.match(
      installerWorkflow,
      /needs\.prepare\.outputs\.publish == 'true'/
    )
    assert.match(installerWorkflow, /name: Express lint/)
    assert.match(installerWorkflow, /name: Express tests Windows x64/)
    assert.match(
      installerWorkflow,
      /name: Run unit tests[\s\S]*?yarn test:unit/
    )
    assert.match(
      installerWorkflow,
      /name: Run script tests[\s\S]*?yarn test:script/
    )
    assert.match(
      installerWorkflow,
      /needs\.lint\.result == 'success' && needs\.test\.result == 'success'/
    )
    assert.match(installerWorkflow, /DISPATCH_REF: \$\{\{ github\.ref \}\}/)
    assert.match(installerWorkflow, /DISPATCH_REF" != "refs\/heads\/main"/)
    assert.match(installerWorkflow, /publish="\$ci_can_publish"/)
    assert.match(
      installerWorkflow,
      /bash \.github\/scripts\/promote-current-release\.sh/
    )
    assert.match(
      releasePromotionScript,
      /git ls-remote origin refs\/heads\/main/
    )
    assert.match(
      releasePromotionScript,
      /Published superseded commit \$RELEASE_TARGET_SHA without changing Latest/
    )
    assert.doesNotMatch(installerWorkflow, /softprops\/action-gh-release/)
    assert.equal(
      installerWorkflow.match(/gh release create "\$RELEASE_TAG"/g)?.length,
      1
    )
    assert.match(installerWorkflow, /actions\/upload-artifact@v7/)
    assert.match(installerWorkflow, /compression-level: 0/)
    assert.match(
      installerWorkflow,
      /required=\([\s\S]*?"release-payload\/installers\/GitHub Desktop-x64\.zip"/
    )
    assert.match(installerWorkflow, /fetch-depth: 0/)
    assert.match(
      installerWorkflow,
      /Generate bounded exact-SHA release notes[\s\S]*?generate-automated-release-notes\.ts[\s\S]*?--release-sha "\$RELEASE_TARGET_SHA"/
    )
    assert.match(
      installerWorkflow,
      /Verify required release assets[\s\S]*?Preserve express installer payload[\s\S]*?Generate bounded exact-SHA release notes[\s\S]*?Preserve exact release notes[\s\S]*?Revalidate immutable release tag before publishing[\s\S]*?Verify downloaded release payload[\s\S]*?Publish GitHub release[\s\S]*?Verify published release target[\s\S]*?Promote only a still-current main release/
    )
    assert.match(
      installerWorkflow,
      /--notes-file release-payload\/release-notes\.md/
    )
    assert.doesNotMatch(installerWorkflow, /--fail-on-no-commits/)
    assert.match(
      installerWorkflow,
      /permissions:\s*\n\s*actions: read\s*\n\s*contents: read/
    )
    assert.match(
      installerWorkflow,
      /block_reason: \$\{\{ steps\.target\.outputs\.block_reason \}\}/
    )
    assert.match(installerWorkflow, /block_reason=ci-failed/)
    assert.doesNotMatch(installerWorkflow, /block_reason=stale/)
    assert.doesNotMatch(installerWorkflow, /Record stale non-publishing result/)
    assert.doesNotMatch(installerWorkflow, /became stale while building/)
    assert.doesNotMatch(installerWorkflow, /group: build-installers-publisher/)
    assert.match(
      installerWorkflow,
      /Publish GitHub release[\s\S]*?gh release create[\s\S]*?--latest=false/
    )
    assert.doesNotMatch(installerWorkflow, /^\s+--latest\s*$/m)
    assert.match(releasePromotionScript, /select_highest_target_tag/)
    assert.match(releasePromotionScript, /-f make_latest=true/)
    assert.match(releasePromotionScript, /-f make_latest=false/)
    assert.match(
      releasePromotionScript,
      /current_main_after=\$\(resolve_main\)/
    )
    assert.match(
      releasePromotionScript,
      /reconciled_tag=\$\(select_highest_target_tag\)/
    )
    assert.match(
      releasePromotionScript,
      /current_main_final=\$\(resolve_main\)/
    )
    assert.match(releasePromotionScript, /releases\/latest/)

    const upstreamFailureStep = installerWorkflow.match(
      /- name: Preserve the upstream CI failure result([\s\S]*?)(?=\n      - name:|\n  publish:)/
    )
    assert.notEqual(upstreamFailureStep, null)
    assert.match(
      upstreamFailureStep?.[1] ?? '',
      /if: needs\.prepare\.outputs\.block_reason == 'ci-failed'/
    )
    assert.match(upstreamFailureStep?.[1] ?? '', /exit 1/)

    assert.doesNotMatch(installerWorkflow, /^\s+body: \|/m)
  })

  it('runs every overlapping workflow without replacing older running or pending work', () => {
    assert.match(ciWorkflow, /on:\s*\n\s*push:\s*\n/)
    const pushTrigger = ciWorkflow.match(
      /on:\s*\n\s*push:\s*\n([\s\S]*?)\s+pull_request:/
    )
    assert.notEqual(pushTrigger, null)
    assert.doesNotMatch(pushTrigger?.[1] ?? '', /branches:/)
    assert.doesNotMatch(pushTrigger?.[1] ?? '', /^\s*(?:paths|paths-ignore):/m)
    assert.match(
      ciWorkflow,
      /group: ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/
    )
    assert.match(ciWorkflow, /cancel-in-progress: false/)

    for (const required of ['ci.yml', 'build-installers.yml', 'pages.yml']) {
      const workflow = workflowSources.find(({ file }) => file === required)
      assert.notEqual(workflow, undefined, `${required} must exist`)
      assert.match(
        workflow?.source ?? '',
        /^concurrency:/m,
        `${required} must declare its independent concurrency contract`
      )
    }

    for (const { file, source } of workflowSources) {
      assert.doesNotMatch(
        source,
        /cancel-in-progress:\s*true/,
        `${file} must not cancel an older in-progress workflow run`
      )

      if (/^concurrency:/m.test(source)) {
        assert.match(
          source,
          /^\s+cancel-in-progress:\s*false$/m,
          `${file} concurrency must preserve the older run`
        )
        assert.match(
          source,
          /^  group: [^\r\n]*\$\{\{ github\.run_id \}\}[^\r\n]*\$\{\{ github\.run_attempt \}\}\s*$/m,
          `${file} must use a unique run-and-attempt concurrency group so GitHub cannot replace older pending work`
        )
      }
    }
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
      installerWorkflow.match(/^\s+status=\$\?$/gm)?.length,
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
