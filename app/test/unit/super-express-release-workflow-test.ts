import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { SemVer } from 'semver'

const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/super-express-release.yml'),
  'utf8'
)
const installerWorkflow = readFileSync(
  join(process.cwd(), '.github/workflows/build-installers.yml'),
  'utf8'
)
const promotionScript = readFileSync(
  join(process.cwd(), '.github/scripts/promote-current-release.sh'),
  'utf8'
)
const releasePullRequestWorkflow = readFileSync(
  join(process.cwd(), '.github/workflows/release-pr.yml'),
  'utf8'
)

describe('Super Express Release workflow', () => {
  it('is manual-only and tests before building a bounded production package', () => {
    assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/)
    assert.doesNotMatch(workflow, /\n\s+(?:push|workflow_run):/)
    assert.match(workflow, /Require a main-branch manual dispatch/)
    assert.match(workflow, /ref: \$\{\{ env\.RELEASE_TARGET_SHA \}\}/)
    assert.match(workflow, /run: yarn test:unit/)
    assert.match(workflow, /run: yarn test:script/)
    assert.match(workflow, /yarn build:prod/)
    assert.match(workflow, /yarn package/)
    assert.ok(
      workflow.indexOf('run: yarn test:unit') <
        workflow.indexOf('run: yarn build:prod')
    )
    assert.ok(
      workflow.indexOf('run: yarn test:script') <
        workflow.indexOf('run: yarn build:prod')
    )
    assert.doesNotMatch(workflow, /run:\s*yarn lint/)
    assert.doesNotMatch(workflow, /validate-changelog/)
  })

  it('preserves fallback artifacts and publishes a unique immutable release', () => {
    assert.match(workflow, /actions\/upload-artifact@v7/)
    assert.match(workflow, /compression-level: 0/)
    assert.match(workflow, /git ls-remote --exit-code --tags origin/)
    assert.match(workflow, /git show --no-patch/)
    assert.doesNotMatch(workflow, /generate-automated-release-notes\.ts/)
    assert.match(workflow, /gh release create "\$RELEASE_TAG"/)
    assert.match(workflow, /--target "\$RELEASE_TARGET_SHA"/)
    assert.match(workflow, /--latest=false/)
    assert.doesNotMatch(workflow, /^\s+--latest\s*$/m)
    assert.match(workflow, /git rev-parse 'FETCH_HEAD\^\{commit\}'/)
    assert.match(
      workflow,
      /Promote only a still-current main release[\s\S]*?bash \.github\/scripts\/promote-current-release\.sh/
    )
    assert.match(promotionScript, /git ls-remote origin refs\/heads\/main/)
    assert.match(promotionScript, /select_highest_target_tag/)
    assert.match(promotionScript, /reconciled_tag=/)
    assert.match(promotionScript, /-f make_latest=true/)
    assert.match(promotionScript, /-f make_latest=false/)
    assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/)
  })

  it('uses one Squirrel-monotonic version namespace across release lanes', () => {
    for (const source of [installerWorkflow, workflow]) {
      assert.match(
        source,
        /version=\$\(node script\/release-version\.js create "\$base" "\$GITHUB_RUN_ID"\)/
      )
    }

    assert.doesNotMatch(installerWorkflow, /version="\$\{base\}-b/)
    assert.doesNotMatch(workflow, /version="\$\{base\}-s/)

    const installedLegacySuperExpress = new SemVer('3.6.3-beta3-s000000000201')
    const firstUnifiedRelease = new SemVer('3.6.3-beta3-z029974280506')
    const laterUnifiedRelease = new SemVer('3.6.3-beta3-z029974280507')

    assert.ok(firstUnifiedRelease.compare(installedLegacySuperExpress) > 0)
    assert.ok(laterUnifiedRelease.compare(firstUnifiedRelease) > 0)
  })

  it('targets release pull requests at the Windows product default branch', () => {
    assert.match(releasePullRequestWorkflow, /--base main/)
    assert.doesNotMatch(releasePullRequestWorkflow, /--base development/)
  })
})
