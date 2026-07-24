import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const repositorySource = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'repository.tsx'),
  'utf8'
)
const cheapLfsStyles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_cheap-lfs.scss'),
  'utf8'
)
const materialCardStyles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_material-cards.scss'),
  'utf8'
)

describe('repository section navigation source contract', () => {
  it('uses one complete visible-section mapping for clicks and keyboard navigation', () => {
    assert.equal(
      repositorySource.match(/getRepositorySections\(/g)?.length,
      1,
      'repository navigation must not rebuild a partial section list'
    )
    assert.match(
      repositorySource,
      /private getVisibleRepositorySections\(\)[\s\S]*?this\.supportsGitHubActions\(\)[\s\S]*?this\.showsGitHubReleases\(\)[\s\S]*?this\.showsGitHubIssues\(\)[\s\S]*?this\.showsGitHubAPI\(\)/
    )
    assert.match(
      repositorySource,
      /const shortcut = this\.getVisibleRepositorySections\(\)\[requestedIndex\]/
    )
    assert.match(
      repositorySource,
      /const sections = this\.getVisibleRepositorySections\(\)/
    )
    assert.match(
      repositorySource,
      /const section = this\.getVisibleRepositorySections\(\)\[visualIndex\]/
    )
  })

  it('opens the Cheap LFS manager directly without routing through Releases', () => {
    assert.match(
      repositorySource,
      /id="cheap-lfs-tab"[\s\S]*?RepositorySectionTab\.CheapLfs/
    )
    assert.match(
      repositorySource,
      /selectedSection === RepositorySectionTab\.CheapLfs[\s\S]*?<CheapLfs/
    )
    assert.match(repositorySource, /className="cheap-lfs-manager-view"/)
    assert.match(
      cheapLfsStyles,
      /#repository > \.cheap-lfs-manager-view[\s\S]*?overflow-y: auto/
    )
    assert.match(
      materialCardStyles,
      /#repository > \*:not\(\.repository-rail\)[^{]*:not\(\.cheap-lfs-manager-view\)\s*\{\s*overflow: hidden;/,
      'the higher-specificity card rule must exempt the Cheap LFS scroll owner'
    )
  })
})
