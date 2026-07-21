import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const workflow = readFileSync(
  join(process.cwd(), '.github/workflows/super-express-release.yml'),
  'utf8'
)

describe('Super Express Release workflow', () => {
  it('is manual-only and goes straight to a bounded production package', () => {
    assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/)
    assert.doesNotMatch(workflow, /\n\s+(?:push|workflow_run):/)
    assert.match(workflow, /Require a main-branch manual dispatch/)
    assert.match(workflow, /ref: \$\{\{ env\.RELEASE_TARGET_SHA \}\}/)
    assert.match(workflow, /yarn build:prod/)
    assert.match(workflow, /yarn package/)
    assert.doesNotMatch(workflow, /run:\s*yarn (?:lint|test)/)
    assert.doesNotMatch(workflow, /validate-changelog/)
  })

  it('preserves fallback artifacts and publishes a unique immutable release', () => {
    assert.match(workflow, /actions\/upload-artifact@v7/)
    assert.match(workflow, /compression-level: 0/)
    assert.match(workflow, /git ls-remote --exit-code --tags origin/)
    assert.match(workflow, /generate-automated-release-notes\.ts/)
    assert.match(workflow, /gh release create "\$RELEASE_TAG"/)
    assert.match(workflow, /--target "\$RELEASE_TARGET_SHA"/)
    assert.match(workflow, /git rev-parse 'FETCH_HEAD\^\{commit\}'/)
    assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/)
  })
})
